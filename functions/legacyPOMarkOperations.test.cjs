const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createLegacyPOMarkOperation } = require('./legacyPOMarkOperations.cjs');

function setup(options = {}) {
  const f = fixture({ uid: options.uid || 'admin', onRead: options.onRead });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, {
    status: 'pending-approval',
    items: [{ bomItemId: 'bolt', dueDate: new Date('2026-11-20T00:00:00Z') }],
  });
  const operation = createLegacyPOMarkOperation({
    db: f.db,
    auth: f.auth,
    nativeEnabled: options.nativeEnabled ?? false,
    getServerTimestamp: () => new Date('2026-10-18T00:00:00Z'),
  });
  const request = (data = {}) => operation({
    auth: { uid: options.uid || 'admin' },
    rawRequest: { get: () => 'Bearer test' },
    data: {
      project_id: 'P', po_id: 'existing', operation_id: 'mark-1',
      expected_actor_uid: options.uid || 'admin', actual_sent_date: '2026-10-17',
      sent_to_email: 'vendor@example.com', ...data,
    },
  });
  return { ...f, request };
}

test('manual mark atomically records actual date, order date, promised arrival, and audit', async () => {
  const f = setup();
  const result = await f.request();
  assert.equal(result.ok, true);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').status, 'sent');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').actualSentDate, '2026-10-17');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').sentAt, undefined);
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.status, 'ordered');
  assert.equal(item.orderDate, '2026-10-17');
  assert.equal(item.expectedArrival, '2026-11-20');
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});

test('manual mark falls back to an absent item arrival from the PO promise date and preserves arrival when no promise exists', async () => {
  const f = setup();
  f.docs.get('projects/P/purchaseOrders/existing').expectedDeliveryDate = new Date('2026-12-01T00:00:00Z');
  f.docs.get('projects/P/purchaseOrders/existing').items[0].dueDate = null;
  await f.request();
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-12-01');

  const g = setup();
  g.docs.get('projects/P/purchaseOrders/existing').items[0].dueDate = null;
  g.docs.get('projects/P/purchaseOrders/existing').expectedDeliveryDate = null;
  g.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival = '2026-10-31';
  await g.request();
  assert.equal(g.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-10-31');
});

test('manual mark preserves the calendar day of an offset promised-date string', async () => {
  const f = setup();
  f.docs.get('projects/P/purchaseOrders/existing').items[0].dueDate = '2026-11-20T00:00:00+05:30';
  await f.request();
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-11-20');
});

test('manual mark replay is idempotent and conflicting operation reuse is rejected', async () => {
  const f = setup();
  assert.equal((await f.request()).ok, true);
  assert.equal((await f.request()).ok, true);
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
  const conflict = await f.request({ actual_sent_date: '2026-10-16' });
  assert.equal(conflict.error, 'operation_conflict');
});

test('manual mark replay returns its receipt after cutover without writing again', async () => {
  const f = setup();
  assert.equal((await f.request()).replayed, false);
  const poBefore = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  const bomBefore = structuredClone(f.docs.get('projects/P/bom/data'));
  f.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });

  assert.deepEqual(await f.request(), {
    ok: true, project_id: 'P', po_id: 'existing', operation_id: 'mark-1', replayed: true,
  });
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), poBefore);
  assert.deepEqual(f.docs.get('projects/P/bom/data'), bomBefore);
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});

test('manual mark rejects non-admin and marked projects but allows staged writes on uncut projects', async () => {
  const nonAdmin = setup({ uid: 'alice' });
  assert.equal((await nonAdmin.request()).error, 'procurement_forbidden');

  const uncutWithNativeGloballyEnabled = setup({ nativeEnabled: true });
  assert.equal((await uncutWithNativeGloballyEnabled.request()).ok, true);

  const cutover = setup();
  cutover.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });
  const before = structuredClone(cutover.docs.get('projects/P/purchaseOrders/existing'));
  assert.equal((await cutover.request()).error, 'material_cutover_required');
  assert.deepEqual(cutover.docs.get('projects/P/purchaseOrders/existing'), before);
});

test('manual mark rejects invalid date and a PO outside the approved send state', async () => {
  const f = setup();
  assert.equal((await f.request({ actual_sent_date: '2026-02-30' })).error, 'invalid_procurement_request');
  f.docs.get('projects/P/purchaseOrders/existing').status = 'sent';
  assert.equal((await f.request()).error, 'purchase_order_not_approved');
});

test('manual mark cannot race an active legacy email send', async () => {
  const f = setup();
  f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId = 'in-flight';
  f.docs.get('projects/P/purchaseOrders/existing').legacySendPhase = 'dispatching';
  assert.equal((await f.request()).error, 'purchase_order_attempt_active');
});

test('manual mark preserves already-entered order and arrival dates and unrelated fields; absent ones are filled', async () => {
  const f = setup();
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  Object.assign(item, { orderDate: '2026-09-01', expectedArrival: '2026-10-31T00:00:00+05:30', notes: 'keep' });
  await f.request();
  const saved = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(saved.orderDate, '2026-09-01');
  assert.equal(saved.expectedArrival, '2026-10-31T00:00:00+05:30');
  assert.equal(saved.notes, 'keep');
  assert.equal(saved.status, 'ordered');

  const g = setup();
  g.docs.get('projects/P/bom/data').categories[0].items[0].orderDate = '2026-09-01';
  await g.request();
  const half = g.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(half.orderDate, '2026-09-01');
  assert.equal(half.expectedArrival, '2026-11-20');

  const h = setup();
  h.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival = '2026-10-31';
  await h.request();
  const other = h.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(other.orderDate, '2026-10-17');
  assert.equal(other.expectedArrival, '2026-10-31');
});

test('manual mark leaves arrival unset when no promise exists and never guesses from vendor lead time', async () => {
  const f = setup();
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.items[0].dueDate = null; po.expectedDeliveryDate = null;
  f.docs.get('projects/P/bom/data').categories[0].items[0].finalizedVendor = { name: 'Vendor', leadTime: '14 days' };
  await f.request();
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, undefined);
});

test('manual mark revokes on a fresh actor read taken inside the transaction before any write', async () => {
  let revoke = false;
  const f = setup({ onRead: (path, users) => { if (revoke && path === 'projects/P/bom/data') users.get('admin').customClaims.role = 'viewer'; } });
  revoke = true;
  const before = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  assert.deepEqual(await f.request(), { ok: false, error: 'actor_forbidden' });
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), before);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].status, undefined);
  assert.equal([...f.docs.keys()].some(path => path.includes('/legacyMarks/') || path.includes('/audit/')), false);
});
