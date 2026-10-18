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
  const linkedItemQuerySizes = [];
  const snap = path => { const row = docs.get(path); return { exists: !!row, data: () => structuredClone(row?.data), updateTime: row ? { seconds: 10, nanoseconds: row.tick } : undefined }; };
  const query = (collection, filters = [], max = Infinity) => ({ collection, filters, max,
    where(field, op, value) { return query(collection, [...filters, [field, op, value]], max); },
    limit(value) { return query(collection, filters, value); } });
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`), get: async () => snap(path),
    where(field, op, value) { return query(path, [[field, op, value]]); }, limit(value) { return query(path, [], value); } });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const staged = [];
      const reads = new Map();
      const result = await fn({ get: async r => {
        if (staged.length) throw Error('reads after writes');
        if (r.collection && r.filters) {
          for (const [, op, value] of r.filters) if (op === 'array-contains-any') {
            if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw Error('array-contains-any accepts 1-30 values');
            linkedItemQuerySizes.push(value.length);
          }
          const rows = [...docs].filter(([path, row]) => path.startsWith(`${r.collection}/`) && r.filters.every(([field, op, value]) => op === '==' ? row.data[field] === value : op === 'array-contains-any' ? Array.isArray(row.data[field]) && value.some(item => row.data[field].includes(item)) : false)).slice(0, r.max);
          for (const [path, row] of rows) reads.set(path, row.tick);
          return { docs: rows.map(([path, row]) => ({ id: path.slice(r.collection.length + 1), data: () => structuredClone(row.data) })) };
        }
        const row = snap(r.path); reads.set(r.path, docs.get(r.path)?.tick); return row;
      }, update: (r, data) => staged.push(['update', r.path, data]), create: (r, data) => { if (options.failAudit && r.path.includes('materialAudit')) throw Error('audit failure'); staged.push(['create', r.path, data]); } });
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
  return { call, patch, docs, actor, linkedItemQuerySizes, change(path, update) { const row = docs.get(path); docs.set(path, { data: { ...row.data, ...update }, tick: ++clock }); } };
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

const receiptPhoto = 'https://firebasestorage.googleapis.com/v0/b/visionbomtracker.firebasestorage.app/o/projects%2FA%2Freceived-photos%2Fmotor.jpg?alt=media&token=test';
function receiptFixture(options = {}) {
  const f = fixture(options);
  f.docs.set('projectDocuments/invoice', { tick: 1, data: { projectId: 'A', type: 'vendor-invoice', linkedBOMItems: ['motor'] } });
  f.fulfill = (fulfillment = {}, extra = {}) => f.call('POST', { item_id: 'motor', expected_version: '10:1', operation_id: 'receipt-1', fulfillment: { kind: 'receipt', quantity: 1, invoiceDocId: 'invoice', photoUrl: receiptPhoto, loggedAt: '2026-10-13', ...fulfillment }, ...extra }, { query: { resource: 'fulfillment' } });
  f.item = () => f.docs.get('projects/A/bom/data').data.categories[0].items[0];
  return f;
}
test('receipt appends atomically with proof, legacy metadata and immutable server audit', async () => {
  const f = receiptFixture(); f.item().fulfillmentTranches = [{ id: 'old', quantity: 0.5, unknown: 'keep' }];
  const first = await f.fulfill(); assert.equal(first.status, 200);
  assert.equal(first.body.item.status, 'ordered'); assert.equal(first.body.item.actualArrival, '2026-10-13');
  assert.equal(first.body.item.receivedPhotoUrl, receiptPhoto); assert.deepEqual(first.body.item.unknown, { x: 1 });
  assert.deepEqual(first.body.item.fulfillmentTranches[0], { id: 'old', quantity: 0.5, unknown: 'keep' });
  assert.equal(first.body.item.fulfillmentTranches[1].photoUrl, receiptPhoto);
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/receipt-1').data;
  assert.equal(audit.actor_uid, 'alice'); assert.equal(audit.created_at, 'server-time'); assert.equal(audit.before.fulfillmentTranches.length, 1); assert.equal(audit.after.fulfillmentTranches.length, 2);
  assert.deepEqual(await f.fulfill(), first); assert.equal(f.item().fulfillmentTranches.length, 2);
});
test('receipts validate shape, quantity, real dates, invoice and project photo namespace', async () => {
  for (const fulfillment of [{ quantity: 0 }, { quantity: 0.5 }, { quantity: Infinity }, { loggedAt: '2026-02-30' }, { loggedAt: undefined }, { invoiceDocId: undefined }, { photoUrl: undefined }, { photoUrl: 'https://evil.example/photo' }, { photoUrl: receiptPhoto.replace('%2FA%2F', '%2FB%2F') }, { actor_uid: 'admin' }, { kind: 'unknown' }]) {
    const f = receiptFixture(); assert.equal((await f.fulfill(fulfillment)).status, 400, JSON.stringify(fulfillment)); assert.equal(f.docs.size, 3);
  }
  for (const update of [{ projectId: 'B' }, { type: 'vendor-po' }]) {
    const f = receiptFixture(); Object.assign(f.docs.get('projectDocuments/invoice').data, update); assert.equal((await f.fulfill()).status, 403); assert.equal(f.docs.size, 3);
  }
});
test('receipt replay reloads invoice project ownership and project/category membership', async () => {
  for (const revoke of [f => { f.docs.get('projectDocuments/invoice').data.projectId = 'B'; }, f => { f.docs.get('projects/A').data.memberIds = []; }, f => { f.docs.get('projects/A').data.members = []; }]) {
    const f = receiptFixture(); assert.equal((await f.fulfill()).status, 200); revoke(f); assert.equal((await f.fulfill()).status, 403); assert.equal(f.item().fulfillmentTranches.length, 1);
  }
});
test('receipt preserves legacy received totals and fails closed on corrupt tranche state', async () => {
  for (const update of [{ status: 'received' }, { fulfillmentTranches: 'bad' }, { fulfillmentTranches: [{ quantity: -1 }] }, { fulfillmentTranches: [{ quantity: NaN }] }, { fulfillmentTranches: [{ quantity: 3 }] }, { quantity: NaN }]) {
    const f = receiptFixture(); Object.assign(f.item(), update); assert.equal((await f.fulfill()).status, 409); assert.equal(f.docs.size, 3);
  }
  const f = receiptFixture(); f.item().itemType = 'service'; assert.equal((await f.fulfill()).status, 400);
});
test('fulfillment permits optional proof, server day and original partial service status', async () => {
  const f = receiptFixture();
  const result = await f.fulfill({ kind: 'fulfillment', quantity: 0.5, invoiceDocId: undefined, photoUrl: undefined, loggedAt: undefined }, { item_id: 'service' });
  assert.equal(result.status, 200); assert.equal(result.body.item.status, undefined); assert.match(result.body.item.fulfillmentTranches[0].loggedAt, /^\d{4}-\d{2}-\d{2}$/);
  const g = receiptFixture(); assert.equal((await g.fulfill({ kind: 'fulfillment', quantity: 0.4 }, { item_id: 'service' })).status, 400);
});
test('fulfillment prevents budget overflow, tolerates decimal sum and marks exact completion', async () => {
  const f = receiptFixture(); assert.equal((await f.fulfill({ quantity: 3 })).status, 409);
  const g = receiptFixture(); g.item().quantity = 0.8; g.item().itemType = 'service'; g.item().fulfillmentTranches = [{ quantity: 0.1 }, { quantity: 0.2 }];
  const result = await g.fulfill({ kind: 'fulfillment', quantity: 0.5 }); assert.equal(result.status, 200); assert.equal(result.body.item.status, 'received');
});
test('receipt namespace collides with patch and stale concurrent appends commit once', async () => {
  const f = receiptFixture(); assert.equal((await f.patch({}, { operation_id: 'receipt-1' })).status, 200); assert.equal((await f.fulfill()).body.error, 'operation_conflict');
  const g = receiptFixture(); const results = await Promise.all([g.fulfill(), g.fulfill({}, { operation_id: 'receipt-2' })]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(g.item().fulfillmentTranches.length, 1);
});
test('receipt audit failure and proof revocation during transaction retry roll back append', async () => {
  const f = receiptFixture({ failAudit: true }); assert.equal((await f.fulfill()).status, 503); assert.equal(f.item().fulfillmentTranches, undefined); assert.equal(f.docs.size, 3);
  const g = receiptFixture({ beforeCommit: docs => { const row = docs.get('projectDocuments/invoice'); docs.set('projectDocuments/invoice', { tick: 999, data: { ...row.data, projectId: 'B' } }); } });
  assert.equal((await g.fulfill()).status, 403); assert.equal(g.item().fulfillmentTranches, undefined);
});

test('newly uploaded project invoices with no existing links remain usable in original receipt dialog', async () => {
  const f = receiptFixture(); f.docs.get('projectDocuments/invoice').data.linkedBOMItems = [];
  assert.equal((await f.fulfill()).status, 200);
});
test('legacy malformed received state and duplicate tranche identities fail closed', async () => {
  for (const update of [{ status: 'received', quantity: '2' }, { status: 'received', fulfillmentTranches: [{ id: 'same', quantity: 0.5 }, { id: 'same', quantity: 0.5 }] }, { fulfillmentTranches: [{ id: 'tranche-receipt-1', quantity: 0.5 }] }, { itemType: 'unknown' }]) {
    const f = receiptFixture(); Object.assign(f.item(), update); assert.equal((await f.fulfill()).status, 409); assert.equal(f.docs.size, 3);
  }
});
test('receipt handles stale version, duplicate item identities and uncertain identical concurrent retries', async () => {
  const f = receiptFixture(); assert.equal((await f.fulfill({}, { expected_version: '10:0' })).body.error, 'material_version_conflict');
  const g = receiptFixture(); g.docs.get('projects/A/bom/data').data.categories[1].items[0].id = 'motor'; assert.equal((await g.fulfill()).body.error, 'duplicate_material_id');
  const h = receiptFixture(); const results = await Promise.all([h.fulfill(), h.fulfill()]); assert.equal(results[0].status, 200); assert.deepEqual(results[0], results[1]); assert.equal(h.item().fulfillmentTranches.length, 1);
});

test('fulfillment log day is server UTC even when caller supplies a valid date', async () => {
  const f = receiptFixture();
  const result = await f.fulfill({ kind: 'fulfillment', loggedAt: '1999-01-01' });
  assert.equal(result.status, 200); assert.equal(result.body.item.fulfillmentTranches[0].loggedAt, new Date().toISOString().slice(0, 10));
});
test('receipt retains first arrival date and every earlier unknown tranche field', async () => {
  const f = receiptFixture(); f.item().actualArrival = '2026-10-01'; f.item().fulfillmentTranches = [{ quantity: 1, other: { kept: true } }];
  const result = await f.fulfill(); assert.equal(result.status, 200); assert.equal(result.body.item.actualArrival, '2026-10-01'); assert.equal(result.body.item.status, 'received'); assert.deepEqual(result.body.item.fulfillmentTranches[0].other, { kept: true });
});

test('inconsistent received status cannot be reopened by an append', async () => {
  const f = receiptFixture(); f.item().status = 'received'; f.item().fulfillmentTranches = [{ quantity: 0.5 }];
  assert.equal((await f.fulfill()).status, 409); assert.equal(f.item().status, 'received'); assert.equal(f.item().fulfillmentTranches.length, 1);
});

test('component fulfillment requires invoice and photo even outside the receipt form', async () => {
  for (const missing of [{ invoiceDocId: undefined }, { photoUrl: undefined }, { invoiceDocId: undefined, photoUrl: undefined }]) {
    const f = receiptFixture(); const result = await f.fulfill({ kind: 'fulfillment', ...missing });
    assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_material_fulfillment'); assert.equal(f.item().fulfillmentTranches, undefined);
  }
  const f = receiptFixture(); const result = await f.fulfill({ kind: 'fulfillment' });
  assert.equal(result.status, 200); assert.equal(result.body.item.fulfillmentTranches[0].invoiceDocId, 'invoice'); assert.equal(result.body.item.fulfillmentTranches[0].photoUrl, receiptPhoto);
});
test('present legacy tranche identities must be bounded nonblank strings', async () => {
  for (const id of [null, 1, {}, [], '', '   ', 'x'.repeat(513)]) {
    const f = receiptFixture(); f.item().fulfillmentTranches = [{ id, quantity: 0.5 }];
    assert.equal((await f.fulfill()).status, 409, JSON.stringify(id)); assert.equal(f.item().fulfillmentTranches.length, 1);
  }
  const f = receiptFixture(); f.item().fulfillmentTranches = [{ quantity: 0.5 }]; assert.equal((await f.fulfill()).status, 200);
});

function commandFixture(options = {}) {
  const f = fixture(options);
  f.docs.set('settings/bom', { tick: 1, data: { categories: [{ name: 'Mech' }, { name: 'Dest' }, { name: 'Uncategorized' }, { name: 'Inactive', isActive: false }, { name: 'Child', parentId: 'Mech' }] } });
  f.docs.get('projects/A').data.members[0].categoryScope.push('Dest', 'Uncategorized');
  f.command = (command, extra = {}) => f.call('POST', { expected_version: '10:1', operation_id: 'command-1', command, ...extra }, { query: { resource: 'commands' } });
  f.categories = () => f.docs.get('projects/A/bom/data')?.data.categories;
  return f;
}
const newMaterial = (extra = {}) => ({ id: 'new', name: 'New', description: '', itemType: 'component', quantity: 1, category: 'Mech', ...extra });
test('add command appends atomically and preserves prior receipts, unknown item/category/BOM fields', async () => {
  const f = commandFixture(); f.categories()[0].items[0].fulfillmentTranches = [{ quantity: 1, unknown: 'history' }];
  const r = await f.command({ kind: 'add_items', items: [newMaterial(), newMaterial({ id: 'another', category: 'Dest' })] });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, project_id: 'A', operation_id: 'command-1', command_kind: 'add_items' });
  assert.equal(f.categories()[0].items.length, 3); assert.equal(f.categories()[0].extra, 'keep'); assert.equal(f.docs.get('projects/A/bom/data').data.unknown, 'keep'); assert.equal(f.categories()[0].items[0].fulfillmentTranches[0].unknown, 'history');
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/command-1').data;
  assert.equal(audit.actor_uid, 'alice'); assert.equal(audit.previous_version, '10:1'); assert.equal(audit.created_at, 'server-time'); assert.equal(audit.after.items.length, 2);
});
test('delete command replays after deletion but rejects revoked recorded category scope', async () => {
  const f = commandFixture(); const c = { kind: 'delete_items', item_ids: ['motor'] };
  const first = await f.command(c); assert.equal(first.status, 200); assert.deepEqual(await f.command(c), first); assert.equal(f.categories()[0].items.some(i => i.id === 'motor'), false);
  f.docs.get('projects/A').data.members[0].categoryScope = ['Dest']; assert.equal((await f.command(c)).status, 403);
});
test('delete atomically clears linked document IDs, keeps unrelated links, and audits removed receipt history', async () => {
  const f = commandFixture();
  f.categories()[0].items[0].linkedInvoiceDocumentId = 'invoice';
  f.categories()[0].items[0].fulfillmentTranches = [{ id: 'receipt-1', quantity: 1, invoiceDocId: 'invoice', auditNote: 'preserve in audit' }];
  f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor', 'other', 'other'], metadata: 'preserve' } });
  f.docs.set('projectDocuments/invoice', { tick: 1, data: { projectId: 'A', type: 'vendor-invoice', linkedBOMItems: ['motor', 'other'], metadata: 'preserve' } });

  const result = await f.command({ kind: 'delete_items', item_ids: ['motor'] });

  assert.equal(result.status, 200);
  assert.equal(f.categories()[0].items.some(item => item.id === 'motor'), false);
  assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['other', 'other']);
  assert.deepEqual(f.docs.get('projectDocuments/invoice').data.linkedBOMItems, ['other']);
  assert.equal(f.docs.get('projectDocuments/quote').data.metadata, 'preserve');
  assert.equal(f.docs.get('projectDocuments/invoice').data.metadata, 'preserve');
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/command-1').data;
  assert.equal(audit.before.items[0].item.fulfillmentTranches[0].auditNote, 'preserve in audit');
  assert.deepEqual(audit.after.documents.map(row => row.document_id).sort(), ['invoice', 'quote']);
  assert.deepEqual(await f.command({ kind: 'delete_items', item_ids: ['motor'] }), result);
});
test('delete rejects excessive linked documents before any material or audit write', async () => {
  const f = commandFixture();
  for (let index = 0; index < 401; index++) f.docs.set(`projectDocuments/linked-${index}`, { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor'] } });

  const result = await f.command({ kind: 'delete_items', item_ids: ['motor'] });

  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'material_command_too_large');
  assert.equal(f.categories()[0].items.some(item => item.id === 'motor'), true);
  assert.deepEqual(f.docs.get('projectDocuments/linked-0').data.linkedBOMItems, ['motor']);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialAudit/command-1'), false);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialOperations/command-1'), false);
});
test('delete enforces the 400-document cap globally across multiple query chunks', async () => {
  const f = commandFixture();
  const itemIds = Array.from({ length: 200 }, (_, index) => `item-${index}`);
  f.categories()[0].items = itemIds.map(id => ({ id, name: id, itemType: 'component', quantity: 1 }));
  itemIds.forEach((id, itemIndex) => {
    for (let copy = 0; copy < 3; copy++) {
      const documentIndex = itemIndex * 3 + copy;
      f.docs.set(`projectDocuments/linked-${documentIndex}`, { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [id] } });
    }
  });

  const result = await f.command({ kind: 'delete_items', item_ids: itemIds });

  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'material_command_too_large');
  assert.equal(f.categories()[0].items.length, 200);
  assert.deepEqual(f.docs.get('projectDocuments/linked-0').data.linkedBOMItems, ['item-0']);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialAudit/command-1'), false);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialOperations/command-1'), false);
  assert.deepEqual(f.linkedItemQuerySizes, [30, 30, 30, 30, 30]);
});
test('delete accepts the maximum of 400 linked documents and records each cleanup once', async () => {
  const f = commandFixture();
  for (let index = 0; index < 400; index++) f.docs.set(`projectDocuments/linked-${index}`, { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor'] } });

  const result = await f.command({ kind: 'delete_items', item_ids: ['motor'] });

  assert.equal(result.status, 200);
  assert.equal(f.categories()[0].items.some(item => item.id === 'motor'), false);
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/command-1').data;
  const receipt = f.docs.get('pulseProjectMaterialOperations/A/materialOperations/command-1').data;
  assert.equal(audit.before.documents.length, 400);
  assert.equal(audit.after.documents.length, 400);
  assert.equal(receipt.document_ids.length, 400);
  assert.deepEqual(f.docs.get('projectDocuments/linked-399').data.linkedBOMItems, []);
});
test('delete chunks linked-document lookups and audits cross-chunk documents once', async () => {
  const f = commandFixture();
  const itemIds = Array.from({ length: 31 }, (_, index) => `item-${index}`);
  f.categories()[0].items = itemIds.map(id => ({ id, name: id, itemType: 'component', quantity: 1 }));
  itemIds.forEach((id, index) => f.docs.set(`projectDocuments/linked-${index}`, { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [id] } }));
  f.docs.set('projectDocuments/cross-chunk', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['item-0', 'item-30'] } });

  const result = await f.command({ kind: 'delete_items', item_ids: itemIds });

  assert.equal(result.status, 200);
  assert.deepEqual(f.linkedItemQuerySizes, [30, 1]);
  assert.deepEqual(f.docs.get('projectDocuments/cross-chunk').data.linkedBOMItems, []);
  assert.equal(f.docs.get('pulseProjectMaterialOperations/A/materialAudit/command-1').data.before.documents.filter(row => row.document_id === 'cross-chunk').length, 1);
});
test('delete keeps item and linked documents unchanged on audit failure or forbidden customer PO access', async () => {
  const auditFailure = commandFixture({ failAudit: true });
  auditFailure.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor'] } });
  assert.equal((await auditFailure.command({ kind: 'delete_items', item_ids: ['motor'] })).status, 503);
  assert.equal(auditFailure.categories()[0].items.some(item => item.id === 'motor'), true);
  assert.deepEqual(auditFailure.docs.get('projectDocuments/quote').data.linkedBOMItems, ['motor']);

  const forbidden = commandFixture();
  forbidden.docs.set('projectDocuments/customer-po', { tick: 1, data: { projectId: 'A', type: 'customer-po', linkedBOMItems: ['motor'] } });
  assert.equal((await forbidden.command({ kind: 'delete_items', item_ids: ['motor'] })).status, 403);
  assert.equal(forbidden.categories()[0].items.some(item => item.id === 'motor'), true);
  assert.deepEqual(forbidden.docs.get('projectDocuments/customer-po').data.linkedBOMItems, ['motor']);
  assert.equal(forbidden.docs.has('pulseProjectMaterialOperations/A/materialAudit/command-1'), false);
});
test('delete rechecks linked-document authorization if a transaction retries', async () => {
  const f = commandFixture({ beforeCommit: docs => {
    const row = docs.get('projectDocuments/quote');
    docs.set('projectDocuments/quote', { tick: 999, data: { ...row.data, type: 'customer-po' } });
  } });
  f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor'] } });

  const result = await f.command({ kind: 'delete_items', item_ids: ['motor'] });

  assert.equal(result.status, 403);
  assert.equal(f.categories()[0].items.some(item => item.id === 'motor'), true);
  assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['motor']);
  assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialAudit/command-1'), false);
});
test('initialization creates missing BOM conditionally and distinguishes valid empty/malformed/nonempty', async () => {
  const c = { kind: 'add_items', items: [newMaterial()], initialize: true };
  const f = commandFixture(); f.docs.delete('projects/A/bom/data'); const first = await f.command(c, { expected_version: 'missing' }); assert.equal(first.status, 200); assert.deepEqual(await f.command(c, { expected_version: 'missing' }), first);
  const g = commandFixture(); g.docs.get('projects/A/bom/data').data.categories = []; assert.equal((await g.command(c)).status, 200);
  for (const malformed of [null, {}, [{ name: 'Mech', items: 'bad' }]]) { const h = commandFixture(); h.docs.get('projects/A/bom/data').data.categories = malformed; assert.equal((await h.command(c)).status, 409); }
  assert.equal((await commandFixture().command(c)).status, 409);
});
test('scoped empty project exposes command capability without requiring an existing visible category', async () => {
  const f = commandFixture(); f.docs.delete('projects/A/bom/data'); const r = await f.call(); assert.equal(r.body.permissions.command, true); assert.equal(r.body.permissions.edit, false);
  const g = commandFixture({ enabled: false }); assert.equal((await g.call()).body.permissions.command, false); assert.equal((await g.command({ kind: 'delete_items', item_ids: ['motor'] })).status, 503);
});
test('batch patches preserve unknown fields, apply explicit clears and synchronize ordering PO links', async () => {
  const f = commandFixture(); const motor = f.categories()[0].items[0]; motor.linkedPODocumentId = 'old-po';
  f.docs.set('projectDocuments/old-po', { tick: 1, data: { projectId: 'A', type: 'vendor-po', linkedBOMItems: ['motor', 'unrelated'], unknown: true } });
  f.docs.set('projectDocuments/new-po', { tick: 1, data: { projectId: 'A', type: 'vendor-po', linkedBOMItems: ['other'], unknown: true } });
  const r = await f.command({ kind: 'patch_items', updates: [{ item_id: 'motor', patch: { price: null, name: 'Changed', linkedPODocumentId: 'new-po', status: 'ordered', orderDate: '2026-10-13' } }, { item_id: 'service', patch: { quantity: 0.5 } }] });
  assert.equal(r.status, 200); assert.equal(Object.hasOwn(f.categories()[0].items[0], 'price'), false); assert.deepEqual(f.categories()[0].items[0].unknown, { x: 1 });
  assert.deepEqual(f.docs.get('projectDocuments/old-po').data.linkedBOMItems, ['unrelated']); assert.deepEqual(f.docs.get('projectDocuments/new-po').data.linkedBOMItems, ['other', 'motor']); assert.equal(f.docs.get('projectDocuments/new-po').data.unknown, true);
});
test('generic status/quantity patches cannot erase/invent legacy receipt totals or receive without evidence', async () => {
  for (const patch of [{ status: 'ordered' }, { quantity: 3 }]) {
    const f = commandFixture(); f.categories()[0].items[0].status = 'received'; assert.equal((await f.command({ kind: 'patch_items', updates: [{ item_id: 'motor', patch }] })).status, 409);
  }
  const f = commandFixture(); assert.equal((await f.command({ kind: 'patch_items', updates: [{ item_id: 'motor', patch: { status: 'received' } }] })).status, 409);
});
test('move category requires configured destination, preserves merge metadata and replays after source removal', async () => {
  const f = commandFixture(); f.categories().push({ name: 'Dest', extra: 'destination', isExpanded: false, items: [newMaterial({ id: 'other', category: 'Dest' })] }); f.categories()[0].isExpanded = true;
  const c = { kind: 'move_category', category: 'Mech', destination: 'Dest' };
  const first = await f.command(c); assert.equal(first.status, 200); assert.deepEqual(await f.command(c), first);
  const dest = f.categories().find(c => c.name === 'Dest'); assert.equal(dest.extra, 'destination'); assert.equal(dest.isExpanded, true); assert.equal(dest.items.length, 3); assert.equal(dest.items[1].category, 'Dest'); assert.deepEqual(dest.items[1].unknown, { x: 1 });
  const g = commandFixture(); g.docs.get('settings/bom').data.categories = [{ name: 'Mech' }]; assert.equal((await g.command({ kind: 'move_category', category: 'Mech', destination: 'Uncategorized' })).status, 400); assert.equal(g.categories()[0].items.length, 2);
});
test('category expansion and empty deletion preserve all unrelated state; nonempty deletion is rejected', async () => {
  const f = commandFixture(); assert.equal((await f.command({ kind: 'category_state', category: 'Mech', isExpanded: false })).status, 200); assert.equal(f.categories()[0].isExpanded, false);
  const g = commandFixture(); assert.equal((await g.command({ kind: 'delete_category', category: 'Mech' })).status, 409);
  const h = commandFixture(); h.categories().push({ name: 'Dest', unknown: true, items: [] }); assert.equal((await h.command({ kind: 'delete_category', category: 'Dest' })).status, 200); assert.equal(h.categories().some(c => c.name === 'Dest'), false);
});
test('document link deltas update both representations and preserve unrelated links and historical tranches', async () => {
  const f = commandFixture(); f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['unrelated'] } });
  const add = await f.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'add' }); assert.equal(add.status, 200); assert.equal(f.categories()[0].items[0].linkedQuoteDocumentId, 'quote'); assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['unrelated', 'motor']);
  const version = `10:${f.docs.get('projects/A/bom/data').tick}`;
  assert.equal((await f.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'remove' }, { expected_version: version, operation_id: 'command-2' })).status, 200); assert.equal(Object.hasOwn(f.categories()[0].items[0], 'linkedQuoteDocumentId'), false); assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['unrelated']);
});
test('native patch can unlink an invoice scalar while retaining historical receipt attribution', async () => {
  const f = commandFixture();
  const motor = f.categories()[0].items[0];
  motor.linkedInvoiceDocumentId = 'invoice';
  motor.fulfillmentTranches = [{ id: 'receipt-1', quantity: 1, invoiceDocId: 'invoice' }];
  f.docs.set('projectDocuments/invoice', { tick: 1, data: { projectId: 'A', type: 'vendor-invoice', linkedBOMItems: ['motor', 'other'] } });
  const result = await f.command({ kind: 'patch_items', updates: [{ item_id: 'motor', patch: { linkedInvoiceDocumentId: null } }] });
  assert.equal(result.status, 200);
  assert.equal(Object.hasOwn(f.categories()[0].items[0], 'linkedInvoiceDocumentId'), false);
  assert.equal(f.categories()[0].items[0].fulfillmentTranches[0].invoiceDocId, 'invoice');
  assert.deepEqual(f.docs.get('projectDocuments/invoice').data.linkedBOMItems, ['other']);
});
test('all commands reject forbidden item scope, duplicate identities and operation namespace collisions', async () => {
  const f = commandFixture(); assert.equal((await f.command({ kind: 'delete_items', item_ids: ['motor', 'secret'] })).status, 403); assert.equal(f.categories()[0].items.length, 2);
  const g = commandFixture(); g.categories()[1].items[0].id = 'motor'; assert.equal((await g.command({ kind: 'delete_items', item_ids: ['motor'] })).status, 409);
  const h = commandFixture(); assert.equal((await h.patch({}, { operation_id: 'command-1' })).status, 200); assert.equal((await h.command({ kind: 'delete_items', item_ids: ['motor'] })).body.error, 'operation_conflict');
});
test('atomic audit failure and concurrent document access revocation roll back every command write', async () => {
  const f = commandFixture({ failAudit: true }); assert.equal((await f.command({ kind: 'delete_items', item_ids: ['motor'] })).status, 503); assert.equal(f.categories()[0].items.length, 2);
  const g = commandFixture({ beforeCommit: docs => { const row = docs.get('projectDocuments/quote'); docs.set('projectDocuments/quote', { tick: 999, data: { ...row.data, projectId: 'B' } }); } }); g.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [] } });
  assert.equal((await g.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'add' })).status, 403); assert.equal(g.categories()[0].items[0].linkedQuoteDocumentId, undefined); assert.deepEqual(g.docs.get('projectDocuments/quote').data.linkedBOMItems, []);
});
test('two displayed-version commands allow one commit; identical retry commits once', async () => {
  const c = { kind: 'add_items', items: [newMaterial()] }; const f = commandFixture(); const results = await Promise.all([f.command(c), f.command({ kind: 'delete_items', item_ids: ['motor'] }, { operation_id: 'command-2' })]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const g = commandFixture(); const same = await Promise.all([g.command(c), g.command(c)]); assert.equal(same[0].status, 200); assert.deepEqual(same[0], same[1]); assert.equal(g.categories()[0].items.filter(i => i.id === 'new').length, 1);
});

test('customer PO document deltas require fresh admin and never invent an item scalar', async () => {
  const c = { kind: 'link_document', document_id: 'customer', item_ids: ['motor'], action: 'add' };
  const f = commandFixture(); f.docs.set('projectDocuments/customer', { tick: 1, data: { projectId: 'A', type: 'customer-po', linkedBOMItems: [] } }); assert.equal((await f.command(c)).status, 403);
  const g = commandFixture({ actor: { customClaims: { role: 'admin', status: 'approved' } } }); g.docs.set('projectDocuments/customer', { tick: 1, data: { projectId: 'A', type: 'customer-po', linkedBOMItems: ['other'] } }); assert.equal((await g.command(c)).status, 200); assert.deepEqual(g.docs.get('projectDocuments/customer').data.linkedBOMItems, ['other', 'motor']); assert.equal(Object.hasOwn(g.categories()[0].items[0], 'linkedCustomerPODocumentId'), false);
  g.actor.customClaims.role = 'viewer'; assert.equal((await g.command(c)).status, 403);
});
test('document delta does not inspect unrelated historical item links and retains tranche references', async () => {
  const f = commandFixture(); const motor = f.categories()[0].items[0]; motor.linkedInvoiceDocumentId = 'removed-legacy-invoice'; motor.fulfillmentTranches = [{ id: 'history', quantity: 1, invoiceDocId: 'removed-legacy-invoice' }];
  f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [] } }); assert.equal((await f.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'add' })).status, 200); assert.equal(f.categories()[0].items[0].linkedInvoiceDocumentId, 'removed-legacy-invoice'); assert.equal(f.categories()[0].items[0].fulfillmentTranches[0].invoiceDocId, 'removed-legacy-invoice');
});
test('command refuses oversized resulting BOM/audit/documents before any staged mutation', async () => {
  const f = commandFixture(); f.docs.get('projects/A/bom/data').data.large = new Uint8Array(901 * 1024); const before = f.categories()[0].items.length;
  assert.equal((await f.command({ kind: 'delete_items', item_ids: ['motor'] })).body.error, 'material_document_too_large'); assert.equal(f.categories()[0].items.length, before); assert.equal(f.docs.has('pulseProjectMaterialOperations/A/materialAudit/command-1'), false);
  const g = commandFixture(); g.categories()[0].items[0].large = new Uint8Array(600 * 1024); assert.equal((await g.command({ kind: 'patch_items', updates: [{ item_id: 'motor', patch: { name: 'Changed' } }] })).body.error, 'material_document_too_large'); assert.equal(g.categories()[0].items[0].name, 'Motor');
  const h = commandFixture(); h.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [], large: new Uint8Array(901 * 1024) } }); assert.equal((await h.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'add' })).body.error, 'material_document_too_large'); assert.equal(h.categories()[0].items[0].linkedQuoteDocumentId, undefined);
});
test('move category counts actual affected items and scope revocation cancels replay', async () => {
  const f = commandFixture(); f.categories()[0].items = Array.from({ length: 201 }, (_, i) => newMaterial({ id: `large-${i}` })); assert.equal((await f.command({ kind: 'move_category', category: 'Mech', destination: 'Dest' })).body.error, 'material_command_too_large'); assert.equal(f.categories()[0].items.length, 201);
  const g = commandFixture(); const c = { kind: 'move_category', category: 'Mech', destination: 'Dest' }; assert.equal((await g.command(c)).status, 200); g.docs.get('projects/A').data.members[0].categoryScope = ['Dest']; assert.equal((await g.command(c)).status, 403);
});
test('concurrent canonical settings revocation cancels add and receipt write conflicts with stale import', async () => {
  const f = commandFixture({ beforeCommit: docs => { const row = docs.get('settings/bom'); docs.set('settings/bom', { tick: 999, data: { categories: row.data.categories.filter(c => c.name !== 'Dest') } }); } }); assert.equal((await f.command({ kind: 'add_items', items: [newMaterial({ category: 'Dest' })] })).status, 400); assert.equal(f.categories().some(c => c.name === 'Dest'), false);
  const g = commandFixture(); g.docs.set('projectDocuments/invoice', { tick: 1, data: { projectId: 'A', type: 'vendor-invoice' } });
  const r = await g.call('POST', { item_id: 'motor', expected_version: '10:1', operation_id: 'receipt-other', fulfillment: { kind: 'receipt', quantity: 1, invoiceDocId: 'invoice', photoUrl: receiptPhoto, loggedAt: '2026-10-13' } }, { query: { resource: 'fulfillment' } }); assert.equal(r.status, 200); assert.equal((await g.command({ kind: 'add_items', items: [newMaterial()] })).body.error, 'material_version_conflict'); assert.equal(g.categories()[0].items[0].fulfillmentTranches.length, 1);
});

test('single item PATCH cannot invent legacy received totals through quantity/type changes', async () => {
  for (const patch of [{ quantity: 3 }, { quantity: 3, itemType: 'service' }, { quantity: 1 }]) {
    const f = fixture(); f.docs.get('projects/A/bom/data').data.categories[0].items[0].status = 'received'; assert.equal((await f.patch(patch)).body.error, 'received_quantity_conflict'); assert.equal(f.docs.get('projects/A/bom/data').data.categories[0].items[0].quantity, 2);
  }
  const g = fixture(); g.docs.get('projects/A/bom/data').data.categories[0].items[0].status = 'received'; assert.equal((await g.patch({ name: 'Descriptive edit' })).status, 200);
});
test('document delta preserves unrelated legacy links even when duplicated', async () => {
  const f = commandFixture(); f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['unrelated', 'unrelated'] } });
  assert.equal((await f.command({ kind: 'link_document', document_id: 'quote', item_ids: ['motor'], action: 'add' })).status, 200); assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['unrelated', 'unrelated', 'motor']);
});

test('legacy category defaults apply only when the primary category field is absent', async () => {
  const f = commandFixture(); f.docs.get('settings/bom').data = { defaultCategories: ['Mech', 'Dest'] }; assert.equal((await f.command({ kind: 'add_items', items: [newMaterial({ category: 'Dest' })] })).status, 200);
  const g = commandFixture(); g.docs.get('settings/bom').data = { defaultCategories: ['Mech', 'Dest'] }; assert.equal((await g.patch({ category: 'Dest' })).status, 200);
  for (const categories of [[], [{ name: 'Dest', isActive: false }], [{ name: 'Dest', parentId: 'parent' }]]) {
    const h = commandFixture(); h.docs.get('settings/bom').data = { categories, defaultCategories: ['Dest'] }; assert.equal((await h.command({ kind: 'add_items', items: [newMaterial({ category: 'Dest' })] })).body.error, 'invalid_material_category'); assert.equal((await h.patch({ category: 'Dest' })).body.error, 'invalid_material_category');
  }
});
test('malformed primary and legacy canonical settings fail closed before commands or PATCH moves', async () => {
  for (const settings of [{ categories: null, defaultCategories: ['Dest'] }, { categories: {} }, { categories: [null] }, { categories: [{ name: 'Dest', isActive: 'true' }] }, { defaultCategories: ['Dest', 'Dest'] }, { defaultCategories: [''] }, { defaultCategories: 'Dest' }]) {
    const f = commandFixture(); f.docs.get('settings/bom').data = settings; assert.equal((await f.command({ kind: 'add_items', items: [newMaterial({ category: 'Dest' })] })).body.error, 'invalid_material_state'); assert.equal((await f.patch({ category: 'Dest' })).body.error, 'invalid_material_state'); assert.equal(f.categories()[0].items.length, 2);
  }
});

function mixedLinkFixture(options = {}) {
  const f = commandFixture(options);
  f.categories()[0].items[0].linkedQuoteDocumentId = 'quote';
  f.categories()[0].items[0].fulfillmentTranches = [{ quantity: 1, invoiceDocId: 'historical-invoice', unknown: true }];
  f.categories()[0].items[1].linkedQuoteDocumentId = 'old-quote';
  f.docs.set('projectDocuments/quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['motor', 'unchanged', 'unknown-history', 'unknown-history'], unknown: true } });
  f.docs.set('projectDocuments/old-quote', { tick: 1, data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: ['service', 'other'], unknown: true } });
  f.mixed = { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['service'], remove_item_ids: ['motor'] };
  return f;
}
test('a final-destination receipt URL without private publication proof cannot change material totals', async () => {
  const f = receiptFixture();
  const unproven = receiptPhoto.replace('motor.jpg', `finalized%2F${'a'.repeat(64)}.jpg`) + '&generation=12';
  assert.equal((await f.fulfill({ photoUrl: unproven })).body.error, 'receipt_photo_unverified');
  assert.equal(f.item().fulfillmentTranches, undefined);
});

test('native receipt photo requires a finalized server receipt bound to this actor and item', async () => {
  const fileName = `${'a'.repeat(64)}.jpg`;
  const finalPath = `projects/A/received-photos/finalized/${fileName}`;
  const nativePhoto = receiptPhoto.replace('motor.jpg', `finalized%2F${fileName}`) + '&generation=12';
  for (const change of [null, { state: 'reserved' }, { project_id: 'B' }, { item_id: 'service' }, { actor_uid: 'bob' }, { generation: '13' }, { final_path: 'other' }]) {
    const f = receiptFixture();
    if (change) f.docs.set(`pulseNativeUploadIntents/${fileName}`, { tick: 1, data: { state: 'finalized', project_id: 'A', item_id: 'motor', actor_uid: 'alice', actor_email: 'alice@example.com', generation: '12', operation_id: 'photo-1', path: `projects/A/received-photos/native/${fileName}`, final_path: finalPath, ...change } });
    f.docs.set('pulseNativeUploadOperations/A/receipts/photo-1', { tick: 1, data: { actor_uid: 'alice', actor_email: 'alice@example.com', project_id: 'A', item_id: 'motor', final_path: finalPath, finalized: { photo_url: nativePhoto, generation: '12' } } });
    assert.equal((await f.fulfill({ photoUrl: nativePhoto })).body.error, 'receipt_photo_unverified', JSON.stringify(change));
    assert.equal(f.item().fulfillmentTranches, undefined);
  }
  const f = receiptFixture();
  f.docs.set(`pulseNativeUploadIntents/${fileName}`, { tick: 1, data: { state: 'finalized', project_id: 'A', item_id: 'motor', actor_uid: 'alice', actor_email: 'alice@example.com', generation: '12', operation_id: 'photo-1', path: `projects/A/received-photos/native/${fileName}`, final_path: finalPath } });
  f.docs.set('pulseNativeUploadOperations/A/receipts/photo-1', { tick: 1, data: { actor_uid: 'alice', actor_email: 'alice@example.com', project_id: 'A', item_id: 'motor', final_path: finalPath, finalized: { photo_url: nativePhoto, generation: '12' } } });
  assert.equal((await f.fulfill({ photoUrl: nativePhoto })).status, 200);
  const g = receiptFixture();
  g.docs.set(`pulseNativeUploadIntents/${fileName}`, f.docs.get(`pulseNativeUploadIntents/${fileName}`));
  g.docs.set('pulseNativeUploadOperations/A/receipts/photo-1', f.docs.get('pulseNativeUploadOperations/A/receipts/photo-1'));
  assert.equal((await g.fulfill({ photoUrl: nativePhoto.replace('token=test', 'token=forged') })).body.error, 'receipt_photo_unverified');
  for (const photoUrl of [nativePhoto.replace('finalized%2F', 'native%2F'), nativePhoto + '&token=test', nativePhoto + '&extra=1']) {
    assert.equal((await g.fulfill({ photoUrl })).body.error, 'receipt_photo_unverified');
  }
});
test('mixed link delta commits add/remove and prior-document synchronization at one displayed revision', async () => {
  const f = mixedLinkFixture(); const result = await f.command(f.mixed); assert.equal(result.status, 200); assert.equal(result.body.command_kind, 'link_document_delta');
  assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['unchanged', 'unknown-history', 'unknown-history', 'service']); assert.deepEqual(f.docs.get('projectDocuments/old-quote').data.linkedBOMItems, ['other']);
  assert.equal(Object.hasOwn(f.categories()[0].items[0], 'linkedQuoteDocumentId'), false); assert.equal(f.categories()[0].items[1].linkedQuoteDocumentId, 'quote');
  assert.equal(f.categories()[0].items[0].fulfillmentTranches[0].invoiceDocId, 'historical-invoice'); assert.equal(f.docs.get('projectDocuments/quote').data.unknown, true);
  assert.equal(f.docs.get('projects/A/bom/data').tick, 2);
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/command-1').data; assert.equal(audit.previous_version, '10:1'); assert.equal(audit.before.items.length, 2); assert.equal(audit.after.items.length, 2); assert.equal(audit.after.documents.length, 2);
  assert.deepEqual(await f.command(f.mixed), result); assert.equal([...f.docs.keys()].filter(p => p.includes('materialAudit')).length, 1);
});
test('mixed link delta scope/audit failure rejects both halves without partial document writes', async () => {
  const f = mixedLinkFixture(); const result = await f.command({ ...f.mixed, remove_item_ids: ['motor', 'secret'] }); assert.equal(result.status, 403); assert.equal(f.categories()[0].items[1].linkedQuoteDocumentId, 'old-quote'); assert.equal(f.categories()[0].items[0].linkedQuoteDocumentId, 'quote'); assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['motor', 'unchanged', 'unknown-history', 'unknown-history']);
  const g = mixedLinkFixture({ failAudit: true }); assert.equal((await g.command(g.mixed)).status, 503); assert.equal(g.categories()[0].items[1].linkedQuoteDocumentId, 'old-quote'); assert.deepEqual(g.docs.get('projectDocuments/old-quote').data.linkedBOMItems, ['service', 'other']);
});
test('mixed link delta reloads relevant old/new document types and revocation inside transaction/replay', async () => {
  const f = mixedLinkFixture(); f.docs.get('projectDocuments/old-quote').data.type = 'vendor-po'; assert.equal((await f.command(f.mixed)).status, 403); assert.equal(f.categories()[0].items[0].linkedQuoteDocumentId, 'quote');
  const g = mixedLinkFixture({ beforeCommit: docs => { const row = docs.get('projectDocuments/old-quote'); docs.set('projectDocuments/old-quote', { tick: 999, data: { ...row.data, projectId: 'B' } }); } }); assert.equal((await g.command(g.mixed)).status, 403); assert.equal(g.categories()[0].items[0].linkedQuoteDocumentId, 'quote');
  const h = mixedLinkFixture(); assert.equal((await h.command(h.mixed)).status, 200); h.docs.get('projectDocuments/quote').data.type = 'vendor-po'; assert.equal((await h.command(h.mixed)).status, 403);
});
test('mixed customer PO deltas require current admin, modify no scalars and retain unrelated links', async () => {
  const f = mixedLinkFixture({ actor: { customClaims: { role: 'admin', status: 'approved' } } }); f.docs.get('projectDocuments/quote').data.type = 'customer-po';
  assert.equal((await f.command(f.mixed)).status, 200); assert.deepEqual(f.docs.get('projectDocuments/quote').data.linkedBOMItems, ['unchanged', 'unknown-history', 'unknown-history', 'service']); assert.equal(f.categories()[0].items[0].linkedQuoteDocumentId, 'quote'); assert.equal(f.categories()[0].items[1].linkedQuoteDocumentId, 'old-quote');
  f.actor.customClaims.role = 'viewer'; assert.equal((await f.command(f.mixed)).status, 403);
});

const createMetadata = { projectName: 'New Project', clientName: 'Customer', description: '', status: 'Planning', deadline: '2026-12-01', poValue: 0 };
function creationFixture(options = {}) {
  const f = fixture({ actor: { customClaims: { role: 'admin', status: 'approved' } }, ...options });
  f.create = (project = createMetadata, extra = {}, projectId = 'NEW') => f.call('POST', { operation_id: 'create-1', project, ...extra }, { query: { resource: 'project_create', project_id: projectId }, headers: { 'x-pulse-user-email': f.actor.email } });
  return f;
}
test('project creation conditionally creates one project with server actor membership, immutable audit and replay', async () => {
  const f = creationFixture(); f.actor.displayName = 'Current Profile'; const first = await f.create(); assert.equal(first.status, 200); assert.deepEqual(first.body, { ok: true, project_id: 'NEW', operation_id: 'create-1' });
  const project = f.docs.get('projects/NEW').data; assert.equal(project.projectId, 'NEW'); assert.equal(project.projectName, 'New Project'); assert.deepEqual(project.memberIds, ['alice']); assert.deepEqual(project.members, [{ userId: 'alice', email: 'alice@example.com', displayName: 'Current Profile', addedAt: new Date().toISOString().slice(0, 10), addedBy: 'alice', notificationsEnabled: true }]); assert.equal(project.createdAt, 'server-time'); assert.equal(f.docs.has('projects/NEW/bom/data'), false);
  assert.deepEqual(await f.create(), first); const audit = f.docs.get('pulseProjectMaterialOperations/NEW/materialAudit/create-1').data; assert.equal(audit.actor_uid, 'alice'); assert.equal(audit.created_at, 'server-time'); assert.equal(audit.before, null); assert.equal(audit.after.projectName, 'New Project'); assert.equal([...f.docs.keys()].filter(p => p.includes('materialAudit')).length, 1);
});
test('project ID collisions never overwrite and concurrent unknown-outcome retries create exactly once', async () => {
  const f = creationFixture(); const before = structuredClone(f.docs.get('projects/A').data); assert.equal((await f.create(createMetadata, {}, 'A')).body.error, 'project_id_conflict'); assert.deepEqual(f.docs.get('projects/A').data, before);
  const g = creationFixture(); const results = await Promise.all([g.create(), g.create({ ...createMetadata, projectName: 'Other' }, { operation_id: 'create-2' })]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal([...g.docs.keys()].filter(p => p.includes('materialAudit')).length, 1);
  const h = creationFixture(); const same = await Promise.all([h.create(), h.create()]); assert.equal(same[0].status, 200); assert.deepEqual(same[0], same[1]); assert.equal((await h.create({ ...createMetadata, projectName: 'Changed' })).body.error, 'operation_conflict');
});
test('creation permission uses fresh admin/internal actor and replay still requires project access', async () => {
  const f = creationFixture({ actor: { customClaims: { role: 'viewer', status: 'approved' } } }); assert.equal((await f.create()).body.error, 'project_creation_forbidden');
  const g = creationFixture({ actor: { email: 'alice@qualitastech.com', customClaims: { role: 'viewer', status: 'approved' } } }); assert.equal((await g.create()).status, 200); g.docs.get('projects/NEW').data.memberIds = []; assert.equal((await g.create()).body.error, 'project_forbidden');
  const h = creationFixture(); assert.equal((await h.create()).status, 200); h.actor.disabled = true; assert.equal((await h.create()).body.error, 'actor_forbidden');
});
test('creation strictly validates original metadata, IDs, body keys and actor spoofing without writes', async () => {
  for (const project of [null, {}, { ...createMetadata, projectName: '' }, { ...createMetadata, clientName: '' }, { ...createMetadata, deadline: '2026-02-30' }, { ...createMetadata, poValue: -1 }, { ...createMetadata, poValue: Infinity }, { ...createMetadata, status: 'Won' }, { ...createMetadata, description: 'x'.repeat(4001) }, { ...createMetadata, members: [] }, { ...createMetadata, memberIds: ['admin'] }, { ...createMetadata, sourceDealId: 'guessed' }, { ...createMetadata, pulseProjectId: 1 }, { ...createMetadata, projectId: 'different' }, { ...createMetadata, billingEntityId: 'a/b' }]) {
    const f = creationFixture(); assert.equal((await f.create(project)).status, 400); assert.equal(f.docs.has('projects/NEW'), false);
  }
  const f = creationFixture(); assert.equal((await f.create(createMetadata, { actor_uid: 'admin' })).status, 400); assert.equal((await f.create(createMetadata, { operation_id: 'a/b' })).status, 400);
});
test('project creation audit failure rolls back the project and receipt and default-off flag gates all writes', async () => {
  const f = creationFixture({ failAudit: true }); assert.equal((await f.create()).status, 503); assert.equal(f.docs.has('projects/NEW'), false); assert.equal(f.docs.has('pulseProjectMaterialOperations/NEW/materialOperations/create-1'), false);
  const g = creationFixture({ defaultWrites: true }); assert.equal((await g.create()).body.error, 'material_mutations_disabled'); assert.equal(g.docs.has('projects/NEW'), false);
});
