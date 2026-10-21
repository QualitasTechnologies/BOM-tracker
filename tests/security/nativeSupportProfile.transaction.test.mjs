import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const projectId = 'demo-bom-native-security';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue, Timestamp, GeoPoint } = require('@google-cloud/firestore');
const { createNativeProjectOperations } = require('./nativeProjectOperations.cjs');
let env, db, handler;
const actor = { uid: 'partner', email: 'partner@example.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } };
const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => actor };
const request = data => ({ auth: { uid: actor.uid }, rawRequest: { get: () => 'Bearer synthetic-demo-only' }, data: { project_id: 'P', expected_actor_uid: actor.uid, ...data } });
const read = () => handler(request({ operation: 'support_get' }));
const save = (version, extra = {}) => request({ operation: 'command', expected_version: version, operation_id: 'support-one', command: { kind: 'support_profile', patch: { internalNotes: 'Inspected' }, machines: [{ kind: 'patch', id: 'm', patch: { notes: 'Done' } }] }, ...extra });
const create = source => createNativeProjectOperations({ db: source, auth, enabled: true, supportProfileEnabled: true, getServerTimestamp: () => FieldValue.serverTimestamp() });
const assertRaw = raw => {
  assert.ok(raw.at instanceof Timestamp); assert.equal(raw.at.seconds, 12); assert.equal(raw.at.nanoseconds, 34000);
  assert.equal(raw.ref.path, 'legacy/kept'); assert.ok(raw.point instanceof GeoPoint);
  assert.deepEqual(raw.bytes, Buffer.from([1, 2]));
};

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
beforeEach(async () => {
  await env.clearFirestore();
  // Firestore stores timestamps at microsecond precision. Verify the persisted
  // opening first so storage normalization cannot be mistaken for a merge loss.
  const raw = { at: new Timestamp(12, 34000), ref: db.doc('legacy/kept'), point: new GeoPoint(12, 34), bytes: Buffer.from([1, 2]) };
  await db.doc('projects/P').set({ projectId: 'P', memberIds: ['partner'], bomSnapshot: [{ cost: 90, raw }], unknownRoot: raw,
    supportProfile: { retained: raw, internalNotes: 'Old', supportContacts: [{ name: 'Old', raw }], machines: [{ id: 'm', name: 'Line', serialNumber: 'S', raw }] } });
  handler = create(db);
  assertRaw((await db.doc('projects/P').get()).data().supportProfile.retained);
});
after(async () => { await db?.terminate(); await env?.cleanup(); });

test('concurrent Support retries preserve actual SDK values and commit one raw audit and receipt', async () => {
  const opening = await read(); assert.equal(opening.ok, true); assert.equal(opening.support_profile.retained, undefined);
  const payload = save(opening.version), [a, b] = await Promise.all([handler(payload), handler(payload)]);
  assert.equal(a.ok, true); assert.deepEqual(a, b);
  const project = (await db.doc('projects/P').get()).data();
  assertRaw(project.unknownRoot); assertRaw(project.supportProfile.retained); assertRaw(project.supportProfile.machines[0].raw);
  assertRaw(project.supportProfile.supportContacts[0].raw); assertRaw(project.bomSnapshot[0].raw);
  assert.equal(project.supportProfile.internalNotes, 'Inspected'); assert.equal(project.supportProfile.machines[0].notes, 'Done');
  assert.equal((await db.collection('pulseProjectOperations/P/receipts').get()).size, 1);
  const audits = await db.collection('pulseProjectOperations/P/audit').get(); assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].data().expected_version, opening.version);
  assertRaw(audits.docs[0].data().changes.supportProfile.before.value.retained);
  assertRaw(audits.docs[0].data().changes.supportProfile.after.value.machines[0].raw);
});

test('competing Support drafts cannot silently rebase and a lost reply resolves the original receipt', async () => {
  const opening = await read();
  const responses = await Promise.all([handler(save(opening.version)), handler(save(opening.version, { operation_id: 'support-two' }))]);
  assert.equal(responses.filter(value => value.ok).length, 1); assert.equal(responses.find(value => !value.ok).error, 'project_version_conflict');
  assert.equal((await db.collection('pulseProjectOperations/P/audit').get()).size, 1);
  const fresh = await read(), payload = save(fresh.version, { operation_id: 'lost-reply', command: { kind: 'support_profile', patch: { internalNotes: 'Reply lost' } } });
  let dropped = false;
  const lostReply = create({ collection: name => db.collection(name), runTransaction: async callback => {
    const result = await db.runTransaction(callback); if (!dropped) { dropped = true; throw Error('synthetic lost reply'); } return result;
  } });
  assert.equal((await lostReply(payload)).ok, false);
  const resolved = await handler({ ...payload, data: { ...payload.data, resolve_only: true } });
  assert.equal(resolved.resolution, 'committed'); assert.equal((await handler(payload)).ok, true);
  assert.equal((await db.collection('pulseProjectOperations/P/audit').get()).size, 2);
});

test('Support cancellation racing an original has one durable outcome and audit failure rolls back everything', async () => {
  const opening = await read(), payload = save(opening.version);
  const [saved, resolved] = await Promise.all([handler(payload), handler({ ...payload, data: { ...payload.data, resolve_only: true } })]);
  assert.equal(resolved.ok, true);
  if (resolved.resolution === 'cancelled') {
    assert.equal(saved.error, 'project_request_cancelled'); assert.equal((await db.doc('projects/P').get()).data().supportProfile.internalNotes, 'Old');
  } else { assert.equal(saved.ok, true); assert.equal(resolved.resolution, 'committed'); }
  assert.equal((await db.collection('pulseProjectOperations/P/audit').get()).size, 1);
  const fresh = await read(), before = (await db.doc('projects/P').get()).data();
  const failing = create({ collection: name => db.collection(name), runTransaction: callback => db.runTransaction(tx => callback({
    get: ref => tx.get(ref), update: (ref, data) => tx.update(ref, data), create: (ref, data) => {
      if (ref.path.includes('/audit/')) throw Error('synthetic audit failure'); return tx.create(ref, data);
    },
  })) });
  assert.equal((await failing(save(fresh.version, { operation_id: 'audit-failed', command: { kind: 'support_profile', patch: { internalNotes: 'Must roll back' } } }))).ok, false);
  assert.deepEqual((await db.doc('projects/P').get()).data(), before);
  assert.equal((await db.doc('pulseProjectOperations/P/receipts/audit-failed').get()).exists, false);
});
