import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const projectId = 'demo-bom-native-security';
const claims = { email: 'alice@qualitastech.com', email_verified: true, status: 'approved', role: 'viewer' };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 18080,
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });

const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra });
async function seed(project = { memberIds: ['alice'], status: 'Ongoing', title: 'Qualitas website' }) {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'projects/P'), project));
}
async function setStatusFence(enabled) {
  await setRuntimeControl({ projectStatusClientWritesFenced: enabled });
}
async function setRuntimeControl(data) {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'pulseRuntimeControl/cutover'), data));
}

test('legacy project status changes remain available until the explicit runtime fence is enabled', async () => {
  await seed();
  const memberDb = actor().firestore();
  const archiveAt = Timestamp.fromMillis(1_800_000_000_000);
  await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { status: 'Archived', archivedAt: archiveAt }));
  await setRuntimeControl({ mode: 'coexist' });
  await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { status: 'Planning', archivedAt: null }));
  await setStatusFence(false);
  await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { status: 'Ongoing', archivedAt: null }));
  for (const value of ['true', 1]) {
    await setRuntimeControl({ mode: 'coexist', projectStatusClientWritesFenced: value });
    await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { status: 'Planning' }));
  }

  await setStatusFence(true);
  await assertFails(updateDoc(doc(memberDb, 'projects/P'), { status: 'Archived' }));
  await assertFails(updateDoc(doc(memberDb, 'projects/P'), { archivedAt: archiveAt }));
  await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { status: 'Planning', description: 'Same status is okay' }));
  await assertFails(setDoc(doc(memberDb, 'projects/P'), { memberIds: ['alice'], status: 'Archived', title: 'Overwrite' }));
});

test('members and admins retain ordinary project updates but cannot change archive fields', async () => {
  await setStatusFence(true);
  await seed();
  const memberDb = actor().firestore();
  await assertSucceeds(updateDoc(doc(memberDb, 'projects/P'), { description: 'Updated scope' }));
  await assertSucceeds(updateDoc(doc(actor('admin', { role: 'admin' }).firestore(), 'projects/P'), { title: 'Updated title' }));

  const archiveTime = Timestamp.fromMillis(1_800_000_000_000);
  for (const [db, changes] of [
    [memberDb, { status: 'Archived' }],
    [memberDb, { archivedAt: archiveTime }],
    [memberDb, { archivedAt: null }],
    [actor('admin', { role: 'admin' }).firestore(), { status: 'Planning' }],
    [actor('admin', { role: 'admin' }).firestore(), { archivedAt: archiveTime }],
  ]) {
    await assertFails(updateDoc(doc(db, 'projects/P'), changes));
  }
});

test('the archive-field fence preserves the existing project membership access rule', async () => {
  await setStatusFence(true);
  await seed({ memberIds: ['alice'], status: 'Ongoing' });
  await assertFails(updateDoc(doc(actor('bob').firestore(), 'projects/P'), { description: 'No access' }));
  await assertSucceeds(updateDoc(doc(actor('admin', { role: 'admin' }).firestore(), 'projects/P'), { description: 'Admin edit' }));
});

test('project subcollection access remains scoped to the existing project membership rule', async () => {
  await setStatusFence(true);
  await seed();
  const memberDb = actor().firestore();
  await assertSucceeds(setDoc(doc(memberDb, 'projects/P/bom/data'), { value: 'member write' }));
  await assertSucceeds(setDoc(doc(memberDb, 'projects/P/purchaseOrders/PO/items/item'), { value: 'deep member write' }));
  await assertFails(setDoc(doc(actor('bob').firestore(), 'projects/P/bom/other'), { value: 'non-member write' }));
  await assertSucceeds(setDoc(doc(actor('admin', { role: 'admin' }).firestore(), 'projects/P/bom/admin'), { value: 'admin write' }));

  await seed({ status: 'Ongoing', title: 'Legacy project without memberIds' });
  const legacyDb = actor('bob').firestore();
  await assertSucceeds(getDoc(doc(legacyDb, 'projects/P')));
  await assertSucceeds(updateDoc(doc(legacyDb, 'projects/P'), { description: 'migration fallback' }));
  await assertSucceeds(setDoc(doc(legacyDb, 'projects/P/bom/legacy'), { value: 'migration fallback' }));
});

test('setting archive fields on a legacy project without them is denied', async () => {
  await setStatusFence(true);
  await seed({ memberIds: ['alice'], title: 'Legacy project' });
  await assertFails(updateDoc(doc(actor().firestore(), 'projects/P'), { status: 'Archived', archivedAt: Timestamp.fromMillis(1_800_000_000_000) }));
  await assertSucceeds(updateDoc(doc(actor().firestore(), 'projects/P'), { description: 'Legacy edit' }));
});
