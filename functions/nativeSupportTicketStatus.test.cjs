const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, request } = require('./nativeSupportTicketStatusFixture.cjs');
const { supportTicketStatusEnabled } = require('./nativeSupportTicketStatus.cjs');

test('atomically records a permitted status change, activity, receipt and immutable audit', async () => {
  const f = fixture();
  const result = await f.call();
  assert.equal(result.ok, true);
  assert.equal(result.resolution, 'committed');
  const ticket = f.docs.get('projects/P/supportTickets/T');
  assert.equal(ticket.status, 'in-progress');
  assert.equal(ticket.firstResponseAt.toISOString(), '2026-10-19T12:00:00.000Z');
  assert.equal(ticket.updatedAt, 'SERVER_TIME');
  assert.deepEqual(f.docs.get('projects/P/supportTickets/T/activities/status-status-1'), {
    type: 'status-change', message: 'Status changed from Open to In progress', createdAt: 'SERVER_TIME',
    createdBy: 'alice', createdByName: 'Alice Auth', metadata: { from: 'open', to: 'in-progress' },
  });
  assert.equal(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/status-1').result.operation_id, 'status-1');
  assert.equal(f.docs.get('pulseNativeSupportTicketOperations/P/audit/status-1').actor_uid, 'alice');
});

test('preserves the UI blockers for chargeable start, incomplete resolution and pending customer confirmation', async () => {
  const start = fixture({ ticket: { coverageType: 'chargeable', commercialStatus: 'quotation-sent' } });
  assert.equal((await start.call()).error, 'support_ticket_transition_blocked');
  const resolve = fixture({ ticket: { status: 'in-progress', rootCause: '', correctiveAction: 'fix', resolutionSummary: 'fixed' } });
  assert.equal((await resolve.call(request({ command: { kind: 'status_change', to_status: 'resolved' } }))).error, 'support_ticket_transition_blocked');
  const close = fixture({ ticket: { status: 'resolved', rootCause: 'cause', correctiveAction: 'fix', resolutionSummary: 'fixed', customerConfirmation: 'pending' } });
  assert.equal((await close.call(request({ command: { kind: 'status_change', to_status: 'closed' } }))).error, 'support_ticket_transition_blocked');
});

test('uses current UI blocker semantics without inventing a status transition graph', async () => {
  const f = fixture({ ticket: { status: 'closed', rootCause: 'cause', correctiveAction: 'fix', resolutionSummary: 'fixed' } });
  assert.equal((await f.call(request({ command: { kind: 'status_change', to_status: 'open' } }))).ok, true);
  const whitespace = fixture({ ticket: { status: 'in-progress', rootCause: ' ', correctiveAction: 'fix', resolutionSummary: 'fixed' } });
  assert.equal((await whitespace.call(request({ command: { kind: 'status_change', to_status: 'resolved' } }))).error, 'support_ticket_transition_blocked');
});

test('replays the same operation once, rejects conflicting reuse, and requires the expected ticket revision for new writes', async () => {
  const f = fixture();
  const first = await f.call();
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal([...f.docs.keys()].filter(path => path.includes('/activities/')).length, 1);
  assert.equal((await f.call(request({ command: { kind: 'status_change', to_status: 'closed' } }))).error, 'operation_conflict');
  assert.equal((await f.call(request({ operation_id: 'status-2', expected_version: '0:0' }))).error, 'support_ticket_version_conflict');
  assert.equal(first.operation_id, 'status-1');
});

test('rechecks actor and project access on receipt replay', async () => {
  const f = fixture();
  await f.call();
  f.setProject({ projectId: 'P', memberIds: ['outsider'] });
  assert.equal((await f.call()).error, 'support_ticket_project_forbidden');
});

test('keeps same-project receipt IDs action-safe and allows only an authorized replay while writes are disabled', async () => {
  const f = fixture();
  const first = await f.call();
  f.docs.set('pulseNativeSupportTicketOperations/P/receipts/create-1', {
    actor_uid: 'alice', actor_email: 'alice@example.com', payload_hash: 'support-ticket-create-payload', result: { ticket_id: 'OTHER' },
  });
  const collision = await f.call(request({ operation_id: 'create-1' }));
  assert.equal(collision.error, 'operation_conflict');
  f.setEnabled(false);
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal((await f.call(request({ operation_id: 'status-2' }))).error, 'support_ticket_status_disabled');
  assert.equal(first.operation_id, 'status-1');
});

test('returns the current ticket version and rejects a write after a concurrent legacy update', async () => {
  const f = fixture();
  const snapshot = await f.call({ operation: 'get', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice' });
  assert.equal(snapshot.version, '100:1');
  f.setTicket({ ...f.docs.get('projects/P/supportTickets/T'), title: 'Edited by the legacy UI' });
  const result = await f.call(request({ expected_version: snapshot.version, operation_id: 'status-after-legacy' }));
  assert.equal(result.error, 'support_ticket_version_conflict');
  assert.equal(f.docs.get('projects/P/supportTickets/T').status, 'open');
});

test('default-off write gates and cutover modes fail closed for new operations', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.call()).error, 'support_ticket_status_disabled');
  assert.equal(f.docs.size, 2);
  const readOnly = fixture({ runtimeMode: 'read_only' });
  assert.equal((await readOnly.call()).error, 'support_ticket_status_read_only');
  const unknown = fixture({ runtimeMode: 'unknown' });
  assert.equal((await unknown.call()).error, 'support_ticket_control_unavailable');
  const keys = ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED'];
  assert.equal(supportTicketStatusEnabled({}), false);
  assert.equal(supportTicketStatusEnabled(Object.fromEntries(keys.map(key => [key, 'true']))), true);
  for (const missing of keys) {
    assert.equal(supportTicketStatusEnabled(Object.fromEntries(keys.filter(key => key !== missing).map(key => [key, 'true']))), false);
  }
  assert.equal(supportTicketStatusEnabled(Object.fromEntries(keys.map((key, index) => [key, index === 1 ? 'TRUE' : 'true']))), false);
});

test('denies nonmembers, missing membership and unapproved actors without writes', async () => {
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: ['alice'] } }).call()).error, 'support_ticket_project_forbidden');
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P' } }).call()).error, 'support_ticket_project_forbidden');
  assert.equal((await fixture({ uid: 'pending' }).call()).error, 'actor_forbidden');
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: null } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'admin', project: { projectId: 'P', memberIds: [] } }).call()).ok, true);
});

test('a failed transaction leaves the ticket, activity, receipt and audit unchanged', async () => {
  const f = fixture({ failPath: path => path.includes('/activities/') });
  assert.equal((await f.call()).error, 'support_ticket_service_unavailable');
  assert.equal(f.docs.get('projects/P/supportTickets/T').status, 'open');
  assert.equal([...f.docs.keys()].some(path => path.includes('/activities/') || path.includes('/receipts/') || path.includes('/audit/')), false);
});

test('validates request identity, status and operation identifiers', async () => {
  const f = fixture();
  assert.equal((await f.call(request({ project_id: 'OTHER' }))).error, 'support_ticket_project_not_found');
  assert.equal((await f.call(request({ command: { kind: 'status_change', to_status: 'made-up' } }))).error, 'invalid_support_ticket_status_request');
  assert.equal((await f.call(request({ operation_id: '../escape' }))).error, 'invalid_support_ticket_status_request');
  assert.equal((await f.call(request({ command: { kind: 'status_change', to_status: 'open' } }))).error, 'support_ticket_status_unchanged');
  assert.equal((await f.call(request({ unexpected: true }))).error, 'invalid_support_ticket_status_request');
});
