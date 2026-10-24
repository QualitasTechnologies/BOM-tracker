import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc} from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
const projectId='demo-bom-native-security',require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue,Timestamp,GeoPoint}=require('@google-cloud/firestore');
const {createNativeProjectDocumentOperations}=require('./nativeProjectDocumentOperations.cjs');
const {createNativeMaterialOperations}=require('./nativeMaterialOperations.cjs');
const {fixture}=require('./nativeProjectDocumentFixture.cjs');
let env,db,f,call;
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080}});db=new Firestore({projectId,host:'127.0.0.1:18080',ssl:false});});
beforeEach(async()=>{
 await env.clearFirestore();f=fixture();const batch=db.batch();for(const[path,value]of f.docs)batch.set(db.doc(path),value);await batch.commit();
 const handler=createNativeProjectDocumentOperations({db,auth:f.auth,bucket:f.bucket,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp()});
 call=extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{project_id:'P',...(extra.operation==='get'?{}:{document_id:'document-1',operation_id:'upload-1'}),expected_actor_uid:'alice',...extra}});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
const reserve=()=>call({operation:'reserve',name:'quote.pdf',document_type:'vendor-quote',content_type:'application/pdf',byte_size:f.bytes.length,sha256:require('node:crypto').createHash('sha256').update(f.bytes).digest('hex')});
const get=()=>call({operation:'get'});
const opening=o=>({expected_project_version:o.project_version,expected_bom_version:o.bom_version,expected_document_version:o.document_version});
test('actual rules and native document/material reads agree on missing versus explicit-null project membership',async()=>{
 const base=f.docs.get('projects/P'),project=db.doc('projects/P');
 const material=createNativeMaterialOperations({db,auth:f.auth,mutationsEnabled:false,getServerTimestamp:()=>FieldValue.serverTimestamp()});
 for(const [memberIds,admin,allowed]of [[['alice'],false,true],[null,false,true],[undefined,false,false],[{},false,false],[[],false,false],[undefined,true,true]]){
  const stored={...base};if(memberIds===undefined)delete stored.memberIds;else stored.memberIds=memberIds;
  await project.set(stored);f.actor.customClaims.role=admin?'admin':'viewer';
  const context=env.authenticatedContext('alice',{email:f.actor.email,email_verified:true,status:'approved',role:f.actor.customClaims.role});
  const clientRead=getDoc(doc(context.firestore(),'projects/P'));
  if(allowed)await assertSucceeds(clientRead);else await assertFails(clientRead);
  const documents=await get();assert.equal(documents.ok,allowed);
  const materials=await material({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'get',project_id:'P'}});
  assert.equal(materials.ok,allowed);
  if(!allowed){assert.equal(documents.error,'project_document_forbidden');assert.equal(materials.error,'project_forbidden');}
  assert.deepEqual((await project.get()).data(),stored);
 }
 assert.equal((await db.collection('projectDocuments').get()).size,0);
 assert.equal((await db.collection('pulseProjectDocumentUploads/P/receipts').get()).size,0);
 assert.equal((await db.collection('pulseProjectMaterialOperations/P/materialAudit').get()).size,0);
});

test('real finalization transactions publish one document and receipt and conditional deletion preserves typed raw archive and bytes',async()=>{
 const reservation=await reserve();assert.equal(reservation.ok,true);f.upload(reservation.path);
 const [a,b]=await Promise.all([call({operation:'finalize'}),call({operation:'finalize'})]);assert.equal(a.ok,true);assert.deepEqual(a,b);assert.equal(f.publications(),1);
 assert.equal((await db.collection('projectDocuments').get()).size,1);assert.equal((await db.collection('pulseProjectDocumentUploads/P/audit').get()).size,2);
 const ref=db.doc('projectDocuments/document-1');await ref.update({unknown:{ref:db.doc('legacy/ref'),at:new Timestamp(12,34),point:new GeoPoint(12,34),bytes:Buffer.from([1,2])}});
 const page=await get();assert.equal(page.ok,true);const o=page.documents[0].nativeOpening;
 assert.equal((await call({operation:'delete',operation_id:'delete-1',...opening(o)})).resolution,'committed');assert.equal((await ref.get()).exists,false);
 const archived=(await db.doc('pulseDeletedProjectDocuments/P/documents/document-1').get()).data();assert.equal(archived.document.unknown.ref.path,'legacy/ref');assert.ok(archived.document.unknown.at instanceof Timestamp);assert.ok(archived.document.unknown.point instanceof GeoPoint);assert.deepEqual(archived.document.unknown.bytes,Buffer.from([1,2]));assert.equal(f.objects.size,2);
 assert.equal((await call({operation:'resolve_delete',operation_id:'delete-1',...opening(o)})).resolution,'committed');assert.equal((await db.collection('pulseProjectDocumentMutations/P/audit').get()).size,1);
});
test('real cancellation during publication prevents metadata creation and leaves a recoverable audit trail',async()=>{
 const reservation=await reserve();f.upload(reservation.path);f.options.onPublish=async()=>assert.equal((await call({operation:'cancel'})).resolution,'cancelled');
 assert.equal((await call({operation:'finalize'})).error,'project_document_upload_cancelled');assert.equal((await db.collection('projectDocuments').get()).size,0);assert.equal((await db.collection('pulseProjectDocumentUploads/P/audit').get()).size,2);assert.equal(f.publications(),1);
});
test('a changed BOM after the original opening cannot silently rebase a real deletion',async()=>{
 const reservation=await reserve();f.upload(reservation.path);assert.equal((await call({operation:'finalize'})).ok,true);
 const page=await get();assert.equal(page.ok,true);const o=page.documents[0].nativeOpening;
 await db.doc('projects/P/bom/data').update({changed:true});
 assert.equal((await call({operation:'delete',operation_id:'delete-1',...opening(o)})).error,'project_document_version_conflict');assert.equal((await db.doc('projectDocuments/document-1').get()).exists,true);assert.equal((await db.collection('pulseProjectDocumentMutations/P/audit').get()).size,0);
});
