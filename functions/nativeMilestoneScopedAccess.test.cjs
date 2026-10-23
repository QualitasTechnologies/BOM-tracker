const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeMilestoneFixture.cjs');
const frozen=opening=>({operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'access-operation',command:{kind:'baseline_lock'}});

test('scoped schedule reads deny absent or malformed membership before reading milestones',async()=>{
  for(const value of [undefined,{},'outsider',false,[],['other']]){
    const reads=[],f=fixture({uid:'outsider',scopedReadsEnabled:true,onRead:path=>reads.push(path)});
    if(value===undefined)delete f.docs.get('projects/P').memberIds;else f.docs.get('projects/P').memberIds=value;
    const before=structuredClone([...f.docs]);
    assert.equal((await f.call()).error,'milestone_forbidden',JSON.stringify(value));
    assert.equal(reads.includes('projects/P/milestones'),false);
    assert.deepEqual([...f.docs],before);
  }
});

test('scoped schedule access preserves explicit-null legacy access and approved member roles',async()=>{
  for(const uid of ['alice','partner','admin']){
    const f=fixture({uid,scopedReadsEnabled:true});assert.equal((await f.call()).ok,true);
    assert.equal((await f.issue({kind:'baseline_lock'})).ok,true);
  }
  const f=fixture({uid:'outsider',scopedReadsEnabled:true});f.docs.get('projects/P').memberIds=null;
  assert.equal((await f.call()).ok,true);assert.equal((await f.issue({kind:'baseline_lock'})).ok,true);
});

test('markerless coexistence retains the original missing-membership behavior',async()=>{
  const f=fixture({uid:'outsider'});delete f.docs.get('projects/P').memberIds;
  assert.equal((await f.call()).ok,true);assert.equal((await f.issue({kind:'baseline_lock'})).ok,true);
});

test('a scoped read switch cannot enable writes and is read dynamically',async()=>{
  const f=fixture({uid:'outsider',enabled:false});delete f.docs.get('projects/P').memberIds;
  const opening=await f.call();assert.equal(opening.ok,true);assert.equal(opening.permissions.edit,false);
  f.options.scopedReadsEnabled=true;
  assert.equal((await f.call()).error,'milestone_forbidden');
  assert.equal((await f.call(frozen(opening))).error,'milestone_forbidden');
  const member=fixture({enabled:false,scopedReadsEnabled:true});assert.equal((await member.call()).permissions.edit,false);
  assert.equal((await member.issue({kind:'baseline_lock'})).error,'milestone_mutations_disabled');
});

test('scoped receipt replay and resolution cannot bypass current project access',async()=>{
  const f=fixture({scopedReadsEnabled:true}),opening=await f.call(),body=frozen(opening);
  assert.equal((await f.call(body)).ok,true);delete f.docs.get('projects/P').memberIds;
  const before=structuredClone([...f.docs]);
  assert.equal((await f.call(body)).error,'milestone_forbidden');
  assert.equal((await f.call({...body,resolve_only:true})).error,'milestone_forbidden');
  assert.deepEqual([...f.docs],before);
});

test('authorized resolution still settles committed and cancelled requests after writes close',async()=>{
  const f=fixture({scopedReadsEnabled:true}),body=frozen(await f.call());
  assert.equal((await f.call(body)).ok,true);f.options.enabled=false;
  assert.equal((await f.call({...body,resolve_only:true})).resolution,'committed');
  const g=fixture({scopedReadsEnabled:true,enabled:false}),pending=frozen(await g.call());
  assert.equal((await g.call({...pending,resolve_only:true})).resolution,'cancelled');
  g.options.enabled=true;assert.equal((await g.call(pending)).error,'milestone_request_cancelled');
});

test('admin access and a transaction retry preserve the scoped boundary without partial writes',async()=>{
  const admin=fixture({uid:'admin',scopedReadsEnabled:true});delete admin.docs.get('projects/P').memberIds;
  assert.equal((await admin.call()).ok,true);
  const f=fixture({scopedReadsEnabled:true}),body=frozen(await f.call());
  f.options.beforeCommit=(docs,versions)=>{delete docs.get('projects/P').memberIds;versions.set('projects/P',99);};
  assert.equal((await f.call(body)).error,'milestone_forbidden');
  assert.equal(f.docs.get('projects/P').isBaselined,undefined);
  assert.equal([...f.docs.keys()].some(path=>path.includes('/receipts/')||path.includes('/audit/')),false);
});
