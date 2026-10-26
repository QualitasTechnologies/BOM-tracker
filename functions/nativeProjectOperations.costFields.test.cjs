const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativeProjectFixture.cjs');

const FIELDS = ['costPerHour', 'miscCost', 'poValue'];
const open = async f => (await f.call({ operation: 'get' })).version;
const request = (version, command, operation_id = 'cost-1', extra = {}) => ({ operation: 'command', expected_version: version, operation_id, command, ...extra });
const paths = f => [...f.docs.keys()].filter(path => path.startsWith('pulseProjectOperations/'));

test('cost_field is an admin-only one-field raw merge that preserves every other root field', async () => {
  for (const field of FIELDS) {
    const f = fixture();
    const history = [{ id: 'historic', amount: 12 }], raw = new Date('2024-01-01T00:00:00.000Z');
    f.change({ internalBudget: 500, bomSnapshot: history, bomSnapshotDate: 'then', rawLegacyField: raw, costPerHour: 10, miscCost: 20, poValue: 30 });
    const before = structuredClone(f.docs.get('projects/P'));
    const result = await f.call(request(await open(f), { kind: 'cost_field', field, amount: 1234 }));
    assert.deepEqual(result, { ok: true, project_id: 'P', operation_id: 'cost-1' }, field);
    const after = f.docs.get('projects/P');
    assert.equal(after[field], 1234);
    for (const key of Object.keys(before)) if (key !== field) assert.deepEqual(after[key], before[key], `${field} changed ${key}`);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    assert.equal(after.rawLegacyField, raw);
    const audit = f.docs.get('pulseProjectOperations/P/audit/cost-1');
    assert.equal(audit.operation, 'cost_field');
    assert.deepEqual(Object.keys(audit.changes), [field]);
    assert.deepEqual(audit.changes[field], { before: { present: true, value: before[field] }, after: { present: true, value: 1234 } });
    assert.equal(f.docs.get('pulseProjectOperations/P/receipts/cost-1').actor_uid, 'admin');
  }
});

test('legacy finite signed amounts including explicit zero and negative are accepted', async () => {
  for (const amount of [0, -250, -0.5, 12.75, 1e12]) {
    const f = fixture();
    f.change({ miscCost: 99 });
    assert.equal((await f.call(request(await open(f), { kind: 'cost_field', field: 'miscCost', amount }))).ok, true, String(amount));
    assert.equal(f.docs.get('projects/P').miscCost, amount);
    assert.equal(Object.is(f.docs.get('projects/P').miscCost, -0), false);
  }
  const f = fixture();
  assert.equal((await f.call(request(await open(f), { kind: 'cost_field', field: 'poValue', amount: -0 }))).ok, true);
  assert.equal(Object.is(f.docs.get('projects/P').poValue, 0), true);
  // Negative budget stays rejected: the budget validator is separate.
  assert.equal((await fixture().command({ kind: 'budget', amount: -1 })).error, 'invalid_project_command');
});

test('audit before value preserves absent, null, string and zero raw history exactly', async () => {
  const cases = [
    { name: 'absent', seed: {}, before: { present: false } },
    { name: 'null', seed: { poValue: null }, before: { present: true, value: null } },
    { name: 'string', seed: { poValue: '5000' }, before: { present: true, value: '5000' } },
    { name: 'zero', seed: { poValue: 0 }, before: { present: true, value: 0 } },
  ];
  for (const { name, seed, before } of cases) {
    const f = fixture();
    f.change({ ...seed, bomSnapshot: [{ snapshotCost: 7 }] });
    assert.equal((await f.call(request(await open(f), { kind: 'cost_field', field: 'poValue', amount: 42 }, `raw-${name}`))).ok, true, name);
    assert.deepEqual(f.docs.get(`pulseProjectOperations/P/audit/raw-${name}`).changes.poValue.before, before, name);
    assert.deepEqual(f.docs.get('projects/P').bomSnapshot, [{ snapshotCost: 7 }]);
    assert.equal(Object.hasOwn(f.docs.get('projects/P'), 'snapshotCost'), false);
  }
});

test('invalid cost_field commands are rejected before any receipt, audit or project write', async () => {
  const bad = [
    { kind: 'cost_field', field: 'internalBudget', amount: 1 },
    { kind: 'cost_field', field: 'estimatedBudget', amount: 1 },
    { kind: 'cost_field', field: '__proto__', amount: 1 },
    { kind: 'cost_field', field: 'constructor', amount: 1 },
    { kind: 'cost_field', field: 'status', amount: 1 },
    { kind: 'cost_field', amount: 1 },
    { kind: 'cost_field', field: 'miscCost' },
    { kind: 'cost_field', field: 'miscCost', amount: null },
    { kind: 'cost_field', field: 'miscCost', amount: '10' },
    { kind: 'cost_field', field: 'miscCost', amount: NaN },
    { kind: 'cost_field', field: 'miscCost', amount: Infinity },
    { kind: 'cost_field', field: 'miscCost', amount: -Infinity },
    { kind: 'cost_field', field: 'miscCost', amount: true },
    { kind: 'cost_field', field: 'miscCost', amount: [1] },
    { kind: 'cost_field', field: 'miscCost', amount: 1, extra: true },
    { kind: 'cost_field', field: 'miscCost', amount: 1, patch: { status: 'Completed' } },
    { kind: 'cost_field', field: ['miscCost'], amount: 1 },
  ];
  for (const command of bad) {
    const f = fixture();
    const version = await open(f), before = structuredClone([...f.docs]);
    assert.equal((await f.call(request(version, command))).error, 'invalid_project_command', JSON.stringify(command));
    assert.deepEqual([...f.docs], before, JSON.stringify(command));
    assert.equal((await f.call(request(version, command, 'cost-1', { resolve_only: true }))).error, 'invalid_project_command');
    assert.deepEqual([...f.docs], before);
  }
});

test('only an admin may open, replay or resolve a cost_field command and a denial cannot mint a receipt', async () => {
  for (const uid of ['alice', 'partner', 'bob']) {
    const f = fixture({ uid, supportProfileEnabled: true });
    const version = '10:1', before = structuredClone([...f.docs]);
    const command = { kind: 'cost_field', field: 'costPerHour', amount: 5 };
    assert.ok(['project_edit_forbidden', 'project_forbidden'].includes((await f.call(request(version, command))).error), uid);
    assert.ok(['project_edit_forbidden', 'project_forbidden'].includes((await f.call(request(version, command, 'cost-1', { resolve_only: true }))).error), uid);
    assert.deepEqual([...f.docs], before, uid);
    assert.equal(paths(f).length, 0, uid);
  }
});

test('actor demotion between read and write is denied atomically', async () => {
  const f = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('admin').customClaims.role = 'viewer'; } });
  const version = '10:1', before = structuredClone([...f.docs]);
  assert.equal((await f.call(request(version, { kind: 'cost_field', field: 'costPerHour', amount: 5 }))).error, 'project_edit_forbidden');
  assert.deepEqual([...f.docs], before);
});

test('replay and resolve revalidate the current actor and project access', async () => {
  const f = fixture();
  const body = request(await open(f), { kind: 'cost_field', field: 'miscCost', amount: -40 });
  assert.equal((await f.call(body)).ok, true);
  const afterCommit = structuredClone([...f.docs]);
  assert.deepEqual(await f.call(body), { ok: true, project_id: 'P', operation_id: 'cost-1' });
  assert.deepEqual([...f.docs], afterCommit);
  assert.equal((await f.call({ ...body, resolve_only: true })).resolution, 'committed');
  assert.deepEqual([...f.docs], afterCommit);
  f.users.get('admin').customClaims.role = 'viewer';
  assert.equal((await f.call(body)).error, 'project_edit_forbidden');
  assert.equal((await f.call({ ...body, resolve_only: true })).error, 'project_edit_forbidden');
  f.users.get('admin').customClaims.role = 'admin';
  f.users.get('admin').customClaims.status = 'approved';
  assert.equal((await f.call(body)).ok, true);
  // A changed payload or version under the same nonce never replays the receipt.
  for (const changed of [{ ...body.command, amount: -41 }, { ...body.command, field: 'poValue' }]) {
    assert.equal((await f.call({ ...body, command: changed })).error, 'operation_conflict');
    assert.equal((await f.call({ ...body, command: changed, resolve_only: true })).error, 'operation_conflict');
  }
  assert.equal((await f.call({ ...body, expected_version: '10:9' })).error, 'operation_conflict');
  assert.deepEqual([...f.docs], afterCommit);
});

test('stale expected versions conflict without writing', async () => {
  const f = fixture();
  const version = await open(f);
  f.change({ description: 'Changed elsewhere' });
  const before = structuredClone([...f.docs]);
  assert.equal((await f.call(request(version, { kind: 'cost_field', field: 'costPerHour', amount: 5 }))).error, 'project_version_conflict');
  assert.deepEqual([...f.docs], before);
});

test('cost writes honor the same gates while resolution still works with gates closed', async () => {
  const command = { kind: 'cost_field', field: 'poValue', amount: 77 };
  const disabled = fixture({ enabled: false });
  assert.equal((await disabled.command(command)).error, 'project_mutations_disabled');
  const paused = fixture();
  paused.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await paused.command(command)).error, 'project_read_only');
  assert.equal(paths(paused).length, 0);

  const f = fixture();
  const body = request(await open(f), command, 'lost');
  assert.equal((await f.call(body)).ok, true);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  const before = structuredClone([...f.docs]);
  assert.equal((await f.call({ ...body, resolve_only: true })).resolution, 'committed');
  assert.deepEqual([...f.docs], before);

  const g = fixture({ enabled: false });
  const cancel = request(await open(g), command, 'never');
  const projects = structuredClone(g.docs.get('projects/P'));
  const cancelled = await g.call({ ...cancel, resolve_only: true });
  assert.equal(cancelled.resolution, 'cancelled');
  assert.deepEqual(g.docs.get('projects/P'), projects);
  assert.equal(g.docs.get('pulseProjectOperations/P/audit/never').operation, 'cost_field_cancelled');
  assert.equal((await g.call(cancel)).error, 'project_request_cancelled');
});

test('an audit failure leaves the project and receipts untouched', async () => {
  const f = fixture({ failAudit: true });
  f.change({ miscCost: 3 });
  const before = structuredClone([...f.docs]);
  assert.equal((await f.command({ kind: 'cost_field', field: 'miscCost', amount: 4 })).ok, false);
  assert.deepEqual([...f.docs], before);
});
