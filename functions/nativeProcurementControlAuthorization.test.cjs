const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./nativeProcurementFixture.cjs');
test('revocation during the native runtime-mode read releases no PO opening', async () => {
  const f = fixture(), original = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = fn => original(tx => fn({ ...tx, get: async ref => { const snapshot = await tx.get(ref); if (ref.path === 'pulseRuntimeControl/cutover') f.revoke(); return snapshot; } }));
  const result = await f.call({ operation: 'open' });
  assert.equal(result.ok, false); assert.equal(result.error, 'procurement_forbidden'); assert.equal(result.purchase_order, undefined); assert.equal(f.calls.length, 0);
});
