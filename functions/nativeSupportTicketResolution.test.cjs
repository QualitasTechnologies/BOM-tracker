const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, request } = require('./nativeSupportTicketResolutionFixture.cjs');
const { supportTicketResolutionEnabled } = require('./nativeSupportTicketResolution.cjs');

test('atomically saves only the four resolution fields while preserving ticket data and adding compatible activity and audit', async () => {
  const f = fixture({ ticket: { legacyUnknownField: { keep: true }, priority: 'high' } });
  const result = await f.call();
  assert.deepEqual(result, { ok: true, project_id: 'P', ticket_id: 'T', operation_id: 'resolution-1', resolution: 'committed',
    resolution_record: { rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored' } });
  const ticket = f.docs.get('projects/P/supportTickets/T');
  assert.deepEqual(Object.fromEntries(['rootCause', 'correctiveAction', 'preventiveAction', 'resolutionSummary'].map(key => [key, ticket[key]])), {
    rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored',
  });
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.priority, 'high');
  assert.deepEqual(ticket.legacyUnknownField, { keep: true });
  assert.equal(ticket.updatedAt, 'SERVER_TIME');
  assert.deepEqual(f.docs.get('projects/P/supportTickets/T/activities/resolution-resolution-1'), {
    type: 'resolution', message: 'RCA and solution record updated', createdAt: 'SERVER_TIME', createdBy: 'alice', createdByName: 'Alice Auth',
  });
  assert.equal(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/resolution-1').result.operation_id, 'resolution-1');
  assert.deepEqual(f.docs.get('pulseNativeSupportTicketOperations/P/audit/resolution-1').before, {
    rootCause: '', correctiveAction: '', preventiveAction: '', resolutionSummary: '',
  });
  assert.deepEqual(f.docs.get('pulseNativeSupportTicketOperations/P/audit/resolution-1').after, {
    rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored',
  });
});

test('get returns the current version and exactly the four editable resolution fields', async () => {
  const f = fixture({ ticket: { rootCause: 'Cause', correctiveAction: 'Fix', preventiveAction: 'Prevent', resolutionSummary: 'Result', extra: 'hidden' } });
  const result = await f.call({ operation: 'get', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice' });
  assert.deepEqual(result, { ok: true, project_id: 'P', ticket_id: 'T', version: '100:1', resolution_record: {
    rootCause: 'Cause', correctiveAction: 'Fix', preventiveAction: 'Prevent', resolutionSummary: 'Result',
  } });
  assert.equal((await fixture({ cutoverMarker: null }).call({ operation: 'get', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice' })).ok, true);
});

test('allows clearing all four fields with empty strings', async () => {
  const f = fixture({ ticket: { rootCause: 'Cause', correctiveAction: 'Fix', preventiveAction: 'Prevent', resolutionSummary: 'Result' } });
  const result = await f.call(request({ command: { kind: 'resolution_save', root_cause: '', corrective_action: '', preventive_action: '', resolution_summary: '' } }));
  assert.equal(result.ok, true);
  assert.deepEqual(f.docs.get('projects/P/supportTickets/T'), {
    projectId: 'P', ticketNumber: 'SUP-2026-ABC123', status: 'open', rootCause: '', correctiveAction: '', preventiveAction: '', resolutionSummary: '', title: 'Existing ticket', updatedAt: 'SERVER_TIME',
  });
});

test('treats same values as a receipt-backed no-op without duplicate activity or audit', async () => {
  const f = fixture({ ticket: { rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored' } });
  const result = await f.call();
  assert.equal(result.resolution, 'committed');
  assert.deepEqual(result.resolution_record, { rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored' });
  assert.equal(f.docs.get('projects/P/supportTickets/T').updatedAt, undefined);
  assert.equal([...f.docs.keys()].some(path => path.includes('/activities/') || path.includes('/audit/')), false);
  assert.deepEqual(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/resolution-1').result.resolution_record, result.resolution_record);
  assert.equal((await f.call()).resolution, 'replayed');
});

test('replays exact operations before disabled gates, rejects conflicting operation reuse and CAS conflicts', async () => {
  const f = fixture();
  const first = await f.call();
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal([...f.docs.keys()].filter(path => path.includes('/activities/')).length, 1);
  assert.equal((await f.call(request({ command: { kind: 'resolution_save', root_cause: 'other', corrective_action: 'fix', preventive_action: 'monitor', resolution_summary: 'restored' } }))).error, 'operation_conflict');
  f.setEnabled(false);
  assert.equal((await f.call()).resolution, 'replayed');
  assert.equal((await f.call(request({ operation_id: 'resolution-2' }))).error, 'support_ticket_resolution_disabled');
  f.setEnabled(true);
  assert.equal((await f.call(request({ operation_id: 'resolution-3', expected_version: '0:0' }))).error, 'support_ticket_version_conflict');
  assert.equal(first.operation_id, 'resolution-1');
});

test('rechecks project access on receipt replay and permits approved members and admins', async () => {
  const f = fixture();
  await f.call();
  f.setProject({ projectId: 'P', memberIds: ['outsider'] });
  assert.equal((await f.call()).error, 'support_ticket_project_forbidden');
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: ['outsider'] } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'admin', project: { projectId: 'P', memberIds: [] } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'pending' }).call()).error, 'actor_forbidden');
});

test('fails closed for disabled gates and cutover modes', async () => {
  assert.equal((await fixture({ enabled: false }).call()).error, 'support_ticket_resolution_disabled');
  for (const cutoverMarker of [null, {}, { fence: 'wrong', version: 1 }, { fence: 'legacy_support_resolution_writes', version: 2 },
    { fence: 'legacy_support_resolution_writes', version: '1' }]) {
    const f = fixture({ cutoverMarker });
    assert.equal((await f.call()).error, 'support_ticket_resolution_cutover_not_ready');
    assert.equal(f.docs.get('projects/P/supportTickets/T').rootCause, '');
    assert.equal([...f.docs.keys()].some(path => path.includes('/receipts/') || path.includes('/audit/') || path.includes('/activities/')), false);
  }
  const removedAfterCommit = fixture();
  await removedAfterCommit.call();
  removedAfterCommit.setCutoverMarker(null);
  assert.equal((await removedAfterCommit.call()).resolution, 'replayed');
  assert.equal((await fixture({ runtimeMode: 'read_only' }).call()).error, 'support_ticket_resolution_read_only');
  assert.equal((await fixture({ runtimeMode: 'unknown' }).call()).error, 'support_ticket_control_unavailable');
  const keys = ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_RESOLUTION_ENABLED'];
  assert.equal(supportTicketResolutionEnabled({}), false);
  assert.equal(supportTicketResolutionEnabled(Object.fromEntries(keys.map(key => [key, 'true']))), true);
  for (const missing of keys) assert.equal(supportTicketResolutionEnabled(Object.fromEntries(keys.filter(key => key !== missing).map(key => [key, 'true']))), false);
});

test('rolls back ticket, activity, receipt and audit together when a transaction write fails', async () => {
  const f = fixture({ failPath: path => path.includes('/activities/') });
  assert.equal((await f.call()).error, 'support_ticket_service_unavailable');
  assert.equal(f.docs.get('projects/P/supportTickets/T').rootCause, '');
  assert.equal([...f.docs.keys()].some(path => path.includes('/activities/') || path.includes('/receipts/') || path.includes('/audit/')), false);
});

test('validates exact request shape and string sizes while permitting empty field values', async () => {
  const f = fixture();
  assert.equal((await f.call(request({ command: { kind: 'resolution_save', root_cause: 1, corrective_action: 'fix', preventive_action: 'monitor', resolution_summary: 'restored' } }))).error, 'invalid_support_ticket_resolution_request');
  assert.equal((await f.call(request({ command: { kind: 'resolution_save', root_cause: 'x'.repeat(20001), corrective_action: 'fix', preventive_action: 'monitor', resolution_summary: 'restored' } }))).error, 'invalid_support_ticket_resolution_request');
  assert.equal((await f.call(request({ command: { kind: 'resolution_save', root_cause: '', corrective_action: '', preventive_action: '', resolution_summary: '' }, unexpected: true }))).error, 'invalid_support_ticket_resolution_request');
  assert.equal((await f.call(request({ expected_actor_uid: 'outsider' }))).error, 'actor_session_changed');
});
