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
  const result = await f.call({ operation: 'send', attempt_id: 'mark-one', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'mark', actual_sent_date: '2026-10-19', recipient_email: 'vendor@example.com', cc_emails: [] });
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

test('native send cannot start while a legacy email reservation owns the PO and leaves it untouched', async () => {
  for (const phase of ['preparing', 'dispatching', 'uncertain', 'provider_accepted', 'needs_reconciliation']) {
    const f = fixture();
    Object.assign(f.docs.get('projects/P/purchaseOrders/PO'), { legacySendAttemptId: 'legacy-attempt', legacySendPhase: phase });
    const before = structuredClone(f.docs.get('projects/P/purchaseOrders/PO'));
    const result = await f.send();
    assert.deepEqual(result, { ok: false, error: 'purchase_order_attempt_active' }, phase);
    assert.deepEqual(f.docs.get('projects/P/purchaseOrders/PO'), before, phase);
    assert.equal(f.calls.length, 0, phase);
    assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseProcurementOperations/')), false, phase);
  }
});

const markSend = async (f, date, extra = {}) => {
  const opening = await f.call({ operation: 'open' });
  return f.call({ operation: 'send', attempt_id: 'attempt-1', expected_po_version: opening.po_version, expected_material_version: opening.material_version,
    mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [], ...(date === undefined ? {} : { actual_sent_date: date }), ...extra });
};
const firstItem = f => f.docs.get('projects/P/bom/data').categories[0].items[0];
test('manual mark requires a valid calendar actual_sent_date and rejects anything else without writing', async () => {
  for (const bad of [undefined, null, '', '2026-02-30', '2027-02-29', '2026-13-01', '2026-10-17T00:00:00Z', '17-10-2026', 20261017]) {
    const f = fixture();
    assert.deepEqual(await markSend(f, bad), { ok: false, error: 'invalid_procurement_request' }, String(bad));
    assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId, undefined);
    assert.equal(f.docs.has('pulseProcurementOperations/P/attempts/attempt-1'), false);
  }
  const leap = fixture();
  assert.equal((await markSend(leap, '2028-02-29')).phase, 'complete');
  assert.equal(firstItem(leap).orderDate, '2028-02-29');
});
test('email sends reject a supplied actual_sent_date', async () => {
  const f = fixture();
  const opening = await f.call({ operation: 'open' });
  assert.deepEqual(await f.call({ operation: 'send', attempt_id: 'attempt-1', expected_po_version: opening.po_version, expected_material_version: opening.material_version,
    mode: 'email', recipient_email: 'vendor@example.com', cc_emails: [], actual_sent_date: '2026-10-17' }), { ok: false, error: 'invalid_procurement_request' });
  assert.equal(f.calls.length, 0);
});
test('manual mark stores the exact entered day on the PO, audit and unentered materials, without touching status history or quantity', async () => {
  const f = fixture();
  f.docs.get('projects/P/purchaseOrders/PO').items[0].dueDate = '2026-11-20';
  const item = firstItem(f);
  Object.assign(item, { status: 'received', quantity: 7, receiveHistory: [{ qty: 7 }], notes: 'keep' });
  assert.equal((await markSend(f, '2026-10-17')).phase, 'complete');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-17');
  const saved = firstItem(f);
  assert.equal(saved.orderDate, '2026-10-17');
  assert.equal(saved.expectedArrival, '2026-11-20');
  assert.equal(saved.status, 'received');
  assert.equal(saved.quantity, 7);
  assert.deepEqual(saved.receiveHistory, [{ qty: 7 }]);
  assert.equal(saved.notes, 'keep');
  const audits = [...f.docs.entries()].filter(([path]) => path.includes('/audit/'));
  assert.equal(audits.some(([, a]) => a.operation === 'finalize_po_send' && a.actual_sent_date === '2026-10-17'), true);
  assert.equal(audits.some(([, a]) => a.operation === 'prepare_po_send' && a.intent.actual_sent_date === '2026-10-17'), true);
  assert.equal(f.calls.length, 0);
});
test('a different day under the same mark attempt conflicts; a retry keeps the exact frozen day and does not rewrite', async () => {
  const f = fixture();
  assert.equal((await markSend(f, '2026-10-17')).phase, 'complete');
  assert.deepEqual(await markSend(f, '2026-10-18'), { ok: false, error: 'operation_conflict' });
  const before = structuredClone(f.docs.get('projects/P/bom/data'));
  const retried = await f.call({ operation: 'recover' });
  assert.equal(retried.phase, 'complete');
  assert.deepEqual(f.docs.get('projects/P/bom/data'), before);
  assert.equal(f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').actual_sent_date, '2026-10-17');

  let failed = false;
  const g = fixture({ failWrite: writes => { if (!failed && writes.some(([path]) => path.endsWith('-finalized'))) { failed = true; return true; } return false; } });
  assert.equal((await markSend(g, '2026-10-17')).phase, 'metadata_pending');
  g.advance(60 * 60 * 1000);
  assert.equal((await g.call({ operation: 'recover' })).phase, 'complete');
  assert.equal(firstItem(g).orderDate, '2026-10-17');
  assert.equal(g.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-17');
});
test('manual mark preserves already-entered dates, fills absent ones, and never guesses a promise', async () => {
  const f = fixture();
  f.docs.get('projects/P/purchaseOrders/PO').items[0].dueDate = '2026-11-20';
  Object.assign(firstItem(f), { orderDate: '2026-09-01', expectedArrival: '2026-10-31T00:00:00+05:30' });
  await markSend(f, '2026-10-17');
  assert.equal(firstItem(f).orderDate, '2026-09-01');
  assert.equal(firstItem(f).expectedArrival, '2026-10-31T00:00:00+05:30');
  const g = fixture();
  firstItem(g).finalizedVendor = { name: 'Vendor', leadTime: '14 days' };
  g.docs.get('projects/P/purchaseOrders/PO').items[0].description = 'delivery in 14 days';
  await markSend(g, '2026-10-17');
  assert.equal(firstItem(g).orderDate, '2026-10-17');
  assert.equal(firstItem(g).expectedArrival, undefined);
  const h = fixture();
  h.docs.get('projects/P/purchaseOrders/PO').expectedDeliveryDate = '2026-12-01';
  await markSend(h, '2026-10-17');
  assert.equal(firstItem(h).expectedArrival, '2026-12-01');
});
test('material reconcile after a manual mark is not blocked by the PO actualSentDate the mark itself wrote', async () => {
  let f; f = fixture({ failWrite: writes => { if (writes.some(([path]) => path.endsWith('-accepted'))) f.changeMaterials(); return false; } });
  assert.equal((await markSend(f, '2026-10-17')).phase, 'material_pending');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-17');
  const opening = await f.call({ operation: 'open' });
  assert.equal((await f.call({ operation: 'reconcile', expected_material_version: opening.material_version })).phase, 'complete');
  assert.equal(firstItem(f).orderDate, '2026-10-17');
});

test('the opened attempt echoes the frozen manual-mark day (and email attempts do not)', async () => {
  let f; f = fixture({ failWrite: writes => { if (writes.some(([path]) => path.endsWith('-accepted'))) f.changeMaterials(); return false; } });
  assert.equal((await markSend(f, '2026-10-17')).phase, 'material_pending');
  const reopened = await f.call({ operation: 'open' });
  assert.equal(reopened.attempt.phase, 'material_pending');
  assert.equal(reopened.attempt.actual_sent_date, '2026-10-17');
  const e = fixture(); await e.send();
  assert.equal('actual_sent_date' in (await e.call({ operation: 'open' })).attempt, false);
});
test('an older accepted mark attempt without actual_sent_date finalizes from its frozen accepted day, never the current day', async () => {
  let f; f = fixture({ failWrite: writes => { if (writes.some(([path]) => path.endsWith('-accepted'))) f.changeMaterials(); return false; } });
  assert.equal((await markSend(f, '2026-10-17')).phase, 'material_pending');
  const attempt = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1');
  delete attempt.actual_sent_date; attempt.accepted_ms = Date.parse('2026-10-12T10:00:00.000Z');
  const opening = await f.call({ operation: 'open' });
  assert.equal(opening.attempt.actual_sent_date, '2026-10-12');
  assert.equal((await f.call({ operation: 'reconcile', expected_material_version: opening.material_version })).phase, 'complete');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-12');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, '2026-10-12');
});
test('an older mark attempt with no recorded day requires reconciliation instead of guessing or writing undefined', async () => {
  let f; f = fixture({ failWrite: writes => writes.some(([path, data]) => path.endsWith('/attempts/attempt-1') && data.phase === 'dispatching') });
  assert.equal((await markSend(f, '2026-10-17')).phase, 'prepared');
  const attempt = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1');
  delete attempt.actual_sent_date; delete attempt.accepted_ms;
  f.advance(10 * 60 * 1000);
  const before = structuredClone(f.docs.get('projects/P/purchaseOrders/PO'));
  const result = await f.call({ operation: 'recover' });
  assert.equal(result.phase, 'needs_reconciliation');
  assert.equal(result.problem, 'actual_sent_date_required');
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/PO'), before);
  assert.equal('actual_sent_date' in result, false);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, undefined);
});
