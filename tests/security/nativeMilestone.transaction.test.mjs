import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
const projectId='demo-bom-native-security',require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue,Timestamp}=require('@google-cloud/firestore');
const {createNativeMilestoneOperations}=require('./nativeMilestoneOperations.cjs');
const {createNativeProjectOperations}=require('./nativeProjectOperations.cjs');
const {fixture}=require('./nativeMilestoneFixture.cjs');
let env,db,data,auth,call;
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080}});db=new Firestore({projectId,host:'127.0.0.1:18080',ssl:false});});
beforeEach(async()=>{
  await env.clearFirestore();data=fixture();const batch=db.batch();for(const[path,value]of data.docs)batch.set(db.doc(path),value);await batch.commit();
  class UserRecord{constructor(value){Object.assign(this,value);}}
  auth={verifyIdToken:async()=>({uid:'alice',email:data.users.get('alice').email}),getUser:async uid=>new UserRecord(data.users.get(uid))};
  const handler=createNativeMilestoneOperations({db,auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),now:()=>new Date('2026-10-15T00:00:00Z')});
  call=extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data:{operation:'get',project_id:'P',expected_actor_uid:'alice',...extra}});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
test('real baseline and concurrent add cannot silently leave a new milestone outside its baseline',async()=>{
  const opening=await call(),base={operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version};
  const [locked,added]=await Promise.all([call({...base,operation_id:'baseline',command:{kind:'baseline_lock'}}),call({...base,operation_id:'new',command:{kind:'add',milestone_id:'new',input:{name:'Commission',currentPlannedEndDate:'2026-12-20'}}})]);
  assert.notEqual(locked.ok,added.ok);const snapshot=await call();
  if(!locked.ok)assert.equal((await call({operation:'command',expected_project_version:snapshot.project_version,expected_schedule_version:snapshot.schedule_version,operation_id:'final-lock',command:{kind:'baseline_lock'}})).ok,true);
  const project=(await db.doc('projects/P').get()).data();assert.equal(project.isBaselined,true);
  const rows=await db.collection('projects/P/milestones').get();for(const row of rows.docs)assert.equal(row.data().originalPlannedEndDate,row.data().currentPlannedEndDate);
});
test('real cancellation fences a late command and protected archive retains original Firestore types',async()=>{
  await db.doc('projects/P/milestones/one').update({legacyTime:Timestamp.fromDate(new Date('2026-10-01'))});
  const opening=await call(),request={operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'race',command:{kind:'status',milestone_id:'one',status:'completed'}};
  const [saved,resolved]=await Promise.all([call(request),call({...request,resolve_only:true})]);assert.equal(resolved.ok,true);
  if(resolved.resolution==='cancelled')assert.equal(saved.error,'milestone_request_cancelled');else assert.equal(saved.ok,true);
  const fresh=await call(),before=(await db.doc('projects/P/milestones/one').get()).data();
  assert.equal((await call({operation:'command',expected_project_version:fresh.project_version,expected_schedule_version:fresh.schedule_version,operation_id:'delete',command:{kind:'delete',milestone_id:'one'}})).ok,true);
  assert.deepEqual((await db.doc('pulseDeletedMilestones/P/milestones/one').get()).data().record,before);
  assert.equal((await db.doc('projects/P/milestones/one').get()).exists,false);
});
test('real baselined project deadline and delay history commit together with metadata cancellation',async()=>{
  await db.doc('projects/P').update({isBaselined:true,originalDeadline:'2026-10-20',deadline:'2026-11-01'});
  const handler=createNativeProjectOperations({db,auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),getDeleteField:()=>FieldValue.delete(),now:()=>new Date('2026-10-15T00:00:00Z')});
  const invoke=extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data:{project_id:'P',expected_actor_uid:'alice',...extra}});
  const opening=await invoke({operation:'get'}),request={operation:'command',expected_version:opening.version,operation_id:'deadline',command:{kind:'metadata',patch:{deadline:'2026-11-04'},delay:{reason:'Customer approved the schedule change',attribution:'external-client'}}};
  assert.equal((await invoke(request)).ok,true);const logs=await db.collection('projects/P/delayLogs').get();assert.equal(logs.size,1);assert.equal(logs.docs[0].data().cumulativeProjectDelay,15);
  await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});assert.equal((await invoke({...request,resolve_only:true})).resolution,'committed');
});
