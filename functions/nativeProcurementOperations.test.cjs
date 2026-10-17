const test = require('node:test');
const assert = require('node:assert/strict');

const { fixture } = require('./nativeProcurementFixture.cjs');

test('accepted email finalizes original PO and BOM with one attributable send and retry receipt', async () => {
  const f = fixture(); const result = await f.send(); assert.equal(result.phase, 'complete');
  assert.equal(f.calls.length, 1); assert.equal(f.docs.get('projects/P/purchaseOrders/PO').status, 'sent');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').sentAt, 'fixture-time');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].status, 'ordered');
  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete'); assert.equal(f.calls.length, 1);
});
test('finalizing a PO uses the accepted event date in Asia/Kolkata and the item promised date', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items[0].dueDate = '2026-10-22';
  po.expectedDeliveryDate = '2026-10-25';
  f.advance(Date.parse('2026-10-17T23:30:00.000Z') - Date.parse('2026-10-14T12:00:00.000Z'));

  assert.equal((await f.send()).phase, 'complete');

  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.orderDate, '2026-10-18');
  assert.equal(item.expectedArrival, '2026-10-22');
});
test('PO inward date handoff falls back to the PO expected delivery date', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.expectedDeliveryDate = '2026-10-25';

  assert.equal((await f.send()).phase, 'complete');

  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.expectedArrival, '2026-10-25');
});
test('PO inward date handoff preserves existing dates and ignores free-text lead times', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items[0].description = 'Bolt, delivery in 14 days';
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  item.orderDate = '2026-09-01';
  item.expectedArrival = '2026-09-12';

  assert.equal((await f.send()).phase, 'complete');

  const saved = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(saved.orderDate, '2026-09-01');
  assert.equal(saved.expectedArrival, '2026-09-12');
});
test('PO retries reuse the accepted date and do not change manually set inward dates', async () => {
  const f = fixture();
  f.advance(Date.parse('2026-10-18T20:00:00.000Z') - Date.parse('2026-10-14T12:00:00.000Z'));
  assert.equal((await f.send()).phase, 'complete');
  const saved = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(saved.orderDate, '2026-10-19');
  saved.expectedArrival = '2026-11-02';

  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete');

  const retried = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(retried.orderDate, '2026-10-19');
  assert.equal(retried.expectedArrival, '2026-11-02');
  assert.equal(f.calls.length, 1);
});
test('free-text lead time does not create an expected arrival date', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items[0].description = 'Bolt, delivery in 14 days';

  assert.equal((await f.send()).phase, 'complete');

  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.expectedArrival, undefined);
});
test('legacy accepted sends without an event timestamp do not backfill inward dates on recovery', async () => {
  let failed = false;
  const f = fixture({ failWrite: writes => { if (!failed && writes.some(([path]) => path.endsWith('-finalized'))) { failed = true; return true; } return false; } });
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items[0].dueDate = '2026-10-22';
  assert.equal((await f.send()).phase, 'metadata_pending');
  delete f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').accepted_ms;

  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete');

  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.orderDate, undefined);
  assert.equal(item.expectedArrival, undefined);
  assert.equal(f.calls.length, 1);
});
test('PO finalization preserves an existing inward PO number when the PO snapshot has none', async () => {
  const f = fixture();
  f.docs.get('projects/P/purchaseOrders/PO').poNumber = '';
  f.docs.get('projects/P/bom/data').categories[0].items[0].poNumber = 'Existing PO-42';

  assert.equal((await f.send()).phase, 'complete');

  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].poNumber, 'Existing PO-42');
});
test('unknown outcomes remain durable and identical retries reuse provider key and artifact', async () => {
  const f = fixture(); f.timeout(true); assert.equal((await f.send()).phase, 'uncertain');
  f.timeout(false); assert.equal((await f.call({ operation: 'recover' })).phase, 'complete');
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test('expired uncertain outcomes never send again automatically', async () => {
  const f = fixture(); f.timeout(true); await f.send(); f.advance(24 * 60 * 60 * 1000); f.timeout(false);
  assert.equal((await f.call({ operation: 'recover' })).phase, 'needs_reconciliation'); assert.equal(f.calls.length, 1);
});
test('fresh actor and opening assertion prevent unauthorized or switched-account requests', async () => {
  const f = fixture(); f.revoke(); assert.equal((await f.call({ operation: 'open' })).error, 'procurement_forbidden');
  const g = fixture(); g.switchActor(); assert.equal((await g.call({ operation: 'open', expected_actor_uid: 'admin' })).error, 'actor_session_changed'); assert.equal(g.calls.length, 0);
});
test('confirmed email plus material conflict recovers after reload without another provider call', async () => {
  let f; f = fixture({ provider: () => f.changeMaterials() });
  assert.equal((await f.send()).phase, 'material_pending');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').status, 'sent');
  assert.equal((await f.call({ operation: 'open' })).attempt.phase, 'material_pending');
  const opening = await f.call({ operation: 'open' });
  assert.equal((await f.call({ operation: 'reconcile', expected_material_version: opening.material_version })).phase, 'complete');
  assert.equal(f.calls.length, 1);
});
test('admin role revocation during artifact preparation prevents dispatch', async () => {
  const f = fixture({ prepare: actor => { actor.customClaims.role = 'viewer'; } });
  const result = await f.send();
  assert.equal(result.phase, 'prepared'); assert.equal(f.calls.length, 0);
});
test('received items keep their completed status and all historical tranches when filed to a PO', async () => {
  const f = fixture(); const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  item.status = 'received'; item.fulfillmentTranches = [{ id: 'old', quantity: 1, invoiceDocId: 'invoice', legacy: true }];
  assert.equal((await f.send()).phase, 'complete');
  const saved = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(saved.status, 'received'); assert.deepEqual(saved.fulfillmentTranches, item.fulfillmentTranches); assert.equal(saved.poNumber, 'PO-1');
});

test('a concurrent recovery sees the active lease and never invokes the provider twice', async () => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const f = fixture({ provider: async () => { entered(); await hold; } });
  const sending = f.send(); await started;
  assert.equal((await f.call({ operation: 'recover' })).phase, 'pending'); assert.equal(f.calls.length, 1);
  release(); assert.equal((await sending).phase, 'complete');
});
test('prepared attempts can be cancelled but dispatched uncertain attempts cannot', async () => {
  const f = fixture({ prepare: () => { throw Error('PDF interrupted'); } });
  assert.equal((await f.send()).phase, 'prepared');
  assert.equal((await f.call({ operation: 'cancel', attempt_id: 'attempt-1' })).phase, 'cancelled');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId, null); assert.equal(f.calls.length, 0);
  const g = fixture(); g.timeout(true); await g.send();
  assert.equal((await g.call({ operation: 'cancel', attempt_id: 'attempt-1' })).error, 'send_cannot_be_cancelled');
  assert.equal(g.calls.length, 1);
});
test('lost acknowledgment persistence keeps an uncertain request with the same provider key', async () => {
  let failed = false;
  const f = fixture({ failWrite: writes => { if (!failed && writes.some(([path]) => path.endsWith('-accepted'))) { failed = true; return true; } return false; } });
  assert.equal((await f.send()).phase, 'uncertain');
  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete');
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test('metadata commit failure preserves acceptance and recovery never resends', async () => {
  let failed = false;
  const f = fixture({ failWrite: writes => { if (!failed && writes.some(([path]) => path.endsWith('-finalized'))) { failed = true; return true; } return false; } });
  assert.equal((await f.send()).phase, 'metadata_pending');
  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete'); assert.equal(f.calls.length, 1);
});
test('concurrent PO edits after acceptance are preserved and require manual metadata resolution', async () => {
  let f; f = fixture({ provider: () => { f.docs.get('projects/P/purchaseOrders/PO').totalAmount = 999; } });
  assert.equal((await f.send()).phase, 'metadata_pending');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').totalAmount, 999);
  assert.equal((await f.call({ operation: 'recover' })).error, 'purchase_order_changed'); assert.equal(f.calls.length, 1);
});
test('protected artifact attestation key never leaves the public attempt response', async () => {
  const f = fixture(); f.timeout(true); const result = await f.send(); const opening = await f.call({ operation: 'open' });
  const key = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').artifact_key;
  assert.equal(typeof key, 'string'); assert.ok(key.length >= 64);
  assert.equal(JSON.stringify(result).includes(key), false); assert.equal(JSON.stringify(opening).includes(key), false);
});

test('mark as sent preserves the original workflow without billing or an email provider', async () => {
  const f = fixture({ billingFailure: true, nowMs: Date.parse('2026-10-18T20:00:00.000Z') });
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items[0].dueDate = '2026-10-23'; po.expectedDeliveryDate = '2026-10-26';
  const opening = await f.call({ operation: 'open' });
  const result = await f.call({ operation: 'send', attempt_id: 'mark-one', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [] });
  assert.equal(result.phase, 'complete'); assert.equal(f.calls.length, 0);
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.orderDate, '2026-10-19'); assert.equal(item.expectedArrival, '2026-10-23');
  assert.equal([...f.docs.keys()].some(path => path.startsWith('projectDocuments/')), false);
});

test('reservation audit failure leaves no attempt or PO pointer and never sends', async () => {
  const f = fixture({ failWrite: writes => writes.some(([path]) => path.endsWith('-prepared')) });
  assert.equal((await f.send()).ok, false); assert.equal(f.calls.length, 0);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId, undefined);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseProcurementOperations/')), false);
});
