'use strict';
// Behavioural tests for scripts/linkConfirmedPulseProjects.cjs against an in-memory, transaction-faithful Firestore double.
// No network, credential, Google, SQL or Firebase access: every dependency is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tool = require('../scripts/linkConfirmedPulseProjects.cjs');

const { runLinks, sha, canon, tsKey, PAIRS, RUN_COLLECTION, evaluateRecovery, createFsPreimageStore, createTokeninfoResolver, parseArgs, main } = tool;
const PROJECT = 'test-project';
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const OPERATOR = 'rahul-ops';
const PRINCIPAL = { proven: true, principal: 'operator@example.test', subject: 'google:1234567890', expiresAtMs: NOW + 3600e3 };
const TARGETS = { 'PRJ-015': 1910, 'PRJ-017': 2069, 'PRJ-016': 1864, 'PRJ-012': 1823 };
const BOM_IDS = Object.keys(TARGETS);

class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toDate() { return new Date(this.seconds * 1000); }
}
const SERVER_TS = { __serverTimestamp: true };
const clone = v => {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (v === SERVER_TS) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
};

// Transaction-faithful double: optimistic read tracking (documents AND query result sets), single commit version shared by every
// write in a commit, serverTimestamp resolved to that commit version, update preconditions, create-only semantics, atomic commit.
function createFakeDb({ events = [], ignoreReadConflicts = false, beforeCommit = null, failGet = null, afterCommitThrow = false, failCommit = false } = {}) {
  const docs = new Map();
  const log = { commits: [] };
  let counter = 0;
  const stamp = ver => new Timestamp(1789000000 + ver, 679503000);
  const pick = (data, fields) => (fields ? Object.fromEntries(fields.filter(f => Object.hasOwn(data, f)).map(f => [f, clone(data[f])])) : clone(data));
  const snap = (p, fields) => {
    const rec = docs.get(p);
    return { id: p.split('/').at(-1), ref: { path: p }, exists: Boolean(rec), data: () => (rec ? pick(rec.data, fields) : undefined), updateTime: rec ? stamp(rec.ver) : undefined };
  };
  const runQuery = q => [...docs.keys()].filter(p => p.startsWith(`${q.coll}/`) && p.split('/').length === 2)
    .filter(p => q.filters.every(([f, v]) => { const x = docs.get(p).data[f]; return x !== undefined && typeof x === typeof v && x === v; })).sort().map(p => snap(p, q.fields));
  const sig = q => JSON.stringify(runQuery(q).map(s => [s.ref.path, docs.get(s.ref.path).ver]));
  const mkQuery = (coll, filters = [], fields = null) => ({ _query: true, coll, filters, fields,
    where: (f, op, v) => { assert.equal(op, '=='); return mkQuery(coll, [...filters, [f, v]], fields); },
    select: (...f) => mkQuery(coll, filters, f), get: async () => ({ docs: runQuery({ coll, filters, fields }) }) });
  const resolve = (v, ver) => (v === SERVER_TS ? new Timestamp(1789000000 + ver, 851000000) : Array.isArray(v) ? v.map(x => resolve(x, ver))
    : v && typeof v === 'object' && !(v instanceof Timestamp) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, ver)])) : v);
  const db = {
    docs, log, events,
    put: (p, data) => { docs.set(p, { data: clone(data), ver: ++counter }); },
    mutate: (p, patch) => { const r = docs.get(p); r.data = { ...r.data, ...clone(patch) }; r.ver = ++counter; },
    remove: p => { docs.delete(p); ++counter; },
    dump: () => JSON.stringify([...docs].map(([p, r]) => [p, canon(r.data), r.ver])),
    doc: p => ({ path: p, get: async () => snap(p) }),
    collection: coll => mkQuery(coll),
    async runTransaction(fn) {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const reads = [], writes = [];
        const tx = {
          get: async target => {
            if (target._query) { reads.push({ q: target, sig: sig(target) }); return { docs: runQuery(target) }; }
            if (failGet && failGet(target.path)) throw Object.assign(new Error('UNAVAILABLE'), { code: 14 });
            reads.push({ path: target.path, ver: docs.get(target.path)?.ver ?? 0 }); return snap(target.path);
          },
          update: (ref, data, precondition) => writes.push({ kind: 'update', path: ref.path, data: clone(data), precondition }),
          create: (ref, data) => writes.push({ kind: 'create', path: ref.path, data: clone(data) }),
        };
        const out = await fn(tx);
        if (beforeCommit) await beforeCommit(db, attempt);
        const conflict = reads.some(r => (r.q ? sig(r.q) !== r.sig : (docs.get(r.path)?.ver ?? 0) !== r.ver));
        if (conflict && !ignoreReadConflicts) continue;
        if (failCommit) throw Object.assign(new Error('UNAVAILABLE'), { code: 14 });
        for (const w of writes) {
          if (w.kind === 'update' && !docs.has(w.path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
          if (w.kind === 'update' && w.precondition?.lastUpdateTime
            && tsKey(w.precondition.lastUpdateTime) !== tsKey(stamp(docs.get(w.path).ver))) throw Object.assign(new Error('FAILED_PRECONDITION'), { code: 9 });
          if (w.kind === 'create' && docs.has(w.path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        }
        const ver = ++counter;
        for (const w of writes) {
          if (w.kind === 'update') { const r = docs.get(w.path); r.data = { ...r.data, ...resolve(w.data, ver) }; r.ver = ver; }
          else docs.set(w.path, { data: resolve(w.data, ver), ver });
        }
        log.commits.push({ ver, writes: writes.map(w => ({ kind: w.kind, path: w.path, keys: Object.keys(w.data), precondition: w.precondition })) });
        events.push('commit');
        if (afterCommitThrow) throw Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 4 });
        return out;
      }
      throw Object.assign(new Error('ABORTED'), { code: 10 });
    },
  };
  return db;
}
const readOnlyDb = db => ({ doc: db.doc, collection: db.collection, runTransaction: async () => { throw new Error('write path used'); } });

const targetDoc = (name, extra = {}) => ({
  projectName: name, clientName: `${name} Client`, clientId: `client-${name}`, status: 'Planning', memberIds: ['u1', 'u2'],
  members: [{ userId: 'u1', email: 'a@x.test' }, { userId: 'u2', email: 'b@x.test' }], internalBudget: 5000, costPerHour: 1200, miscCost: 0, poValue: 9000,
  description: 'legacy RAW text <b>keep</b>', deadline: '2026-12-31', category: 'customer', externalRecipients: [], bomSnapshot: [{ n: 'part', q: 2 }],
  createdAt: new Timestamp(1770000000, 5), updatedAt: new Timestamp(1770000100, 6), legacyUnknown: { deep: [1, { two: 2 }] }, ...extra });

function makeFixture(opts = {}) {
  const events = [];
  const db = createFakeDb({ events, ...(opts.db || {}) });
  db.put('projects/PRJ-015', targetDoc('Avartan', { pulseProjectId: null }));        // explicit null: presence must be preserved
  db.put('projects/PRJ-017', targetDoc('Amazon'));                                   // field absent
  db.put('projects/PRJ-016', targetDoc('Videojet', { status: 'Ongoing' }));
  db.put('projects/PRJ-012', targetDoc('Hatsun', { status: 'Completed' }));
  db.put('projects/PRJ-013', targetDoc('Ferrari'));                                  // never linked
  db.put('projects/BVS4', targetDoc('BVS4', { pulseProjectId: 721 }));
  db.put('projects/ELVIS', targetDoc('ELVIS', { pulseProjectId: 2002 }));
  db.put('projects/OLD-1', targetDoc('Old', { status: 'Archived', archivedAt: '2026-01-01', pulseProjectId: 2153 }));
  db.put('projects/PRJ-015/bom/data', { categories: [{ name: 'Cameras', items: [{ id: 'i1' }] }] });
  db.put('projects/PRJ-015/emails/e1', { subject: 'hello', rfcMessageId: 'x@y' });
  db.put('pulseTimeEntries/t1', { projectId: 1910, hours: 3 });
  if (opts.control !== null) db.put('pulseRuntimeControl/cutover', opts.control || { mode: 'coexist' });
  const sqlData = { schema: 'bom-confirmed-pulse-sql-existence-v1', capturedAt: new Date(NOW - 5 * 60e3).toISOString(),
    rows: PAIRS.map(p => ({ id: p.pulseProjectId, exists: true })) };
  const sqlSnapshot = { sha256: sha('sql-file-bytes'), data: sqlData };
  const clock = { t: NOW };
  const store = { saved: [], fail: false, badHash: false, async save(record) {
    if (this.fail) throw new Error('disk full');
    events.push('preimage'); this.saved.push(JSON.parse(JSON.stringify(record)));
    return { sha256: this.badHash ? '0'.repeat(64) : sha(record) };
  } };
  const principalState = { value: PRINCIPAL, calls: 0 };
  const base = { db, firebaseProject: PROJECT, now: () => clock.t, resolvePrincipal: async () => { principalState.calls += 1; return principalState.value; },
    serverTimestamp: () => SERVER_TS, preimageStore: store };
  return { db, events, store, clock, sqlSnapshot, base, principalState };
}
const plan = (f, extra = {}) => runLinks({ ...f.base, mode: 'dry-run', sqlSnapshot: f.sqlSnapshot, ...extra });
async function sealed(f) { const r = await plan(f); assert.equal(r.ok, true, JSON.stringify(r)); return r.manifest; }
const applyOpts = (f, manifest, extra = {}) => ({ ...f.base, mode: 'apply', manifest, expectedManifestSha: manifest.manifestSha256, operator: OPERATOR, ...extra });
const reseal = (manifest, edit) => { const c = JSON.parse(JSON.stringify(manifest)); edit(c); delete c.manifestSha256; return { ...c, manifestSha256: sha(c) }; };
const codes = r => [r.rejected, ...Object.keys(r.blockers || {})].filter(Boolean);
const projectDump = db => JSON.stringify([...db.docs].filter(([p]) => !p.startsWith(RUN_COLLECTION)).map(([p, r]) => [p, canon(r.data)]));

test('scope is hardcoded to exactly the four human-confirmed pairs and Ferrari is absent', () => {
  assert.deepEqual(PAIRS.map(p => [p.bomId, p.pulseProjectId]), [['PRJ-015', 1910], ['PRJ-017', 2069], ['PRJ-016', 1864], ['PRJ-012', 1823]]);
  assert.ok(Object.isFrozen(PAIRS) && PAIRS.every(Object.isFrozen));
  assert.ok(!PAIRS.some(p => p.bomId === 'PRJ-013'));
});

test('dry run plans exactly four operations with zero writes and a sealed manifest', async () => {
  const f = makeFixture();
  const before = f.db.dump();
  const r = await plan(f, { db: readOnlyDb(f.db) });
  assert.equal(r.ok, true);
  assert.equal(f.db.dump(), before);
  assert.equal(f.db.log.commits.length, 0);
  assert.equal(r.manifestSha256, r.manifest.manifestSha256);
  const { manifestSha256, ...body } = r.manifest;
  assert.equal(sha(body), manifestSha256);
  assert.deepEqual(r.manifest.operations.map(o => [o.bomId, o.docPath, o.pulseProjectId, o.field]),
    BOM_IDS.map(id => [id, `projects/${id}`, TARGETS[id], 'pulseProjectId']));
  assert.deepEqual(r.manifest.operatorAttribution, { proven: true, credentialPrincipal: 'operator@example.test', credentialSubject: 'google:1234567890',
    firebaseUid: null, actorKind: 'google-credential' });
  assert.equal(r.manifest.runtime.mode, 'coexist');
  assert.equal(r.manifest.sql.snapshotSha256, f.sqlSnapshot.sha256);
  assert.deepEqual(r.manifest.sql.rows.map(x => x.id), [1910, 2069, 1864, 1823]);
  assert.match(r.manifest.humanConfirmation.reference, /PRJ-015.*1910.*PRJ-013/s);
});

test('manifest preserves field PRESENCE and VALUE exactly: explicit null differs from absent, with real Firestore versions', async () => {
  const f = makeFixture();
  const m = await sealed(f);
  const byId = Object.fromEntries(m.operations.map(o => [o.bomId, o]));
  assert.deepEqual(byId['PRJ-015'].before, { present: true, value: null });
  assert.deepEqual(byId['PRJ-017'].before, { present: false });
  for (const id of BOM_IDS) assert.equal(byId[id].docUpdateTime, tsKey(new Timestamp(1789000000 + f.db.docs.get(`projects/${id}`).ver, 679503000)));
});

test('dry run refuses unknown options so the pair mapping cannot be supplied or widened', async () => {
  const f = makeFixture();
  for (const extra of [{ pairs: [{ bomId: 'PRJ-013', pulseProjectId: 5 }] }, { mapping: {} }, { targets: [1] }]) {
    const r = await plan(f, extra);
    assert.equal(r.ok, false);
    assert.equal(r.rejected, 'unknown_option');
  }
});

test('SQL snapshot input must be exactly the four target rows, existing, fresh, and carry no extra data', async () => {
  const f = makeFixture();
  const bad = {
    extraRow: d => d.rows.push({ id: 721, exists: true }),
    missingRow: d => d.rows.pop(),
    wrongId: d => { d.rows[0].id = 1911; },
    duplicateId: d => { d.rows[1].id = 1910; },
    extraKey: d => { d.rows[0].name = 'Avartan Labs'; },
    topLevelExtra: d => { d.note = 'x'; },
    badSchema: d => { d.schema = 'other'; },
    badTime: d => { d.capturedAt = 'yesterday'; },
    future: d => { d.capturedAt = new Date(NOW + 3600e3).toISOString(); },
  };
  for (const [name, edit] of Object.entries(bad)) {
    const data = JSON.parse(JSON.stringify(f.sqlSnapshot.data)); edit(data);
    const r = await plan(f, { sqlSnapshot: { sha256: f.sqlSnapshot.sha256, data } });
    assert.equal(r.ok, false, name); assert.equal(r.rejected, 'sql_snapshot_invalid', name); assert.equal(r.manifest, undefined);
  }
  const missing = JSON.parse(JSON.stringify(f.sqlSnapshot.data)); missing.rows[2].exists = false;
  assert.equal((await plan(f, { sqlSnapshot: { sha256: f.sqlSnapshot.sha256, data: missing } })).rejected, 'sql_row_missing');
  const stale = JSON.parse(JSON.stringify(f.sqlSnapshot.data)); stale.capturedAt = new Date(NOW - 7 * 3600e3).toISOString();
  assert.equal((await plan(f, { sqlSnapshot: { sha256: f.sqlSnapshot.sha256, data: stale } })).rejected, 'sql_snapshot_stale');
  assert.equal((await plan(f, { sqlSnapshot: { sha256: 'nothex', data: f.sqlSnapshot.data } })).rejected, 'sql_snapshot_invalid');
  assert.equal((await plan(f, { sqlSnapshot: undefined })).rejected, 'sql_snapshot_invalid');
});

test('plan needs a proven, unexpired credential principal and never emits a manifest without one', async () => {
  const f = makeFixture();
  for (const p of [{ proven: false }, { ...PRINCIPAL, proven: false }, { ...PRINCIPAL, expiresAtMs: NOW + 30e3 }, { ...PRINCIPAL, expiresAtMs: NOW - 1 },
    { ...PRINCIPAL, principal: 'not-an-email' }, { ...PRINCIPAL, subject: '' }, undefined]) {
    f.principalState.value = p;
    const r = await plan(f);
    assert.equal(r.ok, false); assert.equal(r.manifest, undefined);
    assert.ok(['principal_unproven', 'principal_expired'].includes(r.rejected), String(r.rejected));
  }
});

test('project identity: missing, mismatched, archived, malformed status and missing names all block with no manifest', async () => {
  const cases = {
    project_missing: f => f.db.remove('projects/PRJ-016'),
    project_identity_mismatch: f => f.db.mutate('projects/PRJ-017', { projectId: 'PRJ-099' }),
    project_archived: f => f.db.mutate('projects/PRJ-012', { status: 'Archived' }),
    archivedAtSet: f => f.db.mutate('projects/PRJ-012', { archivedAt: '2026-10-01' }),
    project_status_malformed: f => f.db.mutate('projects/PRJ-015', { status: 7 }),
    unknownStatus: f => f.db.mutate('projects/PRJ-015', { status: 'Weird' }),
    project_identity_missing: f => f.db.mutate('projects/PRJ-015', { projectName: '' }),
  };
  for (const [name, edit] of Object.entries(cases)) {
    const f = makeFixture(); edit(f);
    const r = await plan(f);
    assert.equal(r.ok, false, name); assert.equal(r.manifest, undefined, name);
    assert.ok(Object.keys(r.blockers).length > 0, name);
  }
  const f = makeFixture(); f.db.mutate('projects/PRJ-015', { status: 'Archived' });
  assert.ok(codes(await plan(f)).includes('project_archived'));
});

test('existing non-null link on a target, or a link equal to its target without a receipt, blocks planning', async () => {
  for (const [value, code] of [[999, 'existing_link_conflict'], ['1910', 'existing_link_conflict'], [1910, 'link_without_receipt']]) {
    const f = makeFixture(); f.db.mutate('projects/PRJ-015', { pulseProjectId: value });
    const r = await plan(f);
    assert.equal(r.ok, false); assert.ok(codes(r).includes(code), `${value} -> ${codes(r)}`);
  }
});

test('collisions: numeric, string, whitespace-string, archived holder and cross-pair holders all block', async () => {
  const cases = [
    ['other numeric', f => f.db.mutate('projects/PRJ-013', { pulseProjectId: 1910 })],
    ['other string', f => f.db.mutate('projects/PRJ-013', { pulseProjectId: '2069' })],
    ['padded string', f => f.db.mutate('projects/BVS4', { pulseProjectId: ' 1864 ' })],
    ['archived holder', f => f.db.mutate('projects/OLD-1', { pulseProjectId: 1823 })],
    ['new project doc', f => f.db.put('projects/NEW-1', targetDoc('New', { pulseProjectId: 1910 }))],
    ['pair holds another pair target', f => f.db.mutate('projects/PRJ-017', { pulseProjectId: 1910 })],
  ];
  for (const [name, edit] of cases) {
    const f = makeFixture(); edit(f);
    const r = await plan(f);
    assert.equal(r.ok, false, name); assert.equal(r.manifest, undefined, name);
    assert.ok(codes(r).some(c => ['collision', 'existing_link_conflict'].includes(c)), `${name}: ${codes(r)}`);
  }
});

test('unrelated existing numeric links elsewhere are not collisions', async () => {
  const f = makeFixture();
  assert.equal((await plan(f)).ok, true); // BVS4=721, ELVIS=2002, OLD-1=2153 exist in the fixture
});

test('runtime control must be coexist; absent control or absent mode follows the runtime default of coexist', async () => {
  for (const control of [{ mode: 'read_only' }, { mode: 'pulse_only' }, { mode: 'bogus' }, { mode: 7 }, { mode: true }]) {
    const r = await plan(makeFixture({ control }));
    assert.equal(r.ok, false, JSON.stringify(control)); assert.ok(codes(r).includes('runtime_mode_blocks_writes'));
  }
  assert.equal((await plan(makeFixture({ control: null }))).ok, true);
  assert.equal((await plan(makeFixture({ control: {} }))).ok, true);
  assert.equal((await plan(makeFixture({ control: null }))).manifest.runtime.controlExists, false);
});

test('apply happy path: only the four link fields change, in ONE commit, with preconditions, audit and run receipt', async () => {
  const f = makeFixture();
  const m = await sealed(f);
  const beforeDump = f.db.dump();
  const origProjects = Object.fromEntries(BOM_IDS.map(id => [id, f.db.docs.get(`projects/${id}`).data]));
  const versionsBefore = Object.fromEntries(BOM_IDS.map(id => [id, f.db.docs.get(`projects/${id}`).ver]));
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 'applied');
  assert.deepEqual(r.counts, { operations: 4, ready: 0, applied: 4, verified: 4, blocked: 0 });
  assert.equal(f.db.log.commits.length, 1);
  const commit = f.db.log.commits[0];
  assert.equal(commit.writes.length, 9);
  const updates = commit.writes.filter(w => w.kind === 'update');
  assert.deepEqual(updates.map(w => [w.path, w.keys]), BOM_IDS.map(id => [`projects/${id}`, ['pulseProjectId']]));
  for (const u of updates) assert.ok(u.precondition?.lastUpdateTime, 'update must carry a lastUpdateTime precondition');
  const creates = commit.writes.filter(w => w.kind === 'create').map(w => w.path).sort();
  const runPath = `${RUN_COLLECTION}/${m.manifestSha256}`;
  assert.deepEqual(creates, [runPath, ...BOM_IDS.map(id => `${runPath}/audit/${id}`)].sort());
  // every other field of every target is byte-identical; links are integers
  for (const id of BOM_IDS) {
    const now = f.db.docs.get(`projects/${id}`).data;
    assert.strictEqual(now.pulseProjectId, TARGETS[id]);
    const { pulseProjectId, ...rest } = now; const { pulseProjectId: _o, ...origRest } = origProjects[id];
    assert.equal(canon(rest), canon(origRest));
    assert.notEqual(f.db.docs.get(`projects/${id}`).ver, versionsBefore[id]);
  }
  // nothing outside the 4 projects + maintenance collection changed
  const stripped = d => JSON.stringify(JSON.parse(d).filter(([p]) => !BOM_IDS.some(id => p === `projects/${id}`) && !p.startsWith(RUN_COLLECTION)));
  assert.equal(stripped(f.db.dump()), stripped(beforeDump));
  assert.equal(f.db.docs.get('projects/PRJ-013').data.pulseProjectId, undefined);
  assert.equal(f.db.docs.get('pulseTimeEntries/t1').data.projectId, 1910);
  assert.equal(f.db.docs.get('projects/PRJ-015/emails/e1').data.rfcMessageId, 'x@y');
});

test('run receipt and audit record the real operator provenance, human confirmation, before/after and the commit version', async () => {
  const f = makeFixture();
  const m = await sealed(f);
  assert.equal((await runLinks(applyOpts(f, m))).ok, true);
  const receipt = f.db.docs.get(`${RUN_COLLECTION}/${m.manifestSha256}`).data;
  assert.equal(receipt.firebaseUid, null);
  assert.equal(receipt.actorKind, 'google-credential');
  assert.equal(receipt.credentialPrincipal, 'operator@example.test');
  assert.equal(receipt.credentialSubject, 'google:1234567890');
  assert.equal(receipt.operator, OPERATOR);
  assert.equal(receipt.principalSha256, sha('operator@example.test'));
  assert.equal(receipt.manifestSha256, m.manifestSha256);
  assert.equal(receipt.sqlSnapshotSha256, f.sqlSnapshot.sha256);
  assert.equal(receipt.humanConfirmation.reference, m.humanConfirmation.reference);
  assert.equal(receipt.preimageSha256, sha(f.store.saved[0]));
  assert.deepEqual(receipt.operations.map(o => [o.bomId, o.before, o.after]), [
    ['PRJ-015', { present: true, value: null }, { value: 1910 }], ['PRJ-017', { present: false }, { value: 2069 }],
    ['PRJ-016', { present: false }, { value: 1864 }], ['PRJ-012', { present: false }, { value: 1823 }]]);
  // appliedAt is audit time only; the after-version is the receipt DOCUMENT's updateTime from the same atomic commit.
  const receiptSnap = await f.db.doc(`${RUN_COLLECTION}/${m.manifestSha256}`).get();
  const commitVersion = tsKey(receiptSnap.updateTime);
  assert.ok(commitVersion);
  assert.notEqual(tsKey(receipt.appliedAt), commitVersion, 'fixture must separate appliedAt from the commit version');
  for (const id of BOM_IDS) {
    assert.equal(tsKey((await f.db.doc(`projects/${id}`).get()).updateTime), commitVersion);
    const audit = f.db.docs.get(`${RUN_COLLECTION}/${m.manifestSha256}/audit/${id}`).data;
    assert.equal(audit.firebaseUid, null); assert.equal(audit.operator, OPERATOR); assert.equal(tsKey(audit.appliedAt), tsKey(receipt.appliedAt));
    assert.equal(audit.runReceiptPath, `${RUN_COLLECTION}/${m.manifestSha256}`);
  }
});

test('the durable preimage is saved BEFORE the commit and contains the pre-change presence, value and version', async () => {
  const f = makeFixture();
  const m = await sealed(f);
  await runLinks(applyOpts(f, m));
  assert.deepEqual(f.events.filter(e => e === 'preimage' || e === 'commit'), ['preimage', 'commit']);
  assert.equal(f.store.saved.length, 1);
  const pre = f.store.saved[0];
  assert.equal(pre.manifestSha256, m.manifestSha256);
  assert.deepEqual(pre.operations.map(o => [o.bomId, o.before, o.docUpdateTime]), m.operations.map(o => [o.bomId, o.before, o.docUpdateTime]));
  assert.ok(!JSON.stringify(pre).includes('legacy RAW'), 'preimage must be field-level, not a document backup');
});

test('unsafe gates abort before ANY write or preimage', async () => {
  const f0 = makeFixture();
  const m = await sealed(f0);
  const variants = {
    shaPinMismatch: [f => ({ expectedManifestSha: 'f'.repeat(64) }), 'manifest_sha_pin_mismatch'],
    shaPinMalformed: [f => ({ expectedManifestSha: 'abc' }), 'manifest_sha_pin_mismatch'],
    contentTamper: [f => ({ manifest: { ...m, firebaseProject: 'evil' } }), 'manifest_content_hash_mismatch'],
    wrongProject: [f => ({ firebaseProject: 'other-project' }), 'manifest_project_mismatch'],
    principalUnproven: [f => { f.principalState.value = { proven: false }; return {}; }, 'principal_unproven'],
    principalOtherEmail: [f => { f.principalState.value = { ...PRINCIPAL, principal: 'someone@example.test' }; return {}; }, 'principal_mismatch'],
    principalOtherSubject: [f => { f.principalState.value = { ...PRINCIPAL, subject: 'google:999' }; return {}; }, 'principal_mismatch'],
    principalExpiring: [f => { f.principalState.value = { ...PRINCIPAL, expiresAtMs: NOW + 10e3 }; return {}; }, 'principal_expired'],
    operatorMissing: [f => ({ operator: undefined }), 'operator_label_invalid'],
    operatorBad: [f => ({ operator: 'x' }), 'operator_label_invalid'],
    noStore: [f => ({ preimageStore: undefined }), 'preimage_store_missing'],
    noTimestamp: [f => ({ serverTimestamp: undefined }), 'server_timestamp_missing'],
    stale: [f => { f.clock.t = NOW + 7 * 3600e3; f.principalState.value = { ...PRINCIPAL, expiresAtMs: NOW + 99 * 3600e3 }; return {}; }, 'manifest_stale'],
  };
  for (const [name, [make, code]] of Object.entries(variants)) {
    const f = makeFixture(); const dump = f.db.dump();
    const extra = make(f);
    const r = await runLinks(applyOpts(f, m, extra));
    assert.equal(r.ok, false, name); assert.equal(r.rejected, code, name);
    assert.equal(f.db.dump(), dump, name); assert.equal(f.store.saved.length, 0, name); assert.equal(f.db.log.commits.length, 0, name);
  }
});

test('the credential is re-proven right before the transaction: a change or expiry after the backup aborts with no Firestore write', async () => {
  for (const [name, second, code] of [['unproven', { proven: false }, 'principal_unproven'], ['other account', { ...PRINCIPAL, principal: 'other@example.test' }, 'principal_mismatch'],
    ['expiring', { ...PRINCIPAL, expiresAtMs: NOW + 5e3 }, 'principal_expired']]) {
    const f = makeFixture(); const m = await sealed(f); const dump = f.db.dump();
    let calls = 0;
    const r = await runLinks(applyOpts(f, m, { resolvePrincipal: async () => { calls += 1; return calls === 1 ? PRINCIPAL : second; } }));
    assert.equal(r.ok, false, name); assert.equal(r.rejected, code, name); assert.equal(calls, 2, name);
    assert.equal(f.db.dump(), dump, name); assert.equal(f.db.log.commits.length, 0, name);
  }
  // The clock jumps while the transaction is reading, after both pre-transaction credential checks passed.
  const tick = { t: NOW };
  const f = makeFixture({ db: { failGet: () => { tick.t = NOW + 60e3; return false; } } }); const m = await sealed(f);
  tick.t = NOW; // sealing ran its own (non-transactional) reads only; reset anyway
  const r = await runLinks(applyOpts(f, m, { now: () => tick.t, resolvePrincipal: async () => ({ ...PRINCIPAL, expiresAtMs: NOW + 130e3 }) }));
  assert.equal(r.rejected, 'principal_expired', 'expiry is also enforced inside the transaction, not only at the gate');
  assert.equal(f.db.log.commits.length, 0);
});

test('manifests cannot be edited to add Ferrari, change a target or reorder pairs, even when re-sealed', async () => {
  const f = makeFixture();
  const m = await sealed(f);
  const edits = {
    addFerrari: c => c.operations.push({ ...c.operations[0], bomId: 'PRJ-013', docPath: 'projects/PRJ-013', pulseProjectId: 1234 }),
    swapTarget: c => { c.operations[0].pulseProjectId = 1911; },
    swapDoc: c => { c.operations[0].docPath = 'projects/PRJ-013'; },
    dropOne: c => c.operations.pop(),
    reorder: c => c.operations.reverse(),
    otherField: c => { c.operations[0].field = 'members'; },
    stringTarget: c => { c.operations[0].pulseProjectId = '1910'; },
    badBefore: c => { c.operations[0].before = { present: true, value: 1910 }; },
    extraOpKey: c => { c.operations[0].extra = 1; },
    confirmationEdited: c => { c.humanConfirmation.reference = 'whatever'; },
    sqlRowEdited: c => { c.sql.rows[0].exists = false; },
    fbUid: c => { c.operatorAttribution.firebaseUid = 'abc'; },
    modeEdited: c => { c.mode = 'apply'; },
    extraTop: c => { c.mappings = {}; },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const g = makeFixture(); const dump = g.db.dump();
    const r = await runLinks(applyOpts(g, reseal(m, edit)));
    assert.equal(r.ok, false, name);
    assert.ok(['manifest_pairs_invalid', 'manifest_invalid', 'manifest_schema_invalid', 'sql_snapshot_invalid', 'sql_row_missing'].includes(r.rejected), `${name}: ${r.rejected}`);
    assert.equal(g.db.dump(), dump, name);
  }
});

test('backup unavailable fails closed: no Firestore write, no claim of applied', async () => {
  for (const mode of ['fail', 'badHash']) {
    const f = makeFixture(); const m = await sealed(f); const dump = f.db.dump();
    f.store[mode] = true;
    const r = await runLinks(applyOpts(f, m));
    assert.equal(r.ok, false); assert.equal(r.rejected, 'preimage_unavailable');
    assert.equal(f.db.dump(), dump); assert.equal(f.db.log.commits.length, 0);
  }
});

test('stale manifest: any project change since planning blocks everything (all-or-nothing)', async () => {
  for (const id of BOM_IDS) {
    const f = makeFixture(); const m = await sealed(f);
    f.db.mutate(`projects/${id}`, { description: 'edited by a user' });
    const dump = f.db.dump();
    const r = await runLinks(applyOpts(f, m));
    assert.equal(r.ok, false); assert.ok(codes(r).includes('stale_update_time'), codes(r).join());
    assert.equal(f.db.dump(), dump); assert.equal(f.store.saved.length, 0);
  }
});

test('identity drift (renamed project) and a field changed by a legacy writer are separate blockers', async () => {
  const f = makeFixture(); const m = await sealed(f);
  f.db.mutate('projects/PRJ-017', { projectName: 'Different' });
  assert.ok(codes(await runLinks(applyOpts(f, m))).includes('stale_update_time'));
  const g = makeFixture(); const m2 = await sealed(g);
  g.db.mutate('projects/PRJ-016', { pulseProjectId: 5 });
  const r = await runLinks(applyOpts(g, m2));
  assert.equal(r.ok, false); assert.equal(g.db.docs.get('projects/PRJ-016').data.pulseProjectId, 5);
});

test('races inside the transaction abort all four: a concurrent edit, a new collision and a control flip', async () => {
  const races = {
    edit: db => db.mutate('projects/PRJ-012', { description: 'raced' }),
    collision: db => db.put('projects/RACE-1', targetDoc('Race', { pulseProjectId: '1864' })),
    control: db => db.mutate('pulseRuntimeControl/cutover', { mode: 'read_only' }),
  };
  for (const [name, race] of Object.entries(races)) {
    let fired = false;
    const f = makeFixture({ db: { beforeCommit: async (db, attempt) => { if (!fired) { fired = true; race(db); } } } });
    const m = await sealed(f);
    const r = await runLinks(applyOpts(f, m));
    assert.equal(r.ok, false, name);
    for (const id of BOM_IDS) assert.notEqual(f.db.docs.get(`projects/${id}`).data.pulseProjectId, TARGETS[id], `${name} ${id}`);
    assert.equal(f.db.log.commits.length, 0, name);
    assert.equal([...f.db.docs.keys()].some(p => p.startsWith(RUN_COLLECTION)), false, name);
  }
});

test('commit-time failure of ONE project aborts the whole transaction (no partial application)', async () => {
  const f = makeFixture({ db: { ignoreReadConflicts: true, beforeCommit: async db => { db.remove('projects/PRJ-012'); } } });
  const m = await sealed(f);
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.equal(r.rejected, 'transaction_failed');
  for (const id of ['PRJ-015', 'PRJ-017', 'PRJ-016']) assert.notEqual(f.db.docs.get(`projects/${id}`).data.pulseProjectId, TARGETS[id]);
  assert.equal(f.db.log.commits.length, 0);
});

test('read failures and commit failures leave no writes and report only a sanitized code', async () => {
  const f = makeFixture({ db: { failGet: p => p === 'projects/PRJ-016' } });
  f.db.failGetOn = true;
  const m = await sealed(makeFixture());
  const r = await runLinks(applyOpts(f, { ...m }));
  assert.equal(r.ok, false);
  assert.equal(f.db.log.commits.length, 0);
  assert.ok(!JSON.stringify(r).includes('UNAVAILABLE'));
  const g = makeFixture({ db: { failCommit: true } }); const gm = await sealed(g);
  const gr = await runLinks(applyOpts(g, gm));
  assert.equal(gr.ok, false); assert.equal(gr.rejected, 'transaction_failed'); assert.equal(g.db.log.commits.length, 0);
  assert.ok(!JSON.stringify(gr).includes('UNAVAILABLE'));
});

test('lost commit acknowledgement is reported as failed, and re-running the same manifest verifies without writing', async () => {
  const f = makeFixture({ db: { afterCommitThrow: true } });
  const m = await sealed(f);
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.equal(r.rejected, 'transaction_failed');
  assert.equal(f.db.log.commits.length, 1); // it did commit
  const again = await runLinks(applyOpts(f, m));
  assert.equal(again.ok, true); assert.equal(again.status, 'already_applied');
  assert.equal(f.db.log.commits.length, 1);
});

test('replay writes NOTHING, saves no preimage, and verifies all four links plus the matching receipt', async () => {
  const f = makeFixture(); const m = await sealed(f);
  assert.equal((await runLinks(applyOpts(f, m))).ok, true);
  const dump = f.db.dump(); const saved = f.store.saved.length;
  const r = await runLinks({ ...applyOpts(f, m), db: readOnlyDb(f.db) });
  assert.equal(r.ok, true); assert.equal(r.status, 'already_applied');
  assert.deepEqual(r.counts, { operations: 4, ready: 0, applied: 0, verified: 4, blocked: 0 });
  assert.equal(f.db.dump(), dump); assert.equal(f.store.saved.length, saved);
  const viaDry = await runLinks({ ...f.base, db: readOnlyDb(f.db), mode: 'dry-run', manifest: m, expectedManifestSha: m.manifestSha256 });
  assert.equal(viaDry.ok, true); assert.equal(viaDry.status, 'already_applied');
});

test('replay by a different principal is refused and does not claim success', async () => {
  const f = makeFixture(); const m = await sealed(f);
  await runLinks(applyOpts(f, m));
  f.principalState.value = { ...PRINCIPAL, principal: 'other@example.test' };
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.equal(r.rejected, 'principal_mismatch');
});

test('a link set by a legacy writer WITHOUT our receipt is never reported as applied', async () => {
  const f = makeFixture(); const m = await sealed(f);
  f.db.mutate('projects/PRJ-017', { pulseProjectId: 2069 });
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.notEqual(r.status, 'applied'); assert.notEqual(r.status, 'already_applied');
  assert.equal(f.db.log.commits.length, 0);
  const g = makeFixture();
  for (const id of BOM_IDS) g.db.mutate(`projects/${id}`, { pulseProjectId: TARGETS[id] });
  const gp = await plan(g);
  assert.equal(gp.ok, false); assert.ok(codes(gp).includes('link_without_receipt'));
});

test('after apply, a link later removed or overwritten by an old client makes replay fail loudly', async () => {
  const f = makeFixture(); const m = await sealed(f);
  await runLinks(applyOpts(f, m));
  f.db.mutate('projects/PRJ-015', { pulseProjectId: 777 });
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.ok(codes(r).includes('receipt_link_diverged'));
  assert.notEqual(r.status, 'already_applied');
});

test('receipt and audit tampering is detected on replay and on re-apply, never silently accepted', async () => {
  const tampers = {
    afterValue: (db, rp) => { const d = db.docs.get(rp).data; d.operations[0].after.value = 1911; },
    principal: (db, rp) => { db.docs.get(rp).data.credentialPrincipal = 'evil@example.test'; },
    manifestSha: (db, rp) => { db.docs.get(rp).data.manifestSha256 = 'a'.repeat(64); },
    firebaseUid: (db, rp) => { db.docs.get(rp).data.firebaseUid = 'u1'; },
    extraKey: (db, rp) => { db.docs.get(rp).data.note = 'x'; },
    reorder: (db, rp) => { db.docs.get(rp).data.operations.reverse(); },
    badPrincipalHash: (db, rp) => { db.docs.get(rp).data.principalSha256 = 'b'.repeat(64); },
    badOperator: (db, rp) => { db.docs.get(rp).data.operator = ''; },
    sqlSha: (db, rp) => { db.docs.get(rp).data.sqlSnapshotSha256 = 'c'.repeat(64); },
    auditMissing: (db, rp) => { db.docs.delete(`${rp}/audit/PRJ-012`); },
    auditEdited: (db, rp) => { db.docs.get(`${rp}/audit/PRJ-017`).data.after = { value: 5 }; },
    auditUid: (db, rp) => { db.docs.get(`${rp}/audit/PRJ-016`).data.firebaseUid = 'u9'; },
  };
  for (const [name, tamper] of Object.entries(tampers)) {
    const f = makeFixture(); const m = await sealed(f);
    await runLinks(applyOpts(f, m));
    tamper(f.db, `${RUN_COLLECTION}/${m.manifestSha256}`);
    const dump = f.db.dump();
    const r = await runLinks(applyOpts(f, m));
    assert.equal(r.ok, false, name); assert.notEqual(r.status, 'already_applied', name);
    assert.ok(codes(r).includes('receipt_conflict'), `${name}: ${codes(r)}`);
    assert.equal(f.db.dump(), dump, name);
  }
});

test('a pre-existing receipt without the links (re-apply after manual link removal) is a conflict, not a second apply', async () => {
  const f = makeFixture(); const m = await sealed(f);
  f.db.put(`${RUN_COLLECTION}/${m.manifestSha256}`, { schema: 'x' });
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.ok(codes(r).includes('receipt_conflict'));
  assert.equal(f.db.log.commits.length, 0);
});

test('post-verification reports collisions that appear after the commit without pretending they were prevented', async () => {
  let fired = false;
  const f = makeFixture({ db: { } });
  const m = await sealed(f);
  const real = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = async fn => { const out = await real(fn); if (!fired) { fired = true; f.db.put('projects/LATE', targetDoc('Late', { pulseProjectId: 1910 })); } return out; };
  const r = await runLinks(applyOpts(f, m));
  assert.equal(r.ok, false); assert.equal(r.rejected, 'post_verification_failed'); assert.equal(r.committed, true);
  assert.deepEqual(r.postVerification.collisions.map(c => c.docId), ['LATE']);
});

test('recovery guard binds to the receipt SNAPSHOT updateTime, never to receipt data, and fails closed without it', async () => {
  const f = makeFixture(); const m = await sealed(f);
  await runLinks(applyOpts(f, m));
  const rsnap = await f.db.doc(`${RUN_COLLECTION}/${m.manifestSha256}`).get();
  const receipt = rsnap.data();
  assert.notEqual(tsKey(receipt.appliedAt), tsKey(rsnap.updateTime));
  const pre = f.store.saved[0];
  const snap = id => f.db.doc(`projects/${id}`).get();
  const withReceipt = (patch, ...explicit) => ({ exists: true, data: () => ({ ...receipt, ...patch }), updateTime: explicit.length ? explicit[0] : rsnap.updateTime });
  const ok = await evaluateRecovery({ bomId: 'PRJ-017', receiptSnapshot: rsnap, preimage: pre, project: await snap('PRJ-017') });
  assert.deepEqual([ok.allowed, ok.action], [true, 'delete_field']);
  assert.equal(ok.guard.updateTime, tsKey(rsnap.updateTime));
  const okNull = await evaluateRecovery({ bomId: 'PRJ-015', receiptSnapshot: rsnap, preimage: pre, project: await snap('PRJ-015') });
  assert.deepEqual([okNull.allowed, okNull.action], [true, 'set_null']);
  const bad = async (over, id = 'PRJ-017') => evaluateRecovery({ bomId: id, receiptSnapshot: rsnap, preimage: pre, project: await snap(id), ...over });
  assert.equal((await bad({ bomId: 'PRJ-013' })).allowed, false);
  assert.equal((await bad({ preimage: { ...pre, manifestSha256: 'd'.repeat(64) } })).allowed, false);
  assert.equal((await bad({ preimage: { ...pre, operations: pre.operations.slice(1) } })).allowed, false);
  assert.equal((await bad({ receiptSnapshot: withReceipt({ preimageSha256: 'e'.repeat(64) }) })).allowed, false);
  assert.equal((await bad({ receiptSnapshot: withReceipt({ firebaseUid: 'u1' }) })).allowed, false);
  assert.equal((await bad({ project: { exists: false } })).code, 'project_missing');
  // missing or unusable trusted metadata: reject, even when receipt DATA carries a matching-looking version
  const pv = tsKey((await snap('PRJ-017')).updateTime);
  const forged = { appliedAt: (await snap('PRJ-017')).updateTime, commitVersion: pv, version: pv };
  for (const receiptSnapshot of [withReceipt(forged, undefined), withReceipt(forged, null), withReceipt(forged, { seconds: 1, nanoseconds: 2 }), undefined, { exists: false }, { data: () => receipt }]) {
    assert.equal((await bad({ receiptSnapshot })).code, 'receipt_metadata_missing');
  }
  // receipt DATA claiming the project's current version does not help when the snapshot version differs
  assert.equal((await bad({ receiptSnapshot: withReceipt(forged, new Timestamp(1, 1)) })).code, 'modified_since_apply');
  // the old contract (a raw receipt object whose appliedAt equals the project version) is no longer accepted
  assert.equal((await bad({ receiptSnapshot: undefined, receipt: { ...receipt, appliedAt: (await snap('PRJ-017')).updateTime } })).code, 'receipt_metadata_missing');
  // a later user edit to an unrelated field moves the version: leave it untouched
  f.db.mutate('projects/PRJ-017', { description: 'later user edit' });
  assert.equal((await bad({ project: await snap('PRJ-017') })).code, 'modified_since_apply');
  // a later legacy overwrite of the link itself
  f.db.mutate('projects/PRJ-016', { pulseProjectId: 5 });
  assert.equal((await bad({ project: await snap('PRJ-016') }, 'PRJ-016')).code, 'value_changed_since_apply');
});

test('post-commit verification binds to the receipt snapshot version and reports a late unrelated edit or missing metadata', async () => {
  const f = makeFixture(); const m = await sealed(f);
  const r = await runLinks(applyOpts(f, m));
  const rsnap = await f.db.doc(`${RUN_COLLECTION}/${m.manifestSha256}`).get();
  assert.equal(r.postVerification.commitVersion, tsKey(rsnap.updateTime));
  assert.equal(r.postVerification.linksVerified, 4);

  const g = makeFixture(); const gm = await sealed(g);
  const real = g.db.runTransaction.bind(g.db);
  g.db.runTransaction = async fn => { const out = await real(fn); g.db.mutate('projects/PRJ-017', { description: 'edited between commit and verification' }); return out; };
  const gr = await runLinks(applyOpts(g, gm));
  assert.equal(gr.rejected, 'post_verification_failed'); assert.equal(gr.committed, true); assert.equal(gr.postVerification.linksVerified, 3);

  const h = makeFixture(); const hm = await sealed(h);
  const receiptPath = `${RUN_COLLECTION}/${hm.manifestSha256}`;
  const noMeta = { doc: p => (p === receiptPath ? { path: p, get: async () => ({ ...(await h.db.doc(p).get()), updateTime: undefined }) } : h.db.doc(p)),
    collection: h.db.collection, runTransaction: h.db.runTransaction };
  const hr = await runLinks(applyOpts(h, hm, { db: noMeta }));
  assert.equal(hr.rejected, 'receipt_metadata_missing'); assert.equal(hr.committed, true);
});

test('replay stays a zero-write success after later unrelated edits while links remain, and fails closed without receipt metadata', async () => {
  const f = makeFixture(); const m = await sealed(f);
  await runLinks(applyOpts(f, m));
  f.db.mutate('projects/PRJ-017', { description: 'later user edit' });
  const dump = f.db.dump();
  const r = await runLinks({ ...applyOpts(f, m), db: readOnlyDb(f.db) });
  assert.equal(r.ok, true); assert.equal(r.status, 'already_applied');
  assert.deepEqual(r.postVerification.modifiedSinceApply, ['PRJ-017']);
  assert.equal(f.db.dump(), dump); assert.equal(f.db.log.commits.length, 1);
  const receiptPath = `${RUN_COLLECTION}/${m.manifestSha256}`;
  const noMeta = { doc: p => (p === receiptPath ? { path: p, get: async () => ({ ...(await f.db.doc(p).get()), updateTime: undefined }) } : f.db.doc(p)), collection: f.db.collection,
    runTransaction: async () => { throw new Error('write path used'); } };
  const rm = await runLinks({ ...applyOpts(f, m), db: noMeta });
  assert.equal(rm.ok, false); assert.ok(codes(rm).includes('receipt_metadata_missing')); assert.notEqual(rm.status, 'already_applied');
});

test('manifest and SQL freshness are bounded to 15 minutes, inclusive of the boundary', async () => {
  const MIN15 = 15 * 60e3;
  const f = makeFixture();
  const at = ms => ({ sha256: f.sqlSnapshot.sha256, data: { ...f.sqlSnapshot.data, capturedAt: new Date(NOW - ms).toISOString() } });
  assert.equal((await plan(f, { sqlSnapshot: at(MIN15) })).ok, true);
  assert.equal((await plan(f, { sqlSnapshot: at(MIN15 + 1) })).rejected, 'sql_snapshot_stale');
  assert.equal((await plan(f, { sqlSnapshot: at(60 * 60e3) })).rejected, 'sql_snapshot_stale');
  // manifest age, with an SQL snapshot taken at the same instant so only the manifest bound is exercised
  const g = makeFixture();
  const planned = await plan(g, { sqlSnapshot: { sha256: g.sqlSnapshot.sha256, data: { ...g.sqlSnapshot.data, capturedAt: new Date(NOW).toISOString() } } });
  assert.equal(planned.ok, true);
  const m = planned.manifest;
  const verify = () => runLinks({ ...g.base, mode: 'dry-run', manifest: m, expectedManifestSha: m.manifestSha256 });
  g.clock.t = NOW + MIN15;
  assert.equal((await verify()).ok, true);
  g.clock.t = NOW + MIN15 + 1;
  assert.equal((await verify()).rejected, 'manifest_stale');
  assert.equal(g.db.log.commits.length, 0);
});

test('token info resolver: proven only for a verified email, subject and unexpired token; errors are sanitized', async () => {
  const now = () => NOW;
  const make = info => createTokeninfoResolver({ getAccessToken: async () => 'SECRET-TOKEN-VALUE', fetchTokenInfo: async () => info, now });
  const good = await make({ email: 'Operator@Example.test', email_verified: 'true', sub: '42', exp: String(Math.floor(NOW / 1000) + 600) })();
  assert.deepEqual(good, { proven: true, principal: 'operator@example.test', subject: 'google:42', expiresAtMs: (Math.floor(NOW / 1000) + 600) * 1000 });
  assert.equal((await make({ email: 'a@b.test', email_verified: true, sub: '1', expiry_date: NOW + 5000 })()).proven, true);
  assert.equal((await make({ email: 'a@b.test', email_verified: 'true', user_id: '1', expires_in: '300' })()).proven, true);
  for (const bad of [{ email: 'a@b.test', email_verified: true, sub: '1', exp: String(Math.floor(NOW / 1000) - 5) }, { email: 'a@b.test', email_verified: true, sub: '1' }, { email_verified: true, sub: '1', exp: String(Math.floor(NOW / 1000) + 99) },
    { email: 'a@b.test', sub: '1', exp: String(Math.floor(NOW / 1000) + 99) }, { email: 'a@b.test', email_verified: undefined, sub: '1', expiry_date: NOW + 5000 },
    { email: 'a@b.test', email_verified: null, sub: '1', exp: String(Math.floor(NOW / 1000) + 99) }, { email: 'a@b.test', email_verified: 1, sub: '1', exp: String(Math.floor(NOW / 1000) + 99) },
    { email: 'a@b.test', email_verified: 'TRUE ', sub: '1', exp: String(Math.floor(NOW / 1000) + 99) },
    { email: 'a@b.test', email_verified: 'false', sub: '1', exp: String(Math.floor(NOW / 1000) + 99) }, { email: 'a@b.test', email_verified: true, sub: '', exp: String(Math.floor(NOW / 1000) + 99) }, null, 'x']) {
    assert.deepEqual(await make(bad)(), { proven: false });
  }
  const leaky = createTokeninfoResolver({ getAccessToken: async () => 'SECRET-TOKEN-VALUE', fetchTokenInfo: async t => { throw new Error(`bad ${t}`); }, now });
  const out = await leaky(); assert.deepEqual(out, { proven: false }); assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.deepEqual(await createTokeninfoResolver({ getAccessToken: async () => { throw new Error('x'); }, fetchTokenInfo: async () => ({}), now })(), { proven: false });
  assert.ok(!JSON.stringify(good).includes('SECRET'));
});

test('no run result, manifest, receipt or preimage contains token-like material', async () => {
  const f = makeFixture();
  const r = await plan(f); const a = await runLinks(applyOpts(f, r.manifest));
  const everything = JSON.stringify([r, a, f.store.saved, [...f.db.docs.values()].map(x => x.data)]);
  assert.ok(!/access_token|ya29\.|Bearer|SECRET/i.test(everything));
});

test('CLI arguments: pair mappings and unsafe combinations are rejected', () => {
  const ok = parseArgs(['--project=p', '--sql-snapshot=/tmp/x.json']);
  assert.equal(ok.apply, false);
  for (const bad of [['--project=p', '--pair=PRJ-013:5'], ['--project=p', '--map=a'], ['--project=p', '--sql-snapshot=a', '--sql-snapshot=b'], ['--project=p', '--apply'],
    ['--project=p', '--operator=abc', '--sql-snapshot=a'], ['--project=p', '--apply', '--manifest=m', '--expected-manifest-sha=' + 'a'.repeat(64), '--operator=rahul-ops'],
    ['--project=p', '--apply', '--manifest=m', '--expected-manifest-sha=' + 'a'.repeat(64), '--operator=rahul-ops', '--preimage-dir=/x', '--sql-snapshot=s'],
    ['--project=p', '--manifest=m'], ['--sql-snapshot=a'], ['positional'], ['--project=p', '--sql-snapshot=a', '--manifest=m', '--expected-manifest-sha=' + 'a'.repeat(64)]]) {
    assert.throws(() => parseArgs(bad), /usage_/, bad.join(' '));
  }
  const apply = parseArgs(['--project=p', '--apply', '--manifest=m', '--expected-manifest-sha=' + 'a'.repeat(64), '--operator=rahul-ops', '--preimage-dir=/x']);
  assert.equal(apply.apply, true);
});

test('CLI main: no arguments touches nothing; bad usage never loads Firebase; output carries no secrets', async () => {
  let loaded = 0; const lines = [];
  const deps = { loadRuntime: async () => { loaded += 1; throw new Error('must not load'); }, out: l => lines.push(l), err: l => lines.push(l), env: {} };
  assert.equal(await main([], deps), 2);
  assert.equal(await main(['--project=p', '--pair=PRJ-013:5'], deps), 2);
  assert.equal(await main(['--project=p', '--apply', '--manifest=m', '--expected-manifest-sha=' + 'a'.repeat(64), '--operator=rahul-ops', '--preimage-dir=/x'], { ...deps, env: { FIRESTORE_EMULATOR_HOST: 'localhost:8080' } }), 2);
  assert.equal(loaded, 0);
});

test('CLI main plan: reads the sql snapshot bytes, hashes them, prints the manifest and writes it create-exclusively outside git', async () => {
  const f = makeFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-cli-'));
  const sqlFile = path.join(dir, 'sql.json'); const bytes = JSON.stringify(f.sqlSnapshot.data); fs.writeFileSync(sqlFile, bytes);
  const outFile = path.join(dir, 'manifest.json'); const lines = [];
  const deps = { loadRuntime: async () => ({ db: f.db, serverTimestamp: () => SERVER_TS, resolvePrincipal: async () => PRINCIPAL }), out: l => lines.push(l), err: l => lines.push(l), env: {}, now: () => NOW };
  assert.equal(await main([`--project=${PROJECT}`, `--sql-snapshot=${sqlFile}`, `--manifest-out=${outFile}`], deps), 0);
  const printed = JSON.parse(lines.join('\n'));
  assert.equal(printed.manifest.sql.snapshotSha256, require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')), printed.manifest);
  assert.equal(await main([`--project=${PROJECT}`, `--sql-snapshot=${sqlFile}`, `--manifest-out=${outFile}`], deps), 1); // refuses to overwrite
  assert.equal(f.db.log.commits.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('filesystem preimage store: absolute, outside git, create-exclusive, hash-verified, conflict-detecting', async () => {
  assert.throws(() => createFsPreimageStore('relative/dir'), /preimage_dir_invalid/);
  assert.throws(() => createFsPreimageStore(path.join(__dirname, 'inside-repo')), /preimage_dir_in_git/);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'links-pre-')), 'nested');
  const store = createFsPreimageStore(dir);
  const rec = { schema: 'bom-confirmed-pulse-links-preimage-v1', manifestSha256: 'a'.repeat(64), operations: [{ bomId: 'PRJ-015', before: { present: false } }] };
  const saved = await store.save(rec);
  assert.equal(saved.sha256, sha(rec));
  assert.equal((await store.save(rec)).sha256, sha(rec)); // idempotent retry
  await assert.rejects(store.save({ ...rec, operations: [] }), /preimage_conflict/);
  const file = path.join(dir, `${rec.manifestSha256}.preimage.json`);
  assert.equal(sha(JSON.parse(fs.readFileSync(file, 'utf8'))), sha(rec));
  await assert.rejects(store.save({ ...rec, manifestSha256: 'zz' }), /preimage_record_invalid/);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('end to end with the real filesystem store: plan, apply, replay', async () => {
  const f = makeFixture();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'links-e2e-')), 'pre');
  const m = await sealed(f);
  const opts = applyOpts(f, m, { preimageStore: createFsPreimageStore(dir) });
  assert.equal((await runLinks(opts)).status, 'applied');
  const file = path.join(dir, `${m.manifestSha256}.preimage.json`);
  assert.equal(sha(JSON.parse(fs.readFileSync(file, 'utf8'))), f.db.docs.get(`${RUN_COLLECTION}/${m.manifestSha256}`).data.preimageSha256);
  assert.equal((await runLinks(opts)).status, 'already_applied');
  assert.equal(f.db.log.commits.length, 1);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('the tool source performs no network, SQL, impersonation or native-flag access', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linkConfirmedPulseProjects.cjs'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  for (const banned of [/createCustomToken/, /verifyIdToken/, /signInWith/, /BOM_NATIVE_/, /\bsqlite/i, /child_process/, /\.set\(/, /\.delete\(\)/, /\bbatch\(/]) assert.ok(!banned.test(code), String(banned));
});
