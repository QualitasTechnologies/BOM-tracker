const { createProjectActorFactory } = require('./projectReviewActor.cjs');
const { readProjectCommunications } = require('./projectReviewCommunications.cjs');

const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const fault = (code, status) => Object.assign(new Error(code), { code, status });
const safeText = value => typeof value === 'string' ? value : null;

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
  const actorFor = createProjectActorFactory({ auth, getServiceKey });

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
