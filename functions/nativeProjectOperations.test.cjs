const test = require('node:test');
const assert = require('node:assert/strict');

const { fixture } = require('./nativeProjectFixture.cjs');


test('missing membership data denies non-admin project reads and edits', async () => {
  for (const uid of ['alice', 'partner', 'bob']) {
    const f = fixture({ uid });
    const opening = await f.call({ operation: 'get' });
    delete f.docs.get('projects/P').memberIds;
    const before = structuredClone([...f.docs]);
    assert.equal((await f.call({ operation: 'get' })).error, 'project_forbidden');
    const response = await f.call({ operation: 'command', expected_version: opening.version, operation_id: 'missing-members', command: { kind: 'metadata', patch: { description: 'Denied' } } });
    assert.equal(response.ok, false);
    assert.deepEqual([...f.docs], before);
  }
});

test('explicit-null migration access and admin access to missing membership remain available', async () => {
  for (const uid of ['alice', 'partner', 'bob']) {
    const f = fixture({ uid });
    f.docs.get('projects/P').memberIds = null;
    assert.equal((await f.call({ operation: 'get' })).ok, true);
  }
  const internal = fixture({ uid: 'alice' });
  internal.docs.get('projects/P').memberIds = null;
  assert.equal((await internal.command({ kind: 'metadata', patch: { description: 'Allowed' } })).ok, true);
  const admin = fixture();
  delete admin.docs.get('projects/P').memberIds;
  assert.equal((await admin.call({ operation: 'get' })).ok, true);
  assert.equal((await admin.command({ kind: 'metadata', patch: { description: 'Admin edit' } })).ok, true);
});

test('receipt replay does not restore access after membership data is removed', async () => {
  const f = fixture({ uid: 'alice' });
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'lost-membership', command: { kind: 'metadata', patch: { description: 'Saved' } } };
  assert.equal((await f.call(request)).ok, true);
  delete f.docs.get('projects/P').memberIds;
  const before = structuredClone([...f.docs]);
  assert.equal((await f.call(request)).error, 'project_forbidden');
  assert.deepEqual([...f.docs], before);
});
test('baselined project deadline saves require reason and atomically append authoritative history',async()=>{
  const f=fixture();f.change({isBaselined:true,originalDeadline:'2026-10-20'});
  assert.equal((await f.command({kind:'metadata',patch:{deadline:'2026-11-04'}})).ok,false);
  const command={kind:'metadata',patch:{deadline:'2026-11-04',description:'Updated'},delay:{reason:'Customer approved the schedule change',attribution:'external-client'}};
  assert.equal((await f.command(command)).ok,true);const logs=[...f.docs].filter(([path])=>path.startsWith('projects/P/delayLogs/'));assert.equal(logs.length,1);
  assert.equal(logs[0][1].previousDate,'2026-11-01');assert.equal(logs[0][1].delayDays,3);assert.equal(logs[0][1].cumulativeProjectDelay,15);assert.equal(logs[0][1].loggedBy,'admin');
  assert.equal(f.docs.get('projects/P').originalDeadline,'2026-10-20');
  const g=fixture({failAudit:true});g.change({isBaselined:true,originalDeadline:'2026-10-20'});assert.equal((await g.command(command)).ok,false);assert.equal(g.docs.get('projects/P').deadline,'2026-11-01');assert.equal([...g.docs.keys()].filter(path=>path.includes('/delayLogs/')).length,0);
});
test('metadata resolution confirms or cancels the original nonce even with writes disabled or readonly',async()=>{
  const f=fixture(),opening=await f.call({operation:'get'}),request={operation:'command',expected_version:opening.version,operation_id:'resolve',command:{kind:'metadata',patch:{description:'Changed'}}};
  assert.equal((await f.call(request)).ok,true);f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
  assert.equal((await f.call({...request,resolve_only:true})).resolution,'committed');
  const g=fixture({enabled:false}),snap=await g.call({operation:'get'}),cancel={...request,expected_version:snap.version};
  assert.equal((await g.call({...cancel,resolve_only:true})).resolution,'cancelled');assert.equal((await g.call(cancel)).error,'project_request_cancelled');
  const h=fixture();h.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.equal((await h.command({kind:'metadata',patch:{description:'No'}})).ok,false);
});

test('metadata transition and unlink are atomic, audited, replayable and preserve all other data', async () => {
  const f = fixture(); const opening = await f.call({ operation: 'get' });
  const body = { operation: 'command', expected_version: opening.version, operation_id: 'one', command: { kind: 'metadata', patch: { status: 'Ongoing', pulseProjectId: null, projectName: 'Delivery' } } };
  assert.equal((await f.call(body)).ok, true);
  const saved = f.docs.get('projects/P'); assert.equal(saved.status, 'Ongoing'); assert.equal(saved.pulseProjectId, undefined);
  assert.deepEqual(saved.bomSnapshot, [{ id: 'bolt', quantity: 1, legacy: 'keep' }]); assert.deepEqual(saved.supportProfile, { serial: 'unchanged' });
  assert.equal((await f.call(body)).ok, true); assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});
test('starting requires a project-owned customer PO and cannot partially save metadata', async () => {
  const f = fixture(); f.docs.get('projectDocuments/customer').projectId = 'Other';
  assert.equal((await f.command({ kind: 'metadata', patch: { status: 'Ongoing', projectName: 'No' } })).error, 'customer_po_required');
  assert.equal(f.docs.get('projects/P').projectName, 'Project'); assert.equal(f.docs.get('projects/P').bomSnapshot, undefined);
});
test('stale versions and changed operation payloads cannot overwrite a project', async () => {
  const f = fixture(); const opening = await f.call({ operation: 'get' }); f.change({ projectName: 'Other person' });
  const body = { operation: 'command', expected_version: opening.version, operation_id: 'one', command: { kind: 'metadata', patch: { projectName: 'Stale' } } };
  assert.equal((await f.call(body)).error, 'project_version_conflict');
  body.expected_version = (await f.call({ operation: 'get' })).version; assert.equal((await f.call(body)).ok, true);
  body.command.patch.projectName = 'Different retry'; assert.equal((await f.call(body)).error, 'operation_conflict');
});
test('original internal viewer edit/notification access stays, but membership is admin-only', async () => {
  const f = fixture({ uid: 'alice' }); assert.equal((await f.command({ kind: 'archive' })).ok, true);
  assert.equal((await f.command({ kind: 'member_notifications', user_id: 'alice', enabled: true }, { operation_id: 'two' })).ok, true);
  assert.equal((await f.command({ kind: 'member_remove', user_id: 'partner' }, { operation_id: 'three' })).error, 'project_management_forbidden');
  const p = fixture({ uid: 'partner' }); assert.equal((await p.command({ kind: 'metadata', patch: { projectName: 'No' } })).error, 'project_edit_forbidden');
});
test('current membership, role and opening account are checked even for receipt replay', async () => {
  const f = fixture({ uid: 'alice' }); const opening = await f.call({ operation: 'get' });
  const body = { operation: 'command', expected_version: opening.version, operation_id: 'one', command: { kind: 'metadata', patch: { description: 'Hello' } } };
  assert.equal((await f.call(body)).ok, true); f.change({ memberIds: ['admin'] });
  assert.equal((await f.call(body)).error, 'project_forbidden');
  assert.equal((await f.call({ operation: 'get', expected_actor_uid: 'other' })).error, 'actor_session_changed');
});
test('member deltas use current target identity and preserve history and notification preferences', async () => {
  const f = fixture(); assert.equal((await f.command({ kind: 'member_add', user_id: 'bob', category_scope: ['Mech'] })).ok, true);
  const project = f.docs.get('projects/P'); const bob = project.members.find(row => row.userId === 'bob');
  assert.equal(bob.email, 'bob@external.example'); assert.equal(bob.addedBy, 'admin'); assert.equal(bob.notificationsEnabled, true);
  assert.deepEqual(project.members[0].legacy, { retained: true }); assert.equal(project.members[0].notificationsEnabled, false);
  assert.equal((await f.command({ kind: 'member_scope', user_id: 'partner', category_scope: ['Mech'] }, { operation_id: 'two' })).ok, true);
  assert.equal(f.docs.get('projects/P').members.find(row => row.userId === 'partner').notificationsEnabled, false);
  assert.equal((await f.command({ kind: 'member_remove', user_id: 'bob' }, { operation_id: 'three' })).ok, true);
  assert.equal(f.docs.get('projects/P').memberIds.includes('bob'), false);
});
test('disabled target users, invented scopes, last-member removal and unknown patch fields are rejected', async () => {
  const f = fixture(); f.users.get('bob').disabled = true;
  assert.equal((await f.command({ kind: 'member_add', user_id: 'bob' })).error, 'target_user_unavailable');
  assert.equal((await f.command({ kind: 'member_scope', user_id: 'partner', category_scope: ['Invented'] })).error, 'invalid_category_scope');
  f.change({ memberIds: ['admin'], members: [f.docs.get('projects/P').members[0]] });
  assert.equal((await f.command({ kind: 'member_remove', user_id: 'admin' })).error, 'last_project_member');
  assert.equal((await f.command({ kind: 'metadata', patch: { memberIds: ['evil'] } })).error, 'invalid_project_command');
});
test('external recipient deltas are normalized and retain unrelated preferences/history', async () => {
  const f = fixture(); assert.equal((await f.command({ kind: 'recipient_add', email: ' NEW@Example.com ', name: 'New' })).ok, true);
  assert.equal(f.docs.get('projects/P').externalRecipients[1].email, 'new@example.com');
  assert.equal((await f.command({ kind: 'recipient_notifications', email: 'OLD@example.com', enabled: true }, { operation_id: 'two' })).ok, true);
  assert.equal(f.docs.get('projects/P').externalRecipients[0].legacy, 'keep');
  assert.equal((await f.command({ kind: 'recipient_remove', email: 'new@example.com' }, { operation_id: 'three' })).ok, true);
});
test('audit failure rolls back every field, receipt and membership change', async () => {
  const f = fixture({ failAudit: true }); const before = structuredClone([...f.docs]);
  assert.equal((await f.command({ kind: 'archive' })).ok, false); assert.deepEqual([...f.docs], before);
});
test('write flags are off by default but the opening remains a freshly authorized read', async () => {
  const f = fixture({ enabled: false }); assert.equal((await f.call({ operation: 'get' })).permissions.edit, false);
  assert.equal((await f.command({ kind: 'archive' })).error, 'project_mutations_disabled');
});

test('revoking admin role during target lookup prevents granting project access', async () => {
  const f = fixture({ onTargetLookup: users => { users.get('admin').customClaims.role = 'viewer'; } });
  assert.equal((await f.command({ kind: 'member_add', user_id: 'bob' })).error, 'project_management_forbidden');
  assert.equal(f.docs.get('projects/P').memberIds.includes('bob'), false);
});

test('legacy structural membership needs explicit migration and never silently restricts existing readers', async () => {
  const f = fixture(); delete f.docs.get('projects/P').memberIds;
  const before = structuredClone(f.docs.get('projects/P'));
  assert.equal((await f.command({ kind: 'member_add', user_id: 'bob' })).error, 'legacy_membership_migration_required');
  assert.deepEqual(f.docs.get('projects/P'), before);
});
test('adding a member preserves every existing access ID and declared member when old arrays drifted', async () => {
  const f = fixture(); f.docs.get('projects/P').memberIds = ['admin', 'legacy-reader'];
  assert.equal((await f.command({ kind: 'member_add', user_id: 'bob' })).ok, true);
  assert.deepEqual(f.docs.get('projects/P').memberIds, ['admin', 'legacy-reader', 'alice', 'partner', 'bob']);
});
test('target revocation during business reads is checked again immediately before staging membership writes', async () => {
  const f = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('bob').disabled = true; } });
  assert.equal((await f.command({ kind: 'member_add', user_id: 'bob' })).error, 'target_user_unavailable');
  assert.equal(f.docs.get('projects/P').memberIds.includes('bob'), false);
});
test('changed master-data IDs must exist and identify the selected client/billing entity', async () => {
  const f = fixture();
  assert.equal((await f.command({ kind: 'metadata', patch: { clientId: 'missing', clientName: 'Acme' } })).error, 'client_unavailable');
  assert.equal((await f.command({ kind: 'metadata', patch: { billingEntityId: 'missing' } })).error, 'billing_entity_unavailable');
  assert.equal((await f.command({ kind: 'metadata', patch: { clientId: 'C', clientName: 'Different' } })).error, 'client_identity_conflict');
  assert.equal((await f.command({ kind: 'metadata', patch: { clientId: 'C', clientName: 'Acme', billingEntityId: 'B' } })).ok, true);
});

test('archive restore is separately gated from receipt resolution and returns the project to Planning', async () => {
  const f = fixture();
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'coexist', projectStatusClientWritesFenced: true });
  const opening = await f.call({ operation: 'get' });
  assert.equal(opening.permissions.restore, true);
  assert.equal(opening.permissions.restore_resolve, true);
  const before = structuredClone(f.docs.get('projects/P'));
  const archive = await f.call({ operation: 'command', expected_version: opening.version, operation_id: 'archive', command: { kind: 'archive' } });
  assert.equal(archive.ok, true);
  const archived = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: archived.version, operation_id: 'restore', command: { kind: 'restore' } };
  assert.equal((await f.call(request)).ok, true);
  const restored = f.docs.get('projects/P');
  assert.equal(restored.status, 'Planning');
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.projectName, before.projectName);
  assert.deepEqual(restored.members, before.members);
  assert.deepEqual(restored.supportProfile, before.supportProfile);
  assert.deepEqual(restored.bomSnapshot, before.bomSnapshot);
  const audit = f.docs.get('pulseProjectOperations/P/audit/restore');
  assert.equal(audit.operation, 'restore');
  assert.deepEqual(audit.changes.status, { before: { present: true, value: 'Archived' }, after: { present: true, value: 'Planning' } });
  assert.deepEqual(audit.changes.archivedAt, { before: { present: true, value: '2026-10-14T00:00:00.000Z' }, after: { present: true, value: null } });
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only', projectStatusClientWritesFenced: false });
  assert.deepEqual(await f.call(request), { ok: true, project_id: 'P', operation_id: 'restore' });
  assert.equal([...f.docs.keys()].filter(path => path.startsWith('pulseProjectOperations/P/audit/')).length, 2);
});

test('restore get permission and command agree when the cutover mode is absent', async () => {
  const f = fixture();
  f.change({ status: 'Archived', archivedAt: '2026-10-14T00:00:00.000Z' });
  f.docs.set('pulseRuntimeControl/cutover', { projectStatusClientWritesFenced: true });
  const opening = await f.call({ operation: 'get' });
  assert.equal(opening.permissions.restore, true);
  assert.equal((await f.call({
    operation: 'command', expected_version: opening.version, operation_id: 'restore-no-mode', command: { kind: 'restore' },
  })).ok, true);
  assert.equal(f.docs.get('projects/P').status, 'Planning');
});

test('restore writes are blocked without the explicit legacy status-writer fence or allowed cutover', async () => {
  for (const control of [
    { mode: 'coexist' },
    { mode: 'read_only', projectStatusClientWritesFenced: true },
    { mode: 'coexist', projectStatusClientWritesFenced: false },
  ]) {
    const f = fixture(); f.change({ status: 'Archived', archivedAt: 'old' }); f.docs.set('pulseRuntimeControl/cutover', control);
    const result = await f.command({ kind: 'restore' });
    assert.equal(result.error, control.mode === 'read_only' ? 'project_read_only' : 'project_status_writers_not_fenced');
    assert.equal(f.docs.get('projects/P').status, 'Archived');
    assert.equal([...f.docs.keys()].some(path => path.includes('/audit/')), false);
  }
});

test('only an archived project at the exact version can be restored', async () => {
  const f = fixture(); f.docs.set('pulseRuntimeControl/cutover', { mode: 'coexist', projectStatusClientWritesFenced: true });
  assert.equal((await f.command({ kind: 'restore' })).error, 'project_not_archived');
  f.change({ status: 'Archived', archivedAt: 'old' });
  const stale = await f.call({ operation: 'get' }); f.change({ description: 'concurrent update' });
  assert.equal((await f.call({ operation: 'command', expected_version: stale.version, operation_id: 'stale-restore', command: { kind: 'restore' } })).error, 'project_version_conflict');
  assert.equal(f.docs.get('projects/P').status, 'Archived');
});

test('metadata cannot archive or unarchive and repeat archive is rejected', async () => {
  const f = fixture();
  assert.equal((await f.command({ kind: 'metadata', patch: { status: 'Archived' } })).error, 'project_status_transition_invalid');
  f.change({ status: 'Archived', archivedAt: 'old' });
  assert.equal((await f.command({ kind: 'metadata', patch: { status: 'Ongoing' } })).error, 'project_status_transition_invalid');
  assert.equal((await f.command({ kind: 'archive' })).error, 'project_already_archived');
  assert.equal(f.docs.get('projects/P').status, 'Archived');
  assert.equal(f.docs.get('projects/P').archivedAt, 'old');
});

test('an uncertain restore can be resolved as cancelled without restoring or requiring write gates', async () => {
  const f = fixture({ enabled: false }); f.change({ status: 'Archived', archivedAt: 'old' });
  const opening = await f.call({ operation: 'get' });
  assert.equal(opening.permissions.restore, false);
  assert.equal(opening.permissions.restore_resolve, true);
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'cancel-restore', command: { kind: 'restore' } };
  const before = structuredClone([...f.docs]);
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal(f.docs.get('projects/P').status, 'Archived');
  assert.deepEqual([...f.docs].filter(([path]) => path.startsWith('projects/')), before.filter(([path]) => path.startsWith('projects/')));
  assert.equal(f.docs.get('pulseProjectOperations/P/audit/cancel-restore').operation, 'restore_cancelled');
  assert.equal((await f.call(request)).error, 'project_request_cancelled');
});

test('restore audit failure leaves project, receipt and audit unchanged', async () => {
  const f = fixture({ failAudit: true }); f.change({ status: 'Archived', archivedAt: 'old' });
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'coexist', projectStatusClientWritesFenced: true });
  const before = structuredClone([...f.docs]);
  assert.equal((await f.command({ kind: 'restore' })).ok, false);
  assert.deepEqual([...f.docs], before);
});

test('restore receipt replay requires current project access and base edit permission', async () => {
  for (const revoke of [
    { uid: 'alice', revoke: f => f.change({ memberIds: ['admin', 'partner'] }) },
    { uid: 'partner', role: 'admin', revoke: f => { f.users.get('partner').customClaims.role = 'user'; } },
  ]) {
    const f = fixture({ uid: revoke.uid });
    if (revoke.role) f.users.get(revoke.uid).customClaims.role = revoke.role;
    f.change({ status: 'Archived', archivedAt: 'old' });
    f.docs.set('pulseRuntimeControl/cutover', { mode: 'coexist', projectStatusClientWritesFenced: true });
    const opening = await f.call({ operation: 'get' });
    const request = { operation: 'command', expected_version: opening.version, operation_id: 'restore-replay', command: { kind: 'restore' } };
    assert.equal((await f.call(request)).ok, true);
    revoke.revoke(f);
    const before = structuredClone([...f.docs]);
    const replay = await f.call(request);
    assert.ok(['project_forbidden', 'project_edit_forbidden'].includes(replay.error), `unexpected replay response: ${JSON.stringify(replay)}`);
    assert.deepEqual([...f.docs], before);
  }
});

test('revoked admin cannot use a malformed access list as a membership substring', async () => {
  const f = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('admin').customClaims.role = 'viewer'; } });
  f.docs.get('projects/P').memberIds = 'admin';
  assert.equal((await f.command({ kind: 'metadata', patch: { description: 'No' } })).error, 'project_forbidden');
  assert.equal(f.docs.get('projects/P').description, undefined);
});
