const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./index.js'),'utf8');
test('expense delivery exports stay off and do not load credentials or query jobs when disabled',async()=>{
  const start=source.indexOf('// Durable expense approval notifications');assert.ok(start>=0);
  let options,queries=0,secrets=0;const configurations={},handlers={};
  const context={exports:{},process:{env:{}},admin:{firestore:Object.assign(()=>({collection:()=>{queries++;throw Error('disabled');}}),{FieldValue:{serverTimestamp:()=>0}}),auth:()=>({})},
    require:name=>name==='./expenseApprovalAdapter.cjs'?{createExpenseApprovalDispatcher:input=>{options=input;return{prepare:async()=>{},deliver:async()=>{}};}}:{createPOApprovalSender:()=>()=>{}},
    createPOApprovalSender:()=>()=>{},Resend:class{},getResendApiKey:()=>{secrets++;throw Error('not required');},resendApiKey:'private-reference',
    onDocumentCreated:(config,handler)=>{const kind=config.document.startsWith('pulseExpenseApprovalNotifications/')?'prepare':'send';configurations[kind]=config;handlers[kind]=handler;return handler;},
    onSchedule:(config,handler)=>{configurations.retry=config;handlers.retry=handler;return handler;},logger:{warn:()=>{}}};
  vm.runInNewContext(source.slice(start),context);
  assert.equal(options.enabled(),false);await handlers.retry();assert.equal(queries,0);assert.equal(secrets,0);
  assert.equal(configurations.prepare.secrets,undefined);assert.deepEqual(Array.from(configurations.send.secrets),['private-reference']);assert.equal(configurations.retry.maxInstances,1);
  context.process.env.BOM_NATIVE_EXPENSE_NOTIFICATIONS_ENABLED='TRUE';assert.equal(options.enabled(),false);
  context.process.env.BOM_NATIVE_EXPENSE_NOTIFICATIONS_ENABLED='true';assert.equal(options.enabled(),true);
});
test('legacy expense emails share original template and honor cutover before provider credentials',async()=>{
  const start=source.indexOf('exports.notifyExpenseApproval = onCall('),end=source.indexOf('// ==================== PURCHASE ORDER APPROVAL NOTIFICATIONS',start);
  let allowed=true,sends=0,keyReads=0,built=0,role='admin';
  const context={exports:{},resendApiKey:'private-reference',onCall:(_config,handler)=>handler,
    admin:{firestore:()=>({}),auth:()=>({listUsers:async()=>({users:[{email:'admin@example.com',customClaims:{role:'admin',status:'approved'}}]}),getUser:async uid=>({uid,email:uid+'@example.com',displayName:'Original user',customClaims:{role,status:'approved'}})})},
    require:name=>name==='./poApprovalLegacyGuard.cjs'?{legacyApprovalSendingAllowed:async()=>allowed}:{buildExpenseApprovalEmail:input=>{built++;return require('./expenseApprovalEmail.cjs').buildExpenseApprovalEmail(input);}},
    Resend:class{emails={send:async mail=>{sends++;assert.match(mail.html,/visionbomtracker\.web\.app/);assert.equal(mail.from,'BOM Tracker <info@qualitastech.com>');return{data:{id:'synthetic'}};}};},
    getResendApiKey:()=>{keyReads++;return'synthetic';},logger:{info:()=>{},warn:()=>{}}};
  vm.runInNewContext(source.slice(start,end),context);
  const request={auth:{uid:'alice'},data:{mode:'submitted',projectId:'P',projectName:'Project',visitDates:'15 Oct 2026',visitTotal:123.5}};
  assert.equal((await context.exports.notifyExpenseApproval(request)).sent,1);assert.equal(sends,1);assert.equal(built,1);
  assert.equal((await context.exports.notifyExpenseApproval({...request,data:{...request.data,mode:'approved',ownerUid:'owner'}})).success,true);assert.equal(sends,2);assert.equal(built,2);
  role='member';await assert.rejects(context.exports.notifyExpenseApproval({...request,data:{...request.data,mode:'rejected',ownerUid:'owner'}}),/Admin/);assert.equal(sends,2);
  allowed=false;await assert.rejects(context.exports.notifyExpenseApproval(request),/Pulse|disabled|read.only/i);assert.equal(sends,2);assert.equal(keyReads,2);
});
