const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectOperationsHandler, PROCUREMENT_FIELDS } = require('./projectOperations.cjs');

const ts = iso => ({ toDate: () => new Date(iso) });
const po = (overrides = {}) => ({
  projectId: 'A', billingEntityId: 'be', poNumber: 'PO-1', vendorId: 'v1', vendorName: 'Vendor', vendorAddress: 'Addr', vendorGstin: 'G', vendorStateCode: '29', vendorStateName: 'Karnataka',
  vendorEmail: 'v@example.com', vendorPhone: '1', projectReference: 'Ref', vendorQuoteReference: 'Q1', invoiceToCompany: 'Us', invoiceToAddress: 'UA', invoiceToGstin: 'UG', invoiceToStateCode: '29', invoiceToStateName: 'Karnataka',
  shipToAddress: 'SA', shipToGstin: 'SG', shipToStateCode: '29', shipToStateName: 'Karnataka',
  items: [{ bomItemId: 'motor', slNo: 1, description: 'Motor', itemCode: 'M1', make: 'ABB', uom: 'nos', quantity: 2, rate: 10, discountPercent: 5, amount: 19, dueDate: ts('2026-02-03T00:00:00Z'), hsn: '8501', secret: 'x' }],
  subtotal: 19, taxType: 'igst', taxPercentage: 18, igstAmount: 3.42, cgstAmount: 0, sgstAmount: 0, totalAmount: 22.42, amountInWords: 'INR Twenty Two Only', currency: 'INR',
  paymentTerms: 'P', deliveryTerms: 'D', dispatchedThrough: 'T', destination: 'Dest', termsAndConditions: 'TC', includeAnnexure: true,
  poDate: ts('2026-01-02T03:04:05Z'), expectedDeliveryDate: ts('2026-02-01T00:00:00Z'), status: 'sent',
  submittedForApprovalAt: ts('2026-01-03T00:00:00Z'), submittedBy: 'u1', changesRequestedAt: ts('2026-01-04T00:00:00Z'), changesRequestedBy: 'u2', changesRequestedNote: 'fix',
  sentAt: ts('2026-01-05T00:00:00Z'), sentBy: 'u2', sentToEmail: 'v@example.com', closedAt: ts('2026-01-06T00:00:00Z'),
  pdfUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/po.pdf?alt=media&token=SECRET',
  warnings: [{ field: 'vendorGstin', message: 'm', severity: 'warning', internal: 'x' }],
  createdAt: ts('2026-01-01T00:00:00Z'), createdBy: 'u1', updatedAt: ts('2026-01-07T00:00:00Z'), internalNote: 'private', storagePath: 'projects/A/po.pdf', ...overrides
});
const document = (overrides = {}) => ({
  projectId: 'A', name: 'Quote.pdf', url: 'https://firebasestorage.googleapis.com/o/x?token=SECRET', type: 'vendor-quote', uploadedAt: ts('2026-03-01T00:00:00Z'), uploadedBy: 'u1',
  linkedBOMItems: ['motor', 'secret'], fileSize: 2048, sourceUrl: 'https://evil.example/', storagePath: 'projects/A/documents/q.pdf', token: 'SECRET', extra: 1, ...overrides
});
const adminActor = { customClaims: { role: 'admin', status: 'approved' } };

function fixture(options = {}) {
  const actor = { uid: 'alice', email: 'alice@example.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' }, ...options.actor };
  const docs = new Map(Object.entries({
    'projects/A': { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Mech'] }] },
    'projects/B': { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Mech'] }] },
    'projects/A/bom/data': { categories: [{ name: 'Mech', items: [{ id: 'motor' }, { id: 'pump' }] }, { name: 'Secret', items: [{ id: 'secret' }] }] },
    'projects/A/purchaseOrders/po1': po(),
    'projects/B/purchaseOrders/other': po({ poNumber: 'OTHER' }),
    'projectDocuments/d1': document(),
    'projectDocuments/d2': document({ name: 'Hidden.pdf', linkedBOMItems: ['secret'] }),
    'projectDocuments/d3': document({ name: 'Unlinked.pdf', linkedBOMItems: [] }),
    'projectDocuments/d4': document({ name: 'Customer.pdf', type: 'customer-po', linkedBOMItems: ['motor'] }),
    'projectDocuments/dB': document({ name: 'Other project', projectId: 'B', linkedBOMItems: ['motor'] }),
    ...options.docs
  }).map(([path, data]) => [path, { data, tick: 1 }]));
  // structuredClone cannot copy the fake Timestamps' toDate functions.
  const clone = value => Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' && typeof value.toDate !== 'function' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
  const snap = path => { const row = docs.get(path); return { id: path.split('/').pop(), exists: !!row, data: () => clone(row?.data), updateTime: row ? { seconds: 10, nanoseconds: row.tick } : undefined }; };
  const queryOf = (path, filters = [], limitN = Infinity, order = null) => ({
    isQuery: true,
    where: (field, op, value) => queryOf(path, [...filters, [field, op, value]], limitN, order),
    orderBy: field => queryOf(path, filters, limitN, field),
    limit: n => queryOf(path, filters, n, order),
    async run() {
      // Ordering by a data field silently drops records that lack it; only the document id is complete.
      if (order !== '__name__') throw Error('procurement queries must order by document id');
      const depth = path.split('/').length + 1;
      const rows = [...docs.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === depth)
        .filter(key => filters.every(([field, op, value]) => op === '==' && docs.get(key).data[field] === value)).sort();
      return { docs: rows.slice(0, limitN).map(snap), size: Math.min(rows.length, limitN) };
    }
  });
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`), get: async () => snap(path), where: (...a) => queryOf(path).where(...a), orderBy: f => queryOf(path).orderBy(f), limit: n => queryOf(path).limit(n) });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const staged = [];
    const result = await fn({ get: async r => r.isQuery ? r.run() : snap(r.path), update: (r, d) => staged.push(['update', r.path, d]), create: (r, d) => staged.push(['create', r.path, d]) });
    assert.equal(staged.length, 0, 'procurement reads must not write');
    return result;
  } };
  const auth = { getUserByEmail: async () => actor, getUser: async () => actor, verifyIdToken: async () => ({ uid: 'other', email: 'other@example.com' }) };
  const handler = createProjectOperationsHandler({ db, auth, getServiceKey: () => 'secret', mutationsEnabled: true, getServerTimestamp: () => 'now', ...(options.limits ? { procurementLimits: options.limits } : {}) });
  const call = async (method = 'GET', body, overrides = {}) => {
    const headers = { 'x-project-operations-key': 'secret', 'x-pulse-user-email': 'alice@example.com', 'x-pulse-authenticated-at': '1800000000000', ...overrides.headers };
    const req = { method, query: { project_id: 'A', resource: 'procurement', ...overrides.query }, body, get: key => headers[key.toLowerCase()] };
    let status = 200, result; const res = { set() {}, status(code) { status = code; return this; }, json(value) { result = value; return this; } };
    await handler(req, res); return { status, body: result };
  };
  return { call, docs, actor, change(path, update) { const row = docs.get(path); docs.set(path, { data: { ...row.data, ...update }, tick: row.tick + 1 }); } };
}

test('procurement read returns the exact contract with edit permanently false', async () => {
  const r = await fixture().call();
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.project_id, 'A');
  assert.deepEqual(r.body.permissions, { edit: false });
  assert.deepEqual(r.body.truncated, { purchase_orders: false, documents: false });
  assert.deepEqual(Object.keys(r.body).sort(), ['documents', 'ok', 'permissions', 'project_id', 'purchase_orders', 'truncated']);
  assert.equal(r.body.purchase_orders.length, 1);
});
test('absent resource still serves legacy materials; unknown or repeated resources are rejected', async () => {
  const f = fixture(); const legacy = await f.call('GET', null, { query: { resource: undefined } });
  assert.equal(legacy.status, 200); assert.equal(legacy.body.categories.length, 1); assert.equal(legacy.body.purchase_orders, undefined);
  for (const resource of ['materials', 'Procurement', 'procurement ', '', ['procurement', 'procurement'], { a: 1 }, 'documents']) assert.equal((await f.call('GET', null, { query: { resource } })).status, 400, JSON.stringify(resource));
});
test('procurement and unknown-resource PATCH are rejected and write nothing (legacy PATCH stays covered in projectOperations tests)', async () => {
  const body = { item_id: 'motor', expected_version: '10:1', operation_id: 'op-1', patch: { name: 'x' } };
  const f = fixture(); const before = f.docs.size;
  assert.equal((await f.call('PATCH', body)).status, 405);
  assert.equal((await f.call('PATCH', body, { query: { resource: 'bogus' } })).status, 400);
  assert.equal(f.docs.size, before);
});
test('fresh actor and project membership are required', async () => {
  for (const actor of [{ disabled: true }, { emailVerified: false }, { customClaims: { role: 'viewer', status: 'pending' } }, { email: 'changed@example.com' }, { tokensValidAfterTime: new Date(1900000000000).toISOString() }]) assert.equal((await fixture({ actor }).call()).status, 403);
  assert.equal((await fixture().call('GET', null, { headers: { 'x-project-operations-key': 'wrong' } })).status, 401);
  assert.equal((await fixture().call('GET', null, { headers: { authorization: 'Bearer other' } })).status, 403);
  const f = fixture(); f.change('projects/A', { memberIds: [] }); assert.equal((await f.call()).status, 403);
  assert.equal((await fixture().call('GET', null, { query: { project_id: 'missing' } })).status, 404);
  assert.equal((await fixture().call('GET', null, { query: { project_id: 'a/b' } })).status, 400);
});
test('purchase orders whitelist every source field, drop unknown and storage fields, and normalise dates', async () => {
  const [row] = (await fixture().call()).body.purchase_orders;
  assert.deepEqual(Object.keys(row).sort(), [...PROCUREMENT_FIELDS.purchaseOrder, 'id', 'has_pdf'].sort());
  assert.equal(row.id, 'po1'); assert.equal(row.projectId, 'A'); assert.equal(row.poNumber, 'PO-1'); assert.equal(row.status, 'sent'); assert.equal(row.totalAmount, 22.42); assert.equal(row.includeAnnexure, true);
  assert.equal(row.poDate, '2026-01-02T03:04:05.000Z'); assert.equal(row.closedAt, '2026-01-06T00:00:00.000Z'); assert.equal(row.items[0].dueDate, '2026-02-03T00:00:00.000Z');
  assert.deepEqual(Object.keys(row.items[0]).sort(), [...PROCUREMENT_FIELDS.purchaseOrderItem].sort());
  assert.deepEqual(row.warnings, [{ field: 'vendorGstin', message: 'm', severity: 'warning' }]);
  assert.equal(row.has_pdf, true);
  const text = JSON.stringify(row); for (const leak of ['SECRET', 'pdfUrl', 'internalNote', 'storagePath', 'firebasestorage']) assert.equal(text.includes(leak), false, leak);
});
test('malformed dates, numbers and shapes degrade to null instead of failing the page; unknown status is kept', async () => {
  const f = fixture({ docs: { 'projects/A/purchaseOrders/po2': { status: 'on-hold-legacy', poDate: { toDate: () => { throw Error('boom'); } }, createdAt: { toDate: () => new Date('nope') }, updatedAt: 'not a date', sentAt: '2026-04-05T06:07:08Z', expectedDeliveryDate: 12, totalAmount: Infinity, subtotal: '10', items: 'bad', warnings: [null, 3, { field: 'f' }], vendorName: { x: 1 }, includeAnnexure: 'yes' } } });
  const r = await f.call(); assert.equal(r.status, 200);
  const row = r.body.purchase_orders.find(p => p.id === 'po2');
  assert.equal(row.status, 'on-hold-legacy');
  for (const key of ['poDate', 'createdAt', 'updatedAt', 'expectedDeliveryDate', 'totalAmount', 'subtotal', 'vendorName', 'includeAnnexure']) assert.equal(row[key], null, key);
  assert.equal(row.sentAt, '2026-04-05T06:07:08.000Z'); assert.deepEqual(row.items, []); assert.deepEqual(row.warnings, [{ field: 'f', message: null, severity: null }]); assert.equal(row.has_pdf, false);
});
test('purchase orders stay visible to every project member, as in the BOM Documents tab, whatever their category scope', async () => {
  for (const mutate of [() => {}, f => f.change('projects/A', { members: [{ userId: 'alice', categoryScope: [] }] }), f => f.change('projects/A', { members: [] })]) {
    const f = fixture(); mutate(f); const r = await f.call(); assert.equal(r.status, 200); assert.deepEqual(r.body.purchase_orders.map(p => p.id), ['po1']);
  }
  assert.equal((await fixture().call('GET', null, { query: { project_id: 'B' } })).body.purchase_orders[0].poNumber, 'OTHER');
});
test('partner documents are limited to items in visible categories and linked ids outside them are hidden', async () => {
  const r = await fixture().call();
  assert.deepEqual(r.body.documents.map(d => d.id), ['d1']);
  assert.deepEqual(r.body.documents[0].linkedBOMItems, ['motor']);
  assert.equal(JSON.stringify(r.body).includes('"secret"'), false);
});
test('partners with no category scope or no BOM see no documents', async () => {
  const f = fixture(); f.change('projects/A', { members: [{ userId: 'alice', categoryScope: [] }] }); assert.deepEqual((await f.call()).body.documents, []);
  const g = fixture(); g.docs.delete('projects/A/bom/data'); assert.deepEqual((await g.call()).body.documents, []);
});
test('customer PO is BOM-admin only; internal members see the other four kinds in full', async () => {
  const internal = fixture({ actor: { email: 'alice@qualitastech.com' } });
  const asInternal = await internal.call('GET', null, { headers: { 'x-pulse-user-email': 'alice@qualitastech.com' } });
  assert.deepEqual(asInternal.body.documents.map(d => d.id), ['d1', 'd2', 'd3']);
  assert.deepEqual(asInternal.body.documents.find(d => d.id === 'd1').linkedBOMItems, ['motor', 'secret']);
  const asAdmin = await fixture({ actor: adminActor }).call(); assert.deepEqual(asAdmin.body.documents.map(d => d.id), ['d1', 'd2', 'd3', 'd4']);
});
test('documents expose only metadata with explicit ids; urls, storage and unknown fields never leave', async () => {
  const r = await fixture({ actor: adminActor }).call(); const first = r.body.documents[0];
  assert.deepEqual(Object.keys(first).sort(), [...PROCUREMENT_FIELDS.document].sort());
  assert.deepEqual(first, { id: 'd1', name: 'Quote.pdf', type: 'vendor-quote', uploadedAt: '2026-03-01T00:00:00.000Z', uploadedBy: 'u1', linkedBOMItems: ['motor', 'secret'], fileSize: 2048 });
  const text = JSON.stringify(r.body.documents); for (const leak of ['SECRET', 'firebasestorage', 'evil.example', 'storagePath', 'extra']) assert.equal(text.includes(leak), false, leak);
});
test('documents tolerate malformed metadata, skip unknown kinds and never read another project', async () => {
  const f = fixture({ actor: adminActor, docs: {
    'projectDocuments/d5': { projectId: 'A', type: 'mystery', name: 'x', linkedBOMItems: [] },
    'projectDocuments/d6': { projectId: 'A', type: 'spec-sheet', name: 7, uploadedAt: 'bad', uploadedBy: null, linkedBOMItems: ['ok', 3, null, 'x'.repeat(600)], fileSize: -5 },
    'projectDocuments/d7': { projectId: 'A', type: 'spec-sheet', name: 'Not array', linkedBOMItems: 'motor', fileSize: 'big' } } });
  const r = await f.call(); const ids = r.body.documents.map(d => d.id);
  assert.equal(ids.includes('d5'), false); assert.equal(ids.includes('dB'), false);
  assert.deepEqual(r.body.documents.find(d => d.id === 'd6'), { id: 'd6', name: null, type: 'spec-sheet', uploadedAt: null, uploadedBy: null, linkedBOMItems: ['ok'], fileSize: null });
  assert.deepEqual(r.body.documents.find(d => d.id === 'd7').linkedBOMItems, []);
});
test('page bounds are deterministic, and truncation is explicit and never silent', async () => {
  const extra = Object.fromEntries([2, 3, 4].map(n => [`projects/A/purchaseOrders/po${n}`, po({ poNumber: `PO-${n}` })]));
  const f = fixture({ docs: extra, limits: { purchaseOrders: 3, documents: 2 }, actor: adminActor });
  const r = await f.call();
  assert.equal(r.body.purchase_orders.length, 3); assert.equal(r.body.truncated.purchase_orders, true);
  assert.equal(r.body.documents.length, 2); assert.equal(r.body.truncated.documents, true);
  assert.deepEqual((await f.call()).body, r.body);
  const exact = await fixture({ limits: { purchaseOrders: 1, documents: 4 }, actor: adminActor }).call();
  assert.deepEqual(exact.body.truncated, { purchase_orders: false, documents: false });
});
test('a partner whose raw page overflowed is told it is truncated even if few documents are visible', async () => {
  const r = await fixture({ limits: { purchaseOrders: 5, documents: 1 } }).call();
  assert.equal(r.body.truncated.documents, true);
});
test('page is ordered newest first with missing dates last', async () => {
  const f = fixture({ docs: { 'projects/A/purchaseOrders/po0': po({ createdAt: undefined }), 'projects/A/purchaseOrders/po9': po({ createdAt: ts('2026-06-01T00:00:00Z') }) } });
  assert.deepEqual((await f.call()).body.purchase_orders.map(p => p.id), ['po9', 'po1', 'po0']);
});
