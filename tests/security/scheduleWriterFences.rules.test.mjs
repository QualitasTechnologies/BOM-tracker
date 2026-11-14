import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore'),{fixture}=require('./nativeMilestoneFixture.cjs');
const {createNativeMilestoneOperations}=require('./nativeMilestoneOperations.cjs'),{createNativeProjectOperations}=require('./nativeProjectOperations.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
const accepted={mode:'coexist',scheduleClientWritesFenced:true};let env,db,f,uid,call,projectCall;
before(async()=>{const root=fileURLToPath(new URL('../../',import.meta.url)),rules=await readFile(process.env.FIRESTORE_RULES_PATH?resolve(root,process.env.FIRESTORE_RULES_PATH):resolve(root,'firestore.rules'),'utf8');env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules}});db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});});
after(async()=>{await db?.terminate();await env?.cleanup();});
async function seed(control=accepted,actor='alice',scopedReadsEnabled=false){
 await env.clearFirestore();uid=actor;f=fixture({uid});f.docs.delete('pulseRuntimeControl/cutover');const batch=db.batch();for(const[path,value]of f.docs)batch.set(db.doc(path),value);if(control!==null)batch.set(db.doc('pulseRuntimeControl/cutover'),control);await batch.commit();
 const options={db,auth:f.auth,enabled:true,scopedReadsEnabled,getServerTimestamp:()=>FieldValue.serverTimestamp(),getDeleteField:()=>FieldValue.delete(),now:()=>new Date('2026-11-14T00:00:00Z')};
 const native=createNativeMilestoneOperations(options),project=createNativeProjectOperations(options),request=extra=>({auth:{uid},rawRequest:{get:()=> 'Bearer synthetic-demo'},data:{operation:'get',project_id:'P',expected_actor_uid:uid,...extra}});
 call=extra=>native(request(extra));projectCall=extra=>project(request(extra));
}
beforeEach(()=>seed());
const client=(actor=uid)=>{const user=f.users.get(actor);return env.authenticatedContext(actor,{...user.customClaims,email:user.email,email_verified:true}).firestore();};
const issue=async command=>{const opening=await call();assert.equal(opening.ok,true);const result=await call({operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'native',command});assert.equal(result.ok,true,JSON.stringify(result));return result;};

test('only exact true fences SDK schedule/history and project schedule fields, retaining unrelated writes and reads',async()=>{
 for(const flag of [undefined,false,'true',1,true]){
  await seed(flag===undefined?null:{mode:'coexist',scheduleClientWritesFenced:flag});const sdk=client(),check=flag===true?assertFails:assertSucceeds;
  await assertSucceeds(getDoc(doc(sdk,'projects/P/milestones/one')));await check(updateDoc(doc(sdk,'projects/P/milestones/one'),{status:'completed'}));
  await check(setDoc(doc(sdk,'projects/P/milestones/created'),{name:'Original creation'}));await check(deleteDoc(doc(sdk,'projects/P/milestones/two')));
  await check(setDoc(doc(sdk,'projects/P/delayLogs/original'),{reason:'Original SDK history'}));await check(updateDoc(doc(sdk,'projects/P'),{deadline:'2027-01-03'}));
  await check(deleteDoc(doc(client('admin'),'projects/P')));
  if(flag===true){
   await assertSucceeds(updateDoc(doc(sdk,'projects/P'),{description:'Unrelated metadata'}));
   for(const path of ['projects/P/bom/data','projects/P/overheads/data','projects/P/other/metadata'])await assertSucceeds(setDoc(doc(sdk,path),{kept:true}));
   await assertSucceeds(setDoc(doc(sdk,'projects/NEW'),{projectId:'NEW',deadline:'2027-01-01',memberIds:['alice']}));
   await assertFails(setDoc(doc(sdk,'pulseRuntimeControl/cutover'),{mode:'coexist',scheduleClientWritesFenced:false}));
  }
 }
});
test('stale SDK rows cannot reverse native completion or recreate an archived milestone',async()=>{
 const ref=doc(client(),'projects/P/milestones/one'),stale=(await getDoc(ref)).data();await issue({kind:'status',milestone_id:'one',status:'completed'});await assertFails(setDoc(ref,stale));
 assert.equal((await db.doc('projects/P/milestones/one').get()).data().status,'completed');assert.equal((await db.doc('pulseMilestoneOperations/P/receipts/native').get()).exists,true);
 await seed();const old=(await getDoc(doc(client(),'projects/P/milestones/one'))).data();await issue({kind:'delete',milestone_id:'one'});await assertFails(setDoc(doc(client(),'projects/P/milestones/one'),old));assert.equal((await db.doc('projects/P/milestones/one').get()).exists,false);assert.equal((await db.doc('pulseDeletedMilestones/P/milestones/one').get()).exists,true);
});
test('stale SDK project cannot remove baseline metadata or original milestone dates',async()=>{
 const ref=doc(client(),'projects/P'),stale=(await getDoc(ref)).data();await issue({kind:'baseline_lock'});await assertFails(setDoc(ref,stale));assert.equal((await db.doc('projects/P').get()).data().isBaselined,true);assert.equal((await db.doc('projects/P/milestones/one').get()).data().originalPlannedEndDate,'2026-11-01');
});
test('native deadline plus history cannot be rolled back by a stale original SDK project save',async()=>{
 await db.doc('projects/P').update({isBaselined:true,originalDeadline:'2026-12-20'});const ref=doc(client(),'projects/P'),stale=(await getDoc(ref)).data(),opening=await projectCall();
 const saved=await projectCall({operation:'command',expected_version:opening.version,operation_id:'deadline',command:{kind:'metadata',patch:{deadline:'2027-01-03'},delay:{reason:'Customer approved the later delivery date',attribution:'external-client'}}});assert.equal(saved.ok,true);await assertFails(setDoc(ref,stale));
 assert.equal((await db.doc('projects/P').get()).data().deadline,'2027-01-03');const logs=await db.collection('projects/P/delayLogs').get();assert.equal(logs.docs[0].data().newDate,'2027-01-03');
});
test('committed delay history cannot be updated or removed by any original role',async()=>{
 await db.doc('projects/P').update({isBaselined:true,originalDeadline:'2026-12-20'});await db.doc('projects/P/milestones/one').update({originalPlannedEndDate:'2026-11-01'});
 await issue({kind:'date',milestone_id:'one',new_date:'2026-11-04',delay:{reason:'Customer approval arrived later than planned',attribution:'external-client'}});
 const logs=await db.collection('projects/P/delayLogs').get();assert.equal(logs.size,1);const original=logs.docs[0].data();
 for(const actor of ['alice','partner','admin']){const ref=doc(client(actor),'projects/P/delayLogs/'+logs.docs[0].id);await assertSucceeds(getDoc(ref));await assertFails(updateDoc(ref,{reason:'Untracked edit'}));await assertFails(deleteDoc(ref));}
 assert.deepEqual((await db.doc(logs.docs[0].ref.path).get()).data(),original);
});
test('internal, external and admin native/SDK reads agree for absent, null and listed membership in both read modes',async()=>{
 for(const scoped of [false,true])for(const actor of ['alice','partner','admin'])for(const membership of [undefined,null,[],['alice','partner']]){
  await seed(accepted,actor,scoped);const project=(await db.doc('projects/P').get()).data();if(membership===undefined)delete project.memberIds;else project.memberIds=membership;await db.doc('projects/P').set(project);
  const allowed=actor==='admin'||membership===null||Array.isArray(membership)&&membership.includes(actor),result=await call();assert.equal(result.ok,allowed);
  await (allowed?assertSucceeds:assertFails)(getDoc(doc(client(),'projects/P/milestones/one')));
 }
});
test('fence revocation after opening denies commands and preserves receipt settlement after pause',async()=>{
 const opening=await call(),payload={operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'revoked',command:{kind:'status',milestone_id:'one',status:'completed'}};
 await db.doc('pulseRuntimeControl/cutover').set({mode:'coexist',scheduleClientWritesFenced:false});assert.equal((await call(payload)).error,'milestone_mutations_disabled');assert.equal((await db.doc('projects/P/milestones/one').get()).data().status,'not-started');
 await db.doc('pulseRuntimeControl/cutover').set(accepted);const saved=await call(payload);assert.equal(saved.ok,true);await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only',scheduleClientWritesFenced:true});assert.deepEqual(await call(payload),saved);assert.equal((await call({...payload,resolve_only:true})).resolution,'committed');await assertFails(updateDoc(doc(client(),'projects/P/milestones/one'),{status:'not-started'}));
});
