import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const projectId = 'demo-bom-native-security';
let env;

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });

const ticket = { title: 'Synthetic test ticket', createdBy: 'alice' };
async function seedProject(projectData) {
  await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'projects/P'), { projectId: 'P', ...projectData }));
}
const writeTicket = uid => setDoc(doc(env.authenticatedContext(uid, { status: 'approved', role: 'viewer' }).firestore(), 'projects/P/supportTickets/test'), ticket);

test('actual rules allow approved project member ticket and activity writes, with no category scope', async () => {
  await seedProject({ memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: [] }] });
  const db = env.authenticatedContext('alice', { status: 'approved', role: 'viewer' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/test'), ticket));
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/test/activities/created'), { type: 'created', createdBy: 'alice' }));
});

test('actual rules accept explicit null memberIds and reveal whether a missing memberIds field receives the legacy fallback', async () => {
  await seedProject({ memberIds: null });
  await assertSucceeds(writeTicket('outsider'));
  await env.clearFirestore();
  await seedProject({});
  const result = await writeTicket('outsider').then(() => 'allowed', () => 'denied');
  assert.equal(result, 'allowed', 'checked-in rules describe missing memberIds as a legacy null fallback');
});

test('actual rules reject a nonmember and an unapproved member', async () => {
  await seedProject({ memberIds: ['bob'] });
  await assertFails(writeTicket('alice'));
  const db = env.authenticatedContext('bob', { status: 'pending', role: 'user' }).firestore();
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/test'), ticket));
});
