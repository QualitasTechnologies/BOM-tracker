const { createHash, timingSafeEqual } = require('node:crypto');
const { readProjectCommunications } = require('./projectReviewCommunications.cjs');

const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const fault = (code, status) => Object.assign(new Error(code), { code, status });
const safeText = value => typeof value === 'string' ? value : null;
const hash = value => createHash('sha256').update(String(value || '')).digest();

function timestamp(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function sanitizedProject(snapshot) {
  const data = snapshot.data();
  const link = data.pulseProjectId;
  return {
    source_id: snapshot.id, name: safeText(data.projectName) || snapshot.id,
    client_name: safeText(data.clientName), status: safeText(data.status), deadline: safeText(data.deadline),
    category: ['internal', 'customer'].includes(data.category) ? data.category : null,
    pulse_project_id: Number.isSafeInteger(link) && link > 0 ? link : null,
    permissions: { review: true, edit: false }
  };
}

function canReview(project, actor) {
  return actor.customClaims.role === 'admin' || (Array.isArray(project.memberIds) && project.memberIds.includes(actor.uid));
}

function materialSummary(categories, scope) {
  const summary = { item_count: 0, component_count: 0, service_count: 0, status_counts: { 'not-ordered': 0, ordered: 0, received: 0 } };
  for (const category of Array.isArray(categories) ? categories : []) {
    if (scope && !scope.includes(category.name)) continue;
    for (const item of Array.isArray(category.items) ? category.items : []) {
      summary.item_count++;
      if (item.itemType === 'service') summary.service_count++; else summary.component_count++;
      if (Object.hasOwn(summary.status_counts, item.status)) summary.status_counts[item.status]++;
    }
  }
  return summary;
}

/** Admin SDK access is deliberately scoped here; Firestore rules do not protect server SDK reads. */
function createProjectReviewHandler({ db, auth, getServiceKey, timestampFromParts }) {
  async function actorFor(req) {
    const configured = getServiceKey();
    const supplied = req.get('X-Project-Review-Key');
    if (!configured) throw fault('project_review_unavailable', 503);
    if (!supplied || !timingSafeEqual(hash(configured), hash(supplied))) throw fault('caller_authentication_required', 401);
    const email = normalizeEmail(req.get('X-Pulse-User-Email'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fault('actor_forbidden', 403);
    let record;
    try { record = await auth.getUserByEmail(email); }
    catch (error) {
      if (error.code === 'auth/user-not-found') throw fault('actor_forbidden', 403);
      throw fault('identity_provider_unavailable', 503);
    }
    // Auth email is unique per Firebase user. Reload by UID to check current approval/disable state.
    record = await auth.getUser(record.uid);
    if (!record?.uid || normalizeEmail(record.email) !== email || record.disabled || record.emailVerified !== true
      || record.customClaims?.status !== 'approved' || !['admin', 'user', 'viewer'].includes(record.customClaims?.role)) throw fault('actor_forbidden', 403);
    const revokedAfter = timestamp(record.tokensValidAfterTime);
    const authenticatedAt = timestamp(req.get('X-Pulse-Authenticated-At'));
    if (Number.isFinite(revokedAfter) && revokedAfter > 0 && (!Number.isFinite(authenticatedAt) || authenticatedAt < revokedAfter)) throw fault('actor_forbidden', 403);
    // Optional Firebase authentication must agree with the trusted channel actor, never replace it.
    const authorization = req.get('Authorization');
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) throw fault('actor_authentication_required', 401);
      let token;
      try { token = await auth.verifyIdToken(authorization.slice(7), true); }
      catch { throw fault('actor_authentication_required', 401); }
      if (token.uid !== record.uid || normalizeEmail(token.email) !== email) throw fault('actor_forbidden', 403);
    }
    return record;
  }

  return async function projectReview(req, res) {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      const actor = await actorFor(req);
      const id = req.query?.project_id;
      if (req.query?.resource != null && req.query.resource !== 'communications') throw fault('invalid_resource', 400);
      if (req.query?.resource === 'communications' && id == null) throw fault('invalid_project_id', 400);
      if (id != null) {
        if (typeof id !== 'string' || !id || id.length > 512 || id.includes('/')) throw fault('invalid_project_id', 400);
        const ref = db.collection('projects').doc(id);
        const snapshot = await ref.get();
        if (!snapshot.exists) throw fault('project_not_found', 404);
        const data = snapshot.data();
        if (!canReview(data, actor)) throw fault('project_forbidden', 403);
        if (req.query?.resource === 'communications') return res.json(await readProjectCommunications(ref, id, req.query, timestampFromParts));
        const project = sanitizedProject(snapshot);
        const bom = await ref.collection('bom').doc('data').get();
        const member = (Array.isArray(data.members) ? data.members : []).find(row => row.userId === actor.uid);
        // Match src/utils/accessControl.ts: unscoped external members see no categories.
        const unrestricted = actor.customClaims.role === 'admin' || normalizeEmail(actor.email).endsWith('@qualitastech.com');
        const scope = unrestricted ? null : Array.isArray(member?.categoryScope) ? member.categoryScope : [];
        project.material_summary = materialSummary(bom.exists ? bom.data()?.categories : [], scope);
        return res.json({ ok: true, project });
      }
      const query = actor.customClaims.role === 'admin' ? db.collection('projects') : db.collection('projects').where('memberIds', 'array-contains', actor.uid);
      const snapshot = await query.get();
      const projects = snapshot.docs.filter(document => canReview(document.data(), actor)).map(sanitizedProject);
      return res.json({ ok: true, projects });
    } catch (error) {
      // Deliberately omit exception text and request headers: SDK errors may contain credentials or account details.
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.code : 'project_review_unavailable' });
    }
  };
}

module.exports = { createProjectReviewHandler };
