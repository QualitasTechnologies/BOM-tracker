import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
const projectId='demo-bom-native-security',require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore');
const {createNativeUploadOperations}=require('./nativeUploadOperations.cjs');
const {createNativeMaterialOperations}=require('./nativeMaterialOperations.cjs');
let env,db,actor,bytes,staging,canonical,metadata,publications,enabled,beforePublish,beforeCreate,preconditionFailures,photo,material;
before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080}});
  db=new Firestore({projectId,host:'127.0.0.1:18080',ssl:false});
});
beforeEach(async()=>{
  await env.clearFirestore();actor={uid:'alice',email:'alice@qualitastech.com',emailVerified:true,customClaims:{role:'viewer',status:'approved'}};
  bytes=Buffer.from([255,216,255,1,255,217]);staging=bytes;canonical=undefined;metadata=undefined;publications=0;enabled=true;beforePublish=null;beforeCreate=null;preconditionFailures=0;
  await db.doc('projects/P').set({projectId:'P',memberIds:['alice']});
  await db.doc('projects/P/bom/data').set({categories:[{name:'Parts',items:[{id:'bolt',quantity:2,itemType:'component',status:'ordered',unknown:'preserve'}]}]});
  await db.doc('pulseMaterialCutovers/P').set({project_id:'P',established_by:'reviewed-operator',source:'reviewed_cutover'});
  await db.doc('projectDocuments/invoice').set({projectId:'P',type:'vendor-invoice'});
  class UserRecord{constructor(value){Object.assign(this,value);}}
  const auth={verifyIdToken:async()=>({uid:'alice',email:actor.email}),getUser:async()=>new UserRecord(actor)};
  const bucket={name:'visionbomtracker.firebasestorage.app',file:(path,options)=>{
    const final=path.includes('/finalized/');return{
      getMetadata:async()=>{const value=final?canonical:staging;if(!value)throw Object.assign(Error('missing'),{code:404});return[{generation:final?'19':'7',size:String(value.length),contentType:'image/jpeg',...(final?metadata:{})}];},
      createReadStream:()=>{assert.equal(options.generation,final?'19':'7');return Readable.from([final?canonical:staging]);},
      save:async(value,settings)=>{assert.equal(settings.preconditionOpts.ifGenerationMatch,0);await beforeCreate?.();if(canonical){preconditionFailures++;throw Object.assign(Error('exists'),{code:412});}canonical=Buffer.from(value);metadata=settings.metadata;publications++;await beforePublish?.();},
    };
  }};
  const photos=createNativeUploadOperations({db,auth,bucket,enabled:()=>enabled,getServerTimestamp:()=>FieldValue.serverTimestamp()});
  const materials=createNativeMaterialOperations({db,auth,mutationsEnabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp()});
  const request=data=>({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data});
  photo=extra=>photos(request({project_id:'P',item_id:'bolt',operation_id:'photo-1',expected_actor_uid:'alice',...extra}));
  material=data=>materials(request({project_id:'P',...data}));
});
after(async()=>{await db?.terminate();await env?.cleanup();});
const reserve=()=>photo({operation:'reserve',content_type:'image/jpeg',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const fulfill=async url=>{
  const opening=await material({operation:'get'});assert.equal(opening.ok,true);
  return material({operation:'fulfill',item_id:'bolt',expected_actor_uid:'alice',expected_version:opening.version,operation_id:'receive-1',fulfillment:{kind:'receipt',quantity:1,invoiceDocId:'invoice',photoUrl:url,loggedAt:'2026-10-16'}});
};
test('real competing photo finalizations produce one canonical object and private proof accepted by material receipt',async()=>{
  assert.equal((await reserve()).ok,true);
  let arrivals=0,release;const bothCreating=new Promise(resolve=>{release=resolve;});
  beforeCreate=()=>{if(++arrivals===2)release();return bothCreating;};
  const [a,b]=await Promise.all([photo({operation:'finalize'}),photo({operation:'finalize'})]);
  assert.equal(a.ok,true);assert.deepEqual(a,b);assert.equal(publications,1);assert.equal(preconditionFailures,1);assert.equal(a.generation,'19');
  assert.equal((await db.collection('pulseNativeUploadOperations/P/audit').get()).size,2);
  assert.equal((await fulfill(a.photo_url)).ok,true);
  const item=(await db.doc('projects/P/bom/data').get()).data().categories[0].items[0];
  assert.equal(item.fulfillmentTranches.length,1);assert.equal(item.receivedPhotoUrl,a.photo_url);assert.equal(item.unknown,'preserve');
  assert.equal((await db.collection('pulseProjectMaterialOperations/P/materialAudit').get()).size,1);
});
test('a delayed staging replacement cannot replace canonical bytes or become a material attachment',async()=>{
  await reserve();beforePublish=()=>{staging=Buffer.from([255,216,255,9,255,217]);};
  const saved=await photo({operation:'finalize'});assert.equal(saved.ok,true);assert.deepEqual(canonical,bytes);assert.notDeepEqual(staging,canonical);
  assert.equal((await fulfill(saved.photo_url.replace('finalized','native'))).error,'receipt_photo_unverified');
  assert.equal((await db.collection('pulseProjectMaterialOperations/P/materialAudit').get()).size,0);
  assert.equal((await fulfill(saved.photo_url)).ok,true);
});
test('revocation during publication leaves no finalized proof and no material mutation',async()=>{
  await reserve();beforePublish=()=>{actor.disabled=true;};
  assert.equal((await photo({operation:'finalize'})).error,'actor_forbidden');
  assert.equal((await db.doc('pulseNativeUploadOperations/P/receipts/photo-1').get()).data().finalized,undefined);
  assert.equal((await db.doc('projects/P/bom/data').get()).data().categories[0].items[0].fulfillmentTranches,undefined);
  assert.equal((await db.collection('pulseNativeUploadOperations/P/audit').get()).size,1);
  assert.equal((await photo({operation:'finalize'})).error,'actor_forbidden');
});
