const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeMaterialOperations } = require('./nativeMaterialOperations.cjs');

function fixture({ enabled = true, mode, flipOnSecondLookup = false } = {}) {
  const actor = { uid: 'native-uid', email: 'partner@qualitastech.com', emailVerified: true, disabled: false, customClaims: { role: 'user', status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const docs = new Map([['projects/A', { memberIds: [actor.uid] }], ['projects/A/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'motor', name: 'Original', quantity: 1 }] }] }]]);
  if (mode) docs.set('pulseRuntimeControl/cutover', { mode });
  const stats = { reads: 0, verifies: 0 };
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`) });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const writes = [];
    const result = await fn({ get: async row => { stats.reads++; return { exists: docs.has(row.path), data: () => structuredClone(docs.get(row.path)), updateTime: { seconds: 10, nanoseconds: 1 } }; },
      update: (row, fields) => writes.push(() => docs.set(row.path, { ...docs.get(row.path), ...fields })), create: (row, data) => writes.push(() => docs.set(row.path, data)) });
    writes.forEach(write => write()); return result;
  } };
  const auth = { verifyIdToken: async () => { stats.verifies++; return token; }, getUser: async () => { if (flipOnSecondLookup && stats.verifies >= 2) return { ...actor, customClaims: { ...actor.customClaims, role: 'viewer' } }; return { ...actor, customClaims: { ...actor.customClaims } }; } };
  const call = createNativeMaterialOperations({ db, auth, mutationsEnabled: () => enabled, getServerTimestamp: () => 'server-time' });
  const invoke = data => call({ auth: { uid: actor.uid }, rawRequest: { get: () => 'Bearer t' }, data });
  const patch = { operation: 'patch', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'nonce-1', patch: { name: 'Changed' }, expected_actor_uid: actor.uid };
  return { actor, docs, stats, invoke, patch };
}

test('callable accepts resolve_only on writes only and settles receipts while the runtime is read-only', async () => {
  const f = fixture(); assert.equal((await f.invoke(f.patch)).ok, true);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await f.invoke(f.patch)).ok, true);
  assert.deepEqual(await f.invoke({ operation: 'get', project_id: 'A', resolve_only: true }), { ok: false, error: 'invalid_material_request' });
  const resolved = await f.invoke({ ...f.patch, resolve_only: true }); assert.deepEqual([resolved.ok, resolved.resolution, resolved.operation_id], [true, 'committed', 'nonce-1']);
  assert.deepEqual(await f.invoke({ ...f.patch, operation_id: 'nonce-2' }), { ok: false, error: 'material_read_only' });
  const cancelled = await f.invoke({ ...f.patch, operation_id: 'nonce-2', resolve_only: true }); assert.equal(cancelled.resolution, 'cancelled');
  assert.deepEqual(await f.invoke({ ...f.patch, operation_id: 'nonce-2' }), { ok: false, error: 'material_request_cancelled' });
  assert.equal(f.docs.get('projects/A/bom/data').categories[0].items[0].name, 'Changed');
});

test('pulse_only allows native writes; closed env rejects ordinary writes before Firestore but not resolve', async () => {
  const f = fixture({ mode: 'pulse_only' }); assert.equal((await f.invoke(f.patch)).ok, true);
  const closed = fixture({ enabled: false, mode: 'read_only' }); const reads = closed.stats.reads;
  assert.deepEqual(await closed.invoke(closed.patch), { ok: false, error: 'material_mutations_disabled' }); assert.equal(closed.stats.reads, reads);
  assert.equal((await closed.invoke({ ...closed.patch, resolve_only: true })).resolution, 'cancelled');
  const get = await closed.invoke({ operation: 'get', project_id: 'A' }); assert.deepEqual([get.permissions.edit, get.permissions.command, get.permissions.resolve], [false, false, true]);
});

test('the live actor is re-verified inside the write and replay transactions', async () => {
  const f = fixture(); const before = f.stats.verifies; await f.invoke(f.patch); assert.ok(f.stats.verifies - before >= 2);
  const g = fixture({ flipOnSecondLookup: true });
  assert.deepEqual(await g.invoke(g.patch), { ok: false, error: 'actor_session_changed' });
  assert.equal(g.docs.get('projects/A/bom/data').categories[0].items[0].name, 'Original');
});
