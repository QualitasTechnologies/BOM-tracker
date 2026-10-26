const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/enrichLegacyEmailIdentity.cjs');

const { runEnrichment, canon, sha, parseArgs, createFsPreimageStore, RECEIPT_COLLECTION } = core;
const PROJECT = 'test-project', PROJECT_DOC = 'PD-1', PULSE_ID = 721, PRINCIPAL = 'operator@example.test';
const EMAILS = `projects/${PROJECT_DOC}/emails/`;

class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
}
function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

// In-memory Firestore double: optimistic transactions that retry on read conflicts, all-or-nothing commits, create-only semantics.
function createFakeDb({ ignoreReadConflicts = false, beforeCommit = null } = {}) {
  const docs = new Map();
  const log = { updates: [], creates: [], other: 0 };
  let counter = 0;
  const stamp = ver => new Timestamp(1789000000 + ver, 679503000);
  const snapshot = p => {
    const rec = docs.get(p);
    return { id: p.split('/').at(-1), exists: Boolean(rec), data: () => (rec ? clone(rec.data) : undefined), updateTime: rec ? stamp(rec.ver) : undefined };
  };
  const ref = p => ({ path: p, get: async () => snapshot(p) });
  const put = (p, data) => { docs.set(p, { data: clone(data), ver: ++counter }); };
  const db = {
    docs, log, put, doc: ref,
    mutate(p, patch) { const rec = docs.get(p); rec.data = { ...rec.data, ...clone(patch) }; rec.ver = ++counter; },
    async runTransaction(fn) {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const reads = new Map(), writes = [];
        const tx = {
          get: async r => { reads.set(r.path, docs.get(r.path)?.ver ?? 0); return snapshot(r.path); },
          update: (r, data) => writes.push(['update', r.path, clone(data)]),
          create: (r, data) => writes.push(['create', r.path, clone(data)]),
        };
        const out = await fn(tx);
        if (beforeCommit) await beforeCommit(db, attempt);
        if (!ignoreReadConflicts && [...reads].some(([p, ver]) => (docs.get(p)?.ver ?? 0) !== ver)) continue;
        for (const [kind, p] of writes) {
          if (kind === 'update' && !docs.has(p)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
          if (kind === 'create' && docs.has(p)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        }
        for (const [kind, p, data] of writes) {
          if (kind === 'update') { const rec = docs.get(p); rec.data = { ...rec.data, ...data }; rec.ver = ++counter; log.updates.push([p, Object.keys(data)]); }
          else { put(p, data); log.creates.push(p); }
        }
        return out;
      }
      throw Object.assign(new Error('ABORTED'), { code: 10 });
    },
  };
  return db;
}
// A db that fails the test on any write attempt, to prove read-only paths cannot mutate.
function readOnlyDb(db) {
  return { doc: db.doc, runTransaction: async () => { throw new Error('write path used'); } };
}

function makeFixture(count = 24, { control } = {}) {
  const db = createFakeDb();
  db.put(`projects/${PROJECT_DOC}`, { pulseProjectId: PULSE_ID, memberIds: ['u1', 'u2'], projectName: 'Alpha', clientName: 'Client', clientId: 'c1', status: 'Completed' });
  if (control) db.put(core.CONTROL_PATH, control);
  const candidates = [], operations = [];
  const originals = new Map();
  for (let i = 0; i < count; i += 1) {
    const gmail = `gmail-${i}`, thread = `thread-${i}`, rfc = `msg-${i}.token@mail.example.test`, docId = `doc${i}`;
    const data = { gmailMessageId: gmail, gmailThreadId: thread, subject: `Subject ${i}`, body: `RAW <b>body</b> ${i}\r\n  keep spacing`, direction: i % 2 ? 'inbound' : 'outbound',
      sentAt: new Timestamp(1770000000 + i, 123456789), createdAt: new Timestamp(1770000100 + i, 5), from: { name: 'A', email: 'a@x.test' }, to: [{ email: 'b@x.test' }],
      cc: [], matchedStakeholderEmails: ['b@x.test'], sanitizeFailed: false };
    db.put(EMAILS + docId, data);
    originals.set(EMAILS + docId, clone(data));
    candidates.push({ gmail_id: gmail, thread_id: thread, rfc_message_id: rfc, refs: [{ pulse_id: PULSE_ID }] });
    operations.push({ docPath: EMAILS + docId, docId, rfc, gmail });
  }
  const candidateFile = { sha256: sha('candidate-file-bytes'), candidates };
  const manifest = buildManifest(db, operations, candidateFile);
  return { db, candidateFile, manifest, originals, operations };
}
function buildManifest(db, operations, candidateFile, overrides = {}) {
  const project = db.docs.get(`projects/${PROJECT_DOC}`).data;
  const body = {
    schema: 'bom-email-identity-enrichment-dryrun-v1', mode: 'dry-run', createdAt: '2026-10-26T00:00:00.000Z', firebaseProject: PROJECT, projectDoc: PROJECT_DOC,
    projectChecks: { exists: true, pulseProjectIdMatches: true, identityFieldsSha256: core.projectIdentityHash(project) },
    candidateFileSha256: candidateFile.sha256,
    counts: { candidates: operations.length, planned: operations.length, noop: 0, blocked: 0 },
    operatorAttribution: { credentialPrincipal: PRINCIPAL, proven: true, firebaseUid: null },
    operations: operations.map(o => {
      const rec = db.docs.get(o.docPath);
      return { operationKey: sha([PROJECT_DOC, o.docId, 'rfcMessageId', sha(o.rfc)].join('|')), docPath: o.docPath,
        docUpdateTime: core.tsKey(new Timestamp(1789000000 + rec.ver, 679503000)), preservedFieldsSha256: core.preservedFingerprint(rec.data),
        identity: { gmailMessageIdSha256: sha(o.gmail) }, status: 'planned', blockers: [],
        writes: { rfcMessageId: { mode: 'fill_only', precondition: 'absent', storedForm: 'angle_bracketed', valueSha256: sha(`<${o.rfc}>`), valueRef: { gmailIdSha256: sha(o.gmail) } } },
        mailboxEmail: { decision: 'withheld_unproven', corroboration: 'none' } };
    }),
    ...overrides,
  };
  return seal(body);
}
const seal = body => { const { manifestSha256, ...rest } = body; return { ...rest, manifestSha256: sha(rest) }; };
const reseal = (manifest, edit) => { const copy = JSON.parse(JSON.stringify(manifest)); edit(copy); return seal(copy); };

function memoryStore() {
  const saved = [];
  return { saved, async save(record) { saved.push(JSON.parse(JSON.stringify(record))); } };
}
function options(f, extra = {}) {
  return { db: f.db, manifest: f.manifest, expectedManifestSha: f.manifest.manifestSha256, candidateFile: f.candidateFile, expectedProject: PROJECT,
    expectedPulseProjectId: PULSE_ID, mode: 'apply', operator: 'rahul-ops', principal: { proven: true, principal: PRINCIPAL }, preimageStore: memoryStore(),
    serverTimestamp: () => new Date('2026-10-26T10:00:00Z'), ...extra };
}
const writesSoFar = db => db.log.updates.length + db.log.creates.length;
const snapshotAll = db => JSON.stringify([...db.docs].map(([p, r]) => [p, canon(r.data), r.ver]));

test('dry run reads everything but cannot write, and reports 24 fill-only candidates', async () => {
  const f = makeFixture();
  const before = snapshotAll(f.db);
  const result = await runEnrichment(options({ ...f, db: readOnlyDb(f.db) }, { mode: 'dry-run', operator: undefined, principal: undefined, preimageStore: undefined, serverTimestamp: undefined }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { operations: 24, ready: 24, noopEqual: 0, noopReplayed: 0, blocked: 0, applied: 0 });
  assert.equal(snapshotAll(f.db), before);
});

test('mode defaults to dry-run when omitted', async () => {
  const f = makeFixture(2);
  const { mode, ...rest } = options({ ...f, db: readOnlyDb(f.db) });
  const result = await runEnrichment(rest);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.ok, true);
});

test('apply fills only rfcMessageId on 24 docs and preserves every other byte-for-byte field', async () => {
  const f = makeFixture();
  const store = memoryStore();
  const result = await runEnrichment(options(f, { preimageStore: store }));
  assert.equal(result.ok, true);
  assert.equal(result.counts.applied, 24);
  for (const [p, original] of f.originals) {
    const now = f.db.docs.get(p).data;
    const op = f.operations.find(o => o.docPath === p);
    assert.equal(now.rfcMessageId, `<${op.rfc}>`);
    const { rfcMessageId, ...rest } = now;
    assert.equal(canon(rest), canon(original));
    assert.equal(Object.hasOwn(now, 'mailboxEmail'), false);
    assert.equal(Object.hasOwn(now, 'updatedAt'), false);
  }
  assert.equal(f.db.log.updates.length, 24);
  assert.ok(f.db.log.updates.every(([, keys]) => keys.join() === 'rfcMessageId'));
  assert.equal(f.db.log.creates.length, 24);
  assert.ok(f.db.log.creates.every(p => p.startsWith(`${RECEIPT_COLLECTION}/`)));
  assert.equal(store.saved.length, 24);
  assert.ok(store.saved.every(r => r.presence === 'absent' && r.field === 'rfcMessageId' && Object.keys(r).every(k => k !== 'rawValue')));
  const receipt = f.db.docs.get(`${RECEIPT_COLLECTION}/${f.manifest.operations[0].operationKey}`).data;
  assert.equal(receipt.principalSha256, sha(PRINCIPAL));
  assert.equal(JSON.stringify(receipt).includes(PRINCIPAL), false);
  assert.equal(JSON.stringify(receipt).includes('msg-0.token'), false);
});

test('rerun after full success is a replay no-op with zero further writes', async () => {
  const f = makeFixture();
  await runEnrichment(options(f));
  const writes = writesSoFar(f.db), snap = snapshotAll(f.db);
  const again = await runEnrichment(options(f));
  assert.equal(again.ok, true);
  assert.equal(again.counts.noopReplayed, 24);
  assert.equal(again.counts.applied, 0);
  assert.equal(writesSoFar(f.db), writes);
  assert.equal(snapshotAll(f.db), snap);
});

test('interrupted run resumes: already-applied docs are no-ops and the rest are filled once', async () => {
  const f = makeFixture();
  let seen = 0;
  const failing = { saved: [], async save(r) { if (seen++ === 10) throw new Error('disk gone'); this.saved.push(r); } };
  const first = await runEnrichment(options(f, { preimageStore: failing }));
  assert.equal(first.ok, false);
  assert.equal(first.counts.applied, 10);
  const second = await runEnrichment(options(f));
  assert.equal(second.ok, true);
  assert.equal(second.counts.noopReplayed, 10);
  assert.equal(second.counts.applied, 14);
  assert.equal(f.db.log.updates.length, 24);
  assert.equal(new Set(f.db.log.updates.map(([p]) => p)).size, 24);
});

test('one doc changed since the dry run (stale updateTime) rejects the whole run with zero writes', async () => {
  const f = makeFixture();
  f.db.mutate(f.operations[7].docPath, { subject: 'edited later' });
  const result = await runEnrichment(options(f));
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, { stale_update_time: 1 });
  assert.equal(writesSoFar(f.db), 0);
});

test('non-write-set fingerprint mismatch rejects with zero writes even when updateTime matches', async () => {
  const f = makeFixture();
  const manifest = reseal(f.manifest, m => { m.operations[3].preservedFieldsSha256 = sha('different body'); });
  const result = await runEnrichment(options({ ...f, manifest }));
  assert.deepEqual(result.blockers, { stale_content_fingerprint: 1 });
  assert.equal(writesSoFar(f.db), 0);
});

test('project link or identity drift rejects with zero writes', async () => {
  for (const patch of [{ pulseProjectId: 722 }, { memberIds: ['u1'] }]) {
    const f = makeFixture(3);
    f.db.mutate(`projects/${PROJECT_DOC}`, patch);
    const result = await runEnrichment(options(f));
    assert.equal(result.ok, false);
    assert.equal(writesSoFar(f.db), 0);
    assert.equal(Object.keys(result.blockers).length, 1);
  }
});

test('candidate file hash, tampered candidate value, tampered manifest, and wrong pin all reject with zero writes', async () => {
  const cases = {
    candidate_file_hash_mismatch: f => ({ candidateFile: { ...f.candidateFile, sha256: sha('other') } }),
    candidate_value_mismatch: f => ({ candidateFile: { ...f.candidateFile, candidates: f.candidateFile.candidates.map((c, i) => (i === 2 ? { ...c, rfc_message_id: 'evil@mail.example.test' } : c)) } }),
    manifest_content_hash_mismatch: f => { const m = JSON.parse(JSON.stringify(f.manifest)); m.operations[0].docPath = EMAILS + 'other'; return { manifest: m }; },
    manifest_sha_pin_mismatch: () => ({ expectedManifestSha: sha('not the manifest') }),
    expected_manifest_sha_invalid: () => ({ expectedManifestSha: 'ABC' }),
  };
  for (const [code, build] of Object.entries(cases)) {
    const f = makeFixture(4);
    const result = await runEnrichment(options(f, build(f)));
    assert.equal(result.ok, false, code);
    assert.equal(result.rejected, code);
    assert.equal(writesSoFar(f.db), 0);
  }
});

test('manifest that plans a mailbox write, extra field, bad bounds, or wrong project is rejected', async () => {
  const f = makeFixture(4);
  const reject = async (edit, code) => {
    const manifest = reseal(f.manifest, edit);
    const result = await runEnrichment(options(f, { manifest, expectedManifestSha: manifest.manifestSha256 }));
    assert.equal(result.rejected, code);
    assert.equal(writesSoFar(f.db), 0);
  };
  await reject(m => { m.operations[0].writes.mailboxEmail = { mode: 'fill_only', precondition: 'absent' }; }, 'operation_write_set_invalid');
  await reject(m => { m.operations[0].mailboxEmail.decision = 'write'; }, 'operation_mailbox_not_withheld');
  await reject(m => { m.firebaseProject = 'other'; }, 'manifest_project_mismatch');
  await reject(m => { m.operations[1].docPath = `projects/OTHER/emails/doc1`; }, 'operation_path_invalid');
  await reject(m => { m.operations[1].status = 'blocked'; }, 'operation_not_planned');
  await reject(m => { m.operations[1].operationKey = sha('x'); }, 'operation_key_mismatch');
  await reject(m => { m.operatorAttribution.firebaseUid = 'fabricated'; }, 'manifest_principal_invalid');
  const big = makeFixture(25);
  assert.equal((await runEnrichment(options(big))).rejected, 'manifest_operation_bounds');
  assert.equal(writesSoFar(big.db), 0);
});

test('apply requires a proven principal equal to the sealed one, plus a valid operator label', async () => {
  const f = makeFixture(3);
  const check = async (extra, code) => {
    const result = await runEnrichment(options(f, extra));
    assert.equal(result.rejected, code);
    assert.equal(writesSoFar(f.db), 0);
  };
  await check({ principal: undefined }, 'principal_unproven');
  await check({ principal: { proven: false } }, 'principal_unproven');
  await check({ principal: { proven: true, principal: 'someone.else@example.test' } }, 'principal_mismatch');
  await check({ operator: undefined }, 'operator_label_invalid');
  await check({ operator: 'x' }, 'operator_label_invalid');
  await check({ operator: 'bad\nlabel' }, 'operator_label_invalid');
  await check({ preimageStore: undefined }, 'preimage_store_missing');
  await check({ mode: 'sync' }, 'mode_invalid');
  const ok = await runEnrichment(options(f, { principal: { proven: true, principal: PRINCIPAL.toUpperCase() } }));
  assert.equal(ok.ok, true);
});

test('a conflicting pre-existing receipt blocks the run without writes', async () => {
  const f = makeFixture(3);
  const key = f.manifest.operations[1].operationKey;
  f.db.put(`${RECEIPT_COLLECTION}/${key}`, { operationKey: key, valueSha256: sha('something else') });
  const absentField = await runEnrichment(options(f));
  assert.deepEqual(absentField.blockers, { receipt_without_field: 1 });
  assert.equal(writesSoFar(f.db), 0);
  f.db.mutate(f.operations[1].docPath, { rfcMessageId: `<${f.operations[1].rfc}>` });
  const withField = await runEnrichment(options(f));
  assert.deepEqual(withField.blockers, { receipt_conflict: 1 });
  assert.equal(writesSoFar(f.db), 0);
});

test('null is not absent, different values conflict, equal normalized values are untouched no-ops', async () => {
  const f = makeFixture(4);
  f.db.mutate(f.operations[0].docPath, { rfcMessageId: null });
  f.db.mutate(f.operations[1].docPath, { rfcMessageId: '<someone-else@mail.example.test>' });
  f.db.mutate(f.operations[2].docPath, { rfcMessageId: f.operations[2].rfc }); // unbracketed, equal after normalization
  f.db.mutate(f.operations[3].docPath, { rfcMessageId: 42 });
  const result = await runEnrichment(options(f));
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, { conflict_null_value: 1, conflict_existing_value: 2 });
  assert.equal(result.counts.noopEqual, 1);
  assert.equal(writesSoFar(f.db), 0);
  assert.equal(f.db.docs.get(f.operations[0].docPath).data.rfcMessageId, null);
  assert.equal(f.db.docs.get(f.operations[2].docPath).data.rfcMessageId, f.operations[2].rfc);
});

test('an equal existing value alone is a no-op: no write, no receipt, original form kept', async () => {
  const f = makeFixture(2);
  for (const o of f.operations) f.db.mutate(o.docPath, { rfcMessageId: o.rfc });
  const result = await runEnrichment(options(f));
  assert.equal(result.ok, true);
  assert.equal(result.counts.noopEqual, 2);
  assert.equal(writesSoFar(f.db), 0);
});

test('backup failure means no business write and no receipt', async () => {
  const f = makeFixture(5);
  const result = await runEnrichment(options(f, { preimageStore: { async save() { throw new Error('fsync failed'); } } }));
  assert.equal(result.ok, false);
  assert.equal(result.counts.applied, 0);
  assert.equal(writesSoFar(f.db), 0);
  assert.ok(f.operations.every(o => !Object.hasOwn(f.db.docs.get(o.docPath).data, 'rfcMessageId')));
});

test('a doc mutated between preflight and its transaction is rechecked, not clobbered; later docs are untouched', async () => {
  const f = makeFixture(6);
  const body = 'concurrent edit by someone else';
  const result = await runEnrichment(options(f, { hooks: { afterPreflight: async () => f.db.mutate(f.operations[2].docPath, { body }) } }));
  assert.equal(result.ok, false);
  assert.equal(result.halted, true);
  assert.deepEqual(result.blockers, { stale_update_time: 1 });
  assert.equal(f.db.docs.get(f.operations[2].docPath).data.body, body);
  assert.equal(Object.hasOwn(f.db.docs.get(f.operations[2].docPath).data, 'rfcMessageId'), false);
  assert.equal(result.counts.applied, 2);
  for (const o of f.operations.slice(3)) assert.equal(Object.hasOwn(f.db.docs.get(o.docPath).data, 'rfcMessageId'), false);
});

test('a conflicting writer racing the commit forces a transaction retry that reports a conflict instead of overwriting', async () => {
  const f = makeFixture(3);
  let raced = false;
  const racing = createFakeDb({ beforeCommit: async (db, attempt) => {
    if (!raced && attempt === 1) { raced = true; db.mutate(f.operations[0].docPath, { rfcMessageId: '<other-writer@mail.example.test>' }); }
  } });
  for (const [p, r] of f.db.docs) racing.put(p, r.data);
  const manifest = buildManifest(racing, f.operations, f.candidateFile);
  const result = await runEnrichment({ ...options({ ...f, db: racing, manifest }), expectedManifestSha: manifest.manifestSha256 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, { conflict_existing_value: 1 });
  assert.equal(racing.docs.get(f.operations[0].docPath).data.rfcMessageId, '<other-writer@mail.example.test>');
  assert.equal(racing.log.updates.length, 0);
  assert.equal(racing.log.creates.length, 0);
});

test('field update and receipt are atomic: a create-only receipt collision at commit leaves the field unset', async () => {
  const f = makeFixture(1);
  const key = f.manifest.operations[0].operationKey;
  const racing = createFakeDb({ ignoreReadConflicts: true, beforeCommit: async db => { if (!db.docs.has(`${RECEIPT_COLLECTION}/${key}`)) db.put(`${RECEIPT_COLLECTION}/${key}`, { operationKey: key }); } });
  for (const [p, r] of f.db.docs) racing.put(p, r.data);
  const manifest = buildManifest(racing, f.operations, f.candidateFile);
  const result = await runEnrichment({ ...options({ ...f, db: racing, manifest }), expectedManifestSha: manifest.manifestSha256 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, { transaction_failed: 1 });
  assert.equal(Object.hasOwn(racing.docs.get(f.operations[0].docPath).data, 'rfcMessageId'), false);
  assert.equal(racing.log.updates.length, 0);
});

test('runtime control: read_only, paused, and unknown modes block writes; missing control, coexist, pulse_only allow them', async () => {
  for (const mode of ['read_only', 'paused', 'surprise']) {
    const f = makeFixture(3, { control: { mode } });
    const dry = await runEnrichment(options(f, { mode: 'dry-run' }));
    assert.equal(dry.ok, false);
    assert.deepEqual(dry.blockers, { runtime_mode_blocks_writes: 3 });
    const applied = await runEnrichment(options(f));
    assert.equal(applied.ok, false);
    assert.equal(writesSoFar(f.db), 0);
  }
  for (const control of [undefined, { mode: 'coexist' }, { mode: 'pulse_only' }]) {
    const f = makeFixture(2, { control });
    assert.equal((await runEnrichment(options(f))).ok, true);
  }
});

test('flipping the control to read_only after preflight still blocks every write', async () => {
  const f = makeFixture(4);
  const result = await runEnrichment(options(f, { hooks: { afterPreflight: async () => f.db.put(core.CONTROL_PATH, { mode: 'read_only' }) } }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, { runtime_mode_blocks_writes: 1 });
  assert.equal(writesSoFar(f.db), 0);
});

test('CLI arguments: nothing means dry run; apply needs pin, operator and pre-image dir; strays are refused', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.equal(parseArgs(['--manifest=a', '--candidates=b']).apply, false);
  const refuse = (argv, code) => assert.throws(() => parseArgs(argv), e => e.code === code);
  refuse(['--apply'], 'usage_apply_requires_expected-manifest-sha');
  refuse(['--apply', '--expected-manifest-sha=x'], 'usage_apply_requires_operator');
  refuse(['--apply', '--expected-manifest-sha=x', '--operator=abc'], 'usage_apply_requires_preimage-dir');
  refuse(['--operator=abc'], 'usage_apply_only_argument');
  refuse(['--preimage-dir=/x'], 'usage_apply_only_argument');
  refuse(['--apply=true'], 'usage_unknown_argument');
  refuse(['--force'], 'usage_unknown_argument');
  refuse(['positional'], 'usage_unknown_argument');
  refuse(['--manifest=a', '--manifest=b'], 'usage_duplicate_argument');
  assert.equal(parseArgs(['--apply', '--expected-manifest-sha=x', '--operator=abc', '--preimage-dir=/x']).apply, true);
});

test('fs pre-image store is create-exclusive, idempotent for identical records, and fails closed otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preimage-'));
  try {
    const store = createFsPreimageStore(dir);
    const key = sha('op');
    const record = { schema: 'bom-email-identity-preimage-v1', operationKey: key, docPath: EMAILS + 'a', field: 'rfcMessageId', presence: 'absent' };
    await store.save(record);
    await store.save({ ...record });
    const file = path.join(dir, `${key}.preimage.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record);
    await assert.rejects(store.save({ ...record, presence: 'null' }), e => e.code === 'preimage_conflict');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record);
    await assert.rejects(store.save({ ...record, operationKey: '../escape' }), e => e.code === 'preimage_record_invalid');
    assert.throws(() => createFsPreimageStore('relative/dir'), e => e.code === 'preimage_dir_invalid');
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    assert.throws(() => createFsPreimageStore(blocker));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('canonical hashing contract is pinned (timestamps, key order, null/undefined, nesting)', () => {
  const value = { b: [1, null, { z: undefined, a: 'x' }], a: new Timestamp(5, 7), c: 'é' };
  assert.equal(canon(value), '{"a":{"$ts":[5,7]},"b":[1,null,{"a":"x","z":null}],"c":"é"}');
  assert.equal(sha('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(core.normRfc('<a@b>'), 'a@b');
  for (const bad of ['a b@c', '<a@b', 'a@@b', '', null, 5, 'no-at-sign']) assert.equal(core.normRfc(bad), null, String(bad));
});

test('end to end with a real pre-image store: files exist before receipts and contain presence only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preimage-e2e-'));
  try {
    const f = makeFixture(3);
    const result = await runEnrichment(options(f, { preimageStore: createFsPreimageStore(dir) }));
    assert.equal(result.ok, true);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 3);
    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.equal(JSON.parse(text).presence, 'absent');
      assert.equal(text.includes('msg-'), false);
      assert.equal(text.includes('RAW'), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
