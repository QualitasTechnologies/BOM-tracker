const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, validInput } = require('./nativeSupportTicketCreateFixture.cjs');
const { supportTicketCreateEnabled } = require('./nativeSupportTicketCreate.cjs');

test('atomically creates a ticket, created activity, receipt and audit with server identity and stable number', async () => {
  const f = fixture();
  const result = await f.call({ ...validInput, createdBy: 'attacker', createdByName: 'Attacker', ticketNumber: 'FORGED', createdAt: 'forged', activityId: 'forged' });
  assert.equal(result.ok, true);
  assert.equal(result.resolution, 'committed');
  assert.equal(result.ticket_number, `SUP-2026-${result.ticket_id.slice(0, 6).toUpperCase()}`);
  const ticket = f.docs.get(`projects/P/supportTickets/${result.ticket_id}`);
  assert.equal(ticket.createdBy, 'alice');
  assert.equal(ticket.createdByName, 'Alice Auth');
  assert.equal(ticket.ticketNumber, result.ticket_number);
  assert.equal(ticket.createdAt, 'SERVER_TIME');
  assert.equal(ticket.updatedAt, 'SERVER_TIME');
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.firstResponseTargetAt.toISOString(), '2026-10-17T16:00:00.000Z');
  assert.equal(ticket.resolutionTargetAt.toISOString(), '2026-10-18T12:00:00.000Z');
  assert.equal(f.docs.get(`projects/P/supportTickets/${result.ticket_id}/activities/created`).createdBy, 'alice');
  assert.equal(f.docs.get(`projects/P/supportTickets/${result.ticket_id}/activities/created`).createdAt, 'SERVER_TIME');
  assert.equal(f.docs.get(`pulseNativeSupportTicketOperations/P/receipts/create-1`).result.ticket_id, result.ticket_id);
  assert.equal(f.docs.get(`pulseNativeSupportTicketOperations/P/audit/create-1`).actor_uid, 'alice');
  assert.equal(f.docs.size, 5);
});

test('approved admins bypass membership, viewers need listed membership, explicit null keeps fallback and absent memberIds denies', async () => {
  assert.equal((await fixture({ uid: 'admin', project: { projectId: 'P', memberIds: [] } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'admin', project: { projectId: 'P' } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'alice', project: { projectId: 'P', memberIds: ['alice'] } }).call()).ok, true);
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P' } }).call()).error, 'support_ticket_project_forbidden');
  assert.equal((await fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: null } }).call()).ok, true);
});

test('rejects nonmembers and unapproved actors without writes', async () => {
  const outsider = fixture({ uid: 'outsider', project: { projectId: 'P', memberIds: ['alice'] } });
  assert.equal((await outsider.call()).error, 'support_ticket_project_forbidden');
  assert.equal(outsider.docs.size, 1);
  const pending = fixture({ uid: 'pending' });
  assert.equal((await pending.call()).error, 'actor_forbidden');
  assert.equal(pending.docs.size, 1);
});

test('rejects a forged initial assignee who is not in the project roster', async () => {
  const f = fixture({ project: {
    projectId: 'P', memberIds: ['alice'], members: [{ userId: 'bob', displayName: 'Bob Member', email: 'bob@example.com' }],
  } });
  const result = await f.call({ ...validInput, assignee: { userId: 'outsider', name: 'Forged', email: 'outsider@example.com' } });
  assert.equal(result.error, 'support_ticket_assignee_not_in_project');
  assert.equal(result.status, 422);
  assert.deepEqual([...f.docs.keys()], ['projects/P']);
});

test('stores initial assignee identity from the current project roster, not caller-supplied text', async () => {
  const f = fixture({ project: {
    projectId: 'P', memberIds: ['alice'], members: [{ userId: 'bob', displayName: 'Bob Member', email: 'bob@example.com' }],
  } });
  const result = await f.call({ ...validInput, assignee: { userId: 'bob', name: 'Forged', email: 'forged@example.com' } });
  assert.equal(result.ok, true);
  assert.deepEqual(f.docs.get(`projects/P/supportTickets/${result.ticket_id}`).assignee, {
    userId: 'bob', name: 'Bob Member', email: 'bob@example.com',
  });
});

test('operation replay returns original identity, rejects another payload and rechecks current access', async () => {
  const f = fixture(); const first = await f.call();
  const replay = await f.call();
  assert.equal(replay.resolution, 'replayed');
  assert.equal(replay.ticket_id, first.ticket_id);
  assert.equal(f.docs.size, 5);
  assert.equal((await f.call({ ...validInput, title: 'different' })).error, 'operation_conflict');
  f.setProject({ projectId: 'P', memberIds: ['outsider'] });
  assert.equal((await f.call()).error, 'support_ticket_project_forbidden');
});

test('default-off writes reject a new operation but allow only an existing matching replay', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.call()).error, 'support_ticket_create_disabled');
  assert.equal(f.docs.size, 1);
  f.setEnabled(true); const first = await f.call(); f.setEnabled(false);
  assert.equal((await f.call()).ticket_id, first.ticket_id);
  assert.equal((await f.call({ ...validInput, title: 'different' })).error, 'operation_conflict');
});

test('runtime cutover defaults to coexist, blocks read_only and unknown modes for new writes, and leaves receipt replay available', async () => {
  const f = fixture();
  const first = await f.call();
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await f.call(validInput, { operation_id: 'new-readonly' })).error, 'support_ticket_create_read_only');
  assert.equal((await f.call()).resolution, 'replayed');
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'unknown' });
  assert.equal((await f.call(validInput, { operation_id: 'new-unknown' })).error, 'support_ticket_control_unavailable');
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'pulse_only' });
  assert.equal((await f.call(validInput, { operation_id: 'new-pulse-only' })).ok, true);
  assert.equal(first.resolution, 'committed');
});

test('all three write gates are strict default-off requirements', () => {
  const keys = ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_CREATE_ENABLED'];
  assert.equal(supportTicketCreateEnabled({}), false);
  for (let index = 0; index < keys.length; index++) assert.equal(supportTicketCreateEnabled(Object.fromEntries(keys.slice(0, index + 1).map(key => [key, 'true']))), index === keys.length - 1);
  assert.equal(supportTicketCreateEnabled(Object.fromEntries(keys.map((key, index) => [key, index === 1 ? 'TRUE' : 'true']))), false);
});

test('failed transaction leaves no partial ticket, activity, receipt or audit', async () => {
  const f = fixture({ failPath: path => path.includes('/activities/') });
  const result = await f.call();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'support_ticket_service_unavailable');
  assert.deepEqual([...f.docs.keys()], ['projects/P']);
});

test('validates request identity and bounded input rather than accepting forged project data', async () => {
  const f = fixture();
  assert.equal((await f.call({ ...validInput, projectId: 'OTHER' })).error, 'invalid_support_ticket_request');
  assert.equal((await f.call(validInput, { operation_id: '../escape' })).error, 'invalid_support_ticket_request');
  assert.equal((await f.call({ ...validInput, title: '' })).error, 'invalid_support_ticket_request');
  assert.deepEqual([...f.docs.keys()], ['projects/P']);
});
