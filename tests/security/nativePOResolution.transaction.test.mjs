import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'demo-bom-native-security';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:19199');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { createNativePOAuthoringOperations } = require('./nativePOAuthoringOperations.cjs');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
let env, db, data, call;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080 } });
  // Same transaction implementation used by Admin; explicitly emulator-only, with no application credentials.
  db = new Firestore({ projectId, host: '127.0.0.1:18080', ssl: false });
});
beforeEach(async () => {
  await env.clearFirestore(); data = fixture();
  const batch = db.batch();
  for (const [path, value] of data.docs) batch.set(db.doc(path), value);
  await batch.commit();
  const actor = data.users.get('alice');
  const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => structuredClone(actor) };
  const native = createNativePOAuthoringOperations({ db, auth, enabled: true, getServerTimestamp: () => FieldValue.serverTimestamp() });
  call = payload => native({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic' }, data: { project_id: 'P', expected_actor_uid: 'alice', ...payload } });
});
after(async () => { await db?.terminate(); await env?.cleanup(); });

test('real Firestore concurrent resolution and creation produce exactly one authoritative outcome', async () => {
  const opening = await call({ operation: 'open' }); assert.equal(opening.ok, true);
  let committed = 0;
  for (let i = 0; i < 8; i++) {
    const request = { operation: 'create', po_id: `race-${i}`, operation_id: `race-${i}`, expected_material_version: opening.material_version, input: data.input, billing_snapshot: data.billingSnapshot };
    const [original, resolution] = await Promise.all([call(request), call({ ...request, resolve_only: true })]);
    assert.equal(resolution.ok, true);
    if (resolution.resolution === 'committed') { assert.equal(original.ok, true); committed++; }
    else { assert.equal(resolution.resolution, 'cancelled'); assert.equal(original.error, 'po_request_cancelled'); }
    assert.equal((await db.doc(`projects/P/purchaseOrders/race-${i}`).get()).exists, resolution.resolution === 'committed');
    assert.equal((await call({ ...request, resolve_only: true })).resolution, resolution.resolution);
  }
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 7 + committed);
  assert.equal((await db.collection('pulsePOAuthoringOperations/P/receipts').get()).size, 8);
  assert.equal((await db.collection('pulsePOAuthoringOperations/P/audit').get()).size, 8);
});

test('real Firestore cancellation fences its old nonce while a fresh authorized request can proceed', async () => {
  const opening = await call({ operation: 'open' });
  const request = { operation: 'create', po_id: 'draft', operation_id: 'old', expected_material_version: opening.material_version, input: data.input, billing_snapshot: data.billingSnapshot };
  assert.equal((await call({ ...request, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await call(request)).error, 'po_request_cancelled');
  assert.equal((await call({ ...request, operation_id: 'new' })).ok, true);
  assert.equal((await call(request)).error, 'po_request_cancelled');
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber, 8);
});
