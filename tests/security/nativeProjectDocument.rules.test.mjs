import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,query,where,collection,updateDoc,deleteDoc,Timestamp} from 'firebase/firestore';
import {ref,uploadBytes,deleteObject,updateMetadata,getBytes} from 'firebase/storage';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
let env,sequence=2000;const claims={email:'alice@partner.example',email_verified:true,status:'approved',role:'viewer'};
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')},storage:{host:'127.0.0.1',port:19199,rules:await readFile(new URL('../../storage.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{await env.clearFirestore();await env.clearStorage();});after(async()=>env.cleanup());
const actor=(uid='alice',extra={})=>env.authenticatedContext(uid,{...claims,...extra});
const FINAL_STATE={state:'finalized'};
async function seed({project={memberIds:['alice']},intent={},mode,size=3}={}){
 const filename=(++sequence).toString(16).padStart(64,'0')+'.bin',path='projects/P/documents/native/staging/'+filename,finalPath='projects/P/documents/native/finalized/'+filename,bytes=new Uint8Array(size);
 await env.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'projects/P'),project);
  await setDoc(doc(context.firestore(),'pulseProjectDocumentUploadIntents/'+filename),{project_id:'P',document_id:'d1',document_type:'vendor-quote',actor_uid:'alice',actor_email:claims.email,path,final_path:finalPath,state:'reserved',content_type:'application/x-odd',byte_size:size,expires_at:Timestamp.fromMillis(Date.now()+900000),...intent});
  if(mode)await setDoc(doc(context.firestore(),'pulseRuntimeControl/cutover'),{mode});
 });
 return{filename,path,finalPath,upload:(context=actor(),metadata={contentType:'application/x-odd'},data=bytes)=>uploadBytes(ref(context.storage(),path),data,metadata)};
}
async function publish(f,extra={}){
 await env.withSecurityRulesDisabled(async context=>{
  await uploadBytes(ref(context.storage(),f.finalPath),new Uint8Array([1,2,3]),{contentType:'application/x-odd'});
  await updateDoc(doc(context.firestore(),'pulseProjectDocumentUploadIntents/'+f.filename),{...FINAL_STATE,...extra});
 });
}
test('current members, legacy-list fallback and admins stage any original MIME including zero bytes; non-members fail',async()=>{
 await assertSucceeds((await seed()).upload());await assertSucceeds((await seed({project:{}})).upload());await assertSucceeds((await seed({project:{memberIds:[]}})).upload(actor('alice',{role:'admin'})));
 await assertSucceeds((await seed({size:0})).upload());await assertSucceeds((await seed({intent:{content_type:'text/x-weird; charset=utf-8'}})).upload(actor(),{contentType:'text/x-weird; charset=utf-8'}));
 await assertFails((await seed({project:{memberIds:[]}})).upload());await assertFails((await seed({project:{memberIds:{alice:true}}})).upload());
 await assertFails((await seed()).upload(actor('alice',{status:'pending'})));await assertFails((await seed()).upload(actor('alice',{email_verified:false})));await assertFails((await seed()).upload(actor('alice',{role:'guest'})));
 await assertFails((await seed()).upload(env.unauthenticatedContext()));
});
test('customer-po staging requires a current admin even for a project member',async()=>{
 const intent={document_type:'customer-po'};
 await assertFails((await seed({intent})).upload());await assertSucceeds((await seed({intent})).upload(actor('alice',{role:'admin'})));
});
test('reserved actor, path, project, state, expiry, type and size are exact',async()=>{
 await assertFails((await seed()).upload(actor('bob')));await assertFails((await seed({intent:{actor_email:'other@partner.example'}})).upload());
 for(const intent of [{state:'cancelled'},{state:'finalized'},{byte_size:4},{expires_at:Timestamp.fromMillis(0)},{project_id:'Q'},{path:'projects/P/documents/native/staging/'+'0'.repeat(64)+'.bin'},{content_type:'image/png'}])await assertFails((await seed({intent})).upload());
 // Existing private staging grants can complete after cutover; only server
 // finalization can publish metadata, and it checks the control document.
 for(const mode of ['read_only','unknown','pulse_only']){const f=await seed({mode});await assertSucceeds(f.upload());await assertFails(getBytes(ref(actor().storage(),f.path)));await assertFails(getBytes(ref(actor().storage(),f.finalPath)));}
 await assertFails((await seed()).upload(actor(),{contentType:'image/png'}));await assertFails((await seed()).upload(actor(),{contentType:'application/x-odd'},new Uint8Array(4)));
 await assertFails((await seed({size:10*1024*1024,intent:{byte_size:10*1024*1024}})).upload());
 const missing='projects/P/documents/native/staging/'+'a'.repeat(64)+'.bin';await assertFails(uploadBytes(ref(actor().storage(),missing),new Uint8Array(1),{contentType:'application/x-odd'}));
});
test('staging is create-only and unreadable; finalized is server-only with current-access reads',async()=>{
 const f=await seed();await assertSucceeds(f.upload());await assertFails(f.upload());
 await assertFails(getBytes(ref(actor().storage(),f.path)));await assertFails(updateMetadata(ref(actor().storage(),f.path),{contentType:'image/png'}));await assertFails(deleteObject(ref(actor().storage(),f.path)));
 await assertFails(uploadBytes(ref(actor().storage(),f.finalPath),new Uint8Array(3),{contentType:'application/x-odd'}));await assertFails(uploadBytes(ref(actor('alice',{role:'admin'}).storage(),f.finalPath),new Uint8Array(3),{contentType:'application/x-odd'}));
 await assertFails(getBytes(ref(actor().storage(),f.finalPath)));
 await publish(f);
 await assertSucceeds(getBytes(ref(actor().storage(),f.finalPath)));await assertSucceeds(getBytes(ref(actor('bob',{role:'admin'}).storage(),f.finalPath)));await assertFails(getBytes(ref(actor('bob').storage(),f.finalPath)));
 await assertFails(getBytes(ref(actor('alice',{status:'pending'}).storage(),f.finalPath)));await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),f.finalPath)));
 await assertFails(updateMetadata(ref(actor().storage(),f.finalPath),{contentType:'image/png'}));await assertFails(deleteObject(ref(actor().storage(),f.finalPath)));await assertFails(deleteObject(ref(actor('alice',{role:'admin'}).storage(),f.finalPath)));
});
test('finalized customer-po reads need admin; mismatched final_path is unreadable',async()=>{
 const f=await seed({intent:{document_type:'customer-po'}});await publish(f);
 await assertFails(getBytes(ref(actor().storage(),f.finalPath)));await assertSucceeds(getBytes(ref(actor('alice',{role:'admin'}).storage(),f.finalPath)));
 const g=await seed();await publish(g,{final_path:'projects/P/documents/native/finalized/'+'b'.repeat(64)+'.bin'});
 await assertFails(getBytes(ref(actor().storage(),g.finalPath)));
});
test('legacy documents/{type}/{file} grant keeps working and does not reach native segments',async()=>{
 const context=actor();await assertSucceeds(uploadBytes(ref(context.storage(),'projects/P/documents/vendor-quote/legacy.pdf'),new Uint8Array(3),{contentType:'application/pdf'}));
 await assertFails(uploadBytes(ref(context.storage(),'projects/P/documents/native/staging/not-hex.bin'),new Uint8Array(3),{contentType:'application/x-odd'}));
 await assertFails(uploadBytes(ref(context.storage(),'projects/P/documents/native/finalized/'+'c'.repeat(64)+'.bin'),new Uint8Array(3),{contentType:'application/x-odd'}));
});
test('marked project document metadata is closed to every client write including admins; legacy rows coexist',async()=>{
 const marker={operation_id:'o',path:'p',generation:'1'};
 await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,'projects/P'),{memberIds:['alice']});await setDoc(doc(db,'projectDocuments/marked'),{projectId:'P',name:'n',type:'vendor-quote',pulseNativeDocument:marker});await setDoc(doc(db,'projectDocuments/legacy'),{projectId:'P',name:'old'});});
 for(const context of [actor(),actor('alice',{role:'admin'})]){
  const db=context.firestore();
  await assertSucceeds(getDoc(doc(db,'projectDocuments/marked')));
  await assertFails(setDoc(doc(db,'projectDocuments/new-marked'),{projectId:'P',pulseNativeDocument:marker}));
  await assertFails(updateDoc(doc(db,'projectDocuments/marked'),{name:'x'}));await assertFails(setDoc(doc(db,'projectDocuments/marked'),{projectId:'P'}));await assertFails(deleteDoc(doc(db,'projectDocuments/marked')));
  await assertFails(updateDoc(doc(db,'projectDocuments/legacy'),{pulseNativeDocument:marker}));await assertFails(setDoc(doc(db,'projectDocuments/legacy'),{projectId:'P',pulseNativeDocument:marker}));
 }
 const db=actor().firestore();
 await assertSucceeds(setDoc(doc(db,'projectDocuments/fresh'),{projectId:'P',name:'new'}));await assertSucceeds(updateDoc(doc(db,'projectDocuments/legacy'),{name:'renamed'}));await assertSucceeds(getDoc(doc(db,'projectDocuments/legacy')));await assertSucceeds(deleteDoc(doc(db,'projectDocuments/legacy')));
 await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'projectDocuments/anon'),{projectId:'P'}));
});
test('private project document namespaces are denied to every client including admins',async()=>{
 for(const context of [actor(),actor('alice',{role:'admin'})])for(const path of ['pulseProjectDocumentUploadIntents/forged','pulseProjectDocumentUploads/P/documents/forged','pulseProjectDocumentUploads/P/audit/forged','pulseProjectDocumentMutations/forged','pulseDeletedProjectDocuments/P/documents/forged']){
  await assertFails(setDoc(doc(context.firestore(),path),{state:'finalized'}));await assertFails(getDoc(doc(context.firestore(),path)));
 }
});
test('spec-search receipts and audit records are unreadable and unwritable to members and admins',async()=>{
 const paths=['pulseSpecSearchReceipts/receipt-1','pulseSpecSearchAudit/audit-1'];
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,paths[0]),{actor_uid:'alice',project_id:'P',item_id:'i1',state:'completed'});
  await setDoc(doc(db,paths[1]),{actor_uid:'alice',project_id:'P',item_id:'i1',outcome:'completed'});
 });
 for(const context of [actor(),actor('alice',{role:'admin'})])for(const path of paths){
  const reference=doc(context.firestore(),path);
  await assertFails(getDoc(reference));
  await assertFails(setDoc(reference,{state:'forged'}));
  await assertFails(updateDoc(reference,{state:'forged'}));
  await assertFails(deleteDoc(reference));
 }
});
test('legacy all-type SDK queries remain available during coexistence',async()=>{
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();await setDoc(doc(db,'projects/P'),{memberIds:['alice']});
  for(const type of ['vendor-quote','customer-po'])await setDoc(doc(db,'projectDocuments/'+type),{projectId:'P',type,name:'n',url:'https://example.test/no-token',pulseNativeDocument:{operation_id:'o',path:'p',generation:'1'}});
  await setDoc(doc(db,'projectDocuments/old'),{projectId:'P',type:'vendor-quote'});
 });
 for(const context of [actor(),actor('bob'),actor('alice',{role:'admin'})]){
  const db=context.firestore();assert.equal((await assertSucceeds(getDocs(query(collection(db,'projectDocuments'),where('projectId','==','P'))))).size,3);
  assert.equal((await assertSucceeds(getDocs(query(collection(db,'projectDocuments'),where('projectId','==','P'),where('type','==','vendor-quote'))))).size,2);
 }
});
