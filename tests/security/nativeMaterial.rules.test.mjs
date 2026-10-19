import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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
      const { path = 'pulseMaterialCutovers/P', data = marker } = marker;
      await setDoc(doc(db, path), data);
    }
    if (bom) await setDoc(doc(db, 'projects/P/bom/data'), { categories: [{ name: 'Electrical', items: [] }] });
  });
}

test('missing, wrong-project, wrong-fence, wrong-version, and incomplete markers preserve coexistence writes', async () => {
  const unrecognizedMarkers = [
    'absent',
    { path: 'pulseMaterialCutovers/OTHER', data: { fence: 'legacy_bom_data_writes', version: 1 } },
    { path: 'pulseMaterialCutovers/P', data: { fence: 'different_fence', version: 1 } },
    { path: 'pulseMaterialCutovers/P', data: { fence: 'legacy_bom_data_writes', version: 2 } },
    { path: 'pulseMaterialCutovers/P', data: { fence: 'legacy_bom_data_writes' } },
    { path: 'pulseMaterialCutovers/P', data: { version: 1 } },
    { path: 'pulseMaterialCutovers/P', data: { fence: 12, version: '1' } },
  ];
  for (const [index, marker] of unrecognizedMarkers.entries()) {
    await seed(marker);
    const data = doc(actor().firestore(), 'projects/P/bom/data');
    await assertSucceeds(updateDoc(data, { categories: [{ name: 'Electrical', items: [{ id: `marker-${index}`, name: 'Fuse' }] }] }));
    await env.clearFirestore();
  }
});

test('an absent marker preserves legacy material create, update, and delete', async () => {
  await seed('absent');
  const data = doc(actor().firestore(), 'projects/P/bom/data');
  await assertSucceeds(updateDoc(data, { categories: [{ name: 'Electrical', items: [{ id: 'changed', name: 'Fuse' }] }] }));
  await assertSucceeds(deleteDoc(data));
  await assertSucceeds(setDoc(data, { categories: [] }));
});

test('exact per-project material fence denies direct member create, update, and delete', async () => {
  const exactMarker = { fence: 'legacy_bom_data_writes', version: 1 };
  await seed({ path: 'pulseMaterialCutovers/P', data: exactMarker }, { bom: false });
  const db = actor().firestore();
  await assertFails(setDoc(doc(db, 'projects/P/bom/data'), { categories: [] }));
  await seed({ path: 'pulseMaterialCutovers/P', data: exactMarker });
  const updatedDb = actor().firestore();
  await assertSucceeds(getDoc(doc(updatedDb, 'projects/P/bom/data')));
  await assertFails(updateDoc(doc(updatedDb, 'projects/P/bom/data'), { categories: [] }));
  await assertFails(deleteDoc(doc(updatedDb, 'projects/P/bom/data')));
  const clientAdminDb = actor('alice', { role: 'admin' }).firestore();
  await assertFails(updateDoc(doc(clientAdminDb, 'projects/P/bom/data'), { categories: [] }));

  const outsiderDb = actor('mallory').firestore();
  await assertFails(getDoc(doc(outsiderDb, 'projects/P/bom/data')));
  await assertFails(updateDoc(doc(outsiderDb, 'projects/P/bom/data'), { categories: [] }));

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P/purchaseOrders/sent'), {
      status: 'sent', sentAt: '2026-10-19', sentBy: 'admin', sentToEmail: 'vendor@example.com',
    });
  });
  await assertFails(updateDoc(doc(updatedDb, 'projects/P/purchaseOrders/sent'), { status: 'draft' }));
});

test('exact per-project material fence leaves other project subcollection writes available', async () => {
  await seed({ path: 'pulseMaterialCutovers/P', data: { fence: 'legacy_bom_data_writes', version: 1 } });
  const db = actor().firestore();
  await assertSucceeds(setDoc(doc(db, 'projects/P/bom/metadata'), { note: 'legacy settings remain writable' }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/order-1'), { status: 'draft' }));
});

test('Admin SDK style server writes bypass Firestore Rules while the per-project fence is enabled', async () => {
  await seed({ path: 'pulseMaterialCutovers/P', data: { fence: 'legacy_bom_data_writes', version: 1 } });
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P/bom/data'), { categories: [{ name: 'Electrical', items: [{ id: 'server', name: 'Fuse' }] }] });
  });
});
