const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createNativeMaterialOperations } = require('./nativeMaterialOperations.cjs');

const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
const start = source.indexOf('// Reused BOM UI uses its real Firebase session;');
const end = source.indexOf('// Durable native PO recovery', start);

// The real export wiring decides whether writes are on for a given function environment.
function gateFor(env) {
  let engine;
  const context = { exports: {}, process: { env }, admin: { firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 't' } }), auth: () => 'auth' },
    require: () => ({ createNativeMaterialOperations: options => { engine = options; return 'handler'; } }), onCall: () => 'callable' };
  vm.runInNewContext(source.slice(start, end), context);
  return engine.mutationsEnabled;
}

const ON = { BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' };
const CLOSED_ENVS = [
  {}, { BOM_MATERIAL_MUTATIONS_ENABLED: 'false', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'false' },
  { BOM_MATERIAL_MUTATIONS_ENABLED: 'true' }, { BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' },
  { ...ON, BOM_MATERIAL_MUTATIONS_ENABLED: 'false' }, { ...ON, BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'false' },
  { ...ON, BOM_MATERIAL_MUTATIONS_ENABLED: 'TRUE' }, { ...ON, BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: '1' },
];

function fixture({ mutationsEnabled, role = 'admin', authFails = false } = {}) {
  const actor = { uid: 'admin-uid', email: 'admin@example.com', emailVerified: true, disabled: false, customClaims: { role, status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const docs = new Map([
    ['projects/A', { memberIds: [actor.uid], members: [{ userId: actor.uid, categoryScope: ['Mech'] }] }],
    ['projects/A/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'motor', name: 'Original', quantity: 1 }] }] }],
  ]);
  const counts = { reads: 0, writes: 0, transactions: 0, touches: 0 };
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`) });
  const db = { collection: name => { counts.touches++; return ref(name); }, runTransaction: async fn => {
    counts.transactions++;
    return fn({
      get: async row => { counts.reads++; return { exists: docs.has(row.path), data: () => structuredClone(docs.get(row.path)), updateTime: { seconds: 10, nanoseconds: 1 } }; },
      update: () => { counts.writes++; throw new Error('unexpected write'); }, create: () => { counts.writes++; throw new Error('unexpected write'); },
    });
  } };
  const auth = { verifyIdToken: async () => { if (authFails) throw new Error('rejected'); return token; }, getUser: async () => actor };
  const call = createNativeMaterialOperations({ db, auth, mutationsEnabled, getServerTimestamp: () => 'time' });
  const request = (data, { uid = actor.uid, bearer = 'Bearer t' } = {}) => ({ auth: uid ? { uid } : undefined, rawRequest: { get: () => bearer }, data });
  return { actor, docs, counts, call, request };
}

const WRITES = actor => ({
  patch: { operation: 'patch', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'op-patch', expected_actor_uid: actor.uid, patch: { name: 'Changed' } },
  fulfill: { operation: 'fulfill', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'op-fulfill', expected_actor_uid: actor.uid, fulfillment: { kind: 'fulfillment', quantity: 1 } },
  command: { operation: 'command', project_id: 'A', expected_version: '10:1', operation_id: 'op-command', expected_actor_uid: actor.uid, command: { kind: 'delete_items', item_ids: ['motor'] } },
  create_project: { operation: 'create_project', project_id: 'NEW', operation_id: 'op-create', expected_actor_uid: actor.uid,
    project: { projectName: 'New', clientName: 'Customer', description: '', status: 'Planning', deadline: '2026-12-01', poValue: 0 } },
});

test('unauthenticated, unverified and mismatched callers never reach Firestore', async () => {
  const cases = [
    { name: 'no auth context', request: { uid: null } }, { name: 'no bearer', request: { bearer: null } },
    { name: 'wrong scheme', request: { bearer: 'Basic x' } }, { name: 'rejected token', fixture: { authFails: true } },
    { name: 'uid mismatch', request: { uid: 'someone-else' } },
  ];
  for (const value of cases) for (const operation of ['get', ...Object.keys(WRITES({ uid: 'x' }))]) {
    const f = fixture({ mutationsEnabled: gateFor(ON), ...value.fixture });
    const data = operation === 'get' ? { operation: 'get', project_id: 'A' } : WRITES(f.actor)[operation];
    const result = await f.call(f.request(data, value.request));
    assert.equal(result.ok, false, `${value.name}/${operation}`);
    assert.match(result.error, /^actor_(authentication_required|forbidden)$/, `${value.name}/${operation}`);
    assert.deepEqual(f.counts, { reads: 0, writes: 0, transactions: 0, touches: 0 }, `${value.name}/${operation}`);
  }
});

test('every closed gate configuration rejects all four write paths without any Firestore access', async () => {
  for (const env of CLOSED_ENVS) {
    const enabled = gateFor(env);
    assert.equal(enabled(), false, JSON.stringify(env));
    for (const [name, data] of Object.entries(WRITES({ uid: 'admin-uid' }))) {
      const f = fixture({ mutationsEnabled: enabled });
      const before = structuredClone([...f.docs]);
      assert.deepEqual(await f.call(f.request(data)), { ok: false, error: 'material_mutations_disabled' }, `${name} ${JSON.stringify(env)}`);
      assert.deepEqual([...f.docs], before, name);
      assert.equal(f.counts.writes, 0, name);
      assert.equal(f.counts.transactions, 0, `${name} must stop before any transaction`);
    }
  }
});

test('the closed-gate rejection also applies to an unset gate dependency', async () => {
  for (const [name, data] of Object.entries(WRITES({ uid: 'admin-uid' }))) {
    const f = fixture({ mutationsEnabled: undefined });
    assert.deepEqual(await f.call(f.request(data)), { ok: false, error: 'material_mutations_disabled' }, name);
    assert.equal(f.counts.writes, 0);
  }
});

test('disabled read is nondestructive, advertises no edit or command, and repeats identically', async () => {
  for (const role of ['admin', 'user', 'viewer']) {
    const f = fixture({ mutationsEnabled: gateFor({}), role });
    if (role !== 'admin') f.docs.get('projects/A').members[0].categoryScope = ['Mech'];
    const before = structuredClone([...f.docs]);
    const first = await f.call(f.request({ operation: 'get', project_id: 'A' }));
    assert.equal(first.ok, true, role);
    assert.equal(first.permissions.edit, false); assert.equal(first.permissions.command, false);
    assert.equal(first.version, '10:1');
    assert.deepEqual(await f.call(f.request({ operation: 'get', project_id: 'A' })), first);
    assert.deepEqual([...f.docs], before, role);
    assert.equal(f.counts.writes, 0, role);
  }
});
