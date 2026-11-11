import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-bom-native-security', firestore: { host: '127.0.0.1', port: 18080, rules: await readFile(new URL('../../firestore.read-signals.rules', import.meta.url), 'utf8') } }); });
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/P'), { memberIds: ['alice'], projectName: 'Original' });
    await setDoc(doc(db, 'projects/P/purchaseOrders/draft'), { projectId: 'P', status: 'draft', paymentTerms: 'Original' });
    await setDoc(doc(db, 'projects/P/purchaseOrders/sent'), { projectId: 'P', status: 'sent', sentAt: 'preserved' });
    await setDoc(doc(db, 'billingEntities/B'), { legalName: 'Original', nextPoNumber: 10 });
    await setDoc(doc(db, 'settings/company'), { companyName: 'Original', nextPoNumber: 7 });
    // Source business fences are deliberately NOT activated by this candidate.
    await setDoc(doc(db, 'pulseRuntimeControl/cutover'), { poClientWritesFenced: true, poCounterClientWritesFenced: true, billingEntityClientWritesFenced: true });
  });
});
const client = (uid = 'alice', role = 'viewer', status = 'approved') => env.authenticatedContext(uid, { role, status }).firestore();
test('existing root membership and project SDK behavior is preserved rather than deploying the newer business fences', async () => {
  const db = client();
  await assertSucceeds(updateDoc(doc(db, 'projects/P'), { projectName: 'Existing edit', memberIds: ['alice', 'bob'] }));
  await assertFails(getDoc(doc(client('outsider'), 'projects/P/purchaseOrders/draft')));
  await assertSucceeds(getDoc(doc(client('admin', 'admin'), 'projects/P/purchaseOrders/draft')));
});
test('Billing admin writes and the broader original company Settings policy are unchanged', async () => {
  const admin = client('admin', 'admin');
  await assertSucceeds(updateDoc(doc(admin, 'billingEntities/B'), { legalName: 'Existing edit', nextPoNumber: 11 }));
  await assertSucceeds(deleteDoc(doc(admin, 'billingEntities/B')));
  await assertSucceeds(setDoc(doc(admin, 'billingEntities/new'), { legalName: 'Existing add', nextPoNumber: 1 }));
  await assertFails(updateDoc(doc(client(), 'billingEntities/new'), { legalName: 'Not allowed' }));
  await assertSucceeds(updateDoc(doc(client('pending', 'viewer', 'pending'), 'settings/company'), { phone: 'Existing policy', nextPoNumber: 8 }));
});
test('existing draft PO writes stay available and original sent-state protections stay enforced', async () => {
  const db = client();
  await assertSucceeds(updateDoc(doc(db, 'projects/P/purchaseOrders/draft'), { paymentTerms: 'Existing edit' }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/new'), { projectId: 'P', status: 'draft' }));
  await assertSucceeds(deleteDoc(doc(db, 'projects/P/purchaseOrders/new')));
  await assertFails(updateDoc(doc(db, 'projects/P/purchaseOrders/draft'), { status: 'sent' }));
  await assertFails(updateDoc(doc(db, 'projects/P/purchaseOrders/sent'), { status: 'draft' }));
  await assertFails(deleteDoc(doc(db, 'projects/P/purchaseOrders/sent')));
});
test('private rollout controls and native journals do not gain a client grant', async () => {
  for (const path of ['pulseRuntimeControl/cutover', 'pulseBillingEntityAudit/a', 'pulseBillingEntityOperations/a', 'pulseDeletedBillingEntities/a', 'pulseProcurementOperations/P/attempts/a']) {
    await assertFails(getDoc(doc(client('admin', 'admin'), path)));
    await assertFails(setDoc(doc(client('admin', 'admin'), path), { forged: true }));
  }
});
