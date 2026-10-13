const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectOperationsHandler } = require('./projectOperations.cjs');

function fixture(options = {}) {
  const actor = { uid: 'alice', email: 'alice@example.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' }, ...options.actor };
  const docs = new Map(Object.entries({
    'projects/A': { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Mech'] }] },
    'projects/A/bom/data': { unknown: 'keep', categories: [{ name: 'Mech', extra: 'keep', items: [{ id: 'motor', name: 'Motor', quantity: 2, price: 9, itemType: 'component', status: 'ordered', vendors: [{ name: 'V' }], unknown: { x: 1 } }, { id: 'service', name: 'Labour', quantity: 1, itemType: 'service' }] }, { name: 'Secret', items: [{ id: 'secret', name: 'Hidden', quantity: 1 }] }] }
  }).map(([path, data]) => [path, { data, tick: 1 }]));
  let clock = 1;
  const snap = path => { const row = docs.get(path); return { exists: !!row, data: () => structuredClone(row?.data), updateTime: row ? { seconds: 10, nanoseconds: row.tick } : undefined }; };
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`), get: async () => snap(path) });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const staged = [];
      const reads = new Map();
      const result = await fn({ get: async r => { if (staged.length) throw Error('reads after writes'); const row = snap(r.path); reads.set(r.path, docs.get(r.path)?.tick); return row; }, update: (r, data) => staged.push(['update', r.path, data]), create: (r, data) => { if (options.failAudit && r.path.includes('materialAudit')) throw Error('audit failure'); staged.push(['create', r.path, data]); } });
      if (options.beforeCommit) { const hook = options.beforeCommit; options.beforeCommit = null; hook(docs); }
      if ([...reads].some(([path, tick]) => docs.get(path)?.tick !== tick)) continue;
      for (const [kind, path] of staged) if (kind === 'create' && docs.has(path)) throw Error('already exists');
      for (const [kind, path, data] of staged) docs.set(path, { data: kind === 'update' ? { ...docs.get(path).data, ...structuredClone(data) } : structuredClone(data), tick: ++clock });
      return result;
    }
    throw Error('transaction contention');
  } };
  const auth = { getUserByEmail: async () => actor, getUser: async () => actor, verifyIdToken: async () => ({ uid: 'other', email: 'other@example.com' }) };
  const handler = createProjectOperationsHandler({ db, auth, getServiceKey: () => 'secret', ...(options.defaultWrites ? {} : { mutationsEnabled: options.enabled === undefined ? true : options.enabled }), getServerTimestamp: () => 'server-time' });
  const call = async (method = 'GET', body, overrides = {}) => {
    const headers = { 'x-project-operations-key': 'secret', 'x-pulse-user-email': 'alice@example.com', 'x-pulse-authenticated-at': '1800000000000', ...overrides.headers };
    const req = { method, query: { project_id: 'A', ...overrides.query }, body, get: key => headers[key.toLowerCase()] };
    let status = 200, result; const res = { set() {}, status(code) { status = code; return this; }, json(value) { result = value; return this; } };
    await handler(req, res); return { status, body: result };
  };
  const patch = (changes = {}, extra = {}) => call('PATCH', { item_id: 'motor', expected_version: '10:1', operation_id: 'op-1', patch: { name: 'New motor', ...changes }, ...extra });
  return { call, patch, docs, actor, change(path, update) { const row = docs.get(path); docs.set(path, { data: { ...row.data, ...update }, tick: ++clock }); } };
}

test('materials handler factory exists', () => assert.equal(typeof createProjectOperationsHandler, 'function'));
test('read scopes categories and preserves stored item details and timestamp version', async () => {
  const f = fixture(); const r = await f.call(); assert.equal(r.status, 200); assert.equal(r.body.version, '10:1'); assert.deepEqual(r.body.categories.map(c => c.name), ['Mech']); assert.equal(r.body.categories[0].items[0].vendors[0].name, 'V'); assert.equal(r.body.permissions.edit, true);
});
test('writes default off, while reads continue', async () => { for (const options of [{ enabled: false }, { defaultWrites: true }]) { const f = fixture(options); assert.equal((await f.patch()).status, 503); assert.equal((await f.call()).body.permissions.edit, false); } });
test('viewer writes narrowly and creates an atomic immutable audit and receipt', async () => {
  const f = fixture(); assert.equal((await f.patch({ quantity: 3 })).status, 200);
  const row = f.docs.get('projects/A/bom/data').data; assert.equal(row.unknown, 'keep'); assert.equal(row.categories[0].extra, 'keep'); assert.deepEqual(row.categories[0].items[0].unknown, { x: 1 }); assert.equal(row.categories[1].items[0].name, 'Hidden'); assert.equal(row.categories[0].items[0].status, 'ordered');
  const audit = [...f.docs].find(([p]) => p.includes('materialAudit'))[1].data; assert.equal(audit.actor_uid, 'alice'); assert.equal(audit.before.name, 'Motor'); assert.equal(audit.after.quantity, 3); assert.equal(audit.created_at, 'server-time'); assert.equal([...f.docs.keys()].filter(p => p.includes('materialOperations')).length, 1);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialAudit/op-1'), true);
  assert.equal(audit.previous_version, '10:1');
  assert.deepEqual(audit.permission, { role: 'viewer', category: 'Mech', scope: ['Mech'] });
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialOperations/op-1'), true);
  assert.equal([...f.docs.keys()].some(path => /^projects\/A\/(materialAudit|materialOperations)\//.test(path)), false);
});
test('scope and membership are enforced including on replay', async () => {
  const f = fixture(); assert.equal((await f.patch({}, { item_id: 'secret' })).status, 403); assert.equal((await f.patch()).status, 200); f.change('projects/A', { memberIds: [] }); assert.equal((await f.patch()).status, 403); assert.equal((await f.call()).status, 403);
});
test('external missing scope sees nothing; internal and admin members see all', async () => {
  const f = fixture(); f.change('projects/A', { members: [] }); assert.deepEqual((await f.call()).body.categories, []); assert.equal((await f.patch()).status, 403);
  for (const actor of [{ email: 'alice@qualitastech.com' }, { customClaims: { role: 'admin', status: 'approved' } }]) { const g = fixture({ actor }); const r = await g.call('GET', null, { headers: { 'x-pulse-user-email': g.actor.email } }); assert.equal(r.body.categories.length, 2); }
});
test('fresh actor checks reject disabled unapproved unverified changed email revoked and mismatched tokens', async () => {
  for (const actor of [{ disabled: true }, { emailVerified: false }, { customClaims: { role: 'viewer', status: 'pending' } }, { email: 'changed@example.com' }, { tokensValidAfterTime: new Date(1900000000000).toISOString() }]) assert.equal((await fixture({ actor }).patch()).status, 403);
  assert.equal((await fixture().call('GET', null, { headers: { authorization: 'Bearer other' } })).status, 403);
  assert.equal((await fixture().call('GET', null, { headers: { 'x-project-operations-key': 'wrong' } })).status, 401);
});
test('strict patch and request validation', async () => {
  for (const patch of [{ status: 'received' }, { vendors: [] }, { id: 'change' }, { itemType: 'unknown' }, { category: '' }, { name: '' }, { name: 'x'.repeat(501) }, { description: 'x'.repeat(4001) }, { quantity: 0 }, { quantity: Infinity }, { price: -1 }, { price: NaN }, { unit: null }, {}, JSON.parse('{"__proto__":{"admin":true}}'), { constructor: 'x' }]) {
    const f = fixture(); const r = await f.patch({}, { patch }); assert.equal(r.status, 400, JSON.stringify(patch)); assert.equal(f.docs.size, 2);
  }
  for (const extra of [{ expected_version: '10:1000000000' }, { expected_version: '10:01' }, { expected_version: 'bogus' }, { operation_id: '../x' }, { item_id: '' }, { evil: true }]) assert.equal((await fixture().patch({}, extra)).status, 400);
  assert.equal((await fixture().patch({ quantity: 0.4 }, { item_id: 'service' })).status, 400);
});
test('legacy writes change snapshot version and reject stale writes without audit', async () => { const f = fixture(); f.change('projects/A/bom/data', { oldClient: true }); assert.equal((await f.patch()).status, 409); assert.equal(f.docs.size, 2); });
test('same actor and payload replay is stable while changed body and actor collide', async () => {
  const f = fixture(); const first = await f.patch(); assert.deepEqual(await f.patch(), first); assert.equal(f.docs.size, 4); assert.equal((await f.patch({ name: 'Another' })).status, 409);
  f.actor.uid = 'bob'; f.change('projects/A', { memberIds: ['bob'], members: [{ userId: 'bob', categoryScope: ['Mech'] }] }); assert.equal((await f.patch()).status, 409);
});
test('audit failure rolls back item and receipt', async () => { const f = fixture({ failAudit: true }); assert.equal((await f.patch()).status, 503); assert.equal(f.docs.size, 2); assert.equal(f.docs.get('projects/A/bom/data').data.categories[0].items[0].name, 'Motor'); });
test('concurrent same-version edits allow one commit and one stale conflict', async () => { const f = fixture(); const r = await Promise.all([f.patch(), f.patch({ name: 'Other' }, { operation_id: 'op-2' })]); assert.deepEqual(r.map(x => x.status).sort(), [200, 409]); assert.equal(f.docs.size, 4); });
test('duplicate item identities conflict even if one duplicate is outside scope', async () => { const f = fixture(); const row = f.docs.get('projects/A/bom/data').data; row.categories[1].items[0].id = 'motor'; assert.equal((await f.patch()).status, 409); assert.equal(f.docs.size, 2); });
test('missing BOM has explicit missing version and cannot create arbitrary items', async () => { const f = fixture(); f.docs.delete('projects/A/bom/data'); assert.equal((await f.call()).body.version, 'missing'); assert.equal((await f.patch({}, { expected_version: 'missing' })).status, 404); });
test('transaction retry rechecks membership after concurrent project access removal', async () => {
  const f = fixture({ beforeCommit: docs => { const row = docs.get('projects/A'); docs.set('projects/A', { data: { ...row.data, memberIds: [] }, tick: 999 }); } });
  assert.equal((await f.patch()).status, 403); assert.equal(f.docs.size, 2); assert.equal(f.docs.get('projects/A/bom/data').data.categories[0].items[0].name, 'Motor');
});
test('concurrent identical operation ids return one receipt and one audit', async () => { const f = fixture(); const r = await Promise.all([f.patch(), f.patch()]); assert.deepEqual(r[0], r[1]); assert.equal(r[0].status, 200); assert.equal(f.docs.size, 4); });
test('replay rechecks current category scope', async () => { const f = fixture(); assert.equal((await f.patch()).status, 200); f.change('projects/A', { members: [] }); assert.equal((await f.patch()).status, 403); });
test('snapshot nanos remain opaque and malformed timestamps fail closed', async () => { const f = fixture(); f.docs.get('projects/A/bom/data').tick = 999999999; assert.equal((await f.call()).body.version, '10:999999999'); f.docs.get('projects/A/bom/data').tick = 1000000000; assert.equal((await f.call()).status, 503); });

function editorFixture(options = {}) {
  const f = fixture(options);
  f.change('projects/A', { members: [{ userId: 'alice', categoryScope: ['Mech', 'Dest'] }] });
  f.docs.set('settings/bom', { tick: 1, data: { categories: [{ name: 'Mech' }, { name: 'Dest' }, { name: 'Hidden', isActive: false }, { name: 'Sub', parentId: 'parent' }] } });
  return f;
}

test('complete reused editor patch moves and edits atomically while preserving unrelated fields and categories', async () => {
  const f = editorFixture();
  const result = await f.patch({ category: 'Dest', itemType: 'service', quantity: 0.5, finalizedVendor: { name: 'Supplier', price: 8, leadTime: '1 week', availability: 'Stock' } });
  assert.equal(result.status, 200);
  const categories = f.docs.get('projects/A/bom/data').data.categories;
  assert.deepEqual(categories[0].items.map(item => item.id), ['service']);
  const moved = categories.find(category => category.name === 'Dest').items[0];
  assert.equal(moved.name, 'New motor'); assert.equal(moved.itemType, 'service'); assert.equal(moved.quantity, 0.5);
  assert.equal(moved.status, 'ordered'); assert.deepEqual(moved.unknown, { x: 1 });
  assert.equal(categories.find(category => category.name === 'Secret').items[0].name, 'Hidden');
  assert.equal(categories[0].extra, 'keep');
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/op-1').data;
  assert.equal(audit.before.itemType, 'component'); assert.equal(audit.after.category, 'Dest');
  assert.equal(audit.permission.category, 'Mech'); assert.equal(audit.actor_uid, 'alice');
  assert.deepEqual(audit.category_transition, { from: 'Mech', to: 'Dest' });
  assert.deepEqual(await f.patch({ category: 'Dest', itemType: 'service', quantity: 0.5, finalizedVendor: { availability: 'Stock', leadTime: '1 week', price: 8, name: 'Supplier' } }), result);
});

test('category move rejects scope, inactive or noncanonical destinations without partial item edits', async () => {
  for (const category of ['Secret', 'Hidden', 'Sub', 'Unknown']) {
    const f = editorFixture();
    const result = await f.patch({ category });
    assert.ok([400, 403].includes(result.status), category);
    assert.equal(f.docs.get('projects/A/bom/data').data.categories[0].items[0].name, 'Motor');
    assert.equal([...f.docs.keys()].some(path => path.includes('materialAudit')), false);
  }
});

test('moving to an existing destination preserves its metadata and other items exactly once', async () => {
  const f = editorFixture(); const data = f.docs.get('projects/A/bom/data').data;
  data.categories.push({ name: 'Dest', isExpanded: false, custom: 'keep', items: [{ id: 'dest-item', unknown: true }] });
  assert.equal((await f.patch({ category: 'Dest' })).status, 200);
  const target = f.docs.get('projects/A/bom/data').data.categories.find(category => category.name === 'Dest');
  assert.equal(target.custom, 'keep'); assert.deepEqual(target.items.map(item => item.id), ['dest-item', 'motor']);
});

test('optional price and vendor clearing remove stored values and audit the explicit intent', async () => {
  const f = editorFixture(); f.docs.get('projects/A/bom/data').data.categories[0].items[0].finalizedVendor = { name: 'Old' };
  assert.equal((await f.patch({ price: null, finalizedVendor: null })).status, 200);
  const item = f.docs.get('projects/A/bom/data').data.categories[0].items[0];
  assert.equal(Object.hasOwn(item, 'price'), false); assert.equal(Object.hasOwn(item, 'finalizedVendor'), false);
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/op-1').data;
  assert.equal(audit.before.price, 9); assert.equal(audit.after.price, null);
});

test('resulting service minimum and received quantities are enforced independently of browser validation', async () => {
  const f = editorFixture(); assert.equal((await f.patch({ itemType: 'service', quantity: 0.4 })).status, 400);
  const g = editorFixture(); g.docs.get('projects/A/bom/data').data.categories[0].items[0].fulfillmentTranches = [{ id: 'receipt', quantity: 1.5 }];
  assert.equal((await g.patch({ quantity: 1 })).status, 409);
  assert.equal((await g.patch({ quantity: 1.5 })).status, 200);
});

test('malformed nested vendor values are rejected without altering unrelated vendor lists', async () => {
  for (const finalizedVendor of [{ name: 'Vendor', price: -1 }, { name: 'Vendor', token: 'private' }, { name: '' }, [], 'vendor']) {
    const f = editorFixture(); assert.equal((await f.patch({ finalizedVendor })).status, 400);
  }
});

test('a concurrent category-setting change cancels the atomic move on transaction retry', async () => {
  const f = editorFixture({ beforeCommit: docs => {
    const row = docs.get('settings/bom');
    docs.set('settings/bom', { tick: 999, data: { categories: row.data.categories.map(category => category.name === 'Dest' ? { ...category, isActive: false } : category) } });
  } });
  assert.equal((await f.patch({ category: 'Dest' })).status, 400);
  assert.equal(f.docs.get('projects/A/bom/data').data.categories[0].items[0].name, 'Motor');
  assert.equal([...f.docs.keys()].some(path => path.includes('materialAudit')), false);
});

test('changing an invalid legacy item to service cannot create an item without a valid quantity', async () => {
  const f = editorFixture(); delete f.docs.get('projects/A/bom/data').data.categories[0].items[0].quantity;
  assert.equal((await f.patch({ itemType: 'service' })).status, 409);
});

test('decimal receipt rounding does not reject the exact received total', async () => {
  const f = editorFixture(); f.docs.get('projects/A/bom/data').data.categories[0].items[0].fulfillmentTranches = [{ quantity: 0.1 }, { quantity: 0.2 }];
  assert.equal((await f.patch({ quantity: 0.3 })).status, 200);
});
