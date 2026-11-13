const test=require('node:test'),assert=require('node:assert/strict');
const{fixture}=require('./nativeOverheadFixture.cjs');
const accepted={mode:'coexist',overheadClientWritesFenced:true};
const command={kind:'add_entry',record_id:'fenced-entry',input:{date:'2026-10-15',category:'Other',description:'Permit',amount:12}};
test('new overhead mutations require exact-true fencing and do not advertise writes before cutover',async()=>{
 for(const flag of [undefined,false,null,'true',1,[],{}]){
  const f=fixture();if(flag===undefined)f.docs.delete('pulseRuntimeControl/cutover');else f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist',overheadClientWritesFenced:flag});
  const before=structuredClone([...f.docs]),opening=await f.call();assert.equal(opening.ok,true);assert.equal(opening.permissions.edit,false,JSON.stringify(flag));assert.equal(opening.permissions.review,false);
  assert.equal((await f.issue(command)).error,'overhead_mutations_disabled');assert.deepEqual([...f.docs],before);
 }
 const f=fixture();f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist'});assert.equal((await f.call()).permissions.edit,false);
});
test('an accepted overhead fence retains original internal, external and admin permissions',async()=>{
 for(const uid of ['alice','partner','admin','outsider']){
  const f=fixture({uid});f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));const opening=await f.call();
  if(uid==='outsider'){assert.equal(opening.error,'overhead_forbidden');continue;}
  assert.equal(opening.permissions.edit,true);assert.equal(opening.permissions.review,uid==='admin');assert.equal((await f.issue(command)).ok,true);
 }
});
test('removing the fence during commit revokes the mutation without an audit or receipt',async()=>{
 const f=fixture();f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));const opening=await f.call();
 f.options.beforeCommit=docs=>{delete docs.get('pulseRuntimeControl/cutover').overheadClientWritesFenced;};
 const result=await f.call({operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:'racing-fence',command});
 assert.equal(result.error,'overhead_mutations_disabled');assert.equal(f.docs.get('projects/P/overheads/data').otherEntries.length,1);
 assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulseOverheadOperations/')).length,0);
});
test('committed receipt replay and resolution survive a missing fence and paused writes',async()=>{
 const f=fixture();f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));const opening=await f.call();
 const payload={operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:'committed',command};
 const saved=await f.call(payload);assert.equal(saved.ok,true);f.docs.delete('pulseRuntimeControl/cutover');f.options.enabled=false;
 assert.deepEqual(await f.call(payload),saved);assert.equal((await f.call({...payload,resolve_only:true})).resolution,'committed');
 assert.equal(f.docs.get('projects/P/overheads/data').otherEntries.length,2);
});
test('cancellation works without fencing and permanently denies the delayed original mutation',async()=>{
 const f=fixture();f.docs.delete('pulseRuntimeControl/cutover');const opening=await f.call();
 const payload={operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:'cancelled',command};
 assert.equal((await f.call({...payload,resolve_only:true})).resolution,'cancelled');f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));
 assert.equal((await f.call(payload)).error,'overhead_request_cancelled');assert.equal(f.docs.get('projects/P/overheads/data').otherEntries.length,1);
});
