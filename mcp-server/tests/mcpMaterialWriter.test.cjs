const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpMaterialWriter } = require('../dist/mcpMaterialWriter.cjs');

class ServerTimestampTransform {}
const P = 'PRJ-1';
const BOM = `projects/${P}/bom/data`;
const RECEIPT = op => `pulseMcpOperations/${P}/receipts/${op}`;
const AUDIT = op => `pulseMcpOperations/${P}/audit/${op}`;
const CONTROL = 'pulseRuntimeControl/cutover';

// In-memory Firestore: transaction writes are buffered, applied atomically, and rolled back on failure.
function memoryDb({ failPath } = {}) {
  const docs = new Map(); let clock = 100;
  const stamp = () => ({ seconds: clock++, nanoseconds: 7 });
  const put = (path, data) => docs.set(path, { data: structuredClone(data), updateTime: stamp() });
  const ref = path => ({ path, collection: name => collection(`${path}/${name}`), doc: id => ref(`${path}/${id}`) });
  const collection = base => ({ doc: id => ref(`${base}/${id}`) });
  const snap = path => { const row = docs.get(path); return { exists: !!row, data: () => row && structuredClone(row.data), updateTime: row?.updateTime }; };
  const db = {
    docs, put, collection,
    runTransaction: async fn => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map(), writes = [];
        const tx = {
          get: async r => { reads.set(r.path, docs.get(r.path)?.updateTime?.seconds); return snap(r.path); },
          update: (r, data) => writes.push(['update', r.path, data]),
          create: (r, data) => writes.push(['create', r.path, data])
        };
        const result = await fn(tx);
        if ([...reads].some(([path, seconds]) => docs.get(path)?.updateTime?.seconds !== seconds)) continue;
        const backup = new Map(docs);
        try {
          for (const [kind, path, data] of writes) {
            if (path === failPath) throw new Error('simulated write failure');
            if (kind === 'create' && docs.has(path)) throw new Error('already exists');
            const old = docs.get(path)?.data ?? {};
            put(path, kind === 'update' ? { ...old, ...data } : data);
          }
        } catch (error) { docs.clear(); backup.forEach((v, k) => docs.set(k, v)); throw error; }
        return result;
      }
      throw new Error('contention');
    }
  };
  return db;
}

const history = { id: 'old-1', name: 'Relay', description: 'd', itemType: 'component', category: 'Electrical', quantity: 4, status: 'received', price: 10, vendors: [{ name: 'V', price: 9, leadTime: '2 weeks', availability: 'x' }], finalizedVendor: { name: 'V', price: 9, leadTime: '2 weeks' }, fulfillmentTranches: [{ id: 't1', quantity: 4, loggedAt: '2026-01-01' }], poNumber: 'PO-1', linkedPODocumentId: 'doc-1' };
function seed(db) {
  db.put(`projects/${P}`, { projectName: 'X' });
  db.put(BOM, { extra: 'keep', categories: [{ name: 'Electrical', isExpanded: false, items: [history] }, { name: 'Mechanical', items: [] }] });
}
const versionOf = (db, path = BOM) => { const t = db.docs.get(path).updateTime; return `${t.seconds}:${t.nanoseconds}`; };
const principal = { id: 'google-sub-1', email: 'robot@example.iam.gserviceaccount.com' };
const make = (db, p = principal) => createMcpMaterialWriter({ db, resolvePrincipal: async () => p, getServerTimestamp: () => new ServerTimestampTransform() });
const input = (db, extra = {}) => ({ project_id: P, category: 'electrical', name: 'Cable', description: 'Power', quantity: 2, price: 5, expected_version: db.docs.has(BOM) ? versionOf(db) : '1:1', operation_id: 'op-1', ...extra });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('adds item with canonical category, deterministic id, audit and receipt; preserves history', async () => {
  const db = memoryDb(); seed(db);
  const result = await make(db).addItem(input(db));
  assert.match(result.item_id, /^mcp-[a-f0-9]{64}$/); assert.equal(result.category, 'Electrical'); assert.equal(result.replayed, false);
  const bom = db.docs.get(BOM).data;
  assert.equal(bom.extra, 'keep');
  assert.deepEqual(bom.categories[0].items[0], history);
  assert.equal(bom.categories[0].isExpanded, false);
  assert.equal(bom.categories[0].items[1].id, result.item_id);
  assert.equal(bom.categories[0].items[1].status, 'not-ordered');
  assert.equal(db.docs.get(AUDIT('op-1')).data.actor.subject, 'google-sub-1');
  assert.equal(db.docs.get(AUDIT('op-1')).data.actor.type, 'google-credential');
  assert.equal(db.docs.get(RECEIPT('op-1')).data.principalId, 'google-sub-1');
  assert.equal('uid' in db.docs.get(AUDIT('op-1')).data.actor, false);
});

test('stale expected version rejects without writing', async () => {
  const db = memoryDb(); seed(db);
  const stale = input(db);
  db.put(BOM, { ...db.docs.get(BOM).data }); // another writer bumps the revision
  await rejects(make(db).addItem(stale), 'stale_bom_version');
  assert.equal(db.docs.get(BOM).data.categories[0].items.length, 1);
  assert.equal(db.docs.has(RECEIPT('op-1')), false);
});

test('concurrent writer between read and commit is retried then rejected as stale', async () => {
  const db = memoryDb(); seed(db);
  const args = input(db); let bumped = false;
  const original = db.runTransaction;
  db.runTransaction = fn => original(async tx => {
    const out = await fn(tx);
    if (!bumped) { bumped = true; db.put(BOM, db.docs.get(BOM).data); }
    return out;
  });
  await rejects(make(db).addItem(args), 'stale_bom_version');
  assert.equal(db.docs.has(AUDIT('op-1')), false);
});

test('matching receipt replays after the BOM version changed', async () => {
  const db = memoryDb(); seed(db);
  const args = input(db), writer = make(db);
  const first = await writer.addItem(args);
  const second = await writer.addItem(args);
  assert.equal(second.replayed, true); assert.equal(second.item_id, first.item_id);
  assert.equal(db.docs.get(BOM).data.categories[0].items.length, 2);
});

test('changed payload or principal on an existing receipt is rejected', async () => {
  const db = memoryDb(); seed(db);
  const args = input(db);
  await make(db).addItem(args);
  await rejects(make(db).addItem({ ...args, quantity: 3 }), 'operation_id_conflict');
  await rejects(make(db, { id: 'someone-else' }).addItem(args), 'operation_id_conflict');
  assert.equal(db.docs.get(BOM).data.categories[0].items.length, 2);
});

test('audit failure rolls back the BOM and receipt', async () => {
  const db = memoryDb({ failPath: AUDIT('op-1') }); seed(db);
  const before = structuredClone(db.docs.get(BOM).data), version = versionOf(db);
  await assert.rejects(make(db).addItem(input(db)), /simulated/);
  assert.deepEqual(db.docs.get(BOM).data, before); assert.equal(versionOf(db), version);
  assert.equal(db.docs.has(RECEIPT('op-1')), false);
});

test('runtime control modes', async () => {
  for (const mode of ['coexist', 'pulse_only']) {
    const db = memoryDb(); seed(db); db.put(CONTROL, { mode });
    assert.match((await make(db).addItem(input(db))).item_id, /^mcp-[a-f0-9]{64}$/);
  }
  const control = structuredClone;
  for (const [data, code] of [[{ mode: 'read_only' }, 'mcp_writes_disabled'], [{ mode: 'weird' }, 'runtime_control_invalid'], [{}, 'runtime_control_invalid'], [{ mode: 5 }, 'runtime_control_invalid']]) {
    const db = memoryDb(); seed(db); db.put(CONTROL, control(data));
    await rejects(make(db).addItem(input(db)), code);
    assert.equal(db.docs.get(BOM).data.categories[0].items.length, 1);
  }
});

test('control record is never written', async () => {
  const db = memoryDb(); seed(db);
  await make(db).addItem(input(db));
  assert.equal(db.docs.has(CONTROL), false);
});

test('missing project, BOM or category fail; no category is created', async () => {
  const base = { ...input(memoryDb({}), {}) };
  let db = memoryDb(); db.put(BOM, { categories: [] });
  await rejects(make(db).addItem({ ...base, expected_version: '1:1' }), 'project_not_found');
  db = memoryDb(); db.put(`projects/${P}`, {});
  await rejects(make(db).addItem({ ...base, expected_version: '1:1' }), 'bom_not_found');
  db = memoryDb(); seed(db);
  await rejects(make(db).addItem(input(db, { category: 'Nope' })), 'material_category_not_found');
  assert.equal(db.docs.get(BOM).data.categories.length, 2);
});

test('principal failure blocks writes', async () => {
  const db = memoryDb(); seed(db);
  const writer = createMcpMaterialWriter({ db, resolvePrincipal: async () => { throw new Error('tokeninfo down'); }, getServerTimestamp: () => new ServerTimestampTransform() });
  await rejects(writer.addItem(input(db)), 'mcp_principal_unavailable');
  await rejects(make(db, { id: '' }).addItem(input(db)), 'mcp_principal_unavailable');
});

test('invalid inputs are rejected before any read', async () => {
  const db = memoryDb(); seed(db);
  const ok = input(db);
  const bad = [
    { ...ok, extra: 1 }, { ...ok, quantity: 0 }, { ...ok, quantity: NaN }, { ...ok, quantity: '2' }, { ...ok, price: -1 },
    { ...ok, price: Infinity }, { ...ok, item_type: 'other' }, { ...ok, operation_id: 'a/b' }, { ...ok, operation_id: 'x'.repeat(129) },
    { ...ok, operation_id: '' }, { ...ok, expected_version: '12' }, { ...ok, project_id: 'a/b' }, { ...ok, project_id: 'x'.repeat(513) },
    { ...ok, name: 'n'.repeat(501) }, { ...ok, description: 'd'.repeat(4001) }, { ...ok, sku: 's'.repeat(501) }, { ...ok, make: 5 },
    { ...ok, name: '  ' }, null, [], 'x'
  ];
  for (const value of bad) await rejects(make(db).addItem(value), 'invalid_mcp_input');
  for (const key of ['expected_version', 'operation_id', 'name', 'quantity']) { const { [key]: _, ...rest } = ok; await rejects(make(db).addItem(rest), 'invalid_mcp_input'); }
  await rejects(make(db).addItem({ ...ok, item_type: 'service', quantity: 0.25 }), 'invalid_material_command');
});

test('case-insensitive category selection preserves the original first-match rule', async () => {
  const db = memoryDb(); seed(db);
  db.put(BOM, { categories: [{ name: 'Electrical', items: [] }, { name: 'electrical', items: [] }] });
  const result = await make(db).addItem(input(db, { category: 'electrical' }));
  assert.equal(result.category, 'Electrical'); assert.equal(db.docs.get(BOM).data.categories[0].items.length, 1);
  assert.equal(db.docs.get(BOM).data.categories[1].items.length, 0);
});

test('long existing project IDs accepted by the material API remain addressable', async () => {
  const db = memoryDb(), project = 'P'.repeat(240);
  db.put('projects/'+project, { projectName: 'Long ID' });
  const bom = 'projects/'+project+'/bom/data'; db.put(bom, { categories: [{ name: 'Electrical', items: [] }] });
  const time = db.docs.get(bom).updateTime;
  const result = await make(db).addItem({ ...input(db), project_id: project, expected_version: time.seconds+':'+time.nanoseconds });
  assert.equal(result.project_id, project);
});

test('one operation nonce reused in different projects cannot collide in legacy item file namespaces', async () => {
  const db = memoryDb(); seed(db); const first = await make(db).addItem(input(db));
  const other = 'Other'; db.put('projects/'+other, { projectName: 'Other' });
  const bom = 'projects/'+other+'/bom/data'; db.put(bom, { categories: [{ name: 'Electrical', items: [] }] });
  const time = db.docs.get(bom).updateTime;
  const second = await make(db).addItem({ ...input(db), project_id: other, expected_version: time.seconds+':'+time.nanoseconds });
  assert.notEqual(first.item_id, second.item_id);
});

test('read-only mode can confirm a known matching outcome without any new business write', async () => {
  const db = memoryDb(); seed(db); const args = input(db); await make(db).addItem(args);
  db.put(CONTROL, { mode: 'read_only' }); const before = structuredClone([...db.docs]);
  assert.equal((await make(db).addItem(args)).replayed, true);
  assert.deepEqual([...db.docs], before);
  await rejects(make(db).addItem({ ...args, operation_id: 'new-op' }), 'mcp_writes_disabled');
});

test('finite inputs cannot create an infinite item total', async () => {
  const db = memoryDb(); seed(db);
  await rejects(make(db).addItem(input(db, { quantity: 1e200, price: 1e200 })), 'invalid_mcp_input');
});
