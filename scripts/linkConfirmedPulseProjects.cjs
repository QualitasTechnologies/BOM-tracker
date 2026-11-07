#!/usr/bin/env node
// One-off operator maintenance tool: set `pulseProjectId` on EXACTLY four BOM projects the user explicitly confirmed:
//   PRJ-015 -> 1910, PRJ-017 -> 2069, PRJ-016 -> 1864, PRJ-012 -> 1823.
// PRJ-013 (Ferrari) has no identified counterpart and is excluded. The pairs are hardcoded; no mapping can be supplied.
//
// Modes (see docs/confirmed-pulse-project-links.md):
//   plan   (default)  --project=P --sql-snapshot=FILE [--manifest-out=FILE]   read-only; emits a sealed manifest
//   verify            --project=P --manifest=FILE --expected-manifest-sha=SHA  read-only; re-checks live state / replay
//   apply  (--apply)  --project=P --manifest=FILE --expected-manifest-sha=SHA --operator=LABEL --preimage-dir=ABSDIR
//
// Provenance: the actor is the operator's Google credential, proven in memory by token info; firebaseUid is always null.
// This is NOT a Firebase user session and is never presented as one. No custom tokens, impersonation or native flag overrides.
// All four project updates (only the pulseProjectId field) plus a create-only run receipt and per-project audit records
// commit in ONE Firestore transaction. SQL is never accessed: a pinned, operator-supplied existence snapshot is only recorded.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_SCHEMA = 'bom-confirmed-pulse-links-dryrun-v1';
const RECEIPT_SCHEMA = 'bom-confirmed-pulse-links-run-receipt-v1';
const AUDIT_SCHEMA = 'bom-confirmed-pulse-links-audit-v1';
const PREIMAGE_SCHEMA = 'bom-confirmed-pulse-links-preimage-v1';
const SQL_SCHEMA = 'bom-confirmed-pulse-sql-existence-v1';
const RUN_COLLECTION = 'pulseConfirmedProjectLinkRuns';
const CONTROL_PATH = 'pulseRuntimeControl/cutover';
const FIELD = 'pulseProjectId';
const ACTOR_KIND = 'google-credential';
const SQL_TRUST = 'operator-supplied-unverified';
const PAIRS = Object.freeze([
  Object.freeze({ bomId: 'PRJ-015', pulseProjectId: 1910 }), Object.freeze({ bomId: 'PRJ-017', pulseProjectId: 2069 }),
  Object.freeze({ bomId: 'PRJ-016', pulseProjectId: 1864 }), Object.freeze({ bomId: 'PRJ-012', pulseProjectId: 1823 }),
]);
const CONFIRMATION_REF = 'User reply "all of them" (2026-11-01) confirmed exactly PRJ-015->1910, PRJ-017->2069, PRJ-016->1864, PRJ-012->1823. '
  + 'PRJ-013 (Ferrari) has no identified Pulse counterpart and is excluded. Recorded in the shared unified handoff.';
const ACTIVE_STATUSES = new Set(['Planning', 'Ongoing', 'Delayed', 'Completed']);
const SQL_MAX_AGE_MS = 15 * 60e3;
const MANIFEST_MAX_AGE_MS = 15 * 60e3;
const FUTURE_SKEW_MS = 5 * 60e3;
const MIN_PRINCIPAL_LIFETIME_MS = 120e3;
const SHA_RE = /^[0-9a-f]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPERATOR_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@:-]{2,63}$/;
const VERSION_RE = /^\d+\.\d{9}$/;
const OPTIONS = new Set(['db', 'mode', 'firebaseProject', 'sqlSnapshot', 'manifest', 'expectedManifestSha', 'operator', 'resolvePrincipal',
  'preimageStore', 'serverTimestamp', 'now']);

// ---- small pure helpers ----
function canon(v) {
  if (v && typeof v.toDate === 'function' && 'seconds' in v) return `{"$ts":[${v.seconds},${v.nanoseconds}]}`;
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const sha = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : canon(v)).digest('hex');
const tsKey = t => (t && typeof t.toDate === 'function' && Number.isFinite(t.seconds) ? `${t.seconds}.${String(t.nanoseconds).padStart(9, '0')}` : null);
const fault = (code, blockers) => Object.assign(new Error(code), { code, linkFault: true, ...(blockers ? { blockers } : {}) });
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const strictKeys = (o, keys, code) => { if (!plain(o) || Object.keys(o).length !== keys.length || !keys.every(k => has(o, k))) throw fault(code); };
const isoMs = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s)) return null; const ms = Date.parse(s); return Number.isFinite(ms) && new Date(ms).toISOString() === s ? ms : null; };
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// ---- operator credential principal (token info; the token itself is never retained or returned) ----
function createTokeninfoResolver({ getAccessToken, fetchTokenInfo, now = Date.now }) {
  return async () => {
    try {
      const token = await getAccessToken();
      if (typeof token !== 'string' || !token) return { proven: false };
      const info = await fetchTokenInfo(token);
      if (!plain(info)) return { proven: false };
      const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
      const subject = info.sub || info.user_id;
      let expiresAtMs = null;
      if (info.expiry_date !== undefined) expiresAtMs = Number(info.expiry_date);
      else if (info.exp !== undefined) expiresAtMs = Number(info.exp) * 1000;
      else if (info.expires_in !== undefined) expiresAtMs = now() + Number(info.expires_in) * 1000;
      if (!EMAIL_RE.test(email) || !(info.email_verified === true || info.email_verified === 'true')
        || typeof subject !== 'string' || !subject || subject.length > 250 || /[\x00-\x20]/.test(subject)
        || !Number.isFinite(expiresAtMs) || expiresAtMs <= now()) return { proven: false };
      return { proven: true, principal: email, subject: `google:${subject}`, expiresAtMs };
    } catch { return { proven: false }; }
  };
}
function validatePrincipal(p, nowMs) {
  if (!plain(p) || p.proven !== true || typeof p.principal !== 'string' || !EMAIL_RE.test(p.principal)
    || typeof p.subject !== 'string' || !/^google:[^\s]{1,250}$/.test(p.subject) || !Number.isFinite(p.expiresAtMs)) throw fault('principal_unproven');
  if (p.expiresAtMs - nowMs < MIN_PRINCIPAL_LIFETIME_MS) throw fault('principal_expired');
  return { principal: p.principal.trim().toLowerCase(), subject: p.subject, expiresAtMs: p.expiresAtMs };
}

// ---- pinned SQL existence input (recorded, never verified or queried here) ----
function checkSqlCore(data, nowMs) {
  strictKeys(data, ['schema', 'capturedAt', 'rows'], 'sql_snapshot_invalid');
  if (data.schema !== SQL_SCHEMA || !Array.isArray(data.rows) || data.rows.length !== PAIRS.length) throw fault('sql_snapshot_invalid');
  const capturedMs = isoMs(data.capturedAt);
  if (capturedMs === null || capturedMs > nowMs + FUTURE_SKEW_MS) throw fault('sql_snapshot_invalid');
  const byId = {};
  for (const row of data.rows) {
    strictKeys(row, ['id', 'exists'], 'sql_snapshot_invalid');
    if (!Number.isSafeInteger(row.id) || typeof row.exists !== 'boolean' || has(byId, row.id)) throw fault('sql_snapshot_invalid');
    byId[row.id] = row.exists;
  }
  if (!PAIRS.every(p => has(byId, p.pulseProjectId))) throw fault('sql_snapshot_invalid');
  if (!PAIRS.every(p => byId[p.pulseProjectId] === true)) throw fault('sql_row_missing');
  if (nowMs - capturedMs > SQL_MAX_AGE_MS) throw fault('sql_snapshot_stale');
  return { capturedAt: data.capturedAt, rows: PAIRS.map(p => ({ id: p.pulseProjectId, exists: true })) };
}
function normalizeSql(input, nowMs) {
  if (!plain(input) || typeof input.sha256 !== 'string' || !SHA_RE.test(input.sha256)) throw fault('sql_snapshot_invalid');
  const core = checkSqlCore(input.data, nowMs);
  return { schema: SQL_SCHEMA, snapshotSha256: input.sha256, capturedAt: core.capturedAt, rows: core.rows, trust: SQL_TRUST };
}
function checkManifestSql(sql, nowMs) {
  strictKeys(sql, ['schema', 'snapshotSha256', 'capturedAt', 'rows', 'trust'], 'sql_snapshot_invalid');
  if (!SHA_RE.test(sql.snapshotSha256) || sql.trust !== SQL_TRUST) throw fault('sql_snapshot_invalid');
  checkSqlCore({ schema: sql.schema, capturedAt: sql.capturedAt, rows: sql.rows }, nowMs);
}

// ---- manifest ----
const BODY_KEYS = ['schema', 'mode', 'firebaseProject', 'generatedAt', 'humanConfirmation', 'operatorAttribution', 'runtime', 'sql', 'operations', 'collisionScan'];
const OP_KEYS = ['bomId', 'docPath', 'field', 'pulseProjectId', 'before', 'docUpdateTime', 'identityFieldsSha256'];
const pairsList = () => PAIRS.map(p => ({ bomId: p.bomId, pulseProjectId: p.pulseProjectId }));
function buildManifest({ firebaseProject, nowMs, principal, sql, state, ops }) {
  const body = {
    schema: MANIFEST_SCHEMA, mode: 'dry-run', firebaseProject, generatedAt: new Date(nowMs).toISOString(),
    humanConfirmation: { reference: CONFIRMATION_REF, pairs: pairsList() },
    operatorAttribution: { proven: true, credentialPrincipal: principal.principal, credentialSubject: principal.subject, firebaseUid: null, actorKind: ACTOR_KIND },
    runtime: { controlPath: CONTROL_PATH, mode: 'coexist', controlExists: state.control.exists },
    sql, operations: ops,
    collisionScan: { scannedProjects: state.scanned, maskedFingerprintSha256: state.fingerprint, queries: PAIRS.length * 2 + 1, collisions: 0 },
  };
  return { ...body, manifestSha256: sha(body) };
}
function verifyManifest(manifest, expectedSha, { firebaseProject, nowMs }) {
  if (typeof expectedSha !== 'string' || !SHA_RE.test(expectedSha) || !plain(manifest) || manifest.manifestSha256 !== expectedSha) throw fault('manifest_sha_pin_mismatch');
  const { manifestSha256, ...body } = manifest;
  if (sha(body) !== expectedSha) throw fault('manifest_content_hash_mismatch');
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.mode !== 'dry-run') throw fault('manifest_schema_invalid');
  strictKeys(body, BODY_KEYS, 'manifest_invalid');
  if (manifest.firebaseProject !== firebaseProject) throw fault('manifest_project_mismatch');
  const generatedMs = isoMs(manifest.generatedAt);
  if (generatedMs === null || generatedMs > nowMs + FUTURE_SKEW_MS) throw fault('manifest_invalid');
  if (nowMs - generatedMs > MANIFEST_MAX_AGE_MS) throw fault('manifest_stale');
  strictKeys(manifest.humanConfirmation, ['reference', 'pairs'], 'manifest_invalid');
  if (manifest.humanConfirmation.reference !== CONFIRMATION_REF || canon(manifest.humanConfirmation.pairs) !== canon(pairsList())) throw fault('manifest_invalid');
  const who = manifest.operatorAttribution;
  strictKeys(who, ['proven', 'credentialPrincipal', 'credentialSubject', 'firebaseUid', 'actorKind'], 'manifest_invalid');
  if (who.proven !== true || !EMAIL_RE.test(who.credentialPrincipal) || who.credentialPrincipal !== who.credentialPrincipal.toLowerCase()
    || !/^google:[^\s]{1,250}$/.test(who.credentialSubject) || who.firebaseUid !== null || who.actorKind !== ACTOR_KIND) throw fault('manifest_invalid');
  strictKeys(manifest.runtime, ['controlPath', 'mode', 'controlExists'], 'manifest_invalid');
  if (manifest.runtime.controlPath !== CONTROL_PATH || manifest.runtime.mode !== 'coexist' || typeof manifest.runtime.controlExists !== 'boolean') throw fault('manifest_invalid');
  const ops = manifest.operations;
  if (!Array.isArray(ops) || ops.length !== PAIRS.length) throw fault('manifest_pairs_invalid');
  ops.forEach((op, i) => {
    strictKeys(op, OP_KEYS, 'manifest_pairs_invalid');
    const pair = PAIRS[i];
    const before = op.before;
    const beforeOk = plain(before) && (canon(before) === canon({ present: false }) || canon(before) === canon({ present: true, value: null }));
    if (op.bomId !== pair.bomId || op.pulseProjectId !== pair.pulseProjectId || op.docPath !== `projects/${pair.bomId}` || op.field !== FIELD
      || !beforeOk || typeof op.docUpdateTime !== 'string' || !VERSION_RE.test(op.docUpdateTime) || !SHA_RE.test(op.identityFieldsSha256 || '')) throw fault('manifest_pairs_invalid');
  });
  checkManifestSql(manifest.sql, nowMs);
  strictKeys(manifest.collisionScan, ['scannedProjects', 'maskedFingerprintSha256', 'queries', 'collisions'], 'manifest_invalid');
  const scan = manifest.collisionScan;
  if (!Number.isSafeInteger(scan.scannedProjects) || scan.scannedProjects < PAIRS.length || !SHA_RE.test(scan.maskedFingerprintSha256) || scan.queries !== PAIRS.length * 2 + 1 || scan.collisions !== 0) throw fault('manifest_invalid');
}

// ---- live state ----
function controlMode(snap) {
  if (!snap.exists) return 'coexist';
  const d = snap.data();
  const m = plain(d) ? d.mode : undefined;
  if (m === undefined || m === null) return 'coexist';
  return typeof m === 'string' ? m : 'invalid';
}
function inspectProject(pair, snap) {
  if (!snap.exists) return { code: 'project_missing' };
  const d = snap.data();
  if (!plain(d)) return { code: 'project_malformed' };
  if (has(d, 'projectId') && d.projectId !== pair.bomId) return { code: 'project_identity_mismatch' };
  if (typeof d.projectName !== 'string' || !d.projectName.trim() || typeof d.clientName !== 'string' || !d.clientName.trim()) return { code: 'project_identity_missing' };
  if (d.status === 'Archived' || (has(d, 'archivedAt') && d.archivedAt !== null && d.archivedAt !== undefined)) return { code: 'project_archived' };
  if (typeof d.status !== 'string' || !ACTIVE_STATUSES.has(d.status)) return { code: 'project_status_malformed' };
  const version = tsKey(snap.updateTime);
  if (!version) return { code: 'project_version_missing' };
  return { ok: true, version, before: has(d, FIELD) ? { present: true, value: d[FIELD] } : { present: false },
    identitySha: sha({ projectId: d.projectId ?? null, projectName: d.projectName, clientName: d.clientName, clientId: d.clientId ?? null }) };
}
async function scanCollisions(db, read) {
  const owners = {};
  PAIRS.forEach(p => { owners[String(p.pulseProjectId)] = p.bomId; });
  const found = {};
  const note = (docId, value, via) => {
    const key = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : null;
    if (key === null || !has(owners, key) || owners[key] === docId) return;
    const id = `${docId}|${key}`;
    found[id] = found[id] || { docId, target: Number(key), via: [] };
    if (!found[id].via.includes(via)) found[id].via.push(via);
  };
  for (const p of PAIRS) {
    for (const [via, value] of [['number-query', p.pulseProjectId], ['string-query', String(p.pulseProjectId)]]) {
      const snap = await read(db.collection('projects').where(FIELD, '==', value));
      snap.docs.forEach(doc => note(doc.id, doc.data()[FIELD], via));
    }
  }
  const all = await read(db.collection('projects').select(FIELD));
  const rows = [];
  all.docs.forEach(doc => {
    const v = doc.data()[FIELD];
    rows.push([doc.id, v === undefined ? 'absent' : v === null ? 'null' : typeof v, typeof v === 'number' || typeof v === 'string' ? v : null]);
    note(doc.id, v, 'masked-scan');
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { collisions: Object.values(found).sort((a, b) => (a.docId + a.target < b.docId + b.target ? -1 : 1)), scanned: all.docs.length, fingerprint: sha(rows) };
}
async function readState(db, read) {
  const control = await read(db.doc(CONTROL_PATH));
  const projects = [];
  for (const p of PAIRS) projects.push(await read(db.doc(`projects/${p.bomId}`)));
  return { control, projects, ...(await scanCollisions(db, read)) };
}
function evaluate(state, manifest) {
  const blockers = {};
  const add = code => { blockers[code] = (blockers[code] || 0) + 1; };
  if (controlMode(state.control) !== 'coexist') add('runtime_mode_blocks_writes');
  state.collisions.forEach(() => add('collision'));
  const ops = PAIRS.map((pair, i) => {
    const ins = inspectProject(pair, state.projects[i]);
    if (!ins.ok) { add(ins.code); return null; }
    if (ins.before.present && ins.before.value !== null) { add(ins.before.value === pair.pulseProjectId ? 'link_without_receipt' : 'existing_link_conflict'); return null; }
    if (manifest) {
      const m = manifest.operations[i];
      if (ins.identitySha !== m.identityFieldsSha256) add('project_identity_changed');
      if (ins.version !== m.docUpdateTime) add('stale_update_time');
      if (canon(ins.before) !== canon(m.before)) add('field_state_changed');
    }
    return { bomId: pair.bomId, docPath: `projects/${pair.bomId}`, field: FIELD, pulseProjectId: pair.pulseProjectId, before: ins.before,
      docUpdateTime: ins.version, identityFieldsSha256: ins.identitySha };
  });
  return { blockers, ops };
}

// ---- receipts and audit ----
const runPathOf = manifest => `${RUN_COLLECTION}/${manifest.manifestSha256}`;
function expectedReceipt(manifest) {
  return {
    schema: RECEIPT_SCHEMA, manifestSha256: manifest.manifestSha256, manifestGeneratedAt: manifest.generatedAt, firebaseProject: manifest.firebaseProject,
    actorKind: ACTOR_KIND, credentialPrincipal: manifest.operatorAttribution.credentialPrincipal, credentialSubject: manifest.operatorAttribution.credentialSubject,
    firebaseUid: null, humanConfirmation: manifest.humanConfirmation, sqlSnapshotSha256: manifest.sql.snapshotSha256, sqlSnapshotCapturedAt: manifest.sql.capturedAt,
    runtimeMode: 'coexist',
    operations: manifest.operations.map(o => ({ bomId: o.bomId, docPath: o.docPath, field: o.field, before: o.before, after: { value: o.pulseProjectId },
      docUpdateTimeBefore: o.docUpdateTime, identityFieldsSha256: o.identityFieldsSha256 })),
  };
}
function expectedAudit(manifest, op, operator) {
  return { schema: AUDIT_SCHEMA, runReceiptPath: runPathOf(manifest), manifestSha256: manifest.manifestSha256, bomId: op.bomId, docPath: op.docPath, field: op.field,
    before: op.before, after: op.after, docUpdateTimeBefore: op.docUpdateTimeBefore, operator, credentialPrincipal: manifest.operatorAttribution.credentialPrincipal,
    credentialSubject: manifest.operatorAttribution.credentialSubject, firebaseUid: null, actorKind: ACTOR_KIND };
}
function receiptMatches(receipt, manifest) {
  if (!plain(receipt)) return false;
  const { operator, principalSha256, preimageSha256, appliedAt, ...rest } = receipt;
  return canon(rest) === canon(expectedReceipt(manifest)) && typeof operator === 'string' && OPERATOR_RE.test(operator)
    && principalSha256 === sha(manifest.operatorAttribution.credentialPrincipal) && SHA_RE.test(preimageSha256 || '') && tsKey(appliedAt) !== null;
}
function auditMatches(audit, manifest, op, receipt) {
  if (!plain(audit)) return false;
  const { appliedAt, ...rest } = audit;
  return canon(rest) === canon(expectedAudit(manifest, op, receipt.operator)) && tsKey(appliedAt) !== null && tsKey(appliedAt) === tsKey(receipt.appliedAt);
}
// Decision helper only (writes nothing): may this one field be restored to its recorded pre-image?
// The after-version is the receipt DOCUMENT snapshot's updateTime (trusted server metadata from the same atomic commit that changed the
// projects). appliedAt in the receipt data is audit time only and is never used as a version. Receipt data cannot supply a version.
function evaluateRecovery({ bomId, receiptSnapshot, preimage, project }) {
  const no = code => ({ allowed: false, code });
  const pair = PAIRS.find(p => p.bomId === bomId);
  if (!pair) return no('pair_not_in_scope');
  if (!receiptSnapshot || receiptSnapshot.exists !== true || typeof receiptSnapshot.data !== 'function') return no('receipt_metadata_missing');
  const commitVersion = tsKey(receiptSnapshot.updateTime);
  if (!commitVersion) return no('receipt_metadata_missing');
  const receipt = receiptSnapshot.data();
  if (!plain(receipt) || receipt.schema !== RECEIPT_SCHEMA || receipt.firebaseUid !== null || receipt.actorKind !== ACTOR_KIND
    || !SHA_RE.test(receipt.manifestSha256 || '') || !SHA_RE.test(receipt.preimageSha256 || '') || !Array.isArray(receipt.operations)) return no('receipt_invalid');
  const rop = receipt.operations.find(o => plain(o) && o.bomId === bomId);
  if (!rop || rop.field !== FIELD || rop.docPath !== `projects/${bomId}` || !plain(rop.after) || rop.after.value !== pair.pulseProjectId || !plain(rop.before)) return no('receipt_invalid');
  if (!plain(preimage) || preimage.schema !== PREIMAGE_SCHEMA || preimage.manifestSha256 !== receipt.manifestSha256 || sha(preimage) !== receipt.preimageSha256) return no('preimage_mismatch');
  const pop = (preimage.operations || []).find(o => plain(o) && o.bomId === bomId);
  if (!pop || canon(pop.before) !== canon(rop.before) || pop.docUpdateTime !== rop.docUpdateTimeBefore) return no('preimage_mismatch');
  if (!project || !project.exists) return no('project_missing');
  const d = project.data();
  if (!plain(d) || !has(d, FIELD) || d[FIELD] !== rop.after.value) return no('value_changed_since_apply');
  if (tsKey(project.updateTime) !== commitVersion) return no('modified_since_apply');
  const action = !rop.before.present ? 'delete_field' : rop.before.value === null ? 'set_null' : 'set_value';
  return { allowed: true, action, field: FIELD, guard: { value: rop.after.value, updateTime: commitVersion } };
}

// ---- durable pre-image store (outside Git, create-exclusive, fsynced, hash verified) ----
function assertOutsideGit(target, code) {
  let dir = path.resolve(target);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) throw fault(code);
    const up = path.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}
function createFsPreimageStore(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw fault('preimage_dir_invalid');
  assertOutsideGit(dir, 'preimage_dir_in_git');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    async save(record) {
      if (!plain(record) || !SHA_RE.test(record.manifestSha256 || '')) throw fault('preimage_record_invalid');
      const file = path.join(dir, `${record.manifestSha256}.preimage.json`);
      try {
        const fd = fs.openSync(file, 'wx', 0o444);
        try { fs.writeFileSync(fd, JSON.stringify(record, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw fault('preimage_write_failed');
      }
      let stored;
      try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw fault('preimage_write_failed'); }
      if (sha(stored) !== sha(record)) throw fault('preimage_conflict');
      return { sha256: sha(record) };
    },
  };
}

// ---- core ----
async function runLinks(opts) {
  const result = { ok: false, mode: 'dry-run', rejected: null, status: null, counts: { operations: 0, ready: 0, applied: 0, verified: 0, blocked: 0 }, blockers: {} };
  const reject = code => { result.ok = false; result.rejected = code; return result; };
  const blocked = blockers => { result.ok = false; result.blockers = blockers; result.counts.blocked = sum(blockers); return result; };
  try {
    if (!plain(opts) || Object.keys(opts).some(k => !OPTIONS.has(k))) return reject('unknown_option');
    const mode = opts.mode === undefined ? 'dry-run' : opts.mode;
    if (mode !== 'dry-run' && mode !== 'apply') return reject('mode_invalid');
    result.mode = mode;
    const { db, firebaseProject } = opts;
    if (!db || typeof firebaseProject !== 'string' || !firebaseProject) return reject('usage_invalid');
    const clock = typeof opts.now === 'function' ? opts.now : Date.now;
    const readLive = x => x.get();
    const principalNow = async () => validatePrincipal(typeof opts.resolvePrincipal === 'function' ? await opts.resolvePrincipal() : undefined, clock());

    // plan: no manifest supplied
    if (mode === 'dry-run' && opts.manifest === undefined) {
      const sql = normalizeSql(opts.sqlSnapshot, clock());
      const principal = await principalNow();
      const state = await readState(db, readLive);
      const ev = evaluate(state, null);
      result.counts.operations = PAIRS.length;
      if (sum(ev.blockers)) return blocked(ev.blockers);
      const manifest = buildManifest({ firebaseProject, nowMs: clock(), principal, sql, state, ops: ev.ops });
      Object.assign(result, { ok: true, status: 'planned', manifest, manifestSha256: manifest.manifestSha256 });
      result.counts.ready = PAIRS.length;
      return result;
    }

    // verify / apply: a sealed manifest is mandatory
    const manifest = opts.manifest;
    verifyManifest(manifest, opts.expectedManifestSha, { firebaseProject, nowMs: clock() });
    result.manifestSha256 = manifest.manifestSha256;
    result.counts.operations = PAIRS.length;
    let principal = null;
    if (mode === 'apply') {
      if (typeof opts.operator !== 'string' || !OPERATOR_RE.test(opts.operator)) return reject('operator_label_invalid');
      if (!opts.preimageStore || typeof opts.preimageStore.save !== 'function') return reject('preimage_store_missing');
      if (typeof opts.serverTimestamp !== 'function') return reject('server_timestamp_missing');
      principal = await principalNow();
      if (principal.principal !== manifest.operatorAttribution.credentialPrincipal || principal.subject !== manifest.operatorAttribution.credentialSubject) return reject('principal_mismatch');
    }
    const runPath = runPathOf(manifest);
    const receiptRef = db.doc(runPath);
    const auditRefs = PAIRS.map(p => db.doc(`${runPath}/audit/${p.bomId}`));

    const existing = await receiptRef.get();
    if (existing.exists) return await replay();
    const state = await readState(db, readLive);
    const ev = evaluate(state, manifest);
    if (sum(ev.blockers)) return blocked(ev.blockers);
    if (mode === 'dry-run') { Object.assign(result, { ok: true, status: 'ready' }); result.counts.ready = PAIRS.length; return result; }

    // 1. durable field pre-image BEFORE any Firestore write; fail closed if unavailable
    const record = { schema: PREIMAGE_SCHEMA, manifestSha256: manifest.manifestSha256,
      operations: manifest.operations.map(o => ({ bomId: o.bomId, docPath: o.docPath, field: o.field, before: o.before, docUpdateTime: o.docUpdateTime })) };
    let saved;
    try { saved = await opts.preimageStore.save(record); } catch { return reject('preimage_unavailable'); }
    if (!plain(saved) || saved.sha256 !== sha(record)) return reject('preimage_unavailable');
    // 2. re-prove the credential immediately before the transaction (short window)
    principal = await principalNow();
    if (principal.principal !== manifest.operatorAttribution.credentialPrincipal || principal.subject !== manifest.operatorAttribution.credentialSubject) return reject('principal_mismatch');

    // 3. one transaction: re-check everything, update four fields, create receipt + audit
    try {
      await db.runTransaction(async tx => {
        const read = x => tx.get(x);
        const live = await readState(db, read);
        const rSnap = await tx.get(receiptRef);
        const aSnaps = [];
        for (const ref of auditRefs) aSnaps.push(await tx.get(ref));
        if (rSnap.exists || aSnaps.some(s => s.exists)) throw fault('receipt_conflict', { receipt_conflict: 1 });
        const inTx = evaluate(live, manifest);
        if (sum(inTx.blockers)) throw fault('state_blocked', inTx.blockers);
        if (clock() + MIN_PRINCIPAL_LIFETIME_MS > principal.expiresAtMs) throw fault('principal_expired');
        // Audit time only (a request time with its own precision). It is NOT the document version; the version is the receipt snapshot updateTime.
        const appliedAt = opts.serverTimestamp();
        const receipt = { ...expectedReceipt(manifest), operator: opts.operator, principalSha256: sha(principal.principal), preimageSha256: saved.sha256, appliedAt };
        PAIRS.forEach((pair, i) => tx.update(db.doc(`projects/${pair.bomId}`), { [FIELD]: pair.pulseProjectId }, { lastUpdateTime: live.projects[i].updateTime }));
        tx.create(receiptRef, receipt);
        receipt.operations.forEach((op, i) => tx.create(auditRefs[i], { ...expectedAudit(manifest, op, opts.operator), appliedAt }));
      });
    } catch (error) {
      if (error && error.linkFault && error.blockers) return blocked(error.blockers);
      if (error && error.linkFault) return reject(error.code);
      return reject('transaction_failed');
    }

    // 4. post-verification (reads only): the links, and any collision that appeared after the commit
    try {
      const rs = await receiptRef.get();
      const commitVersion = rs.exists ? tsKey(rs.updateTime) : null;
      if (!commitVersion) { result.committed = true; return reject('receipt_metadata_missing'); }
      let verified = 0;
      for (const p of PAIRS) { const s = await db.doc(`projects/${p.bomId}`).get(); if (s.exists && s.data()[FIELD] === p.pulseProjectId && tsKey(s.updateTime) === commitVersion) verified += 1; }
      const scan = await scanCollisions(db, readLive);
      result.postVerification = { linksVerified: verified, commitVersion, collisions: scan.collisions };
      if (verified !== PAIRS.length || scan.collisions.length) { result.committed = true; return reject('post_verification_failed'); }
    } catch { result.committed = true; return reject('post_verification_failed'); }
    Object.assign(result, { ok: true, status: 'applied' });
    result.counts.applied = PAIRS.length; result.counts.verified = PAIRS.length;
    return result;

    // replay: nothing is written; prove receipt, audit and all four links
    async function replay() {
      const receiptSnap = await receiptRef.get();
      const receipt = receiptSnap.data();
      const commitVersion = tsKey(receiptSnap.updateTime);
      const bad = {};
      const flag = code => { bad[code] = (bad[code] || 0) + 1; };
      if (!receiptMatches(receipt, manifest)) flag('receipt_conflict');
      else {
        const expectedOps = expectedReceipt(manifest).operations;
        for (let i = 0; i < PAIRS.length; i += 1) {
          const a = await auditRefs[i].get();
          if (!a.exists || !auditMatches(a.data(), manifest, expectedOps[i], receipt)) flag('receipt_conflict');
        }
      }
      if (!commitVersion) flag('receipt_metadata_missing');
      const modifiedSinceApply = [];
      for (const p of PAIRS) {
        const s = await db.doc(`projects/${p.bomId}`).get();
        if (!s.exists || s.data()[FIELD] !== p.pulseProjectId) flag('receipt_link_diverged');
        else if (commitVersion && tsKey(s.updateTime) !== commitVersion) modifiedSinceApply.push(p.bomId); // informational: later edits do not invalidate valid links
      }
      const scan = await scanCollisions(db, readLive);
      scan.collisions.forEach(() => flag('collision'));
      result.postVerification = { commitVersion, modifiedSinceApply, collisions: scan.collisions };
      if (sum(bad)) return blocked(bad);
      Object.assign(result, { ok: true, status: 'already_applied' });
      result.counts.verified = PAIRS.length;
      return result;
    }
  } catch (error) {
    return reject(error && error.linkFault ? error.code : 'unexpected_error');
  }
}

// ---- CLI ----
const VALUE_FLAGS = new Set(['project', 'sql-snapshot', 'manifest-out', 'manifest', 'expected-manifest-sha', 'operator', 'preimage-dir']);
const USAGE = 'plan: --project=P --sql-snapshot=FILE [--manifest-out=ABSFILE] | verify: --project=P --manifest=FILE --expected-manifest-sha=SHA | '
  + 'apply: --apply --project=P --manifest=FILE --expected-manifest-sha=SHA --operator=LABEL --preimage-dir=ABSDIR';
function parseArgs(argv) {
  const out = { apply: false };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw fault('usage_unknown_argument');
    const [, name, value] = m;
    if (name === 'apply' && value === undefined) { if (out.apply) throw fault('usage_duplicate_argument'); out.apply = true; continue; }
    if (!VALUE_FLAGS.has(name) || !value) throw fault('usage_unknown_argument');
    if (has(out, name)) throw fault('usage_duplicate_argument');
    out[name] = value;
  }
  if (!out.project) throw fault('usage_missing_project');
  if (out['expected-manifest-sha'] && !SHA_RE.test(out['expected-manifest-sha'])) throw fault('usage_invalid_sha');
  if (out.apply) {
    for (const need of ['manifest', 'expected-manifest-sha', 'operator', 'preimage-dir']) if (!out[need]) throw fault(`usage_apply_requires_${need}`);
    if (out['sql-snapshot'] || out['manifest-out']) throw fault('usage_apply_forbids_inputs');
  } else if (out.operator || out['preimage-dir']) throw fault('usage_apply_only_argument');
  if (out.manifest) {
    if (!out['expected-manifest-sha']) throw fault('usage_manifest_requires_expected_sha');
    if (out['sql-snapshot'] || out['manifest-out']) throw fault('usage_conflicting_inputs');
  } else if (!out.apply) {
    if (!out['sql-snapshot']) throw fault('usage_missing_input');
    if (out['expected-manifest-sha']) throw fault('usage_conflicting_inputs');
  }
  return out;
}
async function realRuntime({ project }) {
  const { createRequire } = require('node:module');
  const req = createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
  const admin = req('firebase-admin');
  const { OAuth2Client } = req('google-auth-library');
  const credential = admin.credential.applicationDefault();
  admin.initializeApp({ credential, projectId: project });
  return {
    db: admin.firestore(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    resolvePrincipal: createTokeninfoResolver({ getAccessToken: async () => (await credential.getAccessToken()).access_token,
      fetchTokenInfo: token => new OAuth2Client().getTokenInfo(token) }),
  };
}
async function main(argv, deps = {}) {
  const out = deps.out || (l => console.log(l)), err = deps.err || (l => console.error(l)), env = deps.env || process.env, now = deps.now || Date.now;
  const fail = (code, extra) => { err(JSON.stringify({ ok: false, rejected: code, ...extra })); return 2; };
  let args;
  try { args = parseArgs(argv); } catch (e) { return fail(e && e.code ? e.code : 'usage_error', { usage: USAGE }); }
  if (args.apply && env.FIRESTORE_EMULATOR_HOST) return fail('emulator_host_set');
  const read = deps.readFile || (f => fs.readFileSync(f));
  let manifest, sqlSnapshot, preimageStore;
  try {
    if (args.manifest) manifest = JSON.parse(read(args.manifest).toString('utf8'));
    if (args['sql-snapshot']) { const bytes = read(args['sql-snapshot']); sqlSnapshot = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes.toString('utf8')) }; }
  } catch { return fail('input_unreadable'); }
  try { if (args.apply) preimageStore = (deps.createPreimageStore || createFsPreimageStore)(args['preimage-dir']); } catch (e) { return fail(e && e.code ? e.code : 'preimage_dir_invalid'); }
  let runtime;
  try { runtime = await (deps.loadRuntime || realRuntime)({ project: args.project, apply: args.apply }); } catch { return fail('runtime_unavailable'); }
  const result = await runLinks({ db: runtime.db, mode: args.apply ? 'apply' : 'dry-run', firebaseProject: args.project, sqlSnapshot, manifest,
    expectedManifestSha: args['expected-manifest-sha'], operator: args.operator, resolvePrincipal: runtime.resolvePrincipal, preimageStore,
    serverTimestamp: runtime.serverTimestamp, now });
  if (result.ok && args['manifest-out']) {
    try {
      if (!path.isAbsolute(args['manifest-out'])) throw fault('manifest_out_invalid');
      assertOutsideGit(args['manifest-out'], 'manifest_out_in_git');
      const fd = fs.openSync(args['manifest-out'], 'wx', 0o444);
      try { fs.writeFileSync(fd, JSON.stringify(result.manifest, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch { result.ok = false; result.rejected = 'manifest_out_unwritable'; }
  }
  out(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

module.exports = { runLinks, verifyManifest, evaluateRecovery, createFsPreimageStore, createTokeninfoResolver, parseArgs, main, canon, sha, tsKey,
  PAIRS, RUN_COLLECTION, CONTROL_PATH, FIELD, CONFIRMATION_REF };

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => { console.error(JSON.stringify({ ok: false, rejected: 'unexpected_error' })); process.exitCode = 2; });
