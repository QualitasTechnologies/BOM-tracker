import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(emulator.hostname, '127.0.0.1');
let env;
const claims = { email: 'alice@partner.example', email_verified: true, status: 'approved', role: 'viewer' };
const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bom-native-security',
    firestore: {
      host: emulator.hostname,
      port: Number(emulator.port),
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});
beforeEach(async () => env.clearFirestore());
after(async () => env.cleanup());

async function seed(marker, { bom = true } = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/P'), { memberIds: ['alice'] });
    if (marker !== 'absent') {
      await setDoc(doc(db, 'pulseRuntimeControl/cutover'), marker === 'missing-field' ? {} : { blockLegacyMaterialClientWrites: marker });
    }
    if (bom) await setDoc(doc(db, 'projects/P/bom/data'), { categories: [{ name: 'Electrical', items: [] }] });
  });
}

test('absent and false material client-write markers preserve the existing member write flow', async () => {
  for (const marker of ['absent', 'missing-field', false]) {
    await seed(marker);
    const data = doc(actor().firestore(), 'projects/P/bom/data');
    await assertSucceeds(updateDoc(data, { categories: [{ name: 'Electrical', items: [{ id: marker, name: 'Fuse' }] }] }));
    await env.clearFirestore();
  }
});

test('enabled material client-write marker denies direct member create, update, and delete', async () => {
  await seed(true, { bom: false });
  const db = actor().firestore();
  await assertFails(setDoc(doc(db, 'projects/P/bom/data'), { categories: [] }));
  await seed(true);
  const updatedDb = actor().firestore();
  await assertFails(updateDoc(doc(updatedDb, 'projects/P/bom/data'), { categories: [] }));
  await assertFails(deleteDoc(doc(updatedDb, 'projects/P/bom/data')));
  const clientAdminDb = actor('alice', { role: 'admin' }).firestore();
  await assertFails(updateDoc(doc(clientAdminDb, 'projects/P/bom/data'), { categories: [] }));
});

test('enabled material client-write marker leaves other project subcollection writes available', async () => {
  await seed(true);
  const db = actor().firestore();
  await assertSucceeds(setDoc(doc(db, 'projects/P/bom/metadata'), { note: 'legacy settings remain writable' }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/order-1'), { status: 'draft' }));
});

test('Admin SDK style server writes bypass Firestore Rules while the client fence is enabled', async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P/bom/data'), { categories: [{ name: 'Electrical', items: [{ id: 'server', name: 'Fuse' }] }] });
  });
});
