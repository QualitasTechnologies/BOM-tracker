const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeMilestoneFixture.cjs'),{fixture:projectFixture}=require('./nativeProjectFixture.cjs');
const accepted={mode:'coexist',scheduleClientWritesFenced:true};
const command={kind:'status',milestone_id:'one',status:'completed'};
test('milestone writes and permission require exact-true scope fence while permitted reads remain',async()=>{
 for(const flag of [undefined,false,null,'true',1]){const f=fixture();if(flag===undefined)f.docs.delete('pulseRuntimeControl/cutover');else f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist',scheduleClientWritesFenced:flag});
  const read=await f.call();assert.equal(read.ok,true);assert.equal(read.permissions.edit,false);const before=structuredClone([...f.docs]);assert.equal((await f.issue(command)).error,'milestone_mutations_disabled');assert.deepEqual([...f.docs],before);
 }
 for(const uid of ['alice','partner','admin']){const f=fixture({uid});f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));assert.equal((await f.issue(command)).ok,true);}
});
test('original milestone membership requires exact-null or listed UID in both scoped modes',async()=>{
 for(const scopedReadsEnabled of [false,true])for(const uid of ['alice','partner']){
  const f=fixture({uid,scopedReadsEnabled});delete f.docs.get('projects/P').memberIds;assert.equal((await f.call()).error,'milestone_forbidden');
  for(const bad of [[],{},'alice',false]){f.docs.get('projects/P').memberIds=bad;assert.equal((await f.call()).error,'milestone_forbidden');}
  f.docs.get('projects/P').memberIds=null;assert.equal((await f.call()).ok,true);
 }
});
test('new project deadline changes require fence; unchanged deadline and unrelated metadata do not',async()=>{
 const f=projectFixture();f.docs.delete('pulseRuntimeControl/cutover');
 assert.equal((await f.command({kind:'metadata',patch:{deadline:'2026-11-04'}})).error,'project_mutations_disabled');
 assert.equal((await f.command({kind:'metadata',patch:{deadline:'2026-11-01',description:'Original metadata edit'}})).ok,true);
 f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));assert.equal((await f.command({kind:'metadata',patch:{deadline:'2026-11-04'}},{operation_id:'accepted-deadline'})).ok,true);
});
test('revoking a schedule fence before transaction commit prevents new milestone writes',async()=>{
 const f=fixture({beforeCommit:(docs,versions)=>{docs.set('pulseRuntimeControl/cutover',{mode:'coexist',scheduleClientWritesFenced:false});versions.set('pulseRuntimeControl/cutover',50);}});f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));
 assert.equal((await f.issue(command)).error,'milestone_mutations_disabled');assert.equal(f.docs.get('projects/P/milestones/one').status,'not-started');
});
test('committed replay and explicit cancellation remain available after fence removal and write pause',async()=>{
 const f=fixture();f.docs.set('pulseRuntimeControl/cutover',structuredClone(accepted));const opening=await f.call(),payload={operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'saved',command};
 const saved=await f.call(payload);assert.equal(saved.ok,true);f.docs.delete('pulseRuntimeControl/cutover');f.options.enabled=false;
 assert.deepEqual(await f.call(payload),saved);assert.equal((await f.call({...payload,resolve_only:true})).resolution,'committed');
 const missing={...payload,operation_id:'cancel'};assert.equal((await f.call({...missing,resolve_only:true})).resolution,'cancelled');assert.equal((await f.call(missing)).error,'milestone_request_cancelled');
});
test('project deadline receipt replay and cancellation remain available after the schedule fence closes',async()=>{
 const f=projectFixture(),opening=await f.call({operation:'get'}),payload={operation:'command',expected_version:opening.version,operation_id:'deadline-recovery',command:{kind:'metadata',patch:{deadline:'2026-11-04'}}};
 const saved=await f.call(payload);assert.equal(saved.ok,true);f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 assert.deepEqual(await f.call(payload),saved);assert.equal((await f.call({...payload,resolve_only:true})).resolution,'committed');
 const before=f.docs.get('projects/P').deadline,missing={...payload,operation_id:'deadline-cancel'};assert.equal((await f.call({...missing,resolve_only:true})).resolution,'cancelled');assert.equal((await f.call(missing)).error,'project_request_cancelled');assert.equal(f.docs.get('projects/P').deadline,before);
});
