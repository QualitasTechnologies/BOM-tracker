import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
const projectId='demo-bom-native-security',require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue,Timestamp,GeoPoint}=require('@google-cloud/firestore');
const {createNativeOverheadOperations}=require('./nativeOverheadOperations.cjs');
const {createExpenseApprovalDispatcher}=require('./expenseApprovalAdapter.cjs');
const {fixture}=require('./nativeOverheadFixture.cjs');
let env,db,data,auth,call,enabled;
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080}});db=new Firestore({projectId,host:'127.0.0.1:18080',ssl:false});});
beforeEach(async()=>{
  await env.clearFirestore();data=fixture();const batch=db.batch();for(const[path,value]of data.docs)batch.set(db.doc(path),value);await batch.commit();enabled=true;
  class UserRecord{constructor(value){Object.assign(this,value);}}
  auth={verifyIdToken:async()=>({uid:'alice',email:data.users.get('alice').email}),getUser:async uid=>new UserRecord(data.users.get(uid)),listUsers:async()=>({users:[...data.users.values()].map(user=>new UserRecord(user))})};
  const handler=createNativeOverheadOperations({db,auth,enabled:()=>enabled,getServerTimestamp:()=>FieldValue.serverTimestamp(),now:()=>new Date('2026-10-15T00:00:00Z')});
  call=extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data:{operation:'get',project_id:'P',expected_actor_uid:'alice',...extra}});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
const command=async(cmd,nonce)=>{const opening=await call();assert.equal(opening.ok,true);return call({operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:nonce,command:cmd});};
test('real concurrent cost saves reject the stale opening and preserve unrelated raw types in archive',async()=>{
  const costsRef=db.doc('projects/P/overheads/data');
  const raw=(await costsRef.get()).data();raw.legacy={when:Timestamp.fromDate(new Date('2020-01-02')),place:new GeoPoint(12,77),ref:db.doc('projects/P')};raw.otherEntries[0].unknown=raw.legacy;await costsRef.set(raw);
  const opening=await call(),base={operation:'command',expected_project_version:opening.project_version,expected_version:opening.version};
  const [added,deleted]=await Promise.all([
    call({...base,operation_id:'add',command:{kind:'add_entry',record_id:'added',input:{date:'2026-10-15',category:'Other',description:'Permit',amount:5}}}),
    call({...base,operation_id:'delete',command:{kind:'delete_entry',record_id:'entry'}}),
  ]);
  assert.notEqual(added.ok,deleted.ok);assert.equal((added.ok?deleted:added).error,'overhead_version_conflict');
  if(!deleted.ok)assert.equal((await command({kind:'delete_entry',record_id:'entry'},'delete-fresh')).ok,true);
  const current=(await costsRef.get()).data(),archive=(await db.doc('pulseDeletedOverheads/P/records/entry-entry').get()).data();
  assert.deepEqual(current.legacy,raw.legacy);assert.deepEqual(archive.record,raw.otherEntries[0]);assert.equal(current.travelVisits[0].totalCost,100);
});
test('real cancellation fences a late command and committed reimbursement resolves with all write gates off',async()=>{
  const opening=await call(),request={operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:'race',command:{kind:'submit_visit',record_id:'trip'}};
  const [saved,resolved]=await Promise.all([call(request),call({...request,resolve_only:true})]);assert.equal(resolved.ok,true);
  if(resolved.resolution==='cancelled'){assert.equal(saved.error,'overhead_request_cancelled');assert.equal((await db.collection('pulseExpenseApprovalNotifications').get()).size,0);assert.equal((await command({kind:'submit_visit',record_id:'trip'},'fresh')).ok,true);}else assert.equal(saved.ok,true);
  const jobs=await db.collection('pulseExpenseApprovalNotifications').get();assert.equal(jobs.size,1);
  const job=jobs.docs[0];assert.equal(job.data().payload.submitterUid,'alice');assert.equal(job.data().visit_id,'trip');
  const nonce=job.data().operation_id,payload={...request,operation_id:nonce};if(nonce==='fresh'){const receipt=(await db.doc('pulseOverheadOperations/P/receipts/fresh').get()).data();assert.equal(receipt.result.notification_id,job.id);}
  enabled=false;await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});
  if(nonce==='race')assert.equal((await call({...payload,resolve_only:true})).resolution,'committed');
  assert.equal((await call()).permissions.edit,false);
});
test('real expense queue fanout and simultaneous fake-provider delivery have one durable acceptance',async()=>{
  const saved=await command({kind:'submit_visit',record_id:'trip'},'send');assert.equal(saved.ok,true);let sends=0;
  const dispatcher=createExpenseApprovalDispatcher({db,auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),sendEmail:async mail=>{sends++;assert.deepEqual(mail.to,['admin@qualitastech.com']);assert.match(mail.html,/tab=costs/);return{id:'synthetic-no-network'};}});
  const prepared=await dispatcher.prepare(saved.notification_id);assert.equal(prepared.state,'prepared');
  const id=prepared.delivery_ids[0];await Promise.all([dispatcher.deliver(id),dispatcher.deliver(id)]);
  assert.equal((await db.doc('pulseExpenseApprovalNotificationDeliveries/'+id).get()).data().state,'accepted');assert.equal(sends,1);
  assert.equal((await db.doc('pulseExpenseApprovalNotifications/'+saved.notification_id).get()).data().state,'accepted');
});
test('edited approved visit remains the current queued event after Firestore reorders expense map fields',async()=>{
  const ref=db.doc('projects/P/overheads/data'),raw=(await ref.get()).data();raw.travelVisits[0].reimbursementStatus='approved';await ref.set(raw);
  const saved=await command({kind:'edit_visit',record_id:'trip',input:{startDate:'2026-10-15',endDate:'2026-10-16',attendees:['alice'],expenses:[{id:'expense',category:'Transport',amount:150,description:'Taxi'}]}},'edited');assert.equal(saved.ok,true);
  const dispatcher=createExpenseApprovalDispatcher({db,auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),sendEmail:async()=>{throw Error('not used');}});
  assert.equal((await dispatcher.prepare(saved.notification_id)).state,'prepared');
});
