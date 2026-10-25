const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./nativePOAuthoringFixture.cjs');
const {createPOApprovalDispatcher, RETRY_WINDOW} = require('./poApprovalDispatcher.cjs');
const {createPOApprovalNotificationOperations} = require('./poApprovalNotificationOperations.cjs');
const T0 = Date.parse('2026-10-14T00:00:00Z');
async function setup(options = {}) {
  const f = fixture(options.fixture || {});
  const committed = await f.command();
  assert.equal(committed.ok, true);
  let clock = T0, on = true;
  const auth = {...f.auth, listUsers: async () => ({users: [...f.users.values()]})};
  const dispatcher = createPOApprovalDispatcher({db:f.db, auth, enabled:true, now:()=>clock,
    getServerTimestamp:()=>new Date(clock), sendEmail:async()=>{throw Error('unconfirmed secret response');}});
  const handler = createPOApprovalNotificationOperations({db:f.db, auth, enabled:()=>on, now:()=>clock, getServerTimestamp:()=>new Date(clock)});
  const call = (extra = {}) => handler({auth:{uid:'admin'},rawRequest:{get:()=> 'Bearer test'},data:{operation:'status',project_id:'P',po_id:'existing',expected_actor_uid:'admin',...extra}});
  // The fixture's token verifier reflects the current opening account.
  auth.verifyIdToken = async () => ({uid:'admin',email:f.users.get('admin').email});
  const retry = (status, extra={}) => call({operation:'retry',notification_id:status.notification_id,expected_revision:status.revision,operation_id:'retry-1',...extra});
  return {...f,auth,handler,call,retry,dispatcher,id:committed.notification_id,tick:ms=>{clock+=ms;},off:()=>{on=false;}};
}
test('current members can inspect sanitized status with dispatch off; outsiders and changed sessions cannot',async()=>{
  const f=await setup();f.off();const status=await f.call();
  assert.equal(status.ok,true);assert.equal(status.state,'pending');assert.equal(status.dispatch_enabled,false);
  assert.match(status.revision,/^[a-f0-9]{64}$/);assert.equal(status.can_retry_prepare,false);
  assert.doesNotMatch(JSON.stringify(status),/qualitastech|payload|mail_hash|idempotency_key|actor_uid/);
  assert.equal((await f.call({expected_actor_uid:'alice'})).error,'actor_session_changed');
  f.users.get('admin').customClaims.role='viewer';f.docs.get('projects/P').memberIds=[];
  assert.equal((await f.call()).error,'notification_forbidden');
});
test('blocked unattempted preparation requeues atomically once, replay works flag off, and stale revisions fail',async()=>{
  const f=await setup();const path=`pulsePOApprovalNotifications/${f.id}`;
  f.docs.set(path,{...f.docs.get(path),state:'blocked',problem:'invalid_snapshot_or_workspace'});
  const status=await f.call();assert.equal(status.can_retry_prepare,true);
  const result=await f.retry(status);assert.equal(result.ok,true);assert.equal(result.operation_id,'retry-1');
  assert.equal(f.docs.get(path).state,'pending');assert.equal(f.docs.get(path).next_attempt_ms,T0);
  assert.equal([...f.docs.keys()].filter(p=>p.startsWith('pulsePOApprovalNotificationOperations/')).length,1);
  f.off();assert.deepEqual(await f.retry(status),result);
  assert.equal((await f.retry(status,{operation_id:'retry-2'})).error,'notification_dispatch_disabled');
  assert.equal((await f.retry(status,{target_id:'a'.repeat(64)})).error,'notification_request_reused');
});
test('retry preserves immutable message and first-attempt time, rejects active leases and expiry',async()=>{
  const f=await setup();const parent=await f.dispatcher.prepare(f.id),id=parent.delivery_ids[0];
  await f.dispatcher.deliver(id);const path=`pulsePOApprovalNotificationDeliveries/${id}`,before=structuredClone(f.docs.get(path));
  const status=await f.call();assert.equal(status.deliveries[0].can_retry,true);
  const result=await f.retry(status,{target_id:id});assert.equal(result.ok,true);
  for(const key of ['mail','mail_hash','idempotency_key','recipients','first_dispatched_ms'])assert.deepEqual(f.docs.get(path)[key],before[key]);
  assert.equal((await f.retry(status,{target_id:id,operation_id:'another'})).error,'notification_changed');
  f.docs.get(path).lease_until=T0+10000;assert.equal((await f.call()).deliveries[0].can_retry,false);
  f.docs.get(path).lease_until=0;f.tick(RETRY_WINDOW);const expired=await f.call();assert.equal(expired.deliveries[0].can_retry,false);
  assert.equal((await f.retry(expired,{target_id:id,operation_id:'expired'})).error,'notification_retry_forbidden');
});
test('status exposes no notification for old POs, retry requires admin and current event',async()=>{
  const f=await setup();f.users.get('admin').customClaims.role='viewer';
  assert.equal((await f.call()).ok,true);
  const p=f.docs.get(`pulsePOApprovalNotifications/${f.id}`);p.state='blocked';
  assert.equal((await f.retry(await f.call())).error,'notification_forbidden');
  f.users.get('admin').customClaims.role='admin';f.docs.get('projects/P/purchaseOrders/existing').totalAmount=200;
  const changed=await f.call();assert.equal(changed.can_retry_prepare,false);
  assert.equal((await f.retry(changed)).error,'notification_retry_forbidden');
  delete f.docs.get('projects/P/purchaseOrders/existing').nativeApprovalNotificationId;
  assert.equal((await f.call()).state,'none');
});
test('read-only denies retry and provider-shaped errors stay sanitized',async()=>{
  const f=await setup();f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state='blocked';const status=await f.call();
  f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
  assert.equal((await f.call()).dispatch_enabled,false);
  assert.equal((await f.retry(status)).error,'notification_dispatch_disabled');
  f.auth.getUser=async()=>{throw Object.assign(Error('sensitive token'),{status:400,code:'database_secret'});};
  const failed=await f.call();assert.equal(failed.ok,false);assert.doesNotMatch(JSON.stringify(failed),/sensitive|token|database_secret/);
});
test('audit failure rolls back requeue, lost reply safely replays, and removal during reads revokes retry',async()=>{
  const settings={};const f=await setup({fixture:settings}),parentPath=`pulsePOApprovalNotifications/${f.id}`;
  f.docs.get(parentPath).state='blocked';const status=await f.call();
  const originalCreate=f.db.runTransaction;
  f.db.runTransaction=fn=>originalCreate(tx=>fn({...tx,create:(ref,value)=>{if(ref.path.includes('pulsePOApprovalNotificationAudit/'))throw Error('audit secret');return tx.create(ref,value);}}));
  assert.equal((await f.retry(status)).error,'notification_service_unavailable');
  assert.equal(f.docs.get(parentPath).state,'blocked');
  f.db.runTransaction=originalCreate;settings.loseCommitReply=true;
  const recovered=await f.retry(status);assert.equal(recovered.ok,true);
  const replay=await f.retry(status);assert.deepEqual(replay,recovered);
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationOperations/')).length,1);
  settings.onRead=async path=>{if(path===parentPath)f.users.get('admin').disabled=true;};
  assert.equal((await f.retry(status)).error,'actor_forbidden');
});
test('accepted and reconciliation-only deliveries cannot be reopened, and malformed requests never write',async()=>{
  const f=await setup(),parent=await f.dispatcher.prepare(f.id),child=parent.delivery_ids[0],path=`pulsePOApprovalNotificationDeliveries/${child}`;
  for(const state of ['accepted','needs_reconciliation','skipped']){
    f.docs.get(path).state=state;const status=await f.call();assert.equal(status.deliveries[0].can_retry,false);
    assert.equal((await f.retry(status,{target_id:child,operation_id:state})).error,'notification_retry_forbidden');
  }
  const receiptCount=[...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationOperations/')).length;
  assert.equal((await f.call({to:['evil@example.com']})).error,'invalid_notification_request');
  assert.equal((await f.call({operation:'retry',notification_id:f.id,expected_revision:'invalid',operation_id:'retry'})).error,'invalid_notification_request');
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationOperations/')).length,receiptCount);
});
test('a refused retry creates an atomic cancellation receipt that fences delayed requeues',async()=>{
  const f=await setup();f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state='blocked';const status=await f.call();
  f.off();const refused=await f.retry(status);assert.equal(refused.error,'notification_dispatch_disabled');assert.equal(refused.request_finalized,true);assert.equal(refused.operation_id,'retry-1');
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationOperations/')).length,1);
  assert.deepEqual(await f.retry(status),refused);
});
test('status uses a read-only snapshot transaction and retry audit preserves its safety basis',async()=>{
  const f=await setup(),options=[],run=f.db.runTransaction;
  f.db.runTransaction=(fn,opts)=>{options.push(opts);return run(fn);};
  f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state='blocked';const status=await f.call();
  assert.equal(options[0]?.readOnly,true);await f.retry(status);
  assert.notEqual(options[1]?.readOnly,true);
  const audit=[...f.docs].find(([path,row])=>path.startsWith('pulsePOApprovalNotificationAudit/')&&row.phase==='operator_retry')[1];
  assert.equal(audit.previous_state,'blocked');assert.equal(audit.expected_revision,status.revision);assert.equal(audit.first_dispatched_ms,null);assert.equal(audit.control_mode,'coexist');
});
