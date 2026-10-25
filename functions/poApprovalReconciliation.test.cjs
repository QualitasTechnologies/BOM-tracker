const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativePOAuthoringFixture.cjs');
const {createPOApprovalDispatcher}=require('./poApprovalDispatcher.cjs');
const {createPOApprovalNotificationOperations}=require('./poApprovalNotificationOperations.cjs');
const {createPOApprovalReconciliation}=require('./poApprovalReconciliation.cjs');
const PROVIDER='4ef9a417-02e9-4d39-ad75-9611e0fcc33c',T0=Date.parse('2026-10-14T00:00:00Z');
async function setup(options={}){
  const settings={},f=fixture(settings),approval=await f.command();
  const auth={...f.auth,verifyIdToken:async()=>({uid:'admin',email:f.users.get('admin').email}),listUsers:async()=>({users:[...f.users.values()]})};
  const dispatcher=createPOApprovalDispatcher({db:f.db,auth,enabled:true,now:()=>T0,getServerTimestamp:()=>new Date(T0),sendEmail:async()=>{throw Error('unknown');}});
  const parent=await dispatcher.prepare(approval.notification_id),child=parent.delivery_ids[0];await dispatcher.deliver(child);
  let enabled=true,calls=0;const job=f.docs.get(`pulsePOApprovalNotificationDeliveries/${child}`),mail=job.mail;
  const evidence={...structuredClone(mail),id:PROVIDER,object:'email',text:null,bcc:[],cc:[],reply_to:[],scheduled_at:null,created_at:new Date(T0+100).toISOString(),last_event:'delivered'};
  const handler=createPOApprovalReconciliation({db:f.db,auth,enabled:()=>enabled,now:()=>T0+25*3600000,getServerTimestamp:()=>new Date(T0+25*3600000),lookup:async id=>{calls++;if(options.lookup)await options.lookup(f);assert.equal(id,PROVIDER);return evidence;}});
  const request=data=>({auth:{uid:'admin'},rawRequest:{get:()=> 'Bearer fake'},data});
  const status=await createPOApprovalNotificationOperations({db:f.db,auth,enabled:false,now:()=>T0+25*3600000})(request({operation:'status',project_id:'P',po_id:'existing',expected_actor_uid:'admin'}));
  const payload={operation:'reconcile',project_id:'P',po_id:'existing',expected_actor_uid:'admin',notification_id:approval.notification_id,delivery_id:child,provider_id:PROVIDER,operation_id:'evidence-1',expected_revision:status.revision};
  return{...f,settings,auth,job,evidence,payload,call:extra=>handler(request({...payload,...extra})),off:()=>{enabled=false;},calls:()=>calls};
}
test('verified matching provider evidence resolves an expired ambiguity once with no resend',async()=>{
  const f=await setup();const result=await f.call();assert.equal(result.ok,true);assert.equal(result.state,'accepted');assert.equal(result.provider_event,'delivered');
  assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.payload.notification_id}`).state,'accepted');
  f.off();assert.deepEqual(await f.call(),result);assert.equal(f.calls(),1);
  assert.doesNotMatch(JSON.stringify(result),/@|html|mail_hash|provider_id/);
});
test('wrong provider payload never records acceptance; cancellation fences delayed verification',async()=>{
  const f=await setup();f.evidence.html='wrong';assert.equal((await f.call()).ok,false);assert.notEqual(f.job.state,'accepted');
  const cancelled=await f.call({resolve_only:true});assert.equal(cancelled.request_finalized,true);
  assert.equal((await f.call()).error,'notification_reconciliation_cancelled');assert.equal(f.calls(),1);
});
test('lost metadata acknowledgement replays committed evidence after flag off without another lookup',async()=>{
  const f=await setup();f.settings.loseCommitReply=true;assert.equal((await f.call()).ok,false);f.off();
  assert.equal((await f.call()).ok,true);assert.equal(f.calls(),1);
});
test('a changed frozen job or removed admin during lookup cannot commit stale evidence',async()=>{
  const f=await setup({lookup:async state=>{[...state.docs].find(([path])=>path.startsWith('pulsePOApprovalNotificationDeliveries/'))[1].state='needs_reconciliation';}});
  // Use a closed-over lookup instead of exposing mutable request input to provider code.
  const g=await setup({lookup:async state=>{state.users.get('admin').disabled=true;}});
  assert.equal((await g.call()).error,'actor_forbidden');
  assert.equal((await f.call()).ok,false);
});
test('disabled, non-admin and active lease fail before provider access, and readonly permits metadata only',async()=>{
  const f=await setup();f.off();assert.equal((await f.call()).error,'notification_reconciliation_disabled');assert.equal(f.calls(),0);
  const g=await setup();g.users.get('admin').customClaims.role='viewer';assert.equal((await g.call()).error,'notification_forbidden');assert.equal(g.calls(),0);
  const h=await setup();h.job.lease_until=T0+26*3600000;assert.equal((await h.call()).ok,false);assert.equal(h.calls(),0);
  const i=await setup();i.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.equal((await i.call()).ok,true);
});
test('resolution atomically cancels an in-flight provider lookup before it can record acceptance',async()=>{
  let release;const f=await setup({lookup:()=>new Promise(resolve=>{release=resolve;})});
  const running=f.call();while(!release)await new Promise(resolve=>setImmediate(resolve));
  const cancelled=await f.call({resolve_only:true});assert.equal(cancelled.request_finalized,true);release();
  assert.deepEqual(await running,cancelled);assert.equal(f.docs.get(`pulsePOApprovalNotificationDeliveries/${f.payload.delivery_id}`).state,'uncertain');
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationReconciliations/')).length,1);
});
test('audit failure leaves all acceptance metadata intact and receipt absent; provider input cannot select another context',async()=>{
  const f=await setup(),before=structuredClone(f.docs.get(`pulsePOApprovalNotificationDeliveries/${f.payload.delivery_id}`)),run=f.db.runTransaction;
  f.db.runTransaction=(fn,options)=>run(tx=>fn({...tx,create:(ref,value)=>{if(ref.path.startsWith('pulsePOApprovalNotificationAudit/'))throw Error('private audit failure');return tx.create(ref,value);}}),options);
  const result=await f.call();assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/private/);
  assert.deepEqual(f.docs.get(`pulsePOApprovalNotificationDeliveries/${f.payload.delivery_id}`),before);
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulsePOApprovalNotificationReconciliations/')).length,0);
  assert.equal((await f.call({evidence:{id:PROVIDER}})).error,'invalid_notification_request');
});
test('receipt replay and cancellation survive deleted live records, moved pointers and unknown controls',async()=>{
  const f=await setup();const result=await f.call();assert.equal(result.ok,true);
  f.docs.delete('projects/P/purchaseOrders/existing');f.docs.delete('projects/P');f.docs.set('pulseRuntimeControl/cutover',{mode:'unexpected'});
  assert.deepEqual(await f.call({resolve_only:true}),result);assert.equal(f.calls(),1);
  const g=await setup();g.docs.delete('projects/P/purchaseOrders/existing');g.docs.set('pulseRuntimeControl/cutover',{mode:'unexpected'});
  const cancelled=await g.call({resolve_only:true});assert.equal(cancelled.request_finalized,true);assert.equal(g.calls(),0);
  assert.deepEqual(await g.call(),cancelled);
});
test('acceptance clears stale problems and cannot be rewritten with another nonce',async()=>{
  const f=await setup();assert.equal((await f.call()).ok,true);
  const after=f.docs.get(`pulsePOApprovalNotificationDeliveries/${f.payload.delivery_id}`);assert.equal(after.problem,null);
  const time=after.accepted_at;assert.equal((await f.call({operation_id:'another'})).ok,false);assert.equal(f.calls(),1);
  assert.deepEqual(f.docs.get(`pulsePOApprovalNotificationDeliveries/${f.payload.delivery_id}`).accepted_at,time);
});
