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
  const result = await f.call({ operation: 'send', attempt_id: 'mark-one', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [] });
  assert.equal(result.phase, 'complete'); assert.equal(f.calls.length, 0);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('projectDocuments/')), false);
});

test('reservation audit failure leaves no attempt or PO pointer and never sends', async () => {
  const f = fixture({ failWrite: writes => writes.some(([path]) => path.endsWith('-prepared')) });
  assert.equal((await f.send()).ok, false); assert.equal(f.calls.length, 0);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId, undefined);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseProcurementOperations/')), false);
});
