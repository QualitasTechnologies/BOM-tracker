'use strict';

// Content-free refresh notices for the scoped BOM read boundary. A notice only
// tells a signed-in client "read again"; it never carries, derives from or
// replays project data. IDs live in the document path, the body is exactly
// { version, nonce }, and every write is a whole-body server `set`.
const { randomBytes: nodeRandomBytes } = require('node:crypto');

const SIGNAL_VERSION = 1;
const SIGNAL_COLLECTIONS = Object.freeze({ project: 'pulseReadSignals', user: 'pulseUserReadSignals', catalog: 'pulseReadCatalog' });
const CATALOG_DOCUMENT_ID = 'admin';
const NONCE_BYTES = 16;
const DEFAULT_CHUNK_SIZE = 200;
const MAX_CHUNK_SIZE = 400; // Firestore batches allow 500; leave headroom.

// Gate shared with the scoped read callable: exact string 'true' only.
const projectReadSignalsEnabled = env => env.BOM_SCOPED_READS_ENABLED === 'true';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeId = (value, maxLength) => typeof value === 'string' && !!value.trim() && value.length <= maxLength
  && Buffer.byteLength(value, 'utf8') <= 1500
  && !/[\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const validProjectSignalId = value => safeId(value, 512);
const validUserSignalId = value => safeId(value, 128);

function signalBody(random = nodeRandomBytes) {
  const bytes = random(NONCE_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length < NONCE_BYTES) throw new Error('invalid_signal_nonce');
  return { version: SIGNAL_VERSION, nonce: bytes.toString('base64url') };
}

const sideData = snapshot => (snapshot && snapshot.exists ? snapshot.data() : undefined);
const sides = event => ({ before: sideData(event?.data?.before), after: sideData(event?.data?.after) });
const existence = event => {
  const before = event?.data?.before, after = event?.data?.after;
  return before && after ? { before: !!before.exists, after: !!after.exists } : null;
};

// Member UIDs named by either membership representation. Malformed entries are
// ignored as targets; this helper never authorizes reads.
function memberUids(data) {
  const uids = new Set();
  if (!plain(data)) return uids;
  if (Array.isArray(data.memberIds)) for (const uid of data.memberIds) if (validUserSignalId(uid)) uids.add(uid);
  if (Array.isArray(data.members)) for (const row of data.members) if (plain(row) && validUserSignalId(row.userId)) uids.add(row.userId);
  return uids;
}
const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));
const membershipState = data => !plain(data) ? 'missing_project'
  : !Object.hasOwn(data, 'memberIds') ? 'absent'
    : data.memberIds === null ? 'null' : Array.isArray(data.memberIds) ? 'array' : 'malformed';
function membershipChanged(before, after) {
  if (membershipState(before) !== membershipState(after)) return true;
  // Compare each representation independently. A stale roster must not mask
  // revocation from memberIds just because the combined UID union is unchanged.
  return ['memberIds', 'members'].some(field => !sameSet(
    memberUids({ [field]: plain(before) ? before[field] : undefined }),
    memberUids({ [field]: plain(after) ? after[field] : undefined }),
  ));
}

// Pure planning from path parameters and before/after snapshots. Only IDs are
// extracted; no other source value is read, so a stale, duplicate or reordered
// event can do nothing but name the same records to invalidate.
function planSignals(kind, event) {
  if (!['project', 'bom', 'document'].includes(kind)) throw new Error('unknown_signal_kind');
  const plan = { projects: [], users: [], catalog: false };
  if (kind === 'document') {
    const { before, after } = sides(event);
    const ids = new Set();
    for (const data of [before, after]) if (plain(data) && validProjectSignalId(data.projectId)) ids.add(data.projectId);
    plan.projects = [...ids];
    return plan;
  }
  const projectId = event?.params?.projectId;
  if (validProjectSignalId(projectId)) plan.projects = [projectId];
  if (kind === 'bom') return plan;

  const state = existence(event);
  if (state && (!state.before || !state.after)) plan.catalog = true; // project created or deleted
  const { before, after } = sides(event);
  const oldUids = memberUids(before), newUids = memberUids(after);
  if (membershipChanged(before, after)) {
    // Firestore already bounds each source document. Bound individual batches,
    // rather than silently dropping later members from a large valid roster.
    plan.users = [...new Set([...oldUids, ...newUids])];
  }
  return plan;
}

function createProjectReadSignals({ db, enabled, randomBytes = nodeRandomBytes, chunkSize = DEFAULT_CHUNK_SIZE, logger } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) throw new Error('invalid_signal_chunk_size');

  async function write(plan) {
    const targets = [
      ...plan.projects.map(id => [SIGNAL_COLLECTIONS.project, id]),
      ...plan.users.map(uid => [SIGNAL_COLLECTIONS.user, uid]),
      ...(plan.catalog ? [[SIGNAL_COLLECTIONS.catalog, CATALOG_DOCUMENT_ID]] : []),
    ];
    let failedChunks = 0, written = 0;
    for (let offset = 0; offset < targets.length; offset += chunkSize) {
      const chunk = targets.slice(offset, offset + chunkSize);
      try {
        const batch = db.batch();
        for (const [collection, id] of chunk) batch.set(db.collection(collection).doc(id), signalBody(randomBytes));
        await batch.commit();
        written += chunk.length;
      } catch {
        // Keep invalidating the remaining chunks; the delivery retry re-runs the
        // whole plan, which only re-bumps notices and is always safe.
        failedChunks++;
      }
    }
    if (failedChunks) {
      logger?.error?.('read_signal_chunks_failed', { failedChunks, targets: targets.length });
      throw Object.assign(new Error('signal_write_incomplete'), { code: 'signal_write_incomplete', failedChunks });
    }
    return { written, chunks: Math.ceil(targets.length / chunkSize) };
  }

  const handler = kind => async event => {
    if (!enabled()) return { skipped: 'disabled' };
    return write(planSignals(kind, event));
  };
  return { onProject: handler('project'), onBom: handler('bom'), onDocument: handler('document') };
}

module.exports = {
  SIGNAL_VERSION, SIGNAL_COLLECTIONS, CATALOG_DOCUMENT_ID, projectReadSignalsEnabled,
  validProjectSignalId, validUserSignalId, signalBody, planSignals, createProjectReadSignals,
};
