const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacySpecSearchHandler } = require('./legacySpecSearch.cjs');

function fixture({ cutover = false, beforeCommit, afterWebhook, beforeTransaction } = {}) {
  const docs = new Map([
    ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'bolt', specificationUrl: 'old', extra: true }, { id: 'other' }] }] }],
    ...(cutover ? [['pulseMaterialCutovers/P', { project_id: 'P' }]] : []),
  ]);
  const version = new Map([['projects/P/bom/data', 1]]);
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`) });
  const bomRef = ref('projects/P/bom/data'), markerRef = ref('pulseMaterialCutovers/P');
  const snap = path => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 1, nanoseconds: version.get(path) || 0 } });
  let commitHookUsed = false;
  let transactionNumber = 0;
  const db = { collection: name => ref(name), runTransaction: async fn => {
    beforeTransaction?.(++transactionNumber, docs, version);
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map(), writes = [];
      const result = await fn({ get: async r => { reads.set(r.path, version.get(r.path) || 0); return snap(r.path); }, update: (r, data) => writes.push([r.path, data]) });
      if (!commitHookUsed) { commitHookUsed = true; beforeCommit?.(docs, version); }
      if ([...reads].some(([path, rev]) => (version.get(path) || 0) !== rev)) continue;
      for (const [path, data] of writes) { docs.set(path, { ...docs.get(path), ...structuredClone(data) }); version.set(path, (version.get(path) || 0) + 1); }
      return result;
    }
    throw Error('transaction contention');
  } };
  let webhookCalls = 0;
  const handler = createLegacySpecSearchHandler({ db, admin: { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'server-time' } }) },
    fetch: async () => { webhookCalls++; afterWebhook?.(docs, version); return { ok: true, json: async () => ({ success: true, specificationUrl: 'https://example.test/spec.pdf' }) }; },
    logger: { info() {}, error() {} }, webhookUrl: 'https://example.test/search' });
  const invoke = async () => { let status = 200, body; const res = { set() { return this; }, status(value) { status = value; return this; }, json(value) { body = value; return this; }, send() {} };
    await handler({ method: 'POST', body: { projectId: 'P', bomItemId: 'bolt', itemName: 'Bolt' } }, res); return { status, body, webhookCalls, docs }; };
  return { invoke, docs };
}

test('legacy spec search still patches one target item before the project cutover', async () => {
  const f = fixture(); const r = await f.invoke();
  assert.equal(r.status, 200); assert.equal(r.webhookCalls, 1);
  const items = f.docs.get('projects/P/bom/data').categories[0].items;
  assert.equal(items[0].specificationUrl, 'https://example.test/spec.pdf'); assert.equal(items[0].extra, true); assert.deepEqual(items[1], { id: 'other' });
  assert.equal(f.docs.has('pulseMaterialCutovers/P'), false);
});

test('legacy spec search does not call the provider after native material cutover', async () => {
  const f = fixture({ cutover: true }); const r = await f.invoke();
  assert.equal(r.status, 409); assert.equal(r.body.error, 'material_cutover'); assert.equal(r.webhookCalls, 0);
});

test('legacy spec search rechecks cutover transactionally immediately before dispatch', async () => {
  const f = fixture({ beforeTransaction: (number, docs) => { if (number === 2) docs.set('pulseMaterialCutovers/P', { project_id: 'P' }); } });
  const r = await f.invoke();
  assert.equal(r.status, 409); assert.equal(r.body.error, 'material_cutover'); assert.equal(r.webhookCalls, 0);
});

test('in-flight legacy spec response rechecks cutover and cannot write stale categories', async () => {
  const f = fixture({ beforeCommit: (docs, version) => { docs.set('pulseMaterialCutovers/P', { project_id: 'P' }); version.set('pulseMaterialCutovers/P', 1); } }); const r = await f.invoke();
  assert.equal(r.status, 409); assert.equal(r.body.error, 'material_cutover');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl, 'old');
});

test('in-flight legacy spec response rejects if BOM revision changed before write', async () => {
  const f = fixture({ afterWebhook: (docs, version) => { docs.set('projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'bolt', orderDate: '2026-10-10' }] }] }); version.set('projects/P/bom/data', 2); } }); const r = await f.invoke();
  assert.equal(r.status, 409); assert.equal(r.body.error, 'material_version_conflict');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, '2026-10-10');
});
