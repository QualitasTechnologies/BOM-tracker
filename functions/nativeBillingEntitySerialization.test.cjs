const test = require('node:test'), assert = require('node:assert/strict');
const { Firestore, FieldValue, GeoPoint, Timestamp } = require('@google-cloud/firestore');
const { encode } = require(require('node:path').join(__dirname, 'node_modules/firebase-functions/lib/common/providers/https.js'));
const { fixture } = require('./nativeBillingEntityFixture.cjs');
const secret = 'SYNTHETIC-BILLING-SERIALIZATION-SENTINEL';
const sdk = new Firestore({ projectId: 'demo-offline', credentials: { client_email: 'synthetic@example.invalid', private_key: secret } });
const legacy = { reference: sdk.doc('legacy/retained'), point: new GeoPoint(12, 77), timestamp: Timestamp.fromMillis(1000), bytes: Buffer.from('retained'), vector: FieldValue.vector([1, 2]) };
const get = f => f.call({ operation: 'get', entity_id: 'B' });

test('real SDK metadata stays intact in storage/archive and never enters callable output', async () => {
  const f = fixture(); f.docs.get('billingEntities/B').legacy = legacy;
  const opening = await get(f);
  assert.equal(opening.ok, true); assert.equal(opening.entity.legacy, undefined);
  const wire = JSON.stringify(encode(opening));
  assert.equal(wire.includes(secret), false); assert.equal(/_firestore|_settings|_credentials/.test(wire), false);
  assert.equal((await f.call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'typed-edit', patch: { phone: '123' } })).ok, true);
  assert.equal(f.docs.get('billingEntities/B').legacy.reference, legacy.reference);
  assert.equal((await f.call({ operation: 'delete', entity_id: 'B', expected_version: (await get(f)).entity_version, operation_id: 'typed-delete' })).ok, true);
  const stored = f.docs.get('pulseDeletedBillingEntities/B').entity.legacy;
  for (const key of Object.keys(legacy)) assert.equal(stored[key], legacy[key]);
});

test('unsupported private SDK classes cannot cause a partial edit or archive', async () => {
  class Unsupported { constructor() { this.private = secret; } }
  const f = fixture(); f.docs.get('billingEntities/B').legacy = new Unsupported();
  const result = await f.call({ operation: 'delete', entity_id: 'B', expected_version: (await get(f)).entity_version, operation_id: 'bad-sdk' });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(encode(result)).includes(secret), false);
  assert.equal(f.docs.has('billingEntities/B'), true); assert.equal(f.docs.has('pulseDeletedBillingEntities/B'), false);
});

test('only changed logo references are validated; historical references survive unrelated edits', async () => {
  const f = fixture(); f.docs.get('billingEntities/B').logo = 'https://historical.invalid/logo.png';
  const opening = await get(f);
  assert.equal((await f.call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'old-logo', patch: { phone: '123' } })).ok, true);
  const g = fixture(), before = await get(g);
  assert.equal((await g.call({ operation: 'update', entity_id: 'B', expected_version: before.entity_version, operation_id: 'bad-logo', patch: { logo: 'http://169.254.169.254/private', logoPath: 'company-logos/logo.png' } })).error, 'invalid_billing_entity_logo');
  const path = 'company-logos/company_logo.png';
  assert.equal((await g.call({ operation: 'update', entity_id: 'B', expected_version: before.entity_version, operation_id: 'good-logo', patch: { logo: `https://firebasestorage.googleapis.com/v0/b/demo-bom-native-security.appspot.com/o/${encodeURIComponent(path)}?alt=media`, logoPath: path } })).ok, true);
});

test('oversized edits and resulting archived documents fail without writing audit or receipt', async () => {
  for (const oversized of ['request', 'archive']) {
    const f = fixture();
    if (oversized === 'archive') f.docs.get('billingEntities/B').legacy = 'a'.repeat(950 * 1024);
    const opening = await get(f);
    const result = await f.call({ operation: oversized === 'archive' ? 'delete' : 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'oversized', ...(oversized === 'request' ? { patch: { phone: 'a'.repeat(270000) } } : {}) });
    assert.equal(result.ok, false); assert.equal(f.docs.has('pulseBillingEntityOperations/oversized'), false); assert.equal(f.docs.has('pulseBillingEntityAudit/oversized'), false); assert.equal(f.docs.has('billingEntities/B'), true);
  }
});
