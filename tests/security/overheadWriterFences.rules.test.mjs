import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const{Firestore,FieldValue}=require('@google-cloud/firestore');
const{fixture}=require('./nativeOverheadFixture.cjs');
const{createNativeOverheadOperations}=require('./nativeOverheadOperations.cjs');
const accepted={mode:'coexist',overheadClientWritesFenced:true};
let env,db,f;
before(async()=>{
 const rules=await readFile(process.env.FIRESTORE_RULES_PATH?resolve(fileURLToPath(new URL('../../',import.meta.url)),process.env.FIRESTORE_RULES_PATH):new URL('../../firestore.rules',import.meta.url),'utf8');
 env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules}});
 db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
async function seed(control=accepted){
 await env.clearFirestore();f=fixture();f.docs.delete('pulseRuntimeControl/cutover');const batch=db.batch();
 for(const[path,value]of f.docs)batch.set(db.doc(path),value);if(control!==null)batch.set(db.doc('pulseRuntimeControl/cutover'),control);await batch.commit();
}
beforeEach(()=>seed());
const client=(uid='alice')=>{const user=f.users.get(uid);return env.authenticatedContext(uid,{...user.customClaims,email:user.email,email_verified:true}).firestore();};
const handler=(auth=f.auth)=>createNativeOverheadOperations({db,auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),now:()=>new Date('2026-11-14T00:00:00Z')});
const call=(native,extra={})=>native({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'get',project_id:'P',expected_actor_uid:'alice',...extra}});
const issue=async(native,operationId,command)=>{const opening=await call(native);assert.equal(opening.ok,true);return call(native,{operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:operationId,command});};
const edit={kind:'edit_entry',record_id:'entry',input:{date:'2026-10-15',category:'Other',description:'Native edit',amount:45}};

test('only exact-true overhead fencing blocks root SDK create/update/replace/delete, retaining all reads and unrelated writes',async()=>{
 for(const flag of [undefined,false,'true',1,true]){
  await seed(flag===undefined?null:{mode:'coexist',overheadClientWritesFenced:flag});
  const sdk=client(),ref=doc(sdk,'projects/P/overheads/data'),check=flag===true?assertFails:assertSucceeds;
  await assertSucceeds(getDoc(ref));await check(updateDoc(ref,{otherEntries:[]}));
  await check(setDoc(ref,{travelVisits:[],otherEntries:[]}));await check(deleteDoc(ref));await check(setDoc(ref,{travelVisits:[],otherEntries:[]}));
  await assertSucceeds(setDoc(doc(sdk,'projects/P/overheads/data/metadata/legacy'),{note:'retained'}));
  await assertSucceeds(setDoc(doc(sdk,'projects/P/overheads/unrelated'),{note:'retained'}));
  await assertSucceeds(setDoc(doc(sdk,'projects/P/purchaseOrders/draft'),{status:'draft'}));
  await assertFails(setDoc(doc(client('outsider'),'projects/P/overheads/data'),{otherEntries:[]}));
 }
});
test('internal, external and admin SDK writers are equally fenced while their permitted reads survive',async()=>{
 for(const uid of ['alice','partner','admin']){const ref=doc(client(uid),'projects/P/overheads/data');await assertSucceeds(getDoc(ref));await assertFails(updateDoc(ref,{travelVisits:[]}));}
 await assertFails(setDoc(doc(client('admin'),'pulseRuntimeControl/cutover'),{mode:'coexist',overheadClientWritesFenced:false}));
});
test('a fenced stale SDK snapshot cannot overwrite a committed native cost or its receipt/audit',async()=>{
 const ref=doc(client(),'projects/P/overheads/data'),stale=(await getDoc(ref)).data(),native=handler();
 assert.equal((await issue(native,'cost',edit)).ok,true);await assertFails(setDoc(ref,stale));
 assert.equal((await db.doc('projects/P/overheads/data').get()).data().otherEntries[0].amount,45);
 assert.equal((await db.doc('pulseOverheadOperations/P/audit/cost').get()).data().after.amount,45);
 assert.equal((await db.doc('pulseOverheadOperations/P/receipts/cost').get()).exists,true);
});
test('a fenced stale SDK snapshot cannot remove a native expense submission pointer',async()=>{
 const ref=doc(client(),'projects/P/overheads/data'),stale=(await getDoc(ref)).data();
 const saved=await issue(handler(),'submit',{kind:'submit_visit',record_id:'trip'});assert.equal(saved.ok,true);await assertFails(setDoc(ref,stale));
 const visit=(await db.doc('projects/P/overheads/data').get()).data().travelVisits[0];assert.equal(visit.reimbursementStatus,'pending');assert.equal(visit.nativeExpenseNotificationId,saved.notification_id);
 assert.equal((await db.doc('pulseExpenseApprovalNotifications/'+saved.notification_id).get()).exists,true);
});
test('actual transaction reads reject a fence revoked after the opening but before command authorization',async()=>{
 const opening=await call(handler());assert.equal(opening.ok,true);
 let revoked=false;const auth={...f.auth,getUser:async uid=>{if(!revoked){revoked=true;await db.doc('pulseRuntimeControl/cutover').set({mode:'coexist',overheadClientWritesFenced:false});}return f.auth.getUser(uid);}};
 const result=await call(handler(auth),{operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'revoked',command:edit});
 assert.equal(result.error,'overhead_mutations_disabled');assert.equal((await db.doc('projects/P/overheads/data').get()).data().otherEntries[0].amount,20);
 assert.equal((await db.collection('pulseOverheadOperations/P/receipts').get()).size,0);
});
test('read-only cutover retains the fence and permits committed receipt resolution without reopening SDK writes',async()=>{
 const native=handler(),opening=await call(native),payload={operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'saved',command:edit};
 const saved=await call(native,payload);assert.equal(saved.ok,true);
 await db.doc('pulseRuntimeControl/cutover').set({...accepted,mode:'read_only'});
 assert.deepEqual(await call(native,payload),saved);assert.equal((await call(native,{...payload,resolve_only:true})).resolution,'committed');
 await assertFails(updateDoc(doc(client(),'projects/P/overheads/data'),{otherEntries:[]}));
});
