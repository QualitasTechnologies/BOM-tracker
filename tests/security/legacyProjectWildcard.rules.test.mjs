import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';

const host = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(host.hostname, '127.0.0.1');
const environments = [];
after(async () => {
  for (const env of environments) await env.cleanup();
});

// Characterize the deployed September baseline, not a hand-written imitation.
const baseline = execFileSync('git', ['show', 'e36b18b:firestore.rules'], {
  cwd: new URL('../../', import.meta.url), encoding: 'utf8',
});

for (const [label, rules, protectedParent] of [
  ['deployed September rules', baseline, false],
  ['current source rules', await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'), true],
]) {
  test(`${label}: recursive wildcard parent permissions are explicitly characterized`, async () => {
    const env = await initializeTestEnvironment({
      projectId: 'demo-bom-native-security',
      firestore: { host: host.hostname, port: Number(host.port), rules },
    });
    environments.push(env);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'projects/P'), {
        memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Mech'] }],
      });
    });
    const db = env.authenticatedContext('alice', { status: 'approved', role: 'viewer' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'projects/P/emails/example'), { subject: 'Synthetic' }));
    await assertSucceeds(updateDoc(doc(db, 'projects/P'), { projectName: 'Synthetic rename' }));
    const check = protectedParent ? assertFails : assertSucceeds;
    await check(updateDoc(doc(db, 'projects/P'), { memberIds: ['alice', 'bob'] }));
    await check(deleteDoc(doc(db, 'projects/P')));
  });
}
