import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

// The real server-side body builder, so the rules are exercised with exact production bytes.
const { signalBody, SIGNAL_COLLECTIONS } = createRequire(import.meta.url)('../../functions/projectReadSignals.cjs');

const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(emulator.hostname, '127.0.0.1');
let env;
const claims = { email: 'user@partner.example', email_verified: true, status: 'approved', role: 'viewer' };
const as = (uid, extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra }).firestore();
const admin = () => as('admin-1', { role: 'admin' });
const rulesText = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bom-native-security',
    firestore: { host: emulator.hostname, port: Number(emulator.port), rules: rulesText },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/MEMBER'), { projectName: 'Synthetic', memberIds: ['alice'] });
    await setDoc(doc(db, 'projects/LEGACY_NULL'), { projectName: 'Legacy', memberIds: null });
    await setDoc(doc(db, 'projects/NO_MEMBERS'), { projectName: 'No field' });
    for (const id of ['MEMBER', 'LEGACY_NULL', 'NO_MEMBERS']) await setDoc(doc(db, `pulseReadSignals/${id}`), signalBody());
    for (const id of ['alice', 'bob', 'admin-1']) await setDoc(doc(db, `pulseUserReadSignals/${id}`), signalBody());
    await setDoc(doc(db, 'pulseReadCatalog/admin'), signalBody());
  });
});
after(async () => env.cleanup());

const signal = (db, id) => doc(db, `pulseReadSignals/${id}`);
const readable = async ref => { try { await getDoc(ref); return true; } catch { return false; } };

test('current project readers can fetch the project notice; strangers and unauthenticated clients cannot', async () => {
  await assertSucceeds(getDoc(signal(as('alice'), 'MEMBER')));
  await assertSucceeds(getDoc(signal(admin(), 'MEMBER')));
  await assertFails(getDoc(signal(as('bob'), 'MEMBER')));
  await assertFails(getDoc(signal(env.unauthenticatedContext().firestore(), 'MEMBER')));
  // A notice for a project that does not exist grants a non-admin nothing.
  await assertFails(getDoc(signal(as('alice'), 'NEVER_CREATED')));
});

test('explicit-null legacy projects keep the single-project fallback; an absent membership field denies non-admins', async () => {
  await assertSucceeds(getDoc(signal(as('bob'), 'LEGACY_NULL')));
  await assertFails(getDoc(signal(as('bob'), 'NO_MEMBERS')));
  await assertFails(getDoc(signal(as('alice'), 'NO_MEMBERS')));
  await assertSucceeds(getDoc(signal(admin(), 'NO_MEMBERS')));
  await assertFails(getDoc(signal(env.unauthenticatedContext().firestore(), 'LEGACY_NULL')));
});

test('notice reads follow the project root rule for every stored membership shape', async () => {
  const shapes = { list_has: ['alice'], list_lacks: ['carol'], empty: [], nul: null, map_key: { alice: true }, map_other: { carol: true }, text: 'alice', number: 7 };
  await env.withSecurityRulesDisabled(async context => {
    for (const [name, memberIds] of Object.entries(shapes)) {
      await setDoc(doc(context.firestore(), `projects/SHAPE_${name}`), { memberIds });
      await setDoc(doc(context.firestore(), `pulseReadSignals/SHAPE_${name}`), signalBody());
    }
  });
  for (const uid of ['alice', 'bob']) {
    const db = as(uid);
    for (const name of Object.keys(shapes)) {
      assert.equal(await readable(signal(db, `SHAPE_${name}`)), await readable(doc(db, `projects/SHAPE_${name}`)), `${uid} ${name}`);
    }
  }
});

test('revoked membership, unapproved, disabled or claim-less identities lose the notice', async () => {
  await assertSucceeds(getDoc(signal(as('alice'), 'MEMBER')));
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'projects/MEMBER'), { memberIds: ['someone-else'] }));
  await assertFails(getDoc(signal(as('alice'), 'MEMBER')));
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'projects/MEMBER'), { memberIds: ['alice'] }));
  for (const status of ['pending', 'disabled', 'rejected', 'APPROVED', undefined]) {
    await assertFails(getDoc(signal(as('alice', { status }), 'MEMBER')));
    await assertFails(getDoc(signal(as('bob', { status }), 'LEGACY_NULL')));
    await assertFails(getDoc(signal(as('admin-1', { role: 'admin', status }), 'MEMBER')));
  }
  await assertFails(getDoc(signal(env.authenticatedContext('alice', {}).firestore(), 'MEMBER')));
});

test('a user may read only their own approved user notice', async () => {
  await assertSucceeds(getDoc(doc(as('alice'), 'pulseUserReadSignals/alice')));
  await assertFails(getDoc(doc(as('alice'), 'pulseUserReadSignals/bob')));
  await assertFails(getDoc(doc(admin(), 'pulseUserReadSignals/alice')), 'admins do not read other users notices');
  await assertSucceeds(getDoc(doc(admin(), 'pulseUserReadSignals/admin-1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'pulseUserReadSignals/alice')));
  for (const status of ['pending', 'disabled', undefined]) await assertFails(getDoc(doc(as('alice', { status }), 'pulseUserReadSignals/alice')));
});

test('only an approved admin may read the catalog notice', async () => {
  await assertSucceeds(getDoc(doc(admin(), 'pulseReadCatalog/admin')));
  await assertFails(getDoc(doc(as('alice'), 'pulseReadCatalog/admin')));
  await assertFails(getDoc(doc(as('alice', { role: 'internal' }), 'pulseReadCatalog/admin')));
  await assertFails(getDoc(doc(as('admin-1', { role: 'admin', status: 'pending' }), 'pulseReadCatalog/admin')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'pulseReadCatalog/admin')));
  await assertFails(getDoc(doc(admin(), 'pulseReadCatalog/other')), 'only the exact catalog document is defined');
});

test('collections cannot be listed by anyone, including admins, and nested paths are not granted', async () => {
  for (const name of Object.values(SIGNAL_COLLECTIONS)) {
    await assertFails(getDocs(collection(admin(), name)));
    await assertFails(getDocs(collection(as('alice'), name)));
  }
  await assertFails(getDoc(doc(as('alice'), 'pulseReadSignals/MEMBER/children/x')));
  await assertFails(getDoc(doc(admin(), 'pulseUserReadSignals/alice/children/x')));
});

test('every SDK write to every notice path is denied for every actor, existing or new', async () => {
  const targets = [
    ['pulseReadSignals/MEMBER', ['alice', 'admin-1']],
    ['pulseReadSignals/BRAND_NEW', ['alice', 'admin-1']],
    ['pulseUserReadSignals/alice', ['alice', 'admin-1']],
    ['pulseUserReadSignals/brand-new', ['brand-new', 'admin-1']],
    ['pulseReadCatalog/admin', ['alice', 'admin-1']],
    ['pulseReadCatalog/other', ['admin-1']],
  ];
  for (const [path, uids] of targets) {
    for (const uid of uids) {
      const db = uid === 'admin-1' ? admin() : as(uid);
      await assertFails(setDoc(doc(db, path), signalBody()));
      await assertFails(setDoc(doc(db, path), signalBody(), { merge: true }));
      await assertFails(updateDoc(doc(db, path), { nonce: 'forged-value-1234567890' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), path), signalBody()));
  }
  // Nothing changed.
  await env.withSecurityRulesDisabled(async context => {
    const snapshot = await getDoc(doc(context.firestore(), 'pulseReadSignals/MEMBER'));
    assert.deepEqual(Object.keys(snapshot.data()), ['version', 'nonce']);
    assert.equal((await getDoc(doc(context.firestore(), 'pulseReadSignals/BRAND_NEW'))).exists(), false);
  });
});

test('stored notice bytes are exactly the content-free body and nothing else', async () => {
  await env.withSecurityRulesDisabled(async context => {
    for (const path of ['pulseReadSignals/MEMBER', 'pulseUserReadSignals/alice', 'pulseReadCatalog/admin']) {
      const data = (await getDoc(doc(context.firestore(), path))).data();
      assert.deepEqual(Object.keys(data), ['version', 'nonce']);
      assert.equal(data.version, 1);
      assert.match(data.nonce, /^[A-Za-z0-9_-]{22,64}$/);
      const bytes = JSON.stringify(data);
      for (const leak of ['Synthetic', 'Legacy', 'alice', 'MEMBER', '@', 'http', 'categories']) assert.ok(!bytes.includes(leak), `${path} leaked ${leak}`);
    }
  });
});

test('existing project reads and writes are unchanged by the notice rules', async () => {
  await assertSucceeds(getDoc(doc(as('alice'), 'projects/MEMBER')));
  await assertFails(getDoc(doc(as('bob'), 'projects/MEMBER')));
  await assertSucceeds(updateDoc(doc(as('alice'), 'projects/MEMBER'), { projectName: 'Renamed' }));
  await assertFails(updateDoc(doc(as('alice'), 'projects/MEMBER'), { memberIds: ['alice', 'bob'] }));
  await assertSucceeds(getDoc(doc(as('alice'), 'projects/MEMBER/bom/data')));
});

test('the rules define each notice path exactly once and add no overlapping or root wildcard grant', () => {
  for (const name of ['pulseReadSignals', 'pulseUserReadSignals', 'pulseReadCatalog']) {
    assert.equal([...rulesText.matchAll(new RegExp(`match /${name}/`, 'g'))].length, 1, name);
  }
  // Top-level matches sit at four-space indentation inside /databases/{database}/documents.
  const matches = [...rulesText.matchAll(/^ {4}match\s+(\S+)\s*\{/gm)].map(match => match[1]);
  assert.ok(matches.includes('/projects/{projectId}') && matches.length > 10, 'top-level matches discovered');
  // No database-wide wildcard that could OR-in access to the notice collections.
  assert.deepEqual(matches.filter(pattern => /^\/\{[^}]+\}(\/|$)/.test(pattern)), []);
  assert.ok(!matches.some(pattern => /^\/pulse(ReadSignals|UserReadSignals|ReadCatalog)\/.*=\*\*\}/.test(pattern)));
  // Every other top-level collection matched by name is a distinct collection.
  assert.equal(new Set(matches.map(pattern => pattern.split('/')[1])).size, matches.length, 'one match per top-level collection');
  const block = rulesText.slice(rulesText.indexOf('match /pulseReadSignals/'), rulesText.indexOf('match /clients/'));
  assert.equal(block.match(/allow\s+[^:]*\bwrite\b[^:]*:\s*if\s+false/g)?.length, 3, 'explicit write denial on every notice path');
  assert.ok(!/allow\s+(read|get|list)[^:]*:\s*if\s+true/.test(block));
});
