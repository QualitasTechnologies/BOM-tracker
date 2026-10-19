import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

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

test('legacy projects without memberIds still cannot be self-expanded by non-admins', async () => {
  await seedProject(null);
  await assertFails(updateDoc(doc(actor().firestore(), 'projects/P'), {
    memberIds: ['alice'],
    members: [{ userId: 'alice', categoryScope: ['Mech', 'Electrical'] }],
  }));
});
