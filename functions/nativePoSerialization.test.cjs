// Real Firestore SDK instances (synthetic credentials, never connected) through the real callable encoder.
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { Firestore, FieldValue, GeoPoint, Timestamp } = require('@google-cloud/firestore');
const { encode } = require(require('node:path').join(__dirname, 'node_modules/firebase-functions/lib/common/providers/https.js'));
const authoring = require('./nativePOAuthoringFixture.cjs'), procurement = require('./nativeProcurementFixture.cjs');
const SENTINEL = 'SYNTHETIC-PO-SERIALIZATION-SENTINEL';
const sdk = () => new Firestore({ projectId: 'demo-offline', credentials: { client_email: 'synthetic@example.invalid', private_key: SENTINEL } });
const typed = db => ({ reference: db.doc('legacy/reference'), geo: new GeoPoint(12.5, 77.25), vector: FieldValue.vector([1, 2, 3]), stamp: Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')), bytes: Buffer.from('abc') });
const marked = { reference: { __type: 'reference', path: 'legacy/reference' }, geo: { latitude: 12.5, longitude: 77.25 }, vector: [1, 2, 3], stamp: '2026-10-01T00:00:00.000Z', bytes: { __type: 'bytes', base64: 'YWJj' } };
const wire = result => JSON.stringify(encode(result));
const leaks = json => json.includes(SENTINEL) || /_firestore|_settings|_credentials|_serializer/.test(json);
// Inject the typed values into one stored document at the transaction read boundary (fixtures structuredClone).
function inject(db, path, extra) {
  const run = db.runTransaction.bind(db);
  db.runTransaction = (fn, ...rest) => run(tx => fn({ ...tx, get: async r => { const s = await tx.get(r); return r.path === path ? { ...s, data: () => ({ ...s.data(), ...extra }) } : s; } }), ...rest);
}
const values = typed(sdk());

test('positive control: the raw SDK values do leak through the real encoder', () => {
  assert.equal(leaks(wire({ ref: values.reference })), true);
});
test('authoring open PO encodes logical values only and never connection internals', async () => {
  const f = authoring.fixture(); inject(f.db, 'projects/P/purchaseOrders/existing', { legacy: { nested: [values] } });
  const result = await f.call({ operation: 'open', po_id: 'existing' });
  assert.equal(result.ok, true); assert.equal(leaks(wire(result)), false);
  assert.deepEqual(result.purchase_order.legacy, { nested: [marked] });
});
test('authoring open BOM categories encode logical values only', async () => {
  const f = authoring.fixture(); inject(f.db, 'projects/P/bom/data', { categories: [{ name: 'Parts', items: [{ id: 'bolt', note: values }] }] });
  const result = await f.call({ operation: 'open' });
  assert.equal(result.ok, true); assert.equal(leaks(wire(result)), false);
  assert.deepEqual(result.categories[0].items[0].note, marked);
});
test('procurement open PO and material items encode logical values only', async () => {
  const f = procurement.fixture(); inject(f.db, 'projects/P/purchaseOrders/PO', { legacy: values });
  inject(f.db, 'projects/P/bom/data', { categories: [{ name: values.reference, items: [{ id: 'bolt', name: values.reference, quantity: 1, status: 'x' }] }] });
  const result = await f.call({ operation: 'open' });
  assert.equal(result.ok, true); assert.equal(leaks(wire(result)), false);
  assert.deepEqual(result.purchase_order.legacy, marked);
  assert.deepEqual(result.material_items[0].name, marked.reference);
});
test('procurement send hashes typed PO deterministically and persists/provides only safe snapshots', async () => {
  // Vector values are excluded here: the existing document-size estimator (materialCommands) cannot size them, so finalization
  // stays retryable as metadata_pending. That is a separate, fail-closed limit; open/encode coverage above includes vectors.
  const { vector: _vector, ...sendable } = values, expected = { ...marked }; delete expected.vector;
  const f = procurement.fixture(); inject(f.db, 'projects/P/purchaseOrders/PO', { legacy: sendable });
  const result = await f.send();
  assert.equal(result.phase, 'complete'); assert.equal(leaks(wire(result)), false);
  const attempt = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1');
  assert.equal(leaks(JSON.stringify(attempt)), false); assert.deepEqual(attempt.po_snapshot.legacy, expected);
  assert.equal(leaks(JSON.stringify(f.calls[0].frozen)), false);
  const again = await f.call({ operation: 'recover' });
  assert.equal(again.phase, 'complete'); assert.equal(f.calls.length, 1);
});
test('unknown SDK-like classes fail closed with a sanitized error, before any write', async () => {
  const f = procurement.fixture(); inject(f.db, 'projects/P/purchaseOrders/PO', { legacy: FieldValue.serverTimestamp() });
  const result = await f.call({ operation: 'open' }); assert.equal(result.ok, false); assert.equal(leaks(wire(result)), false);
  assert.equal((await f.send()).ok, false); assert.equal(f.docs.has('pulseProcurementOperations/P/attempts/attempt-1'), false);
  class DocumentReference { constructor() { this.path = 'spoof'; this.secret = SENTINEL; } }
  const g = authoring.fixture(); inject(g.db, 'projects/P/purchaseOrders/existing', { legacy: new DocumentReference() });
  const spoof = await g.call({ operation: 'open', po_id: 'existing' }); assert.equal(spoof.ok, false); assert.equal(JSON.stringify(spoof).includes(SENTINEL), false);
});
test('plain user objects that merely claim an SDK constructor name stay plain data', async () => {
  const claim = { constructor: { name: 'DocumentReference' }, path: 'x', keep: 1 };
  const f = authoring.fixture(); inject(f.db, 'projects/P/purchaseOrders/existing', { claim });
  const result = await f.call({ operation: 'open', po_id: 'existing' });
  assert.equal(result.ok, true); assert.deepEqual(result.purchase_order.claim, claim);
});
test('authoritative typed records are written unchanged (raw reference identity kept)', async () => {
  const f = authoring.fixture(), writes = [], ref = values.reference;
  const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (fn, ...rest) => run(tx => fn({ ...tx,
    get: async r => { const s = await tx.get(r); return r.path === 'projects/P/purchaseOrders/existing' ? { ...s, data: () => ({ ...s.data(), legacyReference: ref }) } : s; },
    update: (r, patch) => { writes.push([r.path, patch]); const { legacyReference: _kept, ...others } = patch; return tx.update(r, others); },
    create: (r, data) => { writes.push([r.path, data]); return tx.create(r, JSON.parse(JSON.stringify(data, (_k, v) => v === ref ? '[ref]' : v))); } }), ...rest);
  const result = await f.command({ kind: 'edit', patch: { paymentTerms: 'New' } });
  assert.equal(result.ok, true);
  assert.equal(writes.find(([path]) => path === 'projects/P/purchaseOrders/existing')[1].legacyReference, ref);
});
test('plain-JSON hashes are unchanged (pinned from the pre-fix implementation)', async () => {
  const f = procurement.fixture(); await f.send();
  const attempt = f.docs.get('pulseProcurementOperations/P/attempts/attempt-1');
  assert.equal(attempt.intent_hash, 'f40cb9dfb48d620dac5a211b7bb25957bdee142ec748771ff60c63e72321aa08');
  assert.equal(attempt.po_hash, '8850b124f9dfd9783fecdd6919fb549a5b8d7b109eecbf0218e7b136f8c7b314');
  const g = authoring.fixture(); await g.command({ kind: 'submit' });
  assert.equal(g.docs.get('pulsePOAuthoringOperations/P/receipts/command-1').payload_hash, 'ecbab0bbd7f145a97fda6e1236a34410c68ed6e902d0db81199392de83c7d45a');
});
test('a Date/Timestamp PO hashes exactly as before (ISO, sorted keys)', async () => {
  const f = procurement.fixture(); inject(f.db, 'projects/P/purchaseOrders/PO', { due: new Date('2026-10-01T00:00:00Z'), stamp: values.stamp });
  await f.send();
  const po = { due: '2026-10-01T00:00:00.000Z', id: 'PO', items: [{ bomItemId: 'bolt' }], poNumber: 'PO-1', projectId: 'P', stamp: '2026-10-01T00:00:00.000Z', totalAmount: 5 };
  assert.equal(f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').po_hash, createHash('sha256').update(JSON.stringify(po)).digest('hex'));
});
