import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,Timestamp} from 'firebase/firestore';
import {ref,uploadBytes,deleteObject,updateMetadata} from 'firebase/storage';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
let env,sequence=1000;const bytes=new Uint8Array([1,2,3]),claims={email:'alice@partner.example',email_verified:true,status:'approved',role:'viewer'};
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')},storage:{host:'127.0.0.1',port:19199,rules:await readFile(new URL('../../storage.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>env.clearFirestore());after(async()=>env.cleanup());
const actor=(uid='alice',extra={})=>env.authenticatedContext(uid,{...claims,...extra});
async function seed({project={memberIds:['alice']},intent={},mode}={}){
 const filename=(++sequence).toString(16).padStart(64,'0')+'.bin',path='projects/P/receipts/native/'+filename;
 await env.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'projects/P'),project);
  await setDoc(doc(context.firestore(),'pulseExpenseReceiptIntents/'+filename),{project_id:'P',visit_id:'draft',expense_id:'taxi',actor_uid:'alice',actor_email:claims.email,path,state:'reserved',content_type:'application/pdf',byte_size:3,expires_at:Timestamp.fromMillis(Date.now()+900000),...intent});
  if(mode)await setDoc(doc(context.firestore(),'pulseRuntimeControl/cutover'),{mode});
 });
 return{filename,path,upload:(context=actor(),metadata={contentType:'application/pdf'})=>uploadBytes(ref(context.storage(),path),bytes,metadata)};
}
test('current external viewers, legacy-list fallback and admins retain receipt creation without category restrictions',async()=>{
 await assertSucceeds((await seed()).upload());await assertSucceeds((await seed({project:{}})).upload());await assertSucceeds((await seed({project:{memberIds:[]}})).upload(actor('alice',{role:'admin'})));
 await assertFails((await seed({project:{memberIds:[]}})).upload());await assertFails((await seed({project:{memberIds:{alice:true}}})).upload());
});
test('protected native objects are create-only; provider token assignment does not create finalized expense proof',async()=>{
 const f=await seed();await assertSucceeds(f.upload());await assertFails(f.upload());await assertFails(updateMetadata(ref(actor().storage(),f.path),{contentType:'image/png'}));await assertFails(deleteObject(ref(actor().storage(),f.path)));
 // The emulator moves this reserved metadata key to downloadTokens before Rules.
 // Token secrecy is not the proof boundary: only the private finalized journal is.
 const g=await seed();await assertSucceeds(g.upload(actor(),{contentType:'application/pdf',customMetadata:{firebaseStorageDownloadTokens:'forged'}}));
});
test('wrong actor, expired/state/type/size/control intents cannot be used through the legacy path rule',async()=>{
 await assertFails((await seed()).upload(actor('bob')));
 for(const intent of [{state:'cancelled'},{state:'finalized'},{byte_size:4},{expires_at:Timestamp.fromMillis(0)},{project_id:'Q'}])await assertFails((await seed({intent})).upload());
 for(const mode of ['read_only','unknown'])await assertFails((await seed({mode})).upload());
 await assertFails((await seed()).upload(actor(),{contentType:'image/png'}));
});
test('even client admins cannot forge expense receipt intents, receipts or audit',async()=>{
 const context=actor('alice',{role:'admin'});
 for(const path of ['pulseExpenseReceiptIntents/forged','pulseExpenseReceiptUploads/P/receipts/forged','pulseExpenseReceiptUploads/P/audit/forged'])await assertFails(setDoc(doc(context.firestore(),path),{state:'finalized'}));
});
