import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const projectId = 'demo-bom-native-security', require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createNativePOAuthoringOperations } = require('./nativePOAuthoringOperations.cjs');
let env, db, f;
const accepted = { mode: 'coexist', poClientWritesFenced: true, poCounterClientWritesFenced: true };
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
after(async () => { await db?.terminate(); await env?.cleanup(); });
const seed = async control => {
  await env.clearFirestore(); f = fixture({ uid: 'admin' }); f.docs.delete('pulseRuntimeControl/cutover');
  const batch = db.batch(); for (const [path, value] of f.docs) batch.set(db.doc(path), value);
  if (control !== undefined) batch.set(db.doc('pulseRuntimeControl/cutover'), control);
  await batch.commit();
};
beforeEach(() => seed(undefined));
const client = (uid = 'admin', role = 'admin') => env.authenticatedContext(uid, { status: 'approved', role, email: `${uid}@qualitastech.com`, email_verified: true }).firestore();
const handler = () => createNativePOAuthoringOperations({ db, auth: f.auth, enabled: true, getServerTimestamp: () => FieldValue.serverTimestamp() });
const call = (native, data) => native({ auth: { uid: 'admin' }, rawRequest: { get: () => 'Bearer synthetic' }, data: { project_id: 'P', expected_actor_uid: 'admin', ...data } });

test('PO SDK writes are fenced only by the exact boolean; reads and nested metadata retain existing access', async () => {
  for (const value of [undefined, false, 'true', 1, true]) {
    await seed(value === undefined ? undefined : { mode: 'coexist', poClientWritesFenced: value });
    const legacy = client('alice', 'viewer'), existing = doc(legacy, 'projects/P/purchaseOrders/existing');
    const expected = value === true ? assertFails : assertSucceeds;
    await assertSucceeds(getDoc(existing));
    await expected(setDoc(doc(legacy, 'projects/P/purchaseOrders/new'), { status: 'draft' }));
    await expected(updateDoc(existing, { paymentTerms: 'Legacy edit' }));
    await assertSucceeds(setDoc(doc(legacy, 'projects/P/purchaseOrders/existing/metadata/legacy'), { note: 'kept' }));
    await expected(deleteDoc(existing));
    const outsider = doc(client('outsider', 'viewer'), 'projects/P/purchaseOrders/unknown');
    await assertFails(setDoc(outsider, { status: 'draft' }));
  }
});

test('counter fence protects values, identity format, field removal, replacement, creation and deletion without widening other policy', async () => {
  await seed({ ...accepted, poClientWritesFenced: false });
  const legacy = client();
  for (const path of ['billingEntities/B', 'settings/company']) {
    const ref = doc(legacy, path);
    await assertSucceeds(getDoc(ref));
    for (const patch of [{ nextPoNumber: 1 }, { poNumberPrefix: 'Other' }, { poNumberFormat: 'financial-year' }, { nextPoNumber: deleteField() }]) await assertFails(updateDoc(ref, patch));
    await assertFails(setDoc(ref, { companyAddress: 'replacement' }));
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(ref, { companyAddress: 'Legal edit retained' }));
  }
  await assertFails(setDoc(doc(legacy, 'billingEntities/new'), { nextPoNumber: 1 }));
  await assertSucceeds(setDoc(doc(legacy, 'billingEntities/no-sequence'), { legalName: 'No sequence' }));
  await assertSucceeds(deleteDoc(doc(legacy, 'billingEntities/no-sequence')));
  await assertFails(updateDoc(doc(client('alice', 'viewer'), 'billingEntities/B'), { companyAddress: 'Not admin' }));
  await assertSucceeds(updateDoc(doc(client('alice', 'viewer'), 'settings/company'), { phone: 'Legacy allowed' }));
  await assertSucceeds(setDoc(doc(legacy, 'settings/unrelated'), { nextPoNumber: 5 }));
  await assertSucceeds(setDoc(doc(legacy, 'settings/company/metadata/legacy'), { nextPoNumber: 5 }));
  await assertSucceeds(setDoc(doc(legacy, 'billingEntities/B/metadata/legacy'), { nextPoNumber: 5 }));
  await assertSucceeds(updateDoc(doc(legacy, 'projects/P/purchaseOrders/existing'), { paymentTerms: 'PO fence independent' }));
  await assertFails(setDoc(doc(legacy, 'pulseRuntimeControl/cutover'), { ...accepted }));
});

test('missing, false and malformed counter controls preserve legacy counter writes and deny native activation', async () => {
  for (const value of [undefined, false, 'true', 1]) {
    await seed(value === undefined ? undefined : { mode: 'coexist', poClientWritesFenced: true, poCounterClientWritesFenced: value });
    const native = handler(), opening = await call(native, { operation: 'open' });
    assert.equal(opening.ok, true); assert.equal(opening.permissions.create, false);
    const result = await call(native, { operation: 'create', po_id: 'new', operation_id: 'new', expected_material_version: opening.material_version, input: f.input, billing_snapshot: f.billingSnapshot });
    assert.equal(result.error, 'po_authoring_cutover_required');
    assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 7);
    await assertSucceeds(updateDoc(doc(client(), 'billingEntities/B'), { nextPoNumber: 8 }));
    await assertSucceeds(updateDoc(doc(client(), 'settings/company'), { nextPoNumber: 8 }));
    assert.equal((await db.collection('pulsePOAuthoringOperations/P/audit').get()).size, 0);
  }
});

test('actual native transactions retain edits and unique numbers despite stale SDK saves after both fences', async () => {
  for (const entity of ['B', 'company']) {
    await seed(accepted);
    const legacy = client(), po = doc(legacy, 'projects/P/purchaseOrders/existing');
    const stalePO = (await getDoc(po)).data();
    const counterPath = entity === 'company' ? 'settings/company' : 'billingEntities/B';
    const staleNumber = (await getDoc(doc(legacy, counterPath))).data().nextPoNumber;
    const native = handler(), opening = await call(native, { operation: 'open', po_id: 'existing' });
    assert.equal((await call(native, { operation: 'command', po_id: 'existing', operation_id: 'edit', expected_po_version: opening.po_version, command: { kind: 'edit', patch: { paymentTerms: 'Native fresh' } } })).ok, true);
    await assertFails(updateDoc(po, { paymentTerms: stalePO.paymentTerms }));
    assert.equal((await db.doc(po.path).get()).data().paymentTerms, 'Native fresh');
    const create = async id => {
      const result = await call(native, { operation: 'create', po_id: id, operation_id: id, expected_material_version: opening.material_version, input: { ...f.input, billingEntityId: entity }, billing_snapshot: f.billingSnapshot });
      assert.equal(result.ok, true); return (await db.doc('projects/P/purchaseOrders/' + id).get()).data().poNumber;
    };
    const numbers = [await create('native-one'), await create('native-two')];
    await assertFails(updateDoc(doc(legacy, counterPath), { nextPoNumber: staleNumber + 1 }));
    assert.equal((await db.doc(counterPath).get()).data().nextPoNumber, 9);
    numbers.push(await create('native-three'));
    assert.equal(new Set(numbers).size, 3);
    assert.equal((await db.doc(counterPath).get()).data().nextPoNumber, 10);
    assert.equal((await db.collection('pulsePOAuthoringOperations/P/audit').get()).size, 4);
  }
});
