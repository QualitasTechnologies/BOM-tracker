import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';

const host = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(host.hostname, '127.0.0.1');
const environments = [];
after(async () => {
  for (const env of environments) await env.cleanup();
});

// Characterization only: this pins what the Firestore Rules do for
// projects/P/overheads/data (served by the recursive project-collection grant).
// It deliberately makes no claim about which UI roles ought to see overheads.
const sources = [
  ['firestore.legacy-po.rules', await readFile(new URL('../../firestore.legacy-po.rules', import.meta.url), 'utf8')],
  ['firestore.rules', await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8')],
];

const claims = { status: 'approved', role: 'viewer' };
// Rules ignore email domain; the two synthetic actors only label the internal/external cases.
const internal = { ...claims, email: 'internal-user@internal.example', email_verified: true };
const external = { ...claims, email: 'external-user@partner.example', email_verified: true };
const admin = { status: 'approved', role: 'admin', email: 'admin@internal.example', email_verified: true };

const membershipCases = [
  // [label, project fields, internal/external member expected to succeed]
  ['absent memberIds', {}, false],
  ['explicit null memberIds', { memberIds: null }, true],
  ['matching member array', { memberIds: ['internal-user', 'external-user'] }, true],
  ['outsider-only member array', { memberIds: ['someone-else'] }, false],
];

for (const [ruleName, rules] of sources) {
  test(`${ruleName}: overheads/data follows project memberIds`, async () => {
    const env = await initializeTestEnvironment({
      projectId: 'demo-bom-native-security',
      firestore: { host: host.hostname, port: Number(host.port), rules },
    });
    environments.push(env);
    try {
      for (const [label, project, memberAllowed] of membershipCases) {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
          const db = context.firestore();
          await setDoc(doc(db, 'projects/P'), { projectName: 'Synthetic', ...project });
          await setDoc(doc(db, 'projects/P/overheads/data'), { items: [], synthetic: true });
        });
        const expectMember = memberAllowed ? assertSucceeds : assertFails;
        for (const [actorLabel, uid, token] of [['internal', 'internal-user', internal], ['external', 'external-user', external]]) {
          const db = env.authenticatedContext(uid, token).firestore();
          const ref = doc(db, 'projects/P/overheads/data');
          await expectMember(getDoc(ref)).catch(error => { error.message = `${ruleName} ${label} ${actorLabel} read: ${error.message}`; throw error; });
          await expectMember(setDoc(ref, { items: [], note: actorLabel })).catch(error => { error.message = `${ruleName} ${label} ${actorLabel} write: ${error.message}`; throw error; });
        }
        // Unlisted approved user: allowed only through the explicit-null fallback.
        const outsider = env.authenticatedContext('outsider', { ...external, email: 'outsider@partner.example' }).firestore();
        const outsiderRef = doc(outsider, 'projects/P/overheads/data');
        const expectOutsider = project.memberIds === null ? assertSucceeds : assertFails;
        await expectOutsider(getDoc(outsiderRef));
        await expectOutsider(setDoc(outsiderRef, { items: [], note: 'outsider' }));
        // Admin bypass is preserved for every membership shape.
        const adminRef = doc(env.authenticatedContext('admin', admin).firestore(), 'projects/P/overheads/data');
        await assertSucceeds(getDoc(adminRef));
        await assertSucceeds(setDoc(adminRef, { items: [], note: 'admin' }));
      }
      // Field removed after creation behaves like absent, not like null.
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'projects/P'), { projectName: 'Synthetic', memberIds: ['internal-user'] });
        await setDoc(doc(db, 'projects/P'), { memberIds: deleteField() }, { merge: true });
        await setDoc(doc(db, 'projects/P/overheads/data'), { items: [] });
      });
      const db = env.authenticatedContext('internal-user', internal).firestore();
      await assertFails(getDoc(doc(db, 'projects/P/overheads/data')));
    } finally {
      await env.clearFirestore();
    }
  });
}
