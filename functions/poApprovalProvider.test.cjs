const test=require('node:test'),assert=require('node:assert/strict');
const {Resend}=require('resend');const {createPOApprovalSender,REJECTED}=require('./poApprovalProvider.cjs');
test('provider lookup uses only a bounded GET to the UUID path and never sends email',async()=>{
  const {createPOApprovalLookup}=require('./poApprovalProvider.cjs');const prior=global.fetch;let captured;
  const id='4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
  global.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({id,object:'email'}),{status:200,headers:{'Content-Type':'application/json'}});};
  try{
    const lookup=createPOApprovalLookup({Resend,getApiKey:()=> 're_synthetic'});
    assert.equal((await lookup(id)).id,id);assert.equal(captured.url,`https://api.resend.com/emails/${id}`);assert.equal(captured.options.method,'GET');assert.ok(captured.options.signal instanceof AbortSignal);
    captured=null;await assert.rejects(lookup('../keys'));assert.equal(captured,null);
  }finally{global.fetch=prior;}
});
test('installed Resend SDK sends the stable header and exact mail through a bounded request without a real provider',async()=>{
  const prior=global.fetch;let captured;
  global.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({id:'synthetic-provider-id'}),{status:200,headers:{'Content-Type':'application/json'}});};
  try {
    const send=createPOApprovalSender({Resend,getApiKey:()=> 're_synthetic_not_a_credential'}),mail={from:'BOM Tracker <info@qualitastech.com>',to:['admin@example.com'],subject:'Review',html:'<p>Review</p>'};
    assert.equal((await send(mail,{idempotencyKey:'po-approval/fixed'})).id,'synthetic-provider-id');
    assert.equal(captured.options.headers.get('Idempotency-Key'),'po-approval/fixed');assert.deepEqual(JSON.parse(captured.options.body),mail);assert.ok(captured.options.signal instanceof AbortSignal);
  } finally {global.fetch=prior;}
});
test('provider rejection or missing id remains unconfirmed and does not expose provider error details',async()=>{
  for(const response of [{error:{message:'private diagnostic'}},{data:{}},{}]) {
    const send=createPOApprovalSender({Resend:class{emails={send:async()=>response};},getApiKey:()=> 'synthetic'});
    await assert.rejects(send({},{idempotencyKey:'fixed'}),/^Error: notification_provider_unconfirmed$/);
  }
});
test('known validation/idempotency rejections request reconciliation without discarding the frozen request',async()=>{
  for(const name of ['validation_error','invalid_idempotent_request']){
    const send=createPOApprovalSender({Resend:class{emails={send:async()=>({error:{name,message:'private diagnostic'}})};},getApiKey:()=> 'synthetic'});
    await assert.rejects(send({},{idempotencyKey:'fixed'}),error=>error[REJECTED]===true&&error.message==='notification_provider_unconfirmed');
  }
});
