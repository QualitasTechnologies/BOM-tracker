// Real Firestore SDK instances (synthetic credentials, never connected) through the real callable encoder.
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { Firestore, FieldValue, GeoPoint, Timestamp } = require('@google-cloud/firestore');
const { encode } = require(require('node:path').join(__dirname, 'node_modules/firebase-functions/lib/common/providers/https.js'));
const { fixture } = require('./nativeMilestoneFixture.cjs');
const SENTINEL = 'SYNTHETIC-MILESTONE-SERIALIZATION-SENTINEL';
const sdk = () => new Firestore({ projectId: 'demo-offline', credentials: { client_email: 'synthetic@example.invalid', private_key: SENTINEL } });
const db = sdk();
const typed = () => ({ reference: db.doc('legacy/reference'), geo: new GeoPoint(12.5, 77.25), vector: FieldValue.vector([1, 2, 3]), stamp: Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')), bytes: Buffer.from('abc') });
const marked = { reference: { __type: 'reference', path: 'legacy/reference' }, geo: { latitude: 12.5, longitude: 77.25 }, vector: [1, 2, 3], stamp: '2026-10-01T00:00:00.000Z', bytes: { __type: 'bytes', base64: 'YWJj' } };
const wire = result => JSON.stringify(encode(result));
const leaks = json => json.includes(SENTINEL) || /_firestore|_settings|_credentials|_serializer/.test(json);
// Inject SDK values at the transaction read boundary: query rows (milestones) and the project document.
function inject(f, { milestone, project }) {
  const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (fn, ...rest) => run(tx => fn({ ...tx, get: async r => {
    const s = await tx.get(r);
    if (s.docs && milestone) return { ...s, docs: s.docs.map((d, i) => i === 0 ? { ...d, data: () => ({ ...d.data(), ...milestone }) } : d) };
    if (project && r.path === 'projects/P') return { ...s, data: () => ({ ...s.data(), ...project }) };
    return s;
  } }), ...rest);
}
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('positive control: raw SDK values do leak through the real encoder', () => {
  assert.equal(leaks(wire({ ref: typed().reference })), true);
});
test('milestone get encodes nested SDK values as logical values and never connection internals', async () => {
  const f = fixture(); inject(f, { milestone: { legacy: { nested: [typed()] }, top: typed().reference } });
  const result = await f.call();
  assert.equal(result.ok, true); assert.equal(leaks(wire(result)), false);
  const row = result.milestones.find(m => m.id === 'one');
  assert.deepEqual(row.legacy, { nested: [marked] }); assert.deepEqual(row.top, marked.reference);
});
test('project subset encodes SDK values as logical values', async () => {
  const f = fixture(); inject(f, { project: { deadline: typed().stamp, projectName: typed().reference } });
  const result = await f.call();
  assert.equal(result.ok, true); assert.equal(leaks(wire(result)), false);
  assert.equal(result.project.deadline, marked.stamp); assert.deepEqual(result.project.projectName, marked.reference);
});
test('versions, schedule version and permissions are unchanged by typed values; plain rows unchanged', async () => {
  const plainRun = await fixture().call(), f = fixture(); inject(f, { milestone: { legacy: typed() } });
  const result = await f.call();
  for (const key of ['project_version', 'schedule_version', 'permissions']) assert.deepEqual(result[key], plainRun[key]);
  assert.deepEqual(result.milestones.find(m => m.id === 'two'), plainRun.milestones.find(m => m.id === 'two'));
  assert.deepEqual(plainRun.milestones[0].legacy, { keep: true });
});
test('reading mutates nothing: stored documents and raw SDK values stay untouched', async () => {
  const values = typed(), f = fixture(); inject(f, { milestone: { legacy: values } });
  const before = structuredClone([...f.docs]); await f.call();
  assert.deepEqual([...f.docs], before); assert.ok(values.reference instanceof require('@google-cloud/firestore').DocumentReference);
  assert.equal(values.stamp.constructor, Timestamp);
});
test('command payload hash is unchanged (read-boundary repair only)', async () => {
  const f = fixture(); const command = { kind: 'baseline_lock' };
  const opening = await f.call(), body = { operation: 'command', project_id: 'P', expected_actor_uid: 'alice', expected_project_version: opening.project_version, expected_schedule_version: opening.schedule_version, operation_id: 'operation-1', command };
  const sorted = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k] && typeof o[k] === 'object' ? sorted(o[k]) : o[k]]));
  assert.equal((await f.issue(command)).ok, true);
  assert.equal(f.docs.get('pulseMilestoneOperations/P/receipts/operation-1').payload_hash, sha(sorted(body)));
});
test('unsupported SDK-like values fail closed with a sanitized milestone state error', async () => {
  const f = fixture(); inject(f, { milestone: { legacy: FieldValue.serverTimestamp() } });
  const result = await f.call(); assert.deepEqual(result, { ok: false, error: 'invalid_milestone_state', status: 409 }); assert.equal(leaks(wire(result)), false);
  class DocumentReference { constructor() { this.path = 'spoof'; this.secret = SENTINEL; } }
  const g = fixture(); inject(g, { milestone: { legacy: new DocumentReference() } });
  const spoof = await g.call(); assert.equal(spoof.error, 'invalid_milestone_state'); assert.equal(JSON.stringify(spoof).includes(SENTINEL), false);
});
test('plain objects claiming an SDK constructor name stay plain data', async () => {
  const claim = { constructor: { name: 'DocumentReference' }, path: 'x', keep: 1 };
  const f = fixture(); inject(f, { milestone: { claim } });
  const result = await f.call(); assert.equal(result.ok, true); assert.deepEqual(result.milestones[0].claim, claim);
});
