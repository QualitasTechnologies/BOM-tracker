// Real Admin-SDK Firestore EMULATOR coverage for scripts/linkConfirmedPulseProjects.cjs (demo project only, synthetic data only).
// The engine is imported directly with the real demo database and real FieldValue.serverTimestamp(). The operator principal is a
// synthetic stub: no Google authentication, no CLI apply, no real project. Run via the existing emulators:exec security job.
import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(host, '127.0.0.1:18080');
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'emulator host must be local');
const projectId = 'demo-bom-native-security';
assert.equal(projectId.startsWith('demo-'), true);
const functionsRequire = createRequire(new URL('../../functions/package.json', import.meta.url));
const {Firestore, FieldValue, Timestamp} = functionsRequire('@google-cloud/firestore');
const tool = createRequire(import.meta.url)('../../scripts/linkConfirmedPulseProjects.cjs');
const {PAIRS, RUN_COLLECTION} = tool;

const TARGETS = Object.fromEntries(PAIRS.map(p => [p.bomId, p.pulseProjectId]));
assert.deepEqual(TARGETS, {'PRJ-015': 1910, 'PRJ-017': 2069, 'PRJ-016': 1864, 'PRJ-012': 1823});
const IDS = Object.keys(TARGETS);
const PRINCIPAL = () => ({proven: true, principal: 'operator@example.test', subject: 'google:synthetic-emulator', expiresAtMs: Date.now() + 3600e3});
const projectDoc = (name, extra = {}) => ({
  projectName: name, clientName: `${name} Client`, clientId: `client-${name}`, status: 'Planning', memberIds: ['u1'], members: [{userId: 'u1'}],
  internalBudget: 5000, description: 'synthetic <b>raw</b>', deadline: '2026-12-31', bomSnapshot: [{n: 'part', q: 2}],
  createdAt: Timestamp.fromDate(new Date('2026-01-02T03:04:05Z')), legacyUnknown: {deep: [1, {two: 2}]}, ...extra});
const SEED = {
  'projects/PRJ-015': projectDoc('Avartan', {pulseProjectId: null}), // explicit null
  'projects/PRJ-017': projectDoc('Amazon'), 'projects/PRJ-016': projectDoc('Videojet', {status: 'Ongoing'}),
  'projects/PRJ-012': projectDoc('Hatsun', {status: 'Completed'}), 'projects/PRJ-013': projectDoc('Ferrari'),
  'projects/BVS4': projectDoc('BVS4', {pulseProjectId: 721}),
  'projects/PRJ-015/emails/e1': {subject: 'hello', rfcMessageId: 'x@y'}, 'pulseTimeEntries/t1': {projectId: 1910, hours: 3},
  'pulseRuntimeControl/cutover': {mode: 'coexist'},
};
const UNRELATED = Object.keys(SEED).filter(p => !IDS.some(id => p === `projects/${id}`));

let env, db, store, tmp;
before(async () => {
  env = await initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: 18080}});
  db = new Firestore({projectId, host: host, ssl: false});
});
beforeEach(async () => {
  await env.clearFirestore();
  for (const [p, value] of Object.entries(SEED)) await db.doc(p).set(value);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'links-emulator-'));
  store = tool.createFsPreimageStore(path.join(tmp, 'private-preimage'));
});
after(async () => {
  await db?.terminate();
  await env?.cleanup();
  if (tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

const sqlSnapshot = () => ({sha256: 'a'.repeat(64), data: {schema: 'bom-confirmed-pulse-sql-existence-v1', capturedAt: new Date().toISOString(),
  rows: PAIRS.map(p => ({id: p.pulseProjectId, exists: true}))}});
const base = () => ({db, firebaseProject: projectId, resolvePrincipal: async () => PRINCIPAL(), serverTimestamp: () => FieldValue.serverTimestamp(), preimageStore: store});
const plan = () => tool.runLinks({...base(), mode: 'dry-run', sqlSnapshot: sqlSnapshot()});
const apply = manifest => tool.runLinks({...base(), mode: 'apply', manifest, expectedManifestSha: manifest.manifestSha256, operator: 'emulator-test'});
const stateOf = async paths => {
  const out = {};
  for (const p of paths) { const s = await db.doc(p).get(); out[p] = s.exists ? {data: tool.canon(s.data()), updateTime: s.updateTime.toMillis() + ':' + s.updateTime.nanoseconds} : null; }
  return out;
};
const runDocs = async () => (await db.collection(RUN_COLLECTION).get()).size + (await db.collectionGroup('audit').get()).size;
const runPath = manifest => `${RUN_COLLECTION}/${manifest.manifestSha256}`;

test('plan writes nothing; apply changes only the four link fields plus receipt and audits in one atomic commit', async () => {
  const all = Object.keys(SEED);
  const before = await stateOf(all);
  const planned = await plan();
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(await stateOf(all), before);
  assert.equal(await runDocs(), 0);
  assert.deepEqual(planned.manifest.operations.map(o => [o.bomId, o.before]),
    [['PRJ-015', {present: true, value: null}], ['PRJ-017', {present: false}], ['PRJ-016', {present: false}], ['PRJ-012', {present: false}]]);

  const applied = await apply(planned.manifest);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.status, 'applied');

  for (const id of IDS) {
    const now = (await db.doc(`projects/${id}`).get()).data();
    assert.strictEqual(now.pulseProjectId, TARGETS[id]);
    const {pulseProjectId, ...rest} = now;
    const {pulseProjectId: _prior, ...original} = SEED[`projects/${id}`];
    assert.equal(tool.canon(rest), tool.canon(original), `${id}: no field other than pulseProjectId may change`);
  }
  const after = await stateOf(UNRELATED);
  for (const p of UNRELATED) assert.deepEqual(after[p], before[p], `${p} must be untouched`);

  // The after-version is the receipt DOCUMENT's updateTime, equal to every changed project's updateTime (one commit).
  const receiptSnap = await db.doc(runPath(planned.manifest)).get();
  assert.equal(receiptSnap.exists, true);
  for (const id of IDS) assert.equal((await db.doc(`projects/${id}`).get()).updateTime.isEqual(receiptSnap.updateTime), true, id);
  for (const id of IDS) {
    const audit = await db.doc(`${runPath(planned.manifest)}/audit/${id}`).get();
    assert.equal(audit.exists, true);
    assert.equal(audit.updateTime.isEqual(receiptSnap.updateTime), true);
    assert.equal(audit.data().firebaseUid, null);
  }
  assert.equal(applied.postVerification.commitVersion, tool.tsKey(receiptSnap.updateTime));
  const receipt = receiptSnap.data();
  assert.equal(receipt.firebaseUid, null);
  assert.equal(receipt.actorKind, 'google-credential');
  assert.ok(receipt.appliedAt instanceof Timestamp, 'appliedAt is recorded as audit time only; its equality to the version is neither assumed nor tested');

  const pre = JSON.parse(fs.readFileSync(path.join(tmp, 'private-preimage', `${planned.manifest.manifestSha256}.preimage.json`), 'utf8'));
  assert.deepEqual(pre.operations.map(o => [o.bomId, o.before]), planned.manifest.operations.map(o => [o.bomId, o.before]));
  assert.equal(receipt.preimageSha256, tool.sha(pre));
});

test('replay writes nothing, survives later unrelated edits, and recovery refuses an edited project but allows an untouched one', async () => {
  const planned = await plan();
  assert.equal((await apply(planned.manifest)).ok, true);
  const receiptRef = db.doc(runPath(planned.manifest));
  const everything = [...Object.keys(SEED), runPath(planned.manifest), ...IDS.map(id => `${runPath(planned.manifest)}/audit/${id}`)];

  const before = await stateOf(everything);
  const again = await apply(planned.manifest);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.status, 'already_applied');
  assert.deepEqual(await stateOf(everything), before, 'replay must write nothing');

  await db.doc('projects/PRJ-017').update({description: 'later unrelated edit'});
  const replay = await apply(planned.manifest);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.deepEqual(replay.postVerification.modifiedSinceApply, ['PRJ-017']);

  const receiptSnapshot = await receiptRef.get();
  const preimage = JSON.parse(fs.readFileSync(path.join(tmp, 'private-preimage', `${planned.manifest.manifestSha256}.preimage.json`), 'utf8'));
  const recover = async bomId => tool.evaluateRecovery({bomId, receiptSnapshot, preimage, project: await db.doc(`projects/${bomId}`).get()});
  assert.equal((await recover('PRJ-017')).code, 'modified_since_apply');
  const untouched = await recover('PRJ-016');
  assert.deepEqual([untouched.allowed, untouched.action], [true, 'delete_field']);
  const nullBefore = await recover('PRJ-015');
  assert.deepEqual([nullBefore.allowed, nullBefore.action], [true, 'set_null']);
  assert.equal((await tool.evaluateRecovery({bomId: 'PRJ-016', receiptSnapshot: {exists: true, data: () => receiptSnapshot.data()}, preimage,
    project: await db.doc('projects/PRJ-016').get()})).code, 'receipt_metadata_missing');

  await db.doc('projects/PRJ-012').update({pulseProjectId: 5});
  const diverged = await apply(planned.manifest);
  assert.equal(diverged.ok, false);
  assert.ok(Object.keys(diverged.blockers).includes('receipt_link_diverged'));
  assert.equal((await recover('PRJ-012')).code, 'value_changed_since_apply');
});

test('a project edited after planning aborts all four with no receipt; real collisions block planning', async () => {
  const planned = await plan();
  await db.doc('projects/PRJ-012').update({description: 'edited after plan'});
  const before = await stateOf(Object.keys(SEED));
  const blocked = await apply(planned.manifest);
  assert.equal(blocked.ok, false);
  assert.ok(Object.keys(blocked.blockers).includes('stale_update_time'));
  assert.deepEqual(await stateOf(Object.keys(SEED)), before);
  assert.equal(await runDocs(), 0);

  for (const [id, value] of [['PRJ-013', 1910], ['BVS4', '2069'], ['PRJ-013', ' 1864 ']]) {
    await env.clearFirestore();
    for (const [p, v] of Object.entries(SEED)) await db.doc(p).set(v);
    await db.doc(`projects/${id}`).update({pulseProjectId: value});
    const r = await plan();
    assert.equal(r.ok, false, `${id}=${JSON.stringify(value)}`);
    assert.ok(Object.keys(r.blockers).includes('collision'), JSON.stringify(r.blockers));
    assert.equal(r.manifest, undefined);
  }
});
