const test = require('node:test');
const assert = require('node:assert/strict');

const { fixture } = require('./nativeProcurementFixture.cjs');

test('accepted email finalizes original PO and BOM with one attributable send and retry receipt', async () => {
  const f = fixture(); const result = await f.send(); assert.equal(result.phase, 'complete');
  assert.equal(f.calls.length, 1); assert.equal(f.docs.get('projects/P/purchaseOrders/PO').status, 'sent');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].status, 'ordered');
  assert.equal((await f.call({ operation: 'recover' })).phase, 'complete'); assert.equal(f.calls.length, 1);
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
  const f = fixture({ billingFailure: true }); const opening = await f.call({ operation: 'open' });
  const result = await f.call({ operation: 'send', attempt_id: 'mark-one', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'mark', actual_sent_date: '2026-10-10', recipient_email: 'vendor@example.com', cc_emails: [] });
  assert.equal(result.phase, 'complete'); assert.equal(f.calls.length, 0);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('projectDocuments/')), false);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-10');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').sentAt, undefined);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, '2026-10-10');
});
test('native procurement cannot claim a PO reserved by a legacy email send', async () => {
  const f = fixture();
  f.docs.get('projects/P/purchaseOrders/PO').legacySendAttemptId = 'legacy-in-flight';
  assert.equal((await f.send()).error, 'purchase_order_attempt_active');
  assert.equal(f.calls.length, 0);
});
test('an uncut project advertises its legacy PO path during the staged native rollout', async () => {
  const f = fixture({ cutover: false });
  const opening = await f.call({ operation: 'open' });
  assert.equal(opening.permissions.send, false);
  assert.equal(opening.permissions.legacy_send, true);
});

test('manual sent date is required, calendar-valid, and immutable across attempt retries', async () => {
  const f = fixture(); const opening = await f.call({ operation: 'open' });
  const base = { operation: 'send', attempt_id: 'mark-date', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [] };
  assert.equal((await f.call(base)).error, 'invalid_procurement_request');
  assert.equal((await f.call({ ...base, actual_sent_date: '2026-02-30' })).error, 'invalid_procurement_request');
  const accepted = await f.call({ ...base, actual_sent_date: '2026-10-10' });
  assert.equal(accepted.phase, 'complete');
  assert.equal((await f.call({ ...base, actual_sent_date: '2026-10-11' })).error, 'operation_conflict');
});

test('accepted provider time is the stable send timestamp and linked-material order date', async () => {
  const acceptedAt = Date.parse('2026-10-18T18:30:00.000Z');
  const f = fixture({ now: acceptedAt }); const result = await f.send();
  assert.equal(result.phase, 'complete');
  const accepted = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').accepted_ms;
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').sentAt.getTime(), accepted);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').actualSentDate, '2026-10-19');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, '2026-10-19');
  f.advance(500000); assert.equal((await f.call({ operation: 'recover' })).phase, 'complete');
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').sentAt.getTime(), accepted);
});

test('native PO send uses item promise before header promise and preserves arrival when no promise exists', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items = [{ bomItemId: 'bolt', dueDate: new Date('2026-11-02T00:00:00.000Z') }, { bomItemId: 'washer' }, { bomItemId: 'nut' }];
  po.expectedDeliveryDate = new Date('2026-11-10T00:00:00.000Z');
  const categories = f.docs.get('projects/P/bom/data').categories;
  categories[0].items[0].expectedArrival = '2026-12-01';
  categories[0].items.push(
    { id: 'washer', itemType: 'component', name: 'Washer', quantity: 1, status: 'not-ordered' },
    { id: 'nut', itemType: 'component', name: 'Nut', quantity: 1, status: 'not-ordered', expectedArrival: '2026-12-03' },
  );
  assert.equal((await f.send()).phase, 'complete');
  const saved = f.docs.get('projects/P/bom/data').categories[0].items;
  assert.equal(saved.find(item => item.id === 'bolt').expectedArrival, '2026-11-02');
  assert.equal(saved.find(item => item.id === 'washer').expectedArrival, '2026-11-10');
  assert.equal(saved.find(item => item.id === 'nut').expectedArrival, '2026-11-10');
});

test('native PO promise dates with timezone offsets keep their encoded calendar date', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  po.items = [{ bomItemId: 'bolt', dueDate: '2026-11-02T00:00:00+05:30' }];
  delete po.expectedDeliveryDate;

  assert.equal((await f.send()).phase, 'complete');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-11-02');
});

test('native PO send preserves existing arrival date when neither item nor PO promise is set', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/PO');
  delete po.expectedDeliveryDate;
  po.items = [{ bomItemId: 'bolt' }];
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  item.expectedArrival = '2026-12-01';
  assert.equal((await f.send()).phase, 'complete');
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-12-01');
});

test('PO send respects the pre-existing irreversible legacy-writer fence', async () => {
  const f = fixture(); const result = await f.send(); assert.equal(result.phase, 'complete');
  assert.equal(f.docs.get('pulseMaterialCutovers/P').project_id, 'P');
  assert.equal(f.docs.get('pulseMaterialCutovers/P').established_by, 'reviewed-operator');
});

test('PO send refuses to activate an uncut project or dispatch before the explicit marker exists', async () => {
  const f = fixture({ cutover: false });
  const opening = await f.call({ operation: 'open' }); assert.equal(opening.permissions.send, false);
  const result = await f.send();
  assert.equal(result.error, 'material_cutover_required');
  assert.equal(f.calls.length, 0);
  assert.equal(f.docs.has('pulseMaterialCutovers/P'), false);
  assert.equal(f.docs.has('pulseProcurementOperations/P/attempts/attempt-1'), false);
});

test('cutover loss before artifact preparation leaves the attempt and lease untouched and creates no artifact', async () => {
  let attemptAtCutoverLoss;
  const f = fixture({ beforeTransaction: (number, docs) => { if (number === 4) { attemptAtCutoverLoss = structuredClone(docs.get('pulseProcurementOperations/P/attempts/attempt-1')); docs.delete('pulseMaterialCutovers/P'); } } });
  assert.equal((await f.send()).error, 'material_cutover_required');
  const attempt = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1');
  assert.equal(attempt.phase, 'prepared');
  assert.deepEqual(attempt, attemptAtCutoverLoss);
  assert.equal(f.artifactCalls(), 0);
  assert.equal(f.calls.length, 0);
});

test('recovery refuses to mutate PO or material data if the explicit cutover marker is absent', async () => {
  const f = fixture({ prepare: () => { throw Error('interrupt before dispatch'); } });
  assert.equal((await f.send()).phase, 'prepared');
  f.removeCutover();
  const beforeAttempt = structuredClone(f.docs.get('pulseProcurementOperations/P/attempts/attempt-1'));
  const beforePo = structuredClone(f.docs.get('projects/P/purchaseOrders/PO'));
  assert.equal((await f.call({ operation: 'recover' })).error, 'material_cutover_required');
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/PO'), beforePo);
  assert.deepEqual(f.docs.get('pulseProcurementOperations/P/attempts/attempt-1'), beforeAttempt);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].orderDate, undefined);
  assert.equal(f.calls.length, 0);
});

test('reconcile and cancel refuse unmarked attempts without changing leases, PO, or audit records', async () => {
  const prepared = fixture({ prepare: () => { throw Error('interrupt before dispatch'); } });
  await prepared.send(); prepared.removeCutover();
  const beforeAttempt = structuredClone(prepared.docs.get('pulseProcurementOperations/P/attempts/attempt-1'));
  const beforePo = structuredClone(prepared.docs.get('projects/P/purchaseOrders/PO'));
  assert.equal((await prepared.call({ operation: 'cancel', attempt_id: 'attempt-1' })).error, 'material_cutover_required');
  assert.equal((await prepared.call({ operation: 'recover', attempt_id: 'attempt-1' })).error, 'material_cutover_required');
  assert.deepEqual(prepared.docs.get('projects/P/purchaseOrders/PO'), beforePo);
  assert.deepEqual(prepared.docs.get('pulseProcurementOperations/P/attempts/attempt-1'), beforeAttempt);
  assert.equal([...prepared.docs.keys()].filter(path => path.includes('/audit/')).length, 1);

  const completed = fixture(); await completed.send(); completed.removeCutover();
  const completedAttempt = structuredClone(completed.docs.get('pulseProcurementOperations/P/attempts/attempt-1'));
  const completedPo = structuredClone(completed.docs.get('projects/P/purchaseOrders/PO'));
  const opening = await completed.call({ operation: 'open' });
  assert.equal((await completed.call({ operation: 'reconcile', attempt_id: 'attempt-1', expected_material_version: opening.material_version })).error, 'material_cutover_required');
  assert.deepEqual(completed.docs.get('projects/P/purchaseOrders/PO'), completedPo);
  assert.deepEqual(completed.docs.get('pulseProcurementOperations/P/attempts/attempt-1'), completedAttempt);
  assert.equal(completed.calls.length, 1);
});

test('reservation audit failure leaves no attempt or PO pointer and never sends', async () => {
  const f = fixture({ failWrite: writes => writes.some(([path]) => path.endsWith('-prepared')) });
  assert.equal((await f.send()).ok, false); assert.equal(f.calls.length, 0);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId, undefined);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseProcurementOperations/')), false);
});
