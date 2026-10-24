const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativeProjectFixture.cjs');

const supported = [
  { kind: 'member_add', user_id: 'bob', category_scope: ['Mech'] },
  { kind: 'member_remove', user_id: 'partner' },
  { kind: 'member_scope', user_id: 'partner', category_scope: ['Mech'] },
  { kind: 'member_notifications', user_id: 'partner', enabled: true },
  { kind: 'recipient_add', email: 'new@example.com', name: 'New' },
  { kind: 'recipient_remove', email: 'old@example.com' },
  { kind: 'recipient_notifications', email: 'old@example.com', enabled: true },
  { kind: 'support_profile', patch: { internalNotes: 'Updated' }, machines: [] },
];

test('member, scope, recipient and support receipts resolve after a lost acknowledgement', async () => {
  for (const [index, command] of supported.entries()) {
    const f = fixture({ supportProfileEnabled: true });
    const opening = await f.call({ operation: 'get' });
    const request = { operation: 'command', expected_version: opening.version, operation_id: `commit-${index}`, command };
    assert.equal((await f.call(request)).ok, true, command.kind);
    f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
    const before = structuredClone([...f.docs]);
    assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'committed', command.kind);
    assert.deepEqual([...f.docs], before, command.kind);
  }
});

test('member, scope, recipient and support requests can be cancelled with gates closed', async () => {
  for (const [index, command] of supported.entries()) {
    const f = fixture({ enabled: false });
    f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
    const opening = await f.call({ operation: 'get' });
    const request = { operation: 'command', expected_version: opening.version, operation_id: `cancel-${index}`, command };
    const projectsBefore = [...f.docs].filter(([path]) => path.startsWith('projects/'));
    const resolved = await f.call({ ...request, resolve_only: true });
    assert.equal(resolved.resolution, 'cancelled', command.kind);
    assert.deepEqual([...f.docs].filter(([path]) => path.startsWith('projects/')), projectsBefore, command.kind);
    assert.equal((await f.call(request)).error, 'project_request_cancelled', command.kind);
  }
});

test('resolution retains frozen nonce, revision, command hash and fresh access checks', async () => {
  const f = fixture({ uid: 'alice' });
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'frozen', command: { kind: 'support_profile', patch: { internalNotes: 'Keep frozen' }, machines: [] } };
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await f.call({ ...request, expected_version: '11:9', resolve_only: true })).error, 'operation_conflict');
  assert.equal((await f.call({ ...request, command: { ...request.command, patch: { internalNotes: 'Changed' } }, resolve_only: true })).error, 'operation_conflict');
  f.change({ memberIds: ['admin'] });
  assert.equal((await f.call({ ...request, resolve_only: true })).error, 'project_forbidden');
});

test('malformed receipts and unsupported command kinds remain rejected', async () => {
  const f = fixture();
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'bad-receipt', command: { kind: 'member_scope', user_id: 'partner', category_scope: ['Mech'] } };
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'cancelled');
  const path = 'pulseProjectOperations/P/receipts/bad-receipt';
  f.docs.set(path, { ...f.docs.get(path), payload_hash: 'malformed' });
  assert.equal((await f.call({ ...request, resolve_only: true })).error, 'operation_conflict');
  f.docs.set(path, { ...f.docs.get(path), payload_hash: 'a'.repeat(64), actor_uid: 'other' });
  assert.equal((await f.call({ ...request, resolve_only: true })).error, 'operation_conflict');
  assert.equal((await f.call({ ...request, operation_id: 'unsupported', command: { kind: 'unknown' }, resolve_only: true })).error, 'invalid_project_command');
  assert.equal((await f.call({ ...request, command: { kind: 'recipient_remove', email: 'old@example.com' }, resolve_only: true })).error, 'operation_conflict');
  assert.equal((await f.call({ ...request, project_id: 'missing', resolve_only: true })).error, 'project_not_found');
});

test('committed receipt replay rejects revoked membership role and actor identity', async () => {
  const f = fixture();
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'fresh-replay', command: { kind: 'member_scope', user_id: 'partner', category_scope: ['Mech'] } };
  assert.equal((await f.call(request)).ok, true);
  f.users.get('admin').customClaims.role = 'viewer';
  assert.equal((await f.call({ ...request, resolve_only: true })).error, 'project_management_forbidden');
  f.users.get('admin').customClaims.role = 'admin';
  assert.equal((await f.call({ ...request, expected_actor_uid: 'other', resolve_only: true })).error, 'actor_session_changed');
});

test('resolution audit failure creates neither receipt nor audit', async () => {
  const f = fixture({ failAudit: true, enabled: false });
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'audit-failure', command: { kind: 'recipient_remove', email: 'old@example.com' } };
  const before = [...f.docs];
  assert.equal((await f.call({ ...request, resolve_only: true })).ok, false);
  assert.deepEqual([...f.docs], before);
});

test('member_add recovery and receipt replay do not depend on the target user remaining available', async () => {
  const f = fixture();
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'member-added', command: { kind: 'member_add', user_id: 'bob', category_scope: ['Mech'] } };
  assert.equal((await f.call(request)).ok, true);
  f.users.delete('bob');
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'committed');
  assert.equal((await f.call(request)).operation_id, request.operation_id);
});

test('uncertain member_add can be cancelled despite an invalid target while fresh execution still rejects it', async () => {
  const f = fixture({ enabled: false });
  f.users.get('bob').disabled = true;
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'cancel-invalid-member', command: { kind: 'member_add', user_id: 'bob', category_scope: ['Mech'] } };
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await f.call(request)).error, 'project_request_cancelled');
  const fresh = fixture();
  fresh.users.get('bob').disabled = true;
  const freshOpening = await fresh.call({ operation: 'get' });
  assert.equal((await fresh.call({ ...request, expected_version: freshOpening.version, operation_id: 'fresh-invalid-member' })).error, 'target_user_unavailable');
});

test('archive recovery works through closed write gates and keeps archive permission checks', async () => {
  const committed = fixture();
  const opening = await committed.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'archive-committed', command: { kind: 'archive' } };
  assert.equal((await committed.call(request)).ok, true);
  committed.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await committed.call({ ...request, resolve_only: true })).resolution, 'committed');

  const cancelled = fixture({ enabled: false });
  const cancelOpening = await cancelled.call({ operation: 'get' });
  const cancelRequest = { operation: 'command', expected_version: cancelOpening.version, operation_id: 'archive-cancelled', command: { kind: 'archive' } };
  assert.equal((await cancelled.call({ ...cancelRequest, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await cancelled.call(cancelRequest)).error, 'project_request_cancelled');
  assert.equal(cancelled.docs.get('projects/P').status, 'Planning');

  committed.users.get('admin').email = 'outside@example.com';
  committed.users.get('admin').customClaims.role = 'viewer';
  assert.equal((await committed.call({ ...request, resolve_only: true })).error, 'project_edit_forbidden');
});
