const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./nativePOAuthoringFixture.cjs');
const guard=require('./poApprovalLegacyGuard.cjs');
const request={auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{mode:'submitted',projectId:'P',poId:'existing'}};

test('managed PO acknowledgements preserve original explicit-null access for internal and external approved users',async()=>{
  for(const uid of ['alice','partner']){
    const f=fixture({uid});const result=await f.command();f.docs.get('projects/P').memberIds=null;
    const ack=await guard.managedApprovalNotification({db:f.db,auth:f.auth,request:{...request,auth:{uid}},data:request.data});
    assert.equal(ack.notificationId,result.notification_id);assert.equal(ack.queued,true);
  }
});
test('managed PO acknowledgements deny missing, malformed and removed membership while preserving admin access',async()=>{
  for(const value of [undefined,[],{},'alice',false]){
    const f=fixture();await f.command();if(value===undefined)delete f.docs.get('projects/P').memberIds;else f.docs.get('projects/P').memberIds=value;
    await assert.rejects(guard.managedApprovalNotification({db:f.db,auth:f.auth,request,data:request.data}),/forbidden/i);
  }
  const f=fixture({uid:'admin'});const result=await f.command();delete f.docs.get('projects/P').memberIds;
  assert.equal((await guard.managedApprovalNotification({db:f.db,auth:f.auth,request:{...request,auth:{uid:'admin'}},data:request.data})).notificationId,result.notification_id);
});
test('an overhead fence blocks only new legacy expense provider calls during coexistence',async()=>{
  const f=fixture();
  for(const value of [undefined,false,null,'true',1]){
    f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist',overheadClientWritesFenced:value});
    assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'expense'),true);
    assert.equal(await guard.legacyApprovalSendingAllowed(f.db),true);
  }
  f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist',overheadClientWritesFenced:true});
  assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'expense'),false);
  assert.equal(await guard.legacyApprovalSendingAllowed(f.db),true);
  for(const mode of ['read_only','pulse_only','unknown',undefined]){
    f.docs.set('pulseRuntimeControl/cutover',{mode});
    assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'expense'),false);
    assert.equal(await guard.legacyApprovalSendingAllowed(f.db),false);
  }
  f.docs.delete('pulseRuntimeControl/cutover');
  assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'expense'),true);
  assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'unknown'),false);
});

test('actual old expense wrapper checks its resource fence before auth lookups, template, credentials or provider',async()=>{
  const f=fixture(),source=fs.readFileSync(require.resolve('./index.js'),'utf8');
  const start=source.indexOf('exports.notifyExpenseApproval = onCall('),end=source.indexOf('// ==================== PURCHASE ORDER APPROVAL NOTIFICATIONS',start);
  let lookups=0,keyReads=0,templates=0,sends=0;
  const context={exports:{},resendApiKey:'synthetic-reference',onCall:(_config,handler)=>handler,
    admin:{firestore:()=>f.db,auth:()=>{lookups++;return{listUsers:async()=>({users:[{email:'admin@example.com',customClaims:{role:'admin',status:'approved'}}]}),getUser:async uid=>({uid,email:uid+'@example.com',customClaims:{role:'admin',status:'approved'}})};}},
    require:name=>name==='./poApprovalLegacyGuard.cjs'?guard:{buildExpenseApprovalEmail:()=>{templates++;return{};}},
    Resend:class{emails={send:async()=>{sends++;return{data:{id:'synthetic'}};}};},getResendApiKey:()=>{keyReads++;return'synthetic';},logger:{info:()=>{}}};
  vm.runInNewContext(source.slice(start,end),context);
  const businessBefore=JSON.stringify([...f.docs].filter(([key])=>key!=='pulseRuntimeControl/cutover'));
  f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist',overheadClientWritesFenced:true});
  for(const mode of ['submitted','approved','rejected'])await assert.rejects(context.exports.notifyExpenseApproval({auth:{uid:'alice'},data:{mode,projectId:'P',ownerUid:'alice'}}),/disabled|Pulse/i);
  assert.deepEqual({lookups,keyReads,templates,sends},{lookups:0,keyReads:0,templates:0,sends:0});
  f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist'});
  assert.equal((await context.exports.notifyExpenseApproval({auth:{uid:'alice'},data:{mode:'submitted',projectId:'P'}})).sent,1);
  assert.equal(sends,1);assert.equal(keyReads,1);assert.equal(templates,1);
  assert.equal(JSON.stringify([...f.docs].filter(([key])=>key!=='pulseRuntimeControl/cutover')),businessBefore);
});

test('an overhead fence enabled before the guard transaction completes causes its retry to deny',async()=>{
  const f=fixture({beforeCommit:(docs,versions)=>{docs.set('pulseRuntimeControl/cutover',{mode:'coexist',overheadClientWritesFenced:true});versions.set('pulseRuntimeControl/cutover',50);}});
  assert.equal(await guard.legacyApprovalSendingAllowed(f.db,'expense'),false);
});
