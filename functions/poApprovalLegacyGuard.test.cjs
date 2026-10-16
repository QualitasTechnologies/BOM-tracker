const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativePOAuthoringFixture.cjs');
const {managedApprovalNotification,legacyApprovalSendingAllowed}=require('./poApprovalLegacyGuard.cjs');
const request={auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'}};
test('old browser notification calls acknowledge a matching native event instead of sending a duplicate',async()=>{
  const f=fixture();assert.equal(await managedApprovalNotification({db:f.db,auth:f.auth,request,data:{mode:'submitted',projectId:'P',poId:'existing'}}),null);
  const result=await f.command();assert.match(f.docs.get('projects/P/purchaseOrders/existing').nativeApprovalNotificationId,/^[a-f0-9]{64}$/);
  const ack=await managedApprovalNotification({db:f.db,auth:f.auth,request,data:{mode:'submitted',projectId:'P',poId:'existing'}});
  assert.equal(ack.notificationId,result.notification_id);assert.equal(ack.queued,true);
  f.docs.get('projects/P/purchaseOrders/existing').submittedForApprovalAt=new Date('2026-10-14T01:00:00Z');
  await assert.rejects(managedApprovalNotification({db:f.db,auth:f.auth,request,data:{mode:'submitted',projectId:'P',poId:'existing'}}),/event changed/i);
});
test('managed events require the current member and actor while normal legacy behavior stays available',async()=>{
  const f=fixture();await f.command();f.docs.get('projects/P').memberIds=[];
  await assert.rejects(managedApprovalNotification({db:f.db,auth:f.auth,request,data:{mode:'submitted',projectId:'P',poId:'existing'}}),/forbidden/i);
  assert.equal(await managedApprovalNotification({db:f.db,auth:f.auth,request,data:{mode:'submitted',projectId:'P'}}),null);
});
test('cutover controls fence the legacy provider path without changing missing/coexist defaults',async()=>{
  const f=fixture();assert.equal(await legacyApprovalSendingAllowed(f.db),true);
  for(const mode of ['read_only','pulse_only','unknown']){f.docs.set('pulseRuntimeControl/cutover',{mode});assert.equal(await legacyApprovalSendingAllowed(f.db),false);}
  f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist'});assert.equal(await legacyApprovalSendingAllowed(f.db),true);
});
