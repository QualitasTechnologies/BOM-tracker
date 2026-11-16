const test=require('node:test'),assert=require('node:assert/strict');
const {fetchJsonResponse}=require('./emailNetwork.cjs');
test('network and response-body stalls both stop on the deadline and abort the underlying request',async()=>{
 for(const bodyStall of [false,true]){
  let signal;const fetchImpl=async(_url,options)=>{signal=options.signal;return bodyStall?{ok:true,status:200,json:()=>new Promise(()=>{})}:new Promise(()=>{});};
  await assert.rejects(()=>fetchJsonResponse(fetchImpl,'https://example.test',{},15),error=>error.code==='email_request_timeout');assert.equal(signal.aborted,true);
 }
});
test('successful JSON and provider status survive the bounded transport without reading error bodies',async()=>{
 const r=await fetchJsonResponse(async()=>({ok:true,status:200,json:async()=>({value:'kept'})}),'https://example.test');assert.deepEqual(await r.json(),{value:'kept'});
 const error=await fetchJsonResponse(async()=>({ok:false,status:401,json:async()=>{throw Error('must not parse auth response');}}),'https://example.test');assert.equal(error.status,401);assert.equal(error.ok,false);
});
