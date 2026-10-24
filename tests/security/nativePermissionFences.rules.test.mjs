import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(emulator.hostname, '127.0.0.1');
let env;
const claims = { status: 'approved', role: 'viewer', email_verified: true };
const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra }).firestore();

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

for (const [name, material, support] of [
  ['neither marker', false, false],
  ['only the material marker', true, false],
  ['only the Support marker', false, true],
  ['both markers', true, true],
]) {
  test(`${name}: each fence retains its protection and project boundary`, async () => {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const projectId of ['P', 'Q']) {
        await setDoc(doc(db, `projects/${projectId}`), { memberIds: ['alice'] });
        await setDoc(doc(db, `projects/${projectId}/bom/data`), { categories: [] });
        await setDoc(doc(db, `projects/${projectId}/supportTickets/T`), { rootCause: 'Original', title: 'Ticket' });
      }
      if (material) {
        await setDoc(doc(db, 'pulseMaterialCutovers/P'), { fence: 'legacy_bom_data_writes', version: 1 });
      }
      if (support) {
        await setDoc(doc(db, 'pulseSupportCutovers/P'), { fence: 'legacy_support_resolution_writes', version: 1 });
      }
    });

    const db = actor();
    for (const subject of [db, actor('admin', { role: 'admin' })]) {
      await (material ? assertFails : assertSucceeds)(updateDoc(doc(subject, 'projects/P/bom/data'), { categories: [] }));
      await (support ? assertFails : assertSucceeds)(updateDoc(doc(subject, 'projects/P/supportTickets/T'), { rootCause: 'Changed' }));
      await (support ? assertFails : assertSucceeds)(setDoc(doc(subject, 'projects/P/supportTickets/T/activities/resolution-op'), {
        type: 'resolution', message: 'RCA and solution record updated',
      }));
      await assertFails(setDoc(doc(subject, 'projects/P/purchaseOrders/forged'), { status: 'sent', sentBy: 'alice' }));
      await assertFails(setDoc(doc(subject, 'pulseMaterialCutovers/P'), { fence: 'removed', version: 1 }));
      await assertFails(setDoc(doc(subject, 'pulseSupportCutovers/P'), { fence: 'removed', version: 1 }));
    }

    await assertSucceeds(updateDoc(doc(db, 'projects/Q/bom/data'), { categories: [] }));
    await assertSucceeds(updateDoc(doc(db, 'projects/Q/supportTickets/T'), { rootCause: 'Q unchanged by P markers' }));
    await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/draft'), { status: 'draft' }));
    await assertSucceeds(updateDoc(doc(db, 'projects/P/supportTickets/T'), { title: 'Ordinary edit' }));
    await assertSucceeds(setDoc(doc(db, 'projects/P/bom/data/metadata/M'), { value: 'Nested material metadata' }));
    await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/supportDocuments/D'), { name: 'report.pdf' }));
    await assertSucceeds(getDoc(doc(db, 'projects/P/bom/data')));
    await assertSucceeds(getDoc(doc(db, 'projects/P/supportTickets/T')));

    for (const denied of [actor('outsider'), actor('alice', { status: 'pending' })]) {
      await assertFails(getDoc(doc(denied, 'projects/P/bom/data')));
      await assertFails(getDoc(doc(denied, 'projects/P/supportTickets/T')));
      await assertFails(updateDoc(doc(denied, 'projects/P/supportTickets/T'), { title: 'Denied' }));
      await assertFails(setDoc(doc(denied, 'projects/P/purchaseOrders/outsider'), { status: 'draft' }));
    }
  });
}
