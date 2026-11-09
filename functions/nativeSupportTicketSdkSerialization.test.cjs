const test = require('node:test');
const assert = require('node:assert/strict');
const { Firestore, DocumentReference } = require('@google-cloud/firestore');
const { encode } = require('./node_modules/firebase-functions/lib/common/providers/https.js');
const status = require('./nativeSupportTicketStatusFixture.cjs');
const assignment = require('./nativeSupportTicketAssignmentFixture.cjs');

// Offline only: synthetic credential, never used for any connection.
const SENTINEL = 'SYNTHETIC-SUPPORT-SDK-SENTINEL';
const sdk = new Firestore({ projectId: 'demo-offline', credentials: { client_email: 'synthetic@example.invalid', private_key: SENTINEL } });
const ref = () => sdk.doc('legacy/reference');

// Fixtures deep-copy with structuredClone, which cannot hold SDK classes. Test double only: keep non-plain values by reference.
const isPlain = v => v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const keep = v => v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(keep) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keep(x)])) : v;
const originalClone = globalThis.structuredClone;
test.before(() => { globalThis.structuredClone = keep; });
test.after(() => { globalThis.structuredClone = originalClone; });

const leaks = response => {
  const json = JSON.stringify(encode(response));
  return json.includes(SENTINEL) || json.includes('_firestore') || json.includes('_settings') || json.includes('private_key');
};
const getStatus = { operation: 'get', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice' };
const getAssign = getStatus;
const STATE_ERROR = 'support_ticket_state_invalid';

test('control: the real SDK reference and Firebase encode really do leak the synthetic credential', () => {
  assert.ok(ref() instanceof DocumentReference);
  assert.equal(leaks({ ok: true, status: ref() }), true);
});

test('status get rejects a stored reference status without leaking SDK internals', async () => {
  const result = await status.fixture({ ticket: { status: ref() } }).call(getStatus);
  assert.equal(leaks(result), false);
  assert.deepEqual(result, { ok: false, error: STATE_ERROR, status: 409 });
});

test('status get rejects other non-string stored statuses and keeps legitimate and legacy strings unchanged', async () => {
  for (const bad of [{ a: 1 }, ['open'], 5, true]) {
    assert.equal((await status.fixture({ ticket: { status: bad } }).call(getStatus)).error, STATE_ERROR);
  }
  for (const good of ['open', 'in-progress', 'Legacy Custom']) {
    const result = await status.fixture({ ticket: { status: good } }).call(getStatus);
    assert.deepEqual(result, { ok: true, project_id: 'P', ticket_id: 'T', version: '100:1', status: good });
  }
});

test('status get keeps permission and missing-ticket outcomes ahead of the stored-state check', async () => {
  assert.equal((await status.fixture({ uid: 'outsider', ticket: { status: ref() } }).call({ ...getStatus, expected_actor_uid: 'outsider' })).error, 'support_ticket_project_forbidden');
});

test('status command is unaffected by the stored-state check on its response and still follows the same flags', async () => {
  const f = status.fixture();
  assert.equal((await f.call()).resolution, 'committed');
  const off = status.fixture({ enabled: false });
  assert.equal((await off.call()).error, 'support_ticket_status_disabled');
  assert.equal((await off.call(status.request({ operation_id: 'x' }))).error, 'support_ticket_status_disabled');
});

test('assignment get rejects reference and nested-reference assignees without leaking', async () => {
  const bad = [
    ref(),
    { userId: 'engineer', name: 'Engineer', email: ref() },
    { userId: 'engineer', name: ref(), email: 'e@example.com' },
    { userId: ref(), name: 'Engineer', email: 'e@example.com' },
    { userId: 'engineer', name: 'Engineer', email: 'e@example.com', nested: { r: ref() } },
    { userId: 'engineer' },
    'engineer',
    ['engineer'],
  ];
  for (const assignee of bad) {
    const result = await assignment.fixture({ ticket: { assignee } }).call(getAssign);
    assert.equal(leaks(result), false);
    assert.deepEqual(result, { ok: false, error: STATE_ERROR, status: 409 });
  }
});

test('assignment get leaves legitimate and absent assignees unchanged', async () => {
  const full = { userId: 'engineer', name: 'Engineer', email: 'engineer@example.com' };
  assert.deepEqual((await assignment.fixture({ ticket: { assignee: full } }).call(getAssign)).assignee, full);
  const noEmail = { userId: 'engineer', name: 'Engineer' };
  assert.deepEqual((await assignment.fixture({ ticket: { assignee: noEmail } }).call(getAssign)).assignee, noEmail);
  const blank = { userId: 'engineer', name: 'engineer', email: '' };
  assert.deepEqual((await assignment.fixture({ ticket: { assignee: blank } }).call(getAssign)).assignee, blank);
  assert.equal((await assignment.fixture().call(getAssign)).assignee, null);
});

test('assignment no-op command rejects a reference assignee and writes no receipt', async () => {
  const f = assignment.fixture({ ticket: { assignee: { userId: 'engineer', name: 'E', email: ref() } } });
  const result = await f.call();
  assert.equal(leaks(result), false);
  assert.equal(result.error, STATE_ERROR);
  assert.equal(f.docs.has('pulseNativeSupportTicketOperations/P/receipts/assign-1'), false);
});

test('assignment unassign over a reference assignee fails closed without leaking or writing', async () => {
  const f = assignment.fixture({ ticket: { assignee: ref() } });
  const result = await f.call(assignment.request({ command: { kind: 'assignee_change', assignee_user_id: null } }));
  assert.equal(leaks(result), false);
  assert.equal(result.error, STATE_ERROR);
  assert.equal([...f.docs.keys()].some(path => path.includes('/receipts/') || path.includes('/audit/') || path.includes('/activities/')), false);
});

test('assignment no-op with a legitimate assignee keeps its shape, receipt and replay', async () => {
  const assigned = { userId: 'engineer', name: 'Older Display Name', email: 'engineer@example.com' };
  const f = assignment.fixture({ ticket: { assignee: assigned } });
  const first = await f.call();
  assert.deepEqual(first, { ok: true, project_id: 'P', ticket_id: 'T', operation_id: 'assign-1', assignee: assigned, resolution: 'committed' });
  assert.deepEqual(f.docs.get('pulseNativeSupportTicketOperations/P/receipts/assign-1').result.assignee, assigned);
  assert.deepEqual(await f.call(), { ...first, resolution: 'replayed' });
});

test('replay of a corrupted stored receipt does not leak a reference assignee', async () => {
  const f = assignment.fixture();
  await f.call();
  const receipt = f.docs.get('pulseNativeSupportTicketOperations/P/receipts/assign-1');
  f.docs.set('pulseNativeSupportTicketOperations/P/receipts/assign-1', { ...receipt, result: { ...receipt.result, assignee: ref() } });
  const result = await f.call();
  assert.equal(leaks(result), false);
  assert.equal(result.error, STATE_ERROR);
});

test('assignment writes still follow the same flags', async () => {
  const off = assignment.fixture({ enabled: false });
  assert.equal((await off.call()).error, 'support_ticket_assignment_disabled');
  assert.equal((await assignment.fixture({ runtimeMode: 'read_only' }).call()).error, 'support_ticket_assignment_read_only');
});
