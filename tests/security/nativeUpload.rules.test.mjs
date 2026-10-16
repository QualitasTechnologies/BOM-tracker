import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { deleteObject, getBytes, ref, updateMetadata, uploadBytes } from 'firebase/storage';

const projectId = 'demo-bom-native-security';
// Refuse production or any external host, even if a developer has credentials configured.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080', 'Start the isolated Firestore emulator');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:19199', 'Start the isolated Storage emulator');
let env, sequence = 0;
const jpeg = new Uint8Array([255, 216, 255, 1, 255, 217]);
const claims = { email: 'alice@qualitastech.com', email_verified: true, status: 'approved', role: 'viewer' };
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 18080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 19199, rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });
const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra });
async function seed({ project = { memberIds: ['alice'] }, intent = {}, user = claims } = {}) {
  const fileName = `${(++sequence).toString(16).padStart(64, '0')}.jpg`;
  const path = `projects/P/received-photos/native/${fileName}`;
  const uploadIntent = { actor_uid: 'alice', actor_email: user.email, project_id: 'P', item_id: 'bolt', category: 'Parts', member_index: -1,
    path, state: 'reserved', byte_size: jpeg.byteLength, expires_at: Timestamp.fromMillis(Date.now() + 900000), ...intent };
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P'), project);
    await setDoc(doc(context.firestore(), `pulseNativeUploadIntents/${fileName}`), uploadIntent);
  });
  return { path, fileName, upload: (context = actor(), bytes = jpeg, contentType = 'image/jpeg') => uploadBytes(ref(context.storage(), path), bytes, { contentType }) };
}
async function serverWrite(path, data) {
  return env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), data, { merge: true }));
}

test('an approved internal viewer can create native proof with the current project intent', async () => {
  const f = await seed(); await assertSucceeds(f.upload());
});
test('admin upload does not require membership or a partner category row', async () => {
  const f = await seed({ project: { memberIds: [] } }); await assertSucceeds(f.upload(actor('alice', { role: 'admin' })));
});
test('external users require the current declared category and member index', async () => {
  const user = { ...claims, email: 'alice@vendor.example' };
  const f = await seed({ user, project: { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Parts'] }] }, intent: { member_index: 0 } });
  await assertSucceeds(f.upload(actor('alice', user)));
  const g = await seed({ user, project: { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Other'] }] }, intent: { member_index: 0 } });
  await assertFails(g.upload(actor('alice', user)));
  const reordered = await seed({ user, project: { memberIds: ['alice'], members: [{ userId: 'bob', categoryScope: ['Parts'] }, { userId: 'alice', categoryScope: ['Parts'] }] }, intent: { member_index: 0 } });
  await assertFails(reordered.upload(actor('alice', user)));
});
test('missing intent, different actor, unapproved and unverified identities cannot upload', async () => {
  const f = await seed();
  await assertFails(uploadBytes(ref(actor().storage(), f.path.replace(f.fileName, `${'f'.repeat(64)}.jpg`)), jpeg, { contentType: 'image/jpeg' }));
  for (const context of [env.unauthenticatedContext(), actor('bob'), actor('alice', { email: 'different@qualitastech.com' }), actor('alice', { status: 'pending' }), actor('alice', { email_verified: false })]) await assertFails(f.upload(context));
});
test('wrong path, expired intent, size and content type cannot create proof', async () => {
  const expired = await seed({ intent: { expires_at: Timestamp.fromMillis(Date.now() - 60000) } }); await assertFails(expired.upload());
  const f = await seed(); await assertFails(f.upload(actor(), jpeg, 'image/png')); await assertFails(f.upload(actor(), jpeg.slice(1)));
  await assertFails(uploadBytes(ref(actor().storage(), f.path.replace('projects/P/', 'projects/Q/')), jpeg, { contentType: 'image/jpeg' }));
});
test('legacy grants cannot overwrite, edit metadata or delete a reserved native path', async () => {
  const f = await seed(); await assertSucceeds(f.upload());
  await assertFails(f.upload());
  await assertFails(updateMetadata(ref(actor().storage(), f.path), { customMetadata: { changed: 'true' } }));
  await assertFails(deleteObject(ref(actor().storage(), f.path)));
});
test('membership removal and read-only or unknown control modes deny new uploads', async () => {
  const f = await seed(); await serverWrite('projects/P', { memberIds: [] }); await assertFails(f.upload());
  await serverWrite('projects/P', { memberIds: ['alice'] });
  for (const mode of ['read_only', 'unknown']) { await serverWrite('pulseRuntimeControl/cutover', { mode }); await assertFails(f.upload()); }
  await serverWrite('pulseRuntimeControl/cutover', { mode: 'pulse_only' }); await assertSucceeds(f.upload());
});
test('proof becomes readable only after server confirmation, and remains immutable', async () => {
  const f = await seed(); await assertSucceeds(f.upload()); await assertFails(getBytes(ref(actor().storage(), f.path)));
  await serverWrite(`pulseNativeUploadIntents/${f.fileName}`, { state: 'finalized' });
  assert.deepEqual(new Uint8Array(await assertSucceeds(getBytes(ref(actor().storage(), f.path)))), jpeg);
  await assertFails(f.upload()); await assertFails(deleteObject(ref(actor().storage(), f.path)));
});
test('even client admins cannot forge protected intent, receipts, audit or cutover controls', async () => {
  const client = actor('alice', { role: 'admin' }).firestore();
  for (const path of ['pulseNativeUploadIntents/forged', 'pulseNativeUploadOperations/P/receipts/forged', 'pulseNativeUploadOperations/P/audit/forged', 'pulsePOAuthoringOperations/P/receipts/forged', 'pulsePOAuthoringOperations/P/audit/forged', 'pulseDeletedPurchaseOrders/P/purchaseOrders/existing', 'pulsePOApprovalNotifications/forged','pulsePOApprovalNotificationDeliveries/forged','pulsePOApprovalNotificationAudit/forged/events/forged','pulsePOApprovalNotificationOperations/forged','pulsePOApprovalNotificationReconciliations/forged', 'pulseOverheadOperations/P/receipts/forged','pulseOverheadOperations/P/audit/forged','pulseDeletedOverheads/P/records/visit-forged','pulseExpenseApprovalNotifications/forged','pulseExpenseApprovalNotificationDeliveries/forged','pulseExpenseApprovalNotificationAudit/forged/events/forged','pulseMilestoneOperations/P/receipts/forged','pulseMilestoneOperations/P/audit/forged','pulseMilestoneOperations/P/state/revision','pulseDeletedMilestones/P/milestones/forged','pulseRuntimeControl/cutover', 'pulseProjectMaterialOperations/P/materialAudit/forged', 'pulseMcpOperations/P/receipts/forged']) {
    await assertFails(setDoc(doc(client, path), { fake: true })); await assertFails(getDoc(doc(client, path)));
  }
});
test('coexistence retains the original single-filename legacy photo grant', async () => {
  const path = `projects/P/received-photos/legacy-${++sequence}.jpg`;
  await assertSucceeds(uploadBytes(ref(actor().storage(), path), jpeg, { contentType: 'image/jpeg' }));
  await assertSucceeds(deleteObject(ref(actor().storage(), path)));
});
