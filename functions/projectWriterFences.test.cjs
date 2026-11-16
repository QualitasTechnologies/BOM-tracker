const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeProjectFixture.cjs');
test('native project mutations and edit permissions require the exact browser writer fence',async()=>{
 for(const value of [undefined,false,'true',1]){
  const f=fixture();const control=f.docs.get('pulseRuntimeControl/cutover');if(value===undefined)delete control.projectClientWritesFenced;else control.projectClientWritesFenced=value;
  assert.equal((await f.call({operation:'get'})).permissions.edit,false);
  const before=structuredClone([...f.docs]);const result=await f.command({kind:'metadata',patch:{projectName:'Denied'}});
  assert.equal(result.error,'project_writers_not_fenced');assert.deepEqual([...f.docs],before);
 }
});
test('a committed receipt and an undispatched cancellation remain recoverable after the project fence is removed',async()=>{
 const f=fixture();f.docs.get('pulseRuntimeControl/cutover').projectClientWritesFenced=true;
 const opening=await f.call({operation:'get'}),request={operation:'command',operation_id:'saved',expected_version:opening.version,command:{kind:'metadata',patch:{projectName:'Saved'}}};
 const saved=await f.call(request);assert.equal(saved.ok,true);f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 assert.deepEqual(await f.call(request),saved);assert.equal((await f.call({...request,resolve_only:true})).resolution,'committed');
 assert.equal((await f.call({...request,operation_id:'never-dispatched',resolve_only:true})).resolution,'cancelled');
});
