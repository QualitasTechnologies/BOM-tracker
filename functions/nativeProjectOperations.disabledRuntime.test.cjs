const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeProjectOperations, projectMutationsEnabled } = require('./nativeProjectOperations.cjs');
const { fixture } = require('./nativeProjectFixture.cjs');

test('unauthenticated, unverified and mismatched callable identities cannot touch Firestore', async () => {
  const cases = [
    { name: 'no auth context', uid: undefined, bearer: undefined, expected: 'actor_authentication_required' },
    { name: 'context without bearer', uid: 'admin', bearer: undefined, expected: 'actor_authentication_required' },
    { name: 'wrong scheme', uid: 'admin', bearer: 'Basic fixture', expected: 'actor_authentication_required' },
    { name: 'expired token', uid: 'admin', bearer: 'Bearer fixture', reject: true, expected: 'actor_authentication_required' },
    { name: 'mismatched uid', uid: 'admin', bearer: 'Bearer fixture', tokenUid: 'someone-else', expected: 'actor_forbidden' },
    { name: 'disabled account', uid: 'admin', bearer: 'Bearer fixture', disabled: true, expected: 'actor_forbidden' },
  ];
  for (const value of cases) {
    let databaseTouches = 0;
    const db = new Proxy({}, { get() { databaseTouches++; throw new Error('Firestore must not be reached'); } });
    const auth = {
      async verifyIdToken(_token, checkRevoked) {
        assert.equal(checkRevoked, true);
        if (value.reject) throw new Error('expired');
        return { uid: value.tokenUid || 'admin', email: 'admin@qualitastech.com' };
      },
      async getUser() {
        return { uid: 'admin', email: 'admin@qualitastech.com', emailVerified: true, disabled: value.disabled,
          customClaims: { role: 'admin', status: 'approved' } };
      },
    };
    const handle = createNativeProjectOperations({ db, auth, enabled: false, getServerTimestamp: () => 'time' });
    const result = await handle({ auth: value.uid ? { uid: value.uid } : undefined,
      rawRequest: { get: () => value.bearer }, data: { operation: 'get', project_id: 'P' } });
    assert.equal(result.error, value.expected, value.name);
    assert.equal(databaseTouches, 0, value.name);
  }
});

test('closed runtime gates reject every ordinary business command without project, receipt or audit writes', async () => {
  const on = { BOM_NATIVE_PROJECT_MUTATIONS_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' };
  const environments = [{}, Object.fromEntries(Object.keys(on).map(key => [key, 'false'])),
    ...Object.keys(on).map(key => ({ ...on, [key]: 'false' }))];
  const commands = [
    { kind: 'metadata', patch: { description: 'New description' } },
    { kind: 'budget', amount: 100 },
    { kind: 'cost_field', field: 'miscCost', amount: -25 },
    { kind: 'archive' }, { kind: 'restore' },
    { kind: 'member_add', user_id: 'bob', category_scope: ['Mech'] },
    { kind: 'member_remove', user_id: 'partner' },
    { kind: 'member_scope', user_id: 'partner', category_scope: ['Mech'] },
    { kind: 'member_notifications', user_id: 'admin', enabled: true },
    { kind: 'recipient_add', email: 'new@example.com', name: 'New recipient' },
    { kind: 'recipient_remove', email: 'old@example.com' },
    { kind: 'recipient_notifications', email: 'old@example.com', enabled: true },
    { kind: 'support_profile', patch: { siteLocation: 'Updated site' } },
    { kind: 'support_billing_entity', billing_entity_id: 'B' },
  ];
  for (const env of environments) {
    for (const command of commands) {
      const f = fixture({ enabled: () => projectMutationsEnabled(env), supportProfileEnabled: false });
      const before = structuredClone([...f.docs]);
      const result = await f.command(command);
      assert.equal(result.error, command.kind.startsWith('support_') ? 'support_profile_mutations_disabled' : 'project_mutations_disabled', command.kind);
      assert.deepEqual([...f.docs], before, command.kind);
    }
  }
});

test('disabled runtime get advertises no editable controls and changes no stored data', async () => {
  const f = fixture({ enabled: false });
  const before = structuredClone([...f.docs]);
  const result = await f.call({ operation: 'get' });
  assert.equal(result.ok, true);
  assert.equal(result.permissions.edit, false);
  assert.equal(result.permissions.manage_members, false);
  assert.equal(result.permissions.notifications, false);
  assert.equal(result.permissions.restore, false);
  assert.deepEqual([...f.docs], before);
});

test('paused resolution only records an actor-bound cancellation and remains idempotent', async () => {
  const f = fixture({ enabled: false });
  const beforeProject = structuredClone(f.docs.get('projects/P'));
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'paused-cancel',
    command: { kind: 'cost_field', field: 'poValue', amount: 100 }, resolve_only: true };
  assert.equal((await f.call(request)).resolution, 'cancelled');
  assert.deepEqual(f.docs.get('projects/P'), beforeProject);
  const after = structuredClone([...f.docs]);
  assert.equal((await f.call(request)).resolution, 'cancelled');
  assert.deepEqual([...f.docs], after);
  assert.equal(f.docs.get('pulseProjectOperations/P/receipts/paused-cancel').actor_uid, 'admin');
});
