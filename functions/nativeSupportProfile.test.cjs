const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture: baseFixture } = require('./nativeProjectFixture.cjs');
const { supportProfileMutationsEnabled } = require('./nativeProjectOperations.cjs');
const fixture = options => baseFixture({ uid: 'partner', supportProfileEnabled: true, ...options });
const open = f => f.call({ operation: 'support_get' });
const save = (version, command = { kind: 'support_profile', patch: { internalNotes: 'Inspected' } }, extra = {}) => ({ operation: 'command', expected_version: version, operation_id: 'support-one', command, ...extra });

test('Support writer has an independent default-off gate and no read permission grants writes', async () => {
  const env = { BOM_NATIVE_PROJECT_MUTATIONS_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' };
  assert.equal(supportProfileMutationsEnabled(env), false);
  assert.equal(supportProfileMutationsEnabled({ ...env, BOM_NATIVE_SUPPORT_PROFILE_ENABLED: 'true' }), true);
  assert.equal(supportProfileMutationsEnabled({ BOM_NATIVE_SUPPORT_PROFILE_ENABLED: 'true', BOM_SCOPED_READS_ENABLED: 'true' }), false);
  for (const options of [{ enabled: false }, { supportProfileEnabled: false }]) {
    const f = fixture(options), opening = await open(f), before = structuredClone([...f.docs]);
    assert.equal(opening.ok, true); assert.equal(opening.permissions.edit, false); assert.equal(opening.permissions.resolve, true);
    assert.equal((await f.call(save(opening.version))).error, 'support_profile_mutations_disabled');
    assert.deepEqual([...f.docs], before);
  }
});

test('Support opening returns only safe profile and binding, retaining existing external viewer access', async () => {
  const f = fixture(); f.users.get('partner').customClaims.role = 'viewer';
  f.docs.get('projects/P').internalBudget = 100;
  f.docs.get('projects/P').supportProfile = { internalNotes: 'Visible by current Support policy', unknown: { private: true }, supportContacts: [{ name: 'Old' }] };
  const opening = await open(f);
  assert.equal(opening.ok, true); assert.equal(opening.actor_uid, 'partner'); assert.equal(opening.project_id, 'P');
  assert.deepEqual(opening.support_profile, { internalNotes: 'Visible by current Support policy', supportContacts: [{ name: 'Old' }] });
  assert.equal(opening.permissions.edit, true); assert.equal(JSON.stringify(opening).includes('internalBudget'), false);
  assert.equal((await f.call(save(opening.version))).ok, true);
  assert.equal((await f.command({ kind: 'metadata', patch: { projectName: 'Forbidden' } }, { operation_id: 'metadata' })).error, 'project_edit_forbidden');
});

test('Support deltas preserve raw profile, machines, contacts, root and history while auditing and replaying once', async () => {
  const f = fixture();
  f.docs.get('projects/P').supportProfile = { internalNotes: 'Old', retained: { legacy: true }, supportContacts: [{ name: 'Old' }], machines: [{ id: 'm', name: 'Line', serialNumber: 'S', unknown: { retained: true } }] };
  f.docs.get('projects/P').bomSnapshot = [{ cost: 90 }];
  const opening = await open(f), request = save(opening.version, { kind: 'support_profile', patch: { internalNotes: 'New', supportContactId: null }, machines: [{ kind: 'patch', id: 'm', patch: { notes: 'Done' } }] });
  assert.equal((await f.call(request)).ok, true);
  const profile = f.docs.get('projects/P').supportProfile;
  assert.deepEqual(profile.retained, { legacy: true }); assert.deepEqual(profile.supportContacts, [{ name: 'Old' }]);
  assert.deepEqual(profile.machines[0].unknown, { retained: true }); assert.equal(profile.machines[0].notes, 'Done');
  assert.deepEqual(f.docs.get('projects/P').bomSnapshot, [{ cost: 90 }]);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await f.call(request)).ok, true);
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'committed');
  const audits = [...f.docs].filter(([path]) => path.includes('/audit/'));
  assert.equal(audits.length, 1); assert.equal(audits[0][1].actor_uid, 'partner'); assert.equal(audits[0][1].operation, 'support_profile');
  assert.equal(audits[0][1].expected_version, opening.version);
  assert.deepEqual(audits[0][1].changes.supportProfile.before.value.supportContacts, [{ name: 'Old' }]);
  assert.equal(JSON.stringify(await f.call(request)).includes('retained'), false);
});

test('stale versions, malformed commands, duplicate IDs and unknown fields cannot change Support data', async () => {
  const f = fixture(), opening = await open(f);
  f.change({ description: 'Another writer' });
  assert.equal((await f.call(save(opening.version))).error, 'project_version_conflict');
  for (const command of [
    { kind: 'support_profile', patch: { supportContacts: [] } },
    { kind: 'support_profile', patch: { retained: 'replace' } },
    { kind: 'support_profile', patch: { amcStatus: 'invented' } },
    { kind: 'support_profile', machines: [{ kind: 'add', machine: { id: 'm', name: 'M', serialNumber: 'S' } }, { kind: 'add', machine: { id: 'm', name: 'M2', serialNumber: 'S2' } }] },
  ]) {
    const before = structuredClone([...f.docs]);
    assert.equal((await f.call(save((await open(f)).version, command))).error, 'invalid_support_profile_command');
    assert.deepEqual([...f.docs], before);
  }
});

test('Support audit failure rolls back data and receipts, and malformed known stored values fail visibly', async () => {
  const f = fixture({ failAudit: true }), opening = await open(f), before = structuredClone([...f.docs]);
  assert.equal((await f.call(save(opening.version))).ok, false); assert.deepEqual([...f.docs], before);
  const g = fixture(); g.docs.get('projects/P').supportProfile = { machines: 'bad' };
  assert.equal((await open(g)).error, 'invalid_project_read_state');
  assert.equal((await g.call(save('10:1'))).error, 'invalid_support_profile_state');
});

test('Support resolution fences late originals while writes are paused and binds the original payload', async () => {
  const f = fixture({ enabled: false }), opening = await open(f), request = save(opening.version);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await f.call(request)).error, 'project_request_cancelled');
  const changed = save(opening.version, { kind: 'support_profile', patch: { internalNotes: 'Different' } });
  assert.equal((await f.call({ ...changed, resolve_only: true })).error, 'operation_conflict');
  assert.equal(f.docs.get('projects/P').supportProfile.internalNotes, undefined);
});

test('Support current actor/access is checked for openings, mutations, replay and cancellation', async () => {
  const outsider = fixture({ uid: 'bob' }); assert.equal((await open(outsider)).error, 'project_forbidden');
  const f = fixture(), opening = await open(f), request = save(opening.version);
  assert.equal((await f.call(request)).ok, true); f.change({ memberIds: ['admin'] });
  assert.equal((await f.call(request)).error, 'project_forbidden');
  assert.equal((await f.call({ ...request, resolve_only: true })).error, 'project_forbidden');
  let revoked = false;
  const g = fixture({ onRead: (path, users) => { if (path.includes('/receipts/') && !revoked) { users.get('partner').disabled = true; revoked = true; } } });
  const snap = await open(g), before = structuredClone([...g.docs]);
  assert.equal((await g.call(save(snap.version))).error, 'actor_forbidden'); assert.deepEqual([...g.docs], before);
  const h = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('partner').email = 'changed@external.example'; } });
  const old = await open(h);
  assert.equal((await h.call(save(old.version))).error, 'actor_session_changed');
});

test('the older native project opening also projects external data and rechecks identity before publishing', async () => {
  const f = fixture(); f.docs.get('projects/P').internalBudget = 100; f.docs.get('projects/P').bomSnapshot = [{ hidden: true }];
  const opening = await f.call({ operation: 'get' });
  assert.equal(opening.ok, true); assert.equal(Object.hasOwn(opening.project, 'internalBudget'), false); assert.equal(Object.hasOwn(opening.project, 'bomSnapshot'), false);
  assert.equal(Object.hasOwn(opening.project, 'externalRecipients'), false);
  const g = fixture({ uid: 'admin' }); g.docs.get('projects/P').unknown = 1n;
  assert.equal((await g.call({ operation: 'get' })).error, 'invalid_project_read_state');
  const h = fixture({ onRead: (path, users) => { if (path === 'pulseRuntimeControl/cutover') users.get('partner').disabled = true; } });
  assert.equal((await h.call({ operation: 'get' })).error, 'actor_forbidden');
});
