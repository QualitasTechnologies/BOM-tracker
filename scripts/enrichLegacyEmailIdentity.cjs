#!/usr/bin/env node
// Fill-only migration: add `rfcMessageId` to legacy BOM project email docs from a sealed, hash-pinned dry-run manifest.
//
//   node scripts/enrichLegacyEmailIdentity.cjs --manifest=<file> --candidates=<file> --expected-manifest-sha=<64 hex> --project=<firebase project>
//
// Default (and no-argument) behaviour is a READ-ONLY dry run. Mutation needs --apply with --expected-manifest-sha, --operator and --preimage-dir,
// and an Application Default Credentials principal that tokeninfo proves equals the sealed manifest's principal.
//
// Scope: exactly one field (`rfcMessageId`) on at most 24 existing docs. `mailboxEmail` is never written (capture mailbox is unprovable).
// Existing equal value -> no-op; existing different/null value -> conflict. No `updatedAt` bump, no other field touched.
// Each doc update and its create-only receipt (`pulseEmailIdentityEnrichmentReceipts/<operationKey>`) commit in one transaction,
// after a create-exclusive, fsynced local pre-image file exists.
//
// Guarded rollback (NOT implemented): for an operation whose receipt matches, whose pre-image says presence "absent", and whose doc's
// current `rfcMessageId` still normalizes to the value this run wrote, delete only that field in a transaction that rechecks all three.
// If the value changed since, leave it and report. Never delete or move a business record.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_SCHEMA = 'bom-email-identity-enrichment-dryrun-v1';
const RECEIPT_SCHEMA = 'bom-email-identity-receipt-v1';
const RECEIPT_COLLECTION = 'pulseEmailIdentityEnrichmentReceipts';
const CONTROL_PATH = 'pulseRuntimeControl/cutover';
const WRITES_ALLOWED_MODES = new Set(['coexist', 'pulse_only']);
const FIELD = 'rfcMessageId';
const MAX_OPS = 24;
const SHA_RE = /^[0-9a-f]{64}$/;
const RFC_RE = /^[^\s<>@]+@[^\s<>@]+$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const OPERATOR_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@:-]{2,63}$/;

function canon(v) {
  if (v && typeof v.toDate === 'function' && 'seconds' in v) return `{"$ts":[${v.seconds},${v.nanoseconds}]}`;
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const sha = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : canon(v)).digest('hex');
const tsKey = t => (t && typeof t.toDate === 'function' ? `${t.seconds}.${String(t.nanoseconds).padStart(9, '0')}` : null);
function normRfc(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return RFC_RE.test(s) && s.length <= 998 ? s : null;
}
const fault = (code) => Object.assign(new Error(code), { code, enrichmentFault: true });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function projectIdentityHash(project) {
  return sha({ pulseProjectId: project.pulseProjectId ?? null, memberIds: project.memberIds ?? null, projectName: project.projectName ?? null,
    clientName: project.clientName ?? null, clientId: project.clientId ?? null });
}
function preservedFingerprint(data) {
  const preserved = { ...data };
  delete preserved[FIELD];
  delete preserved.mailboxEmail;
  return sha(preserved);
}

// ---- manifest + candidate verification (pure) ----
function verifyManifest(manifest, expectedManifestSha, expectedProject) {
  if (typeof expectedManifestSha !== 'string' || !SHA_RE.test(expectedManifestSha)) throw fault('expected_manifest_sha_invalid');
  if (!manifest || typeof manifest !== 'object' || manifest.manifestSha256 !== expectedManifestSha) throw fault('manifest_sha_pin_mismatch');
  const { manifestSha256, ...body } = manifest;
  if (sha(body) !== expectedManifestSha) throw fault('manifest_content_hash_mismatch');
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.mode !== 'dry-run') throw fault('manifest_schema_invalid');
  if (!expectedProject || manifest.firebaseProject !== expectedProject) throw fault('manifest_project_mismatch');
  if (typeof manifest.projectDoc !== 'string' || !DOC_ID_RE.test(manifest.projectDoc)) throw fault('manifest_project_doc_invalid');
  const ops = manifest.operations;
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) throw fault('manifest_operation_bounds');
  const counts = manifest.counts || {};
  if (counts.candidates !== ops.length || counts.planned !== ops.length || counts.blocked !== 0 || counts.noop !== 0) throw fault('manifest_counts_inconsistent');
  const who = manifest.operatorAttribution;
  if (!who || who.proven !== true || typeof who.credentialPrincipal !== 'string' || !who.credentialPrincipal || who.firebaseUid !== null) throw fault('manifest_principal_invalid');
  if (typeof manifest.candidateFileSha256 !== 'string' || !SHA_RE.test(manifest.candidateFileSha256)) throw fault('manifest_candidate_hash_invalid');
  if (!manifest.projectChecks || !SHA_RE.test(manifest.projectChecks.identityFieldsSha256 || '')) throw fault('manifest_project_checks_invalid');
}

function resolveOperations(manifest, candidateFile) {
  if (!candidateFile || candidateFile.sha256 !== manifest.candidateFileSha256) throw fault('candidate_file_hash_mismatch');
  const byIdHash = new Map();
  for (const c of candidateFile.candidates || []) {
    if (!c || typeof c.gmail_id !== 'string') throw fault('candidate_invalid');
    const key = sha(c.gmail_id);
    if (byIdHash.has(key)) throw fault('candidate_duplicate');
    byIdHash.set(key, c);
  }
  const seenDocs = new Set(), seenKeys = new Set();
  return manifest.operations.map(op => {
    const prefix = `projects/${manifest.projectDoc}/emails/`;
    if (!op || op.status !== 'planned' || (op.blockers || []).length) throw fault('operation_not_planned');
    if (typeof op.docPath !== 'string' || !op.docPath.startsWith(prefix) || !DOC_ID_RE.test(op.docPath.slice(prefix.length))) throw fault('operation_path_invalid');
    const docId = op.docPath.slice(prefix.length);
    if (seenDocs.has(op.docPath)) throw fault('operation_duplicate_doc');
    seenDocs.add(op.docPath);
    const writes = op.writes || {};
    const w = writes[FIELD];
    if (Object.keys(writes).join() !== FIELD || !w || w.mode !== 'fill_only' || w.precondition !== 'absent' || w.storedForm !== 'angle_bracketed') throw fault('operation_write_set_invalid');
    if (!op.mailboxEmail || op.mailboxEmail.decision !== 'withheld_unproven') throw fault('operation_mailbox_not_withheld');
    if (!SHA_RE.test(op.identity?.gmailMessageIdSha256 || '') || !SHA_RE.test(op.preservedFieldsSha256 || '') || !/^\d+\.\d{9}$/.test(op.docUpdateTime || '')) throw fault('operation_preconditions_invalid');
    if (w.valueRef?.gmailIdSha256 !== op.identity.gmailMessageIdSha256) throw fault('operation_value_ref_mismatch');
    const candidate = byIdHash.get(op.identity.gmailMessageIdSha256);
    if (!candidate) throw fault('candidate_missing');
    const rfc = normRfc(candidate.rfc_message_id);
    if (!rfc || typeof candidate.thread_id !== 'string' || !candidate.thread_id) throw fault('candidate_rfc_invalid');
    const value = `<${rfc}>`;
    if (sha(value) !== w.valueSha256) throw fault('candidate_value_mismatch');
    const operationKey = sha([manifest.projectDoc, docId, FIELD, sha(rfc)].join('|'));
    if (op.operationKey !== operationKey || seenKeys.has(operationKey)) throw fault('operation_key_mismatch');
    seenKeys.add(operationKey);
    return { docPath: op.docPath, value, rfc, threadId: candidate.thread_id, operationKey, gmailIdSha256: op.identity.gmailMessageIdSha256,
      expectedUpdateTime: op.docUpdateTime, preservedSha: op.preservedFieldsSha256, valueSha256: w.valueSha256 };
  });
}

// ---- evaluation of live state (pure) ----
function evaluateGlobal({ control, project }, manifest, expectedPulseProjectId) {
  const mode = control.exists ? (control.data()?.mode ?? 'coexist') : 'coexist';
  if (!WRITES_ALLOWED_MODES.has(mode)) return 'runtime_mode_blocks_writes';
  if (!project.exists) return 'project_missing';
  const p = project.data();
  if (p.pulseProjectId !== expectedPulseProjectId) return 'project_link_mismatch';
  if (projectIdentityHash(p) !== manifest.projectChecks.identityFieldsSha256) return 'project_identity_changed';
  return null;
}
function expectedReceipt(r, manifestSha256) {
  return { schema: RECEIPT_SCHEMA, operationKey: r.operationKey, manifestSha256, docPath: r.docPath, field: FIELD, presenceBefore: 'absent',
    valueSha256: r.valueSha256, docUpdateTimeBefore: r.expectedUpdateTime };
}
const receiptMatches = (existing, expected) => Object.keys(expected).every(k => existing[k] === expected[k]);

function evaluateDoc(r, doc, receipt, manifestSha256) {
  if (!doc.exists) return { status: 'blocked', code: 'doc_missing' };
  const d = doc.data();
  if (sha(d.gmailMessageId ?? null) !== r.gmailIdSha256) return { status: 'blocked', code: 'doc_identity_mismatch' };
  if (d.gmailThreadId !== r.threadId) return { status: 'blocked', code: 'thread_mismatch' };
  const receiptData = receipt.exists ? receipt.data() : null;
  if (has(d, FIELD)) {
    if (d[FIELD] === null) return { status: 'blocked', code: 'conflict_null_value' };
    if (typeof d[FIELD] !== 'string' || normRfc(d[FIELD]) !== r.rfc) return { status: 'blocked', code: 'conflict_existing_value' };
    if (!receiptData) return { status: 'noop_equal' };
    return receiptMatches(receiptData, expectedReceipt(r, manifestSha256)) ? { status: 'noop_replayed' } : { status: 'blocked', code: 'receipt_conflict' };
  }
  if (receiptData) return { status: 'blocked', code: 'receipt_without_field' };
  if (tsKey(doc.updateTime) !== r.expectedUpdateTime) return { status: 'blocked', code: 'stale_update_time' };
  if (preservedFingerprint(d) !== r.preservedSha) return { status: 'blocked', code: 'stale_content_fingerprint' };
  return { status: 'ready' };
}

// ---- local pre-image store: create-exclusive, fsynced, immutable ----
function createFsPreimageStore(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw fault('preimage_dir_invalid');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    async save(record) {
      if (!SHA_RE.test(record.operationKey)) throw fault('preimage_record_invalid');
      const file = path.join(dir, `${record.operationKey}.preimage.json`);
      const text = JSON.stringify(record, null, 2);
      try {
        const fd = fs.openSync(file, 'wx', 0o444);
        try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch (error) {
        if (error.code !== 'EEXIST') throw fault('preimage_write_failed');
        if (sha(JSON.parse(fs.readFileSync(file, 'utf8'))) !== sha(record)) throw fault('preimage_conflict');
      }
    },
  };
}

// ---- core ----
async function runEnrichment(options) {
  const { db, manifest, expectedManifestSha, candidateFile, expectedProject, expectedPulseProjectId, mode = 'dry-run',
    operator, principal, preimageStore, serverTimestamp, hooks = {} } = options;
  const result = { ok: false, mode, rejected: null, counts: { operations: 0, ready: 0, noopEqual: 0, noopReplayed: 0, blocked: 0, applied: 0 }, blockers: {} };
  const reject = code => { result.rejected = code; return result; };
  const block = code => { result.counts.blocked += 1; result.blockers[code] = (result.blockers[code] || 0) + 1; };
  try {
    if (mode !== 'dry-run' && mode !== 'apply') return reject('mode_invalid');
    verifyManifest(manifest, expectedManifestSha, expectedProject);
    if (!Number.isSafeInteger(expectedPulseProjectId) || expectedPulseProjectId <= 0) return reject('expected_pulse_project_id_invalid');
    const resolved = resolveOperations(manifest, candidateFile);
    result.counts.operations = resolved.length;
    result.manifestSha256 = expectedManifestSha;
    if (mode === 'apply') {
      if (typeof operator !== 'string' || !OPERATOR_RE.test(operator)) return reject('operator_label_invalid');
      if (!principal || principal.proven !== true || typeof principal.principal !== 'string') return reject('principal_unproven');
      if (principal.principal.trim().toLowerCase() !== manifest.operatorAttribution.credentialPrincipal.trim().toLowerCase()) return reject('principal_mismatch');
      if (!preimageStore || typeof preimageStore.save !== 'function') return reject('preimage_store_missing');
      if (typeof serverTimestamp !== 'function') return reject('server_timestamp_missing');
    }
    const projectRef = db.doc(`projects/${manifest.projectDoc}`), controlRef = db.doc(CONTROL_PATH);

    // Preflight: read-only; any blocker means nothing is written.
    const [control, project] = await Promise.all([controlRef.get(), projectRef.get()]);
    const globalBlock = evaluateGlobal({ control, project }, manifest, expectedPulseProjectId);
    if (globalBlock) { result.counts.blocked = resolved.length; result.blockers[globalBlock] = resolved.length; return result; }
    for (const r of resolved) {
      const [doc, receipt] = await Promise.all([db.doc(r.docPath).get(), db.doc(`${RECEIPT_COLLECTION}/${r.operationKey}`).get()]);
      const e = evaluateDoc(r, doc, receipt, expectedManifestSha);
      if (e.status === 'blocked') block(e.code);
      else if (e.status === 'ready') result.counts.ready += 1;
      else if (e.status === 'noop_equal') result.counts.noopEqual += 1;
      else result.counts.noopReplayed += 1;
    }
    if (result.counts.blocked) return result;
    if (mode === 'dry-run') { result.ok = true; return result; }

    if (hooks.afterPreflight) await hooks.afterPreflight();
    result.counts.ready = 0; result.counts.noopEqual = 0; result.counts.noopReplayed = 0;
    const principalSha256 = sha(principal.principal.trim().toLowerCase());
    for (const r of resolved) {
      const docRef = db.doc(r.docPath), receiptRef = db.doc(`${RECEIPT_COLLECTION}/${r.operationKey}`);
      let outcome;
      try {
        outcome = await db.runTransaction(async tx => {
          const [ctl, prj, doc, receipt] = [await tx.get(controlRef), await tx.get(projectRef), await tx.get(docRef), await tx.get(receiptRef)];
          const g = evaluateGlobal({ control: ctl, project: prj }, manifest, expectedPulseProjectId);
          if (g) throw fault(g);
          const e = evaluateDoc(r, doc, receipt, expectedManifestSha);
          if (e.status === 'blocked') throw fault(e.code);
          if (e.status !== 'ready') return e.status;
          // Recoverable record of the single touched field exists on disk before the write is issued; failure aborts with no write.
          await preimageStore.save({ schema: 'bom-email-identity-preimage-v1', operationKey: r.operationKey, manifestSha256: expectedManifestSha,
            docPath: r.docPath, field: FIELD, presence: 'absent' });
          tx.update(docRef, { [FIELD]: r.value });
          tx.create(receiptRef, { ...expectedReceipt(r, expectedManifestSha), operator, principalSha256, appliedAt: serverTimestamp() });
          return 'applied';
        });
      } catch (error) {
        block(error && error.enrichmentFault ? error.code : 'transaction_failed');
        result.halted = true;
        return result;
      }
      if (outcome === 'applied') result.counts.applied += 1;
      else if (outcome === 'noop_equal') result.counts.noopEqual += 1;
      else result.counts.noopReplayed += 1;
    }
    result.ok = true;
    return result;
  } catch (error) {
    return reject(error && error.enrichmentFault ? error.code : 'unexpected_error');
  }
}

// ---- CLI ----
const VALUE_FLAGS = new Set(['manifest', 'candidates', 'expected-manifest-sha', 'project', 'expected-pulse-project-id', 'operator', 'preimage-dir']);
function parseArgs(argv) {
  const out = { apply: false };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw fault('usage_unknown_argument');
    const [, name, value] = m;
    if (name === 'apply' && value === undefined) { out.apply = true; continue; }
    if (!VALUE_FLAGS.has(name) || !value) throw fault('usage_unknown_argument');
    if (has(out, name)) throw fault('usage_duplicate_argument');
    out[name] = value;
  }
  if (out.apply) {
    for (const need of ['expected-manifest-sha', 'operator', 'preimage-dir']) if (!out[need]) throw fault(`usage_apply_requires_${need}`);
  } else if (out.operator || out['preimage-dir']) throw fault('usage_apply_only_argument');
  return out;
}

async function tokeninfoPrincipal(admin) {
  const https = require('node:https');
  try {
    const { access_token: token } = await admin.credential.applicationDefault().getAccessToken();
    const body = 'access_token=' + encodeURIComponent(token);
    return await new Promise(resolve => {
      const req = https.request({ method: 'POST', host: 'oauth2.googleapis.com', path: '/tokeninfo', timeout: 10000,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } }, res => {
        let text = '';
        res.on('data', d => { text += d; });
        res.on('end', () => {
          try { const j = JSON.parse(text); resolve(res.statusCode === 200 && j.email ? { proven: true, principal: String(j.email) } : { proven: false }); } catch { resolve({ proven: false }); }
        });
      });
      req.on('error', () => resolve({ proven: false }));
      req.on('timeout', () => req.destroy());
      req.end(body);
    });
  } catch { return { proven: false }; }
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (error) { console.error(JSON.stringify({ ok: false, rejected: error.code || 'usage_error' })); return 2; }
  for (const need of ['manifest', 'candidates', 'expected-manifest-sha', 'project']) {
    if (!args[need]) { console.error(JSON.stringify({ ok: false, rejected: `usage_missing_${need}` })); return 2; }
  }
  let manifest, candidateFile;
  try {
    manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const bytes = fs.readFileSync(args.candidates);
    candidateFile = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), candidates: JSON.parse(bytes).candidates };
  } catch { console.error(JSON.stringify({ ok: false, rejected: 'input_unreadable' })); return 2; }

  const { createRequire } = require('node:module');
  const admin = createRequire(path.join(__dirname, '..', 'functions', 'package.json'))('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: args.project });
  const apply = args.apply;
  const result = await runEnrichment({
    db: admin.firestore(), manifest, expectedManifestSha: args['expected-manifest-sha'], candidateFile, expectedProject: args.project,
    expectedPulseProjectId: Number(args['expected-pulse-project-id'] ?? 721), mode: apply ? 'apply' : 'dry-run',
    operator: args.operator, principal: apply ? await tokeninfoPrincipal(admin) : undefined,
    preimageStore: apply ? createFsPreimageStore(args['preimage-dir']) : undefined,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

module.exports = { runEnrichment, verifyManifest, resolveOperations, evaluateDoc, evaluateGlobal, createFsPreimageStore, parseArgs, canon, sha, normRfc, tsKey,
  preservedFingerprint, projectIdentityHash, RECEIPT_COLLECTION, CONTROL_PATH, FIELD, MAX_OPS };

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => { console.error(JSON.stringify({ ok: false, rejected: 'unexpected_error' })); process.exitCode = 2; });
