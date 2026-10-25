import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';

const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(emulator.hostname, '127.0.0.1');
let env;
const memberClaims = { email: 'alice@partner.example', email_verified: true, status: 'approved', role: 'viewer' };
const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...memberClaims, ...extra });

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

async function seedProject(memberIds = ['alice']) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P'), {
      projectName: 'Scoped project',
      memberIds,
      members: [{ userId: 'alice', categoryScope: ['Mech'] }],
    });
  });
}

test('non-admin members cannot grant themselves broader categories or change project membership', async () => {
  await seedProject();
  const db = actor().firestore();
  const project = doc(db, 'projects/P');

  await assertFails(updateDoc(project, {
    members: [{ userId: 'alice', categoryScope: ['Mech', 'Electrical'] }],
  }));
  await assertFails(updateDoc(project, { memberIds: ['alice', 'bob'] }));
  await assertFails(updateDoc(project, { memberIds: ['bob'] }));
});

test('non-admin members can still update ordinary project fields', async () => {
  await seedProject();
  await assertSucceeds(updateDoc(doc(actor().firestore(), 'projects/P'), { projectName: 'Updated name' }));
});

test('approved project admins retain membership and category-scope management', async () => {
  await seedProject();
  const db = actor('admin', { role: 'admin' }).firestore();
  await assertSucceeds(updateDoc(doc(db, 'projects/P'), {
    memberIds: ['alice', 'bob'],
    members: [
      { userId: 'alice', categoryScope: ['Mech'] },
      { userId: 'bob', categoryScope: ['Electrical'] },
    ],
  }));
});

test('explicit-null legacy projects still cannot be self-expanded by non-admins', async () => {
  await seedProject(null);
  await assertFails(updateDoc(doc(actor().firestore(), 'projects/P'), {
    memberIds: ['alice'],
    members: [{ userId: 'alice', categoryScope: ['Mech', 'Electrical'] }],
  }));
});

test('notification audit receipts are not directly readable or writable by Firebase clients', async () => {
  await seedProject();
  const client = actor('alice').firestore();
  const receipt = doc(client, 'pulseProjectMemberNotificationOperations/P/events/op-1');
  await assertFails(setDoc(receipt, { actor_uid: 'alice', before: true, after: false }));
  await assertFails(getDoc(receipt));
});


test('absent and malformed membership data cannot grant ordinary non-admin project edits', async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'projects/P'), { memberIds: deleteField() }));
  await assertFails(updateDoc(doc(actor().firestore(), 'projects/P'), { projectName: 'Denied' }));
  await seedProject('alice-other');
  await assertFails(updateDoc(doc(actor().firestore(), 'projects/P'), { projectName: 'Denied' }));
});

test('membership, lifecycle, materials, Support and PO protections compose without overlapping grants', async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, 'projects/P'), { status: 'Ongoing' });
    await setDoc(doc(db, 'pulseRuntimeControl/cutover'), { mode: 'coexist', projectStatusClientWritesFenced: true });
    await setDoc(doc(db, 'pulseMaterialCutovers/P'), { fence: 'legacy_bom_data_writes', version: 1 });
    await setDoc(doc(db, 'pulseSupportCutovers/P'), { fence: 'legacy_support_resolution_writes', version: 1 });
    await setDoc(doc(db, 'projects/P/bom/data'), { categories: [] });
    await setDoc(doc(db, 'projects/P/supportTickets/T'), { rootCause: 'Original', title: 'Ticket' });
  });
  const db = actor().firestore();
  await assertFails(updateDoc(doc(db, 'projects/P'), { members: [{ userId: 'alice', categoryScope: ['All'] }] }));
  for (const subject of [db, actor('admin', { role: 'admin' }).firestore()]) {
    await assertFails(updateDoc(doc(subject, 'projects/P'), { status: 'Archived' }));
    await assertFails(updateDoc(doc(subject, 'projects/P/bom/data'), { categories: [] }));
    await assertFails(updateDoc(doc(subject, 'projects/P/supportTickets/T'), { rootCause: 'Changed' }));
    await assertFails(setDoc(doc(subject, 'projects/P/purchaseOrders/sent'), { status: 'sent' }));
  }
  await assertSucceeds(updateDoc(doc(db, 'projects/P'), { projectName: 'Ordinary change' }));
  await assertSucceeds(updateDoc(doc(db, 'projects/P/supportTickets/T'), { title: 'Ordinary title' }));
});
