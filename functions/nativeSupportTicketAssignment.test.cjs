const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, request } = require('./nativeSupportTicketAssignmentFixture.cjs');
const { supportTicketAssignmentEnabled } = require('./nativeSupportTicketAssignment.cjs');

test('atomically assigns from the current roster and records activity, receipt and immutable audit', async () => {
  const f = fixture();
  const result = await f.call();
  const assigned = { userId: 'engineer', name: 'Engineer Roster', email: 'engineer@example.com' };
  assert.deepEqual(result, { ok: true, project_id: 'P', ticket_id: 'T', operation_id: 'assign-1', resolution: 'committed', assignee: assigned });
  assert.deepEqual(f.docs.get('projects/P/supportTickets/T').assignee, assigned);
  assert.equal(f.docs.get('projects/P/supportTickets/T').updatedAt, 'SERVER_TIME');
  assert.deepEqual(f.docs.get('projects/P/supportTickets/T/activities/assignee-assign-1'), {
    type: 'assignment', message: 'Assigned to Engineer Roster', createdAt: 'SERVER_TIME',
    createdBy: 'alice', createdByName: 'Alice Auth',
  });
  assert.equal(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/assign-1').result.ticket_id, 'T');
  assert.deepEqual(f.docs.get('pulseNativeSupportTicketOperations/P/audit/assign-1').after, { assignee: assigned });
});

test('allows self assignment outside the roster and uses verified actor identity', async () => {
  const f = fixture({ project: { projectId: 'P', memberIds: ['alice'], members: [] } });
  const result = await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: 'alice' } }));
  assert.deepEqual(result.assignee, { userId: 'alice', name: 'Alice Auth', email: 'alice@example.com' });
});

test('allows a current roster member with blank identity fields and falls back to user ID for the name', async () => {
  const f = fixture({ project: { projectId: 'P', memberIds: ['alice'], members: [{ userId: 'engineer', displayName: '', email: '' }] } });
  const result = await f.call();
  assert.equal(result.ok, true);
  assert.deepEqual(result.assignee, { userId: 'engineer', name: 'engineer', email: '' });
});

test('treats the current assignee as a receipt-backed no-op without duplicate activity or transition audit', async () => {
  const assigned = { userId: 'engineer', name: 'Older Display Name', email: 'engineer@example.com' };
  const f = fixture({ ticket: { assignee: assigned } });
  const result = await f.call();
  assert.equal(result.resolution, 'committed');
  assert.deepEqual(result.assignee, assigned);
  assert.equal(f.docs.get('projects/P/supportTickets/T').updatedAt, 'OLD_TIME');
  assert.equal([...f.docs.keys()].some(path => path.includes('/activities/') || path.includes('/audit/')), false);
  assert.equal(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/assign-1').result.operation_id, 'assign-1');
  assert.equal((await f.call()).resolution, 'replayed');
});

test('unassigns a stale assignee to null and records the prior value', async () => {
  const old = { userId: 'removed', name: 'Removed member', email: 'removed@example.com' };
  const f = fixture({ ticket: { assignee: old } });
  const result = await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: null } }));
  assert.equal(result.assignee, null);
  assert.equal(f.docs.get('projects/P/supportTickets/T').assignee, null);
  assert.equal(f.docs.get('projects/P/supportTickets/T/activities/assignee-assign-1').message, 'Ticket unassigned');
});

test('rejects unknown or malformed roster targets and ignores client-supplied identity fields', async () => {
  const f = fixture();
  assert.equal((await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: 'missing' } }))).error, 'support_ticket_assignee_not_in_project');
  assert.equal((await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: { userId: 'engineer' } } }))).error, 'invalid_support_ticket_assignment_request');
  assert.equal((await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: 'engineer', name: 'Forged' } }))).error, 'invalid_support_ticket_assignment_request');
  const malformed = fixture({ project: { projectId: 'P', memberIds: ['alice'], members: [{ userId: 'engineer', email: 'bad', displayName: '' }] } });
  assert.equal((await malformed.call()).error, 'support_ticket_assignee_not_in_project');
});

test('requires project access and preserves the existing Support member/admin semantics', async () => {
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: ['alice'], members: [] } }).call()).error, 'support_ticket_project_forbidden');
  assert.equal((await fixture({ uid: 'pending' }).call()).error, 'actor_forbidden');
  assert.equal((await fixture({ uid: 'admin', project: { projectId: 'P', memberIds: [], members: [{ userId: 'engineer', email: 'engineer@example.com', displayName: 'Engineer' }] } }).call()).ok, true);
});

test('replays exact operation before disabled gates, rejects reuse conflicts and checks expected version', async () => {
  const f = fixture();
  const first = await f.call();
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal([...f.docs.keys()].filter(path => path.includes('/activities/')).length, 1);
  assert.equal((await f.call(request({ command: { kind: 'assignee_change', assignee_user_id: 'alice' } }))).error, 'operation_conflict');
  f.setEnabled(false);
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal((await f.call(request({ operation_id: 'assign-2' }))).error, 'support_ticket_assignment_disabled');
  f.setEnabled(true);
  assert.equal((await f.call(request({ operation_id: 'assign-3', expected_version: '0:0' }))).error, 'support_ticket_version_conflict');
  assert.equal(first.operation_id, 'assign-1');
});

test('get returns assignment plus version and stale legacy writes conflict', async () => {
  const f = fixture({ ticket: { assignee: { userId: 'engineer', name: 'Engineer', email: 'engineer@example.com' } } });
  const snapshot = await f.call({ operation: 'get', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice' });
  assert.equal(snapshot.version, '100:1');
  assert.deepEqual(snapshot.assignee, { userId: 'engineer', name: 'Engineer', email: 'engineer@example.com' });
  f.setTicket({ ...f.docs.get('projects/P/supportTickets/T'), title: 'Concurrent legacy edit' });
  assert.equal((await f.call(request({ operation_id: 'assign-after-legacy', expected_version: snapshot.version }))).error, 'support_ticket_version_conflict');
});

test('fails closed for unsupported cutover modes and keeps all three gates strictly default off', async () => {
  assert.equal((await fixture({ enabled: false }).call()).error, 'support_ticket_assignment_disabled');
  assert.equal((await fixture({ runtimeMode: 'read_only' }).call()).error, 'support_ticket_assignment_read_only');
  assert.equal((await fixture({ runtimeMode: 'unknown' }).call()).error, 'support_ticket_control_unavailable');
  const keys = ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_ASSIGNMENT_ENABLED'];
  assert.equal(supportTicketAssignmentEnabled({}), false);
  assert.equal(supportTicketAssignmentEnabled(Object.fromEntries(keys.map(key => [key, 'true']))), true);
  for (const missing of keys) assert.equal(supportTicketAssignmentEnabled(Object.fromEntries(keys.filter(key => key !== missing).map(key => [key, 'true']))), false);
});

test('a transaction failure leaves ticket, activity, receipt and audit unchanged', async () => {
  const f = fixture({ failPath: path => path.includes('/activities/') });
  assert.equal((await f.call()).error, 'support_ticket_service_unavailable');
  assert.equal(f.docs.get('projects/P/supportTickets/T').assignee, null);
  assert.equal([...f.docs.keys()].some(path => path.includes('/activities/') || path.includes('/receipts/') || path.includes('/audit/')), false);
});

test('validates actor, project and exact command request shape', async () => {
  const f = fixture();
  assert.equal((await f.call(request({ expected_actor_uid: 'outsider' }))).error, 'actor_session_changed');
  assert.equal((await f.call(request({ project_id: 'OTHER' }))).error, 'support_ticket_project_not_found');
  assert.equal((await f.call(request({ command: { kind: 'wrong', assignee_user_id: 'engineer' } }))).error, 'invalid_support_ticket_assignment_request');
  assert.equal((await f.call(request({ operation_id: '../escape' }))).error, 'invalid_support_ticket_assignment_request');
  assert.equal((await f.call(request({ unexpected: true }))).error, 'invalid_support_ticket_assignment_request');
});
