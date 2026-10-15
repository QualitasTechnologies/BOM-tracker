const test = require('node:test');
const assert = require('node:assert/strict');

const { fixture } = require('./nativeProjectFixture.cjs');
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
  assert.equal((await f.command({ kind: 'member_notifications', user_id: 'partner', enabled: true }, { operation_id: 'two' })).ok, true);
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

test('revoked admin cannot use a malformed access list as a membership substring', async () => {
  const f = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('admin').customClaims.role = 'viewer'; } });
  f.docs.get('projects/P').memberIds = 'admin';
  assert.equal((await f.command({ kind: 'metadata', patch: { description: 'No' } })).error, 'project_forbidden');
  assert.equal(f.docs.get('projects/P').description, undefined);
});
