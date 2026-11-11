const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./nativeProcurementFixture.cjs');

// Authorization must still be current when a slow Firestore opening completes.
for (const path of ['projects/P', 'projects/P/purchaseOrders/PO', 'projects/P/bom/data', 'pulseProcurementOperations/P/attempts/prior']) {
  test(`a role revoked while reading ${path} releases no procurement data`, async () => {
    const f = fixture();
    f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId = 'prior';
    f.docs.set('pulseProcurementOperations/P/attempts/prior', { attempt_id: 'prior', phase: 'complete', mode: 'email', recipient_email: 'vendor@example.invalid', cc_emails: [] });
    const original = f.db.runTransaction.bind(f.db);
    f.db.runTransaction = fn => original(tx => fn({ ...tx, get: async ref => { const snapshot = await tx.get(ref); if (ref.path === path) f.revoke(); return snapshot; } }));
    const before = structuredClone([...f.docs]);
    const result = await f.call({ operation: 'open' });
    assert.equal(result.ok, false); assert.equal(result.error, 'procurement_forbidden');
    for (const key of ['purchase_order', 'material_items', 'attempt', 'recipient_email']) assert.equal(result[key], undefined);
    assert.deepEqual([...f.docs], before); assert.equal(f.calls.length, 0);
  });
}

test('a switched bearer during the opening cannot release the previous account data', async () => {
  const f = fixture(), original = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = fn => original(tx => fn({ ...tx, get: async ref => { const snapshot = await tx.get(ref); if (ref.path === 'projects/P/bom/data') f.switchActor(); return snapshot; } }));
  const result = await f.call({ operation: 'open' });
  assert.equal(result.ok, false); assert.equal(result.purchase_order, undefined); assert.equal(f.calls.length, 0);
});
