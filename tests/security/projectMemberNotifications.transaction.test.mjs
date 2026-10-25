import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const projectId = 'demo-bom-native-security';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue, Timestamp, GeoPoint } = require('@google-cloud/firestore');
const { createProjectMemberNotifications } = require('./projectMemberNotifications.cjs');
let env, db, handler;
const auth = {
  verifyIdToken: async () => ({ uid: 'alice', email: 'alice@partner.example' }),
  getUser: async () => ({ uid: 'alice', email: 'alice@partner.example', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } }),
};
const request = data => ({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic-demo-only' },
  data: { project_id: 'P', expected_actor_uid: 'alice', ...data } });
const read = () => handler(request({ operation: 'get' }));
const set = (version, extra = {}) => request({ operation: 'set', member_uid: 'alice', notifications_enabled: false,
  expected_version: version, operation_id: 'one', ...extra });

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
beforeEach(async () => {
  await env.clearFirestore();
  await db.doc('projects/P').set({ projectId: 'P', memberIds: ['alice'], members: [{ userId: 'alice', notificationsEnabled: true,
    unknown: { at: new Timestamp(12, 34), ref: db.doc('legacy/kept'), point: new GeoPoint(12, 34), bytes: Buffer.from([1, 2]) } }], bomSnapshot: [{ id: 'kept' }] });
  handler = createProjectMemberNotifications({ db, auth, getServerTimestamp: () => FieldValue.serverTimestamp() });
});
after(async () => { await db?.terminate(); await env?.cleanup(); });

test('concurrent identical retries commit one preference update and one audit with raw member fields preserved', async () => {
  const opening = await read(); assert.equal(opening.ok, true);
  const payload = set(opening.version);
  const [a, b] = await Promise.all([handler(payload), handler(payload)]);
  assert.equal(a.ok, true); assert.deepEqual(a, b);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/events').get()).size, 1);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/audit').get()).size, 1);
  const project = (await db.doc('projects/P').get()).data();
  assert.equal(project.members[0].notificationsEnabled, false);
  assert.ok(project.members[0].unknown.at instanceof Timestamp);
  assert.equal(project.members[0].unknown.ref.path, 'legacy/kept');
  assert.ok(project.members[0].unknown.point instanceof GeoPoint);
  assert.deepEqual(project.members[0].unknown.bytes, Buffer.from([1, 2]));
  assert.deepEqual(project.bomSnapshot, [{ id: 'kept' }]);
});

test('competing operators using the same opening cannot both silently rebase their writes', async () => {
  const opening = await read();
  const results = await Promise.all([handler(set(opening.version)), handler(set(opening.version, { operation_id: 'two' }))]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error, 'project_version_conflict');
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/audit').get()).size, 1);
});

test('a real no-op receipt cannot change newer state on a delayed retry', async () => {
  const opening = await read(); const payload = set(opening.version, { notifications_enabled: true });
  assert.equal((await handler(payload)).changed, false);
  const project = (await db.doc('projects/P').get()).data();
  await db.doc('projects/P').update({ members: project.members.map(row => ({ ...row, notificationsEnabled: false })) });
  assert.equal((await handler(payload)).changed, false);
  assert.equal((await db.doc('projects/P').get()).data().members[0].notificationsEnabled, false);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/audit').get()).size, 1);
});

test('resolution racing a late original request produces one durable committed or cancelled outcome', async () => {
  const opening = await read(); const payload = set(opening.version);
  const [saved, resolved] = await Promise.all([handler(payload), handler({ ...payload, data: { ...payload.data, resolve_only: true } })]);
  assert.equal(resolved.ok, true);
  if (resolved.resolution === 'cancelled') {
    assert.equal(saved.error, 'member_notification_request_cancelled');
    assert.equal((await db.doc('projects/P').get()).data().members[0].notificationsEnabled, true);
  } else { assert.equal(saved.ok, true); assert.equal(resolved.resolution, 'committed'); }
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/events').get()).size, 1);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/audit').get()).size, 1);
});

test('audit staging failure rolls back the project and receipt in an actual Firestore transaction', async () => {
  const opening = await read();
  const failingDb = { collection: name => db.collection(name), runTransaction: callback => db.runTransaction(tx => callback({
    get: ref => tx.get(ref), update: (ref, data) => tx.update(ref, data), create: (ref, data) => {
      if (ref.path.includes('/audit/')) throw new Error('synthetic audit failure');
      return tx.create(ref, data);
    },
  })) };
  const failingHandler = createProjectMemberNotifications({ db: failingDb, auth, getServerTimestamp: () => FieldValue.serverTimestamp() });
  assert.equal((await failingHandler(set(opening.version))).ok, false);
  assert.equal((await db.doc('projects/P').get()).data().members[0].notificationsEnabled, true);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/events').get()).size, 0);
  assert.equal((await db.collection('pulseProjectMemberNotificationOperations/P/audit').get()).size, 0);
});
