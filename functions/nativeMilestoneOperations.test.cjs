const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeMilestoneFixture.cjs');
test('original approved member roles, external members and legacy access remain editable; outsider is denied',async()=>{
  for(const uid of ['alice','admin','partner']){const f=fixture({uid});const opening=await f.call();assert.equal(opening.ok,true);assert.equal(opening.permissions.edit,true);assert.equal(opening.milestones.length,2);assert.match(opening.schedule_version,/^[a-f0-9]{64}$/);}
  const f=fixture({uid:'outsider'});assert.equal((await f.call()).error,'milestone_forbidden');delete f.docs.get('projects/P').memberIds;assert.equal((await f.call()).ok,true);
});
test('schedule reads expose only the fields the existing milestone screens need',async()=>{
  const f=fixture();f.docs.get('projects/P').bomSnapshot=[{secretPrice:5}];const result=await f.call();assert.equal(result.project.projectName,'Project');assert.equal(result.project.bomSnapshot,undefined);assert.equal(result.project.memberIds,undefined);
});
test('baseline project and all milestone originals commit with one audit/receipt and no lost historical fields',async()=>{
  const f=fixture();assert.equal((await f.issue({kind:'baseline_lock'})).ok,true);
  const p=f.docs.get('projects/P');assert.equal(p.isBaselined,true);assert.equal(p.originalDeadline,'2026-12-31');assert.equal(p.baselinedBy,'alice');
  assert.equal(f.docs.get('projects/P/milestones/one').originalPlannedEndDate,'2026-11-01');assert.deepEqual(f.docs.get('projects/P/milestones/one').legacy,{keep:true});
  assert.equal([...f.docs.keys()].filter(path=>path.includes('/audit/')).length,1);assert.equal([...f.docs.keys()].filter(path=>path.includes('/receipts/')).length,1);
  assert.equal((await f.issue({kind:'baseline_lock'},{operation_id:'again'})).ok,false);
});
test('audit failure rolls back the entire baseline; current membership and revocation are checked after reads',async()=>{
  const f=fixture({failAudit:true}),before=structuredClone([...f.docs]);assert.equal((await f.issue({kind:'baseline_lock'})).ok,false);assert.deepEqual([...f.docs],before);
  let revoke=false;const g=fixture({onRead:path=>{if(revoke&&path==='pulseMilestoneOperations/P/state/revision')g.users.get('alice').disabled=true;}});await g.call();revoke=true;
  assert.equal((await g.issue({kind:'baseline_lock'})).error,'actor_forbidden');assert.equal(g.docs.get('projects/P').isBaselined,undefined);
});
test('stale schedule/project versions refuse all writes and a competing add invalidates a lock opening',async()=>{
  const f=fixture(),opening=await f.call();
  assert.equal((await f.issue({kind:'add',milestone_id:'new',input:{name:'Commission',currentPlannedEndDate:'2026-12-20'}},{operation_id:'new'})).ok,true);
  const result=await f.call({operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'old',command:{kind:'baseline_lock'}});
  assert.equal(result.error,'milestone_version_conflict');assert.equal(f.docs.get('projects/P').isBaselined,undefined);
});
test('baselined date edit logs authoritative delay and new date atomically with the original baseline intact',async()=>{
  const f=fixture();f.docs.get('projects/P').isBaselined=true;f.docs.get('projects/P').originalDeadline='2026-12-20';f.docs.get('projects/P/milestones/one').originalPlannedEndDate='2026-11-01';
  const command={kind:'edit',milestone_id:'one',patch:{name:'Planning updated',currentPlannedEndDate:'2026-11-04'},delay:{reason:'The customer approval arrived late',attribution:'external-client'}};
  assert.equal((await f.issue(command)).ok,true);const logs=[...f.docs].filter(([path])=>path.startsWith('projects/P/delayLogs/'));assert.equal(logs.length,1);
  assert.equal(logs[0][1].previousDate,'2026-11-01');assert.equal(logs[0][1].loggedBy,'alice');assert.equal(logs[0][1].delayDays,3);assert.equal(logs[0][1].cumulativeProjectDelay,11);
  assert.equal(f.docs.get('projects/P/milestones/one').originalPlannedEndDate,'2026-11-01');
});
test('lost reply replay and resolve return the same committed result with writes off; cancellation fences an original',async()=>{
  const settings={loseCommitReply:true},f=fixture(settings),opening=await f.call();
  const payload={operation:'command',expected_project_version:opening.project_version,expected_schedule_version:opening.schedule_version,operation_id:'lost',command:{kind:'status',milestone_id:'one',status:'completed'}};
  assert.equal((await f.call(payload)).ok,false);settings.enabled=false;f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
  const resolved=await f.call({...payload,resolve_only:true});assert.equal(resolved.resolution,'committed');assert.equal(f.docs.get('projects/P/milestones/one').actualEndDate,'2026-10-15');
  assert.equal([...f.docs.keys()].filter(path=>path.includes('/receipts/')).length,1);
  const g=fixture(),snapshot=await g.call(),request={...payload,expected_project_version:snapshot.project_version,expected_schedule_version:snapshot.schedule_version,operation_id:'cancel'};
  assert.equal((await g.call({...request,resolve_only:true})).resolution,'cancelled');assert.equal((await g.call(request)).error,'milestone_request_cancelled');assert.equal(g.docs.get('projects/P/milestones/one').status,'not-started');
});
test('deletion archives the full original and prevents later reuse of its identity',async()=>{
  const f=fixture(),original=structuredClone(f.docs.get('projects/P/milestones/one'));assert.equal((await f.issue({kind:'delete',milestone_id:'one'})).ok,true);
  assert.deepEqual(f.docs.get('pulseDeletedMilestones/P/milestones/one').record,original);assert.equal(f.docs.has('projects/P/milestones/one'),false);
  assert.equal((await f.issue({kind:'add',milestone_id:'one',input:{name:'Replacement',currentPlannedEndDate:'2026-12-01'}},{operation_id:'reuse'})).error,'milestone_identity_used');
});
