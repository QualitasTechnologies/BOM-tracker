import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { fixture } = require('./nativeBillingEntityFixture.cjs');
const { createNativeBillingEntityOperations } = require('./nativeBillingEntityOperations.cjs');
const projectId = 'demo-bom-native-security';
let env, db, f, native;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
after(async () => { await db?.terminate(); await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); f = fixture();
  const batch = db.batch(); for (const [path, value] of f.docs) batch.set(db.doc(path), value); await batch.commit();
  native = createNativeBillingEntityOperations({ db, auth: f.auth, enabled: true, bucketName: `${projectId}.appspot.com`, getServerTimestamp: () => FieldValue.serverTimestamp() });
});
const call = data => native({ auth: { uid: 'admin' }, rawRequest: { get: () => 'Bearer synthetic' }, data: { expected_actor_uid: 'admin', ...data } });
const client = (uid = 'admin', role = 'admin') => env.authenticatedContext(uid, { status: 'approved', role, email: `${uid}@example.invalid`, email_verified: true }).firestore();

test('full entity fence blocks stale legal edits while retaining original reads, nested metadata and unrelated Settings', async () => {
  const browser = client();
  await assertSucceeds(getDoc(doc(browser, 'billingEntities/B')));
  await assertFails(updateDoc(doc(browser, 'billingEntities/B'), { phone: 'stale' }));
  await assertFails(deleteDoc(doc(browser, 'billingEntities/B')));
  await assertFails(setDoc(doc(browser, 'billingEntities/new'), { legalName: 'legacy' }));
  await assertFails(updateDoc(doc(browser, 'settings/company'), { phone: 'stale' }));
  await assertSucceeds(setDoc(doc(browser, 'billingEntities/B/metadata/old'), { note: 'retained' }));
  const partner = client('partner', 'viewer');
  await assertSucceeds(setDoc(doc(partner, 'settings/unrelated'), { existingPolicy: true }));
  await assertSucceeds(setDoc(doc(partner, 'settings/company/metadata/old'), { existingPolicy: true }));
});

test('only exact true activates the metadata fence and existing billing/company role distinction remains', async () => {
  for (const value of [undefined, false, 'true', 1]) {
    const control = { mode: 'coexist', ...(value === undefined ? {} : { billingEntityClientWritesFenced: value }) };
    await db.doc('pulseRuntimeControl/cutover').set(control);
    await assertSucceeds(updateDoc(doc(client(), 'billingEntities/B'), { phone: 'legacy' }));
    await assertFails(updateDoc(doc(client('partner', 'viewer'), 'billingEntities/B'), { phone: 'not allowed' }));
    await assertSucceeds(updateDoc(doc(client('partner', 'viewer'), 'settings/company'), { phone: 'existing policy' }));
  }
});

test('client admins cannot forge private receipts, audit, archive or rollout controls', async () => {
  for (const path of ['pulseBillingEntityOperations/fake', 'pulseBillingEntityAudit/fake', 'pulseDeletedBillingEntities/B', 'pulseRuntimeControl/cutover']) {
    await assertFails(setDoc(doc(client(), path), { allowed: true }));
    await assertFails(getDoc(doc(client(), path)));
  }
});

test('real transactions allocate no duplicate edit receipts and archive complete original metadata', async () => {
  const original = (await db.doc('billingEntities/B').get()).data();
  const opening = await call({ operation: 'get', entity_id: 'B' });
  const request = { operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'parallel', patch: { phone: '123' } };
  const results = await Promise.all([call(request), call(request)]);
  assert.equal(results[0].ok, true); assert.deepEqual(results[0], results[1]);
  assert.equal((await db.collection('pulseBillingEntityAudit').get()).size, 1);
  assert.deepEqual((await db.doc('billingEntities/B').get()).data().legacy, original.legacy);
  const deleting = { operation: 'delete', entity_id: 'B', expected_version: (await call({ operation: 'get', entity_id: 'B' })).entity_version, operation_id: 'archive' };
  assert.equal((await call(deleting)).ok, true);
  assert.equal((await db.doc('pulseDeletedBillingEntities/B').get()).data().entity.phone, '123');
  assert.equal((await db.doc('billingEntities/B').get()).exists, false);
  assert.equal((await call(deleting)).ok, true);
});

test('PO allocation rejects an open stale Settings form, and default selection rejects changed catalog membership', async () => {
  const opening = await call({ operation: 'get', entity_id: 'B' });
  await db.runTransaction(async tx => { const target = db.doc('billingEntities/B'), snap = await tx.get(target); tx.update(target, { nextPoNumber: snap.data().nextPoNumber + 1 }); });
  assert.equal((await call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'stale', patch: { nextPoNumber: 10 } })).error, 'billing_entity_version_conflict');
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 11);
  const catalog = await call({ operation: 'catalog' });
  await db.doc('billingEntities/added').set(f.input);
  assert.equal((await call({ operation: 'set_default', entity_id: 'B', expected_catalog_version: catalog.catalog_version, operation_id: 'stale-default' })).error, 'billing_entity_catalog_conflict');
  assert.equal((await db.doc('billingEntities/B').get()).data().isDefault, false);
});
