import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'demo-bom-native-security';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:19199');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { createNativePOAuthoringOperations } = require('./nativePOAuthoringOperations.cjs');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createPOApprovalDispatcher } = require('./poApprovalDispatcher.cjs');
const { managedApprovalNotification } = require('./poApprovalLegacyGuard.cjs');
const { createPOApprovalNotificationOperations } = require('./poApprovalNotificationOperations.cjs');
const { createPOApprovalReconciliation } = require('./poApprovalReconciliation.cjs');
let env, db, data, call, nativeAuth;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
  // Same transaction implementation used by Admin; explicitly emulator-only, with no application credentials.
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
beforeEach(async () => {
  await env.clearFirestore(); data = fixture();
  const batch = db.batch();
  for (const [path, value] of data.docs) batch.set(db.doc(path), value);
  await batch.commit();
  const actor = data.users.get('alice');
  nativeAuth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async uid => structuredClone(data.users.get(uid)),listUsers:async()=>({users:[...data.users.values()]}) };
  const native = createNativePOAuthoringOperations({ db, auth:nativeAuth, enabled: true, getServerTimestamp: () => FieldValue.serverTimestamp() });
  call = payload => native({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic' }, data: { project_id: 'P', expected_actor_uid: 'alice', ...payload } });
});
after(async () => { await db?.terminate(); await env?.cleanup(); });

test('real Firestore concurrent resolution and creation produce exactly one authoritative outcome', async () => {
  const opening = await call({ operation: 'open' }); assert.equal(opening.ok, true);
  let committed = 0;
  for (let i = 0; i < 8; i++) {
    const request = { operation: 'create', po_id: `race-${i}`, operation_id: `race-${i}`, expected_material_version: opening.material_version, input: data.input, billing_snapshot: data.billingSnapshot };
    const [original, resolution] = await Promise.all([call(request), call({ ...request, resolve_only: true })]);
    assert.equal(resolution.ok, true);
    if (resolution.resolution === 'committed') { assert.equal(original.ok, true); committed++; }
    else { assert.equal(resolution.resolution, 'cancelled'); assert.equal(original.error, 'po_request_cancelled'); }
    assert.equal((await db.doc(`projects/P/purchaseOrders/race-${i}`).get()).exists, resolution.resolution === 'committed');
    assert.equal((await call({ ...request, resolve_only: true })).resolution, resolution.resolution);
  }
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 7 + committed);
  assert.equal((await db.collection('pulsePOAuthoringOperations/P/receipts').get()).size, 8);
  assert.equal((await db.collection('pulsePOAuthoringOperations/P/audit').get()).size, 8);
});

test('real Firestore cancellation fences its old nonce while a fresh authorized request can proceed', async () => {
  const opening = await call({ operation: 'open' });
  const request = { operation: 'create', po_id: 'draft', operation_id: 'old', expected_material_version: opening.material_version, input: data.input, billing_snapshot: data.billingSnapshot };
  assert.equal((await call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await call(request)).error, 'po_request_cancelled');
  assert.equal((await call({ ...request, operation_id: 'new' })).ok, true);
  assert.equal((await call(request)).error, 'po_request_cancelled');
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 8);
});

test('real Firestore delete/cancel races preserve the original record or a complete protected archive', async () => {
  const requests=[];
  for (let i=0;i<4;i++) {
    const id=`delete-${i}`, original={...data.docs.get('projects/P/purchaseOrders/existing'),status:'sent',historical:{retained:true,sequence:i}};
    if (i%2===0) {
      original.nativeSendAttemptId=`complete-${i}`;
      await db.doc(`pulseProcurementOperations/P/attempts/complete-${i}`).set({attempt_id:`complete-${i}`,po_id:id,phase:'complete',lease_until:0});
    }
    await db.doc(`projects/P/purchaseOrders/${id}`).set(original);
    const storedOriginal=(await db.doc(`projects/P/purchaseOrders/${id}`).get()).data();
    const opening=await call({operation:'open',po_id:id});assert.equal(opening.permissions.delete,true);
    const request={operation:'command',po_id:id,operation_id:id,expected_po_version:opening.po_version,command:{kind:'delete'}};
    const [removed,resolved]=await Promise.all([call(request),call({...request,resolve_only:true})]);
    assert.equal(resolved.ok,true);requests.push([request,resolved.resolution]);
    const po=await db.doc(`projects/P/purchaseOrders/${id}`).get(),archive=await db.doc(`pulseDeletedPurchaseOrders/P/purchaseOrders/${id}`).get();
    if (resolved.resolution==='committed') {
      assert.equal(removed.ok,true);assert.equal(po.exists,false);assert.equal(archive.exists,true);
      assert.deepEqual(archive.data().record,storedOriginal);assert.equal(archive.data().actor_uid,'alice');
    } else { assert.equal(resolved.resolution,'cancelled');assert.equal(removed.error,'po_request_cancelled');assert.equal(po.exists,true);assert.equal(archive.exists,false); }
  }
  // Guarantee a committed archive comparison even if cancellation wins every race above.
  await db.doc('projects/P/purchaseOrders/existing').update({nativeSendAttemptId:'final-complete',status:'sent'});
  await db.doc('pulseProcurementOperations/P/attempts/final-complete').set({attempt_id:'final-complete',po_id:'existing',phase:'complete',lease_until:0,dispatched_ms:1});
  const exactRecord=(await db.doc('projects/P/purchaseOrders/existing').get()).data();
  const opening=await call({operation:'open',po_id:'existing'});
  const finalRequest={operation:'command',po_id:'existing',operation_id:'confirmed-delete',expected_po_version:opening.po_version,command:{kind:'delete'}};
  assert.equal((await call(finalRequest)).ok,true);
  assert.deepEqual((await db.doc('pulseDeletedPurchaseOrders/P/purchaseOrders/existing').get()).data().record,exactRecord);
  requests.push([finalRequest,'committed']);
  await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});
  for (const [request,outcome] of requests) assert.equal((await call({...request,resolve_only:true})).resolution,outcome);
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber,7);
  assert.equal((await db.collection('pulsePOAuthoringOperations/P/receipts').get()).size,5);
});

test('real approval outbox, fanout and competing delivery triggers preserve one notification per batch',async()=>{
  for(let i=0;i<51;i++){const uid=`notification-admin-${i}`;data.users.set(uid,{uid,email:`a${i}@example.com`,emailVerified:true,customClaims:{role:'admin',status:'approved'}});}
  const opening=await call({operation:'open',po_id:'existing'}),request={operation:'command',po_id:'existing',operation_id:'notify',expected_po_version:opening.po_version,command:{kind:'submit'}};
  const result=await call(request);assert.equal(result.ok,true);assert.match(result.notification_id,/^[a-f0-9]{64}$/);
  const po=(await db.doc('projects/P/purchaseOrders/existing').get()).data();assert.equal(po.status,'pending-approval');assert.equal(po.nativeApprovalNotificationId,result.notification_id);
  assert.equal((await call(request)).notification_id,result.notification_id);assert.equal((await db.collection('pulsePOApprovalNotifications').get()).size,1);
  const cached=await managedApprovalNotification({db,auth:nativeAuth,request:{auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'}},data:{projectId:'P',poId:'existing',mode:'submitted'}});
  assert.equal(cached.queued,true);
  let release,count=0;
  const dispatcher=createPOApprovalDispatcher({db,auth:nativeAuth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),sendEmail:async()=>{
    count++;if(count===1)return new Promise(resolve=>{release=resolve;});return{id:`synthetic-${count}`};
  }});
  const prepared=await dispatcher.prepare(result.notification_id);assert.equal(prepared.delivery_ids.length,2);
  const id=prepared.delivery_ids[0],frozen=(await db.doc(`pulsePOApprovalNotificationDeliveries/${id}`).get()).data();
  data.users.get(frozen.recipients[0].uid).disabled=true;
  const running=dispatcher.deliver(id);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await dispatcher.deliver(id)).state,'pending');assert.equal(count,1);release({id:'synthetic-1'});assert.equal((await running).state,'accepted');
  assert.equal((await dispatcher.deliver(prepared.delivery_ids[1])).state,'accepted');assert.equal(count,2);
  const delivered=(await db.doc(`pulsePOApprovalNotificationDeliveries/${id}`).get()).data();assert.equal(delivered.mail.to.length,frozen.mail.to.length-1);
  const events=await db.collection(`pulsePOApprovalNotificationAudit/${result.notification_id}/events`).get();
  const dispatch=events.docs.map(doc=>doc.data()).find(event=>event.job_id===id&&event.phase==='dispatching');assert.equal(dispatch.mail_hash,delivered.mail_hash);
  assert.equal((await db.doc(`pulsePOApprovalNotifications/${result.notification_id}`).get()).data().state,'accepted');
  await dispatcher.deliver(id);assert.equal(count,2);
});

test('real notification operator retries have one audited receipt and preserve immutable delivery payload',async()=>{
  const opening=await call({operation:'open',po_id:'existing'});
  const submitted=await call({operation:'command',po_id:'existing',operation_id:'operator-submit',expected_po_version:opening.po_version,command:{kind:'submit'}});
  assert.equal(submitted.ok,true);
  const auth={...nativeAuth,verifyIdToken:async()=>({uid:'admin',email:data.users.get('admin').email})};
  let enabled=true;
  const operator=createPOApprovalNotificationOperations({db,auth,enabled:()=>enabled,getServerTimestamp:()=>FieldValue.serverTimestamp()});
  const invoke=extra=>operator({auth:{uid:'admin'},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'status',project_id:'P',po_id:'existing',expected_actor_uid:'admin',...extra}});
  const dispatcher=createPOApprovalDispatcher({db,auth:nativeAuth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),sendEmail:async()=>{throw Error('synthetic lost reply');}});
  const prepared=await dispatcher.prepare(submitted.notification_id),target=prepared.delivery_ids[0];
  assert.equal((await dispatcher.deliver(target)).state,'uncertain');
  const before=(await db.doc(`pulsePOApprovalNotificationDeliveries/${target}`).get()).data(),status=await invoke({});
  assert.equal(status.deliveries[0].can_retry,true);
  const request={operation:'retry',notification_id:submitted.notification_id,expected_revision:status.revision,operation_id:'operator-retry',target_id:target};
  const [left,right]=await Promise.all([invoke(request),invoke(request)]);
  assert.equal(left.ok,true);assert.deepEqual(right,left);
  assert.equal((await db.collection('pulsePOApprovalNotificationOperations').get()).size,1);
  const after=(await db.doc(`pulsePOApprovalNotificationDeliveries/${target}`).get()).data();
  for(const key of ['mail','mail_hash','idempotency_key','recipients','first_dispatched_ms'])assert.deepEqual(after[key],before[key]);
  const events=await db.collection(`pulsePOApprovalNotificationAudit/${submitted.notification_id}/events`).where('phase','==','operator_retry').get();assert.equal(events.size,1);
  enabled=false;await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});assert.deepEqual(await invoke(request),left);
  assert.equal((await invoke({...request,operation_id:'stale-next'})).error,'notification_dispatch_disabled');
  const refused=await invoke({...request,operation_id:'cancelled-next'});assert.equal(refused.request_finalized,true);
  enabled=true;await db.doc('pulseRuntimeControl/cutover').set({mode:'coexist'});
  assert.deepEqual(await invoke({...request,operation_id:'cancelled-next'}),refused);
});

test('real provider evidence reconciliation commits one receipt/audit without sending or changing a message',async()=>{
  const opening=await call({operation:'open',po_id:'existing'});
  const submitted=await call({operation:'command',po_id:'existing',operation_id:'evidence-submit',expected_po_version:opening.po_version,command:{kind:'submit'}});
  const dispatcher=createPOApprovalDispatcher({db,auth:nativeAuth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),sendEmail:async()=>{throw Error('synthetic unknown send');}});
  const parent=await dispatcher.prepare(submitted.notification_id),id=parent.delivery_ids[0];await dispatcher.deliver(id);
  const path=`pulsePOApprovalNotificationDeliveries/${id}`,before=(await db.doc(path).get()).data();
  const auth={...nativeAuth,verifyIdToken:async()=>({uid:'admin',email:data.users.get('admin').email})};
  const request=data=>({auth:{uid:'admin'},rawRequest:{get:()=> 'Bearer synthetic'},data});
  const status=await createPOApprovalNotificationOperations({db,auth,reconciliationEnabled:true})(request({operation:'status',project_id:'P',po_id:'existing',expected_actor_uid:'admin'}));
  assert.equal(status.deliveries[0].can_reconcile,true);
  const provider='4ef9a417-02e9-4d39-ad75-9611e0fcc33c';let enabled=true,lookups=0;
  const evidence={...before.mail,object:'email',id:provider,text:null,bcc:[],cc:[],reply_to:[],created_at:new Date(before.first_dispatched_ms).toISOString(),scheduled_at:null,last_event:'sent'};
  const reconcile=createPOApprovalReconciliation({db,auth,enabled:()=>enabled,getServerTimestamp:()=>FieldValue.serverTimestamp(),lookup:async()=>{lookups++;return evidence;}});
  const payload={operation:'reconcile',project_id:'P',po_id:'existing',expected_actor_uid:'admin',notification_id:submitted.notification_id,delivery_id:id,provider_id:provider,expected_revision:status.revision,operation_id:'verify-evidence'};
  const [left,right]=await Promise.all([reconcile(request(payload)),reconcile(request(payload))]);assert.equal(left.ok,true,JSON.stringify(left));assert.deepEqual(right,left);
  assert.equal((await db.collection('pulsePOApprovalNotificationReconciliations').get()).size,1);
  const audit=await db.collection(`pulsePOApprovalNotificationAudit/${submitted.notification_id}/events`).where('phase','==','provider_evidence_verified').get();assert.equal(audit.size,1);
  const after=(await db.doc(path).get()).data();for(const key of ['mail','mail_hash','idempotency_key','recipients','first_dispatched_ms'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.state,'accepted');assert.equal((await db.doc(`pulsePOApprovalNotifications/${submitted.notification_id}`).get()).data().state,'accepted');
  enabled=false;await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});const previous=lookups;
  assert.deepEqual(await reconcile(request({...payload,resolve_only:true})),left);assert.equal(lookups,previous);
  await db.doc('projects/P/purchaseOrders/existing').delete();await db.doc('projects/P').delete();await db.doc('pulseRuntimeControl/cutover').set({mode:'unknown'});
  assert.deepEqual(await reconcile(request(payload)),left);assert.equal(lookups,previous);
  const cancelled=await reconcile(request({...payload,operation_id:'deleted-cancel',resolve_only:true}));assert.equal(cancelled.request_finalized,true);
  assert.deepEqual(await reconcile(request({...payload,operation_id:'deleted-cancel'})),cancelled);assert.equal(lookups,previous);
});
