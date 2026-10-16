const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeOverheadFixture.cjs');
const entry={kind:'add_entry',record_id:'new',input:{date:'2026-10-15',category:'Other',description:'Permit',amount:12}};
test('atomic opening exposes original access and independent overhead/project revisions',async()=>{
  for(const uid of ['alice','admin','partner']){const f=fixture({uid});const result=await f.call();assert.equal(result.ok,true);assert.equal(result.permissions.edit,true);assert.equal(result.permissions.review,uid==='admin');assert.equal(result.version,'10:1');assert.equal(result.project_version,'10:1');assert.deepEqual(result.project,{projectId:'P',projectName:'Project'});}
  const f=fixture({uid:'outsider'});assert.equal((await f.call()).error,'overhead_forbidden');delete f.docs.get('projects/P').memberIds;assert.equal((await f.call()).ok,true);
});
test('command preserves full legacy document and stale versions prevent lost updates',async()=>{
  const f=fixture(),opening=await f.call();assert.equal((await f.issue(entry)).ok,true);assert.deepEqual(f.docs.get('projects/P/overheads/data').legacy,{keep:true});assert.equal(f.docs.get('projects/P/overheads/data').travelVisits[0].date,'2026-10-01');
  const result=await f.call({operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'stale',command:{...entry,record_id:'stale'}});assert.equal(result.error,'overhead_version_conflict');
});
test('deletion archives full original and forever fences record identity',async()=>{
  const f=fixture(),original=structuredClone(f.docs.get('projects/P/overheads/data').otherEntries[0]);assert.equal((await f.issue({kind:'delete_entry',record_id:'entry'})).ok,true);assert.deepEqual(f.docs.get('pulseDeletedOverheads/P/records/entry-entry').record,original);assert.equal((await f.issue({...entry,record_id:'entry'},{operation_id:'reuse'})).error,'overhead_identity_used');
});
test('submission queues authoritative parent atomically and receipt replays with flags off',async()=>{
  const f=fixture({loseCommitReply:true}),opening=await f.call(),payload={operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'lost',command:{kind:'submit_visit',record_id:'trip'}};
  assert.equal((await f.call(payload)).ok,false);f.options.enabled=false;f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});const result=await f.call({...payload,resolve_only:true});assert.equal(result.resolution,'committed');assert.match(result.notification_id,/^[a-f0-9]{64}$/);const visit=f.docs.get('projects/P/overheads/data').travelVisits[0];assert.equal(visit.nativeExpenseNotificationId,result.notification_id);const job=f.docs.get(`pulseExpenseApprovalNotifications/${result.notification_id}`);assert.equal(job.visit_id,'trip');assert.equal(job.payload.submitterUid,'alice');assert.equal(job.kind,'expense_submitted');
});
test('audit/archive/outbox failure cannot partially mutate costs',async()=>{
  for(const [options,command]of [[{failAudit:true},entry],[{failArchive:true},{kind:'delete_entry',record_id:'entry'}],[{failOutbox:true},{kind:'submit_visit',record_id:'trip'}]]){const f=fixture(options),before=structuredClone([...f.docs]);assert.equal((await f.issue(command)).ok,false);assert.deepEqual([...f.docs],before);}
});
test('only current admins review and final actor revalidation rejects revocation',async()=>{
  const f=fixture();delete f.docs.get('projects/P/overheads/data').travelVisits[0].reimbursementStatus;assert.equal((await f.issue({kind:'review_visit',record_id:'trip',status:'approved'})).error,'overhead_review_forbidden');
  const g=fixture({uid:'admin'});delete g.docs.get('projects/P/overheads/data').travelVisits[0].reimbursementStatus;assert.equal((await g.issue({kind:'review_visit',record_id:'trip',status:'approved'})).ok,true);
  const h=fixture({onRead:path=>{if(path==='pulseRuntimeControl/cutover')h.users.get('alice').disabled=true;}});assert.equal((await h.issue(entry)).error,'actor_forbidden');
});
test('off gates permit reads and cancellation without enabling cost writes',async()=>{
  const f=fixture({enabled:false}),opening=await f.call();assert.equal(opening.permissions.edit,false);assert.equal((await f.issue(entry)).error,'overhead_mutations_disabled');const payload={operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'cancel',command:entry};assert.equal((await f.call({...payload,resolve_only:true})).resolution,'cancelled');assert.equal((await f.call(payload)).error,'overhead_request_cancelled');
});
test('new attendees must be current members while departed original attendees remain valid',async()=>{
  const input={startDate:'2026-10-01',endDate:'2026-10-02',attendees:['forged'],expenses:[{id:'expense',category:'Transport',amount:25}]};const f=fixture();assert.equal((await f.issue({kind:'edit_visit',record_id:'trip',input})).error,'overhead_attendee_forbidden');f.docs.get('projects/P/overheads/data').travelVisits[0].attendees=['departed'];assert.equal((await f.issue({kind:'edit_visit',record_id:'trip',input:{...input,attendees:['departed']}})).ok,true);
});
test('malformed persisted arrays and duplicate identities fail intact',async()=>{
  for(const value of [null,{},[{id:'same'},{id:'same'}]]){const f=fixture();f.docs.get('projects/P/overheads/data').otherEntries=value;const before=structuredClone([...f.docs]);assert.equal((await f.call()).error,'invalid_overhead_state');assert.equal((await f.issue(entry)).ok,false);assert.deepEqual([...f.docs],before);}
});
test('an authorized admin can log their own visit without appearing in the project member list',async()=>{
  const f=fixture({uid:'admin'});f.docs.get('projects/P').memberIds=['alice'];
  const input={startDate:'2026-10-15',endDate:'2026-10-15',attendees:['admin'],expenses:[{id:'taxi',category:'Transport',amount:50}]};
  assert.equal((await f.issue({kind:'add_visit',record_id:'admin-trip',input})).ok,true);
});
test('project revision changes and concurrent legacy cost writes invalidate stale operations',async()=>{
  const f=fixture(),opening=await f.call();f.docs.get('projects/P').projectName='Renamed';f.versions.set('projects/P',2);assert.equal((await f.call({operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'old',command:entry})).error,'overhead_version_conflict');
  const g=fixture(),snapshot=await g.call();g.options.beforeCommit=(docs,versions)=>{docs.get('projects/P/overheads/data').otherEntries.push({id:'legacy-write',amount:99});versions.set('projects/P/overheads/data',2);};const result=await g.call({operation:'command',expected_version:snapshot.version,expected_project_version:snapshot.project_version,operation_id:'racing',command:entry});assert.equal(result.error,'overhead_version_conflict');assert.equal(g.docs.get('projects/P/overheads/data').otherEntries.some(row=>row.id==='new'),false);assert.equal(g.docs.get('projects/P/overheads/data').otherEntries.some(row=>row.id==='legacy-write'),true);
});
test('nonce reuse with changed command is rejected and revoked members cannot recover old receipts',async()=>{
  const f=fixture(),opening=await f.call(),payload={operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'same',command:entry};assert.equal((await f.call(payload)).ok,true);assert.equal((await f.call({...payload,command:{...entry,record_id:'other'}})).error,'operation_conflict');f.docs.get('projects/P').memberIds=['admin'];assert.equal((await f.call({...payload,resolve_only:true})).error,'overhead_forbidden');
});
test('unknown control denies writes and missing overhead document creates from missing revision',async()=>{
  const f=fixture();f.docs.set('pulseRuntimeControl/cutover',{mode:'unknown'});assert.equal((await f.call()).permissions.edit,false);assert.equal((await f.issue(entry)).error,'overhead_control_unavailable');
  const g=fixture();g.docs.delete('projects/P/overheads/data');assert.equal((await g.call()).version,'missing');assert.equal((await g.issue(entry)).ok,true);assert.deepEqual(g.docs.get('projects/P/overheads/data').travelVisits,[]);
});
test('ownerless review creates an explicit skipped parent and stamps the latest pointer',async()=>{
  const f=fixture({uid:'admin'}),visit=f.docs.get('projects/P/overheads/data').travelVisits[0];delete visit.reimbursementStatus;delete visit.createdBy;const result=await f.issue({kind:'review_visit',record_id:'trip',status:'rejected'});assert.equal(result.ok,true);assert.equal(result.notification_id,undefined);const id=f.docs.get('projects/P/overheads/data').travelVisits[0].nativeExpenseNotificationId;assert.match(id,/^[a-f0-9]{64}$/);const job=f.docs.get(`pulseExpenseApprovalNotifications/${id}`);assert.equal(job.state,'skipped');assert.equal(job.problem,'no_owner');assert.equal(job.payload.submitterUid,null);
});
test('document budgets reject an oversized full merged result without truncation',async()=>{
  const f=fixture();f.docs.get('projects/P/overheads/data').unknownHistory='x'.repeat(1024*1024);const before=structuredClone([...f.docs]);assert.equal((await f.issue(entry)).ok,false);assert.deepEqual([...f.docs],before);
});
