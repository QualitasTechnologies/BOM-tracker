const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./index.js'),'utf8');
test('private queue triggers and bounded scheduler are gated off without requesting provider credentials',async()=>{
  const start=source.indexOf('// Durable PO approval notifications');assert.ok(start>=0);
  let dependencies,queries=0,secretReads=0;const configs={},handlers={};
  const context={exports:{},process:{env:{}},admin:{firestore:Object.assign(()=>({collection:()=>{queries++;throw Error('disabled');}}),{FieldValue:{serverTimestamp:()=>0}}),auth:()=>({})},
    require:name=>name==='./poApprovalDispatcher.cjs'?{createPOApprovalDispatcher:options=>{dependencies=options;return{prepare:async id=>({id}),deliver:async id=>({id})};}}:{createPOApprovalSender:()=>()=>{}},
    Resend:class{},getResendApiKey:()=>{secretReads++;throw Error('secret not needed');},resendApiKey:'secret-reference',
    onDocumentCreated:(config,handler)=>{const type=config.document.startsWith('pulsePOApprovalNotifications/')?'prepare':'send';configs[type]=config;handlers[type]=handler;return handler;},
    onSchedule:(config,handler)=>{configs.retry=config;handlers.retry=handler;return handler;},logger:{warn:()=>{}}};
  vm.runInNewContext(source.slice(start,source.indexOf('// PO approval notification operator status')),context);assert.equal(dependencies.enabled(),false);await handlers.retry();assert.equal(queries,0);assert.equal(secretReads,0);
  assert.equal(configs.prepare.secrets,undefined);assert.deepEqual(Array.from(configs.send.secrets),['secret-reference']);assert.equal(configs.send.region,'us-central1');assert.equal(configs.retry.maxInstances,1);
  context.process.env.BOM_NATIVE_PO_NOTIFICATIONS_ENABLED='TRUE';assert.equal(dependencies.enabled(),false);context.process.env.BOM_NATIVE_PO_NOTIFICATIONS_ENABLED='true';assert.equal(dependencies.enabled(),true);
});
test('notification operator callable is secret-free and uses its own strict default-off flag',()=>{
  let options,configuration;const handler=()=>{};
  const context={exports:{},process:{env:{}},admin:{firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}}),auth:()=>({})},
    require:()=>({createPOApprovalNotificationOperations:input=>{options=input;return handler;}}),onCall:(config,fn)=>{configuration=config;return fn;}};
  vm.runInNewContext(source.slice(source.indexOf('// PO approval notification operator status'),source.indexOf('// PO approval provider evidence')),context);
  assert.equal(context.exports.nativePOApprovalNotificationOperations,handler);assert.equal(configuration.secrets,undefined);assert.equal(configuration.region,'us-central1');assert.equal(options.enabled(),false);
  context.process.env.BOM_NATIVE_PO_NOTIFICATIONS_ENABLED='true';assert.equal(options.enabled(),true);
});
test('provider reconciliation binds its secret but remains strict default-off without requesting credentials',()=>{
  let options,configuration,secretReads=0;const handler=()=>{};
  const context={exports:{},process:{env:{}},resendApiKey:'secret-reference',Resend:class{},getResendApiKey:()=>{secretReads++;throw Error('disabled');},admin:{firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}}),auth:()=>({})},
    require:name=>name==='./poApprovalReconciliation.cjs'?{createPOApprovalReconciliation:input=>{options=input;return handler;}}:{createPOApprovalLookup:()=>()=>{}},onCall:(config,fn)=>{configuration=config;return fn;}};
  vm.runInNewContext(source.slice(source.indexOf('// PO approval provider evidence')),context);
  assert.equal(context.exports.nativePOApprovalNotificationReconciliation,handler);assert.deepEqual(Array.from(configuration.secrets),['secret-reference']);assert.equal(options.enabled(),false);assert.equal(secretReads,0);
  context.process.env.BOM_NATIVE_PO_NOTIFICATION_RECONCILIATION_ENABLED='true';assert.equal(options.enabled(),true);
});
test('legacy notification callable uses the shared original message and acknowledges managed native events without another provider call',async()=>{
  const start=source.indexOf('exports.notifyPOApproval = onCall('),end=source.indexOf('// Extract text from PDF quotation',start);let managed=null,sends=0,built=0;
  const context={exports:{},resendApiKey:'secret-reference',onCall:(_config,handler)=>handler,admin:{firestore:()=>({}),auth:()=>({listUsers:async()=>({users:[{email:'admin@example.com',customClaims:{role:'admin',status:'approved'}}]}),getUser:async()=>({displayName:'Original user',email:'user@example.com',customClaims:{role:'admin',status:'approved'}})})},
    require:name=>name==='./poApprovalLegacyGuard.cjs'?{managedApprovalNotification:async()=>managed,legacyApprovalSendingAllowed:async()=>true}:{buildPOApprovalEmail:input=>{built++;return require('./poApprovalEmail.cjs').buildPOApprovalEmail(input);}},
    Resend:class{emails={send:async mail=>{sends++;assert.match(mail.html,/visionbomtracker\.web\.app/);assert.equal(mail.from,'BOM Tracker <info@qualitastech.com>');return{data:{id:'synthetic'}};}};},getResendApiKey:()=> 'synthetic',logger:{info:()=>{}}};
  vm.runInNewContext(source.slice(start,end),context);
  const request={auth:{uid:'alice'},data:{mode:'submitted',projectId:'P',projectName:'Project',poId:'po1',poNumber:'PO-1',vendorName:'Vendor',totalAmount:100}};
  assert.equal((await context.exports.notifyPOApproval(request)).success,true);assert.equal(built,1);assert.equal(sends,1);
  managed={success:true,queued:true};assert.equal((await context.exports.notifyPOApproval(request)).queued,true);assert.equal(sends,1);
});
