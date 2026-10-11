const { createHash } = require('node:crypto');
const { createProjectActorFactory } = require('./projectReviewActor.cjs');

const fault = (code, status) => Object.assign(new Error(code), { code, status });
const digest = text => createHash('sha256').update(text).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validVersion = value => value === 'missing' || (typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9);

function versionOf(snapshot) {
  if (!snapshot.exists) return 'missing';
  const time = snapshot.updateTime;
  if (!time || !Number.isSafeInteger(time.seconds) || !Number.isInteger(time.nanoseconds) || time.seconds < 0 || time.nanoseconds < 0 || time.nanoseconds >= 1e9) throw fault('materials_version_unavailable', 503);
  return `${time.seconds}:${time.nanoseconds}`;
}

function scopeFor(project, actor) {
  if (actor.customClaims.role !== 'admin' && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid))) throw fault('project_forbidden', 403);
  if (actor.customClaims.role === 'admin' || actor.email.trim().toLowerCase().endsWith('@qualitastech.com')) return null;
  const member = (Array.isArray(project.members) ? project.members : []).find(row => row.userId === actor.uid);
  return Array.isArray(member?.categoryScope) ? member.categoryScope : [];
}

function validateBody(body) {
  if (!plain(body) || Object.keys(body).some(key => !['item_id', 'expected_version', 'operation_id', 'patch'].includes(key))) throw fault('invalid_material_patch', 400);
  if (typeof body.item_id !== 'string' || !body.item_id || body.item_id.length > 512 || body.item_id.includes('/')) throw fault('invalid_item_id', 400);
  if (!validVersion(body.expected_version)) throw fault('invalid_material_version', 400);
  if (typeof body.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.operation_id)) throw fault('invalid_operation_id', 400);
  if (!plain(body.patch) || !Object.keys(body.patch).length) throw fault('invalid_material_patch', 400);
  const limits = { name: 500, description: 4000, make: 500, sku: 500, unit: 100 };
  for (const [key, value] of Object.entries(body.patch)) {
    if (Object.hasOwn(limits, key)) {
      if (typeof value !== 'string' || value.length > limits[key] || (key === 'name' && !value.trim())) throw fault('invalid_material_patch', 400);
    } else if (key === 'quantity' || key === 'price') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'quantity' ? value <= 0 : value < 0)) throw fault('invalid_material_patch', 400);
    } else throw fault('invalid_material_patch', 400);
  }
  const sortedPatch = Object.fromEntries(Object.keys(body.patch).sort().map(key => [key, body.patch[key]]));
  return digest(JSON.stringify({ item_id: body.item_id, expected_version: body.expected_version, patch: sortedPatch }));
}

/** Admin SDK writes require both trusted-channel identity and current project/category access. */
function createProjectOperationsHandler({ db, auth, getServiceKey, mutationsEnabled = false, getServerTimestamp }) {
  const actorFor = createProjectActorFactory({ auth, getServiceKey, serviceKeyHeader: 'X-Project-Operations-Key', unavailableCode: 'project_operations_unavailable' });
  const writesOn = () => typeof mutationsEnabled === 'function' ? mutationsEnabled() === true : mutationsEnabled === true;
  return async function projectOperations(req, res) {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (!['GET', 'PATCH'].includes(req.method)) throw fault('method_not_allowed', 405);
      const actor = await actorFor(req);
      const id = req.query?.project_id;
      if (typeof id !== 'string' || !id || id.length > 512 || id.includes('/')) throw fault('invalid_project_id', 400);
      const projectRef = db.collection('projects').doc(id);
      const bomRef = projectRef.collection('bom').doc('data');
      if (req.method === 'GET') {
        const response = await db.runTransaction(async transaction => {
          const project = await transaction.get(projectRef);
          if (!project.exists) throw fault('project_not_found', 404);
          const scope = scopeFor(project.data(), actor);
          const bom = await transaction.get(bomRef);
          const categories = (Array.isArray(bom.data()?.categories) ? bom.data().categories : []).filter(category => scope === null || scope.includes(category.name));
          return { ok: true, project_id: id, categories, version: versionOf(bom), permissions: { review: true, edit: writesOn() && (scope === null || categories.length > 0) } };
        });
        return res.json(response);
      }
      if (!writesOn()) throw fault('material_mutations_disabled', 503);
      const payloadHash = validateBody(req.body);
      const { item_id: itemId, expected_version: expectedVersion, operation_id: operationId, patch } = req.body;
      // Keep deduplication and immutable audit outside the legacy project wildcard,
      // which permits approved BOM clients to write project subcollections.
      const operationsRef = db.collection('pulseProjectMaterialOperations').doc(id);
      const receiptRef = operationsRef.collection('materialOperations').doc(operationId);
      const auditRef = operationsRef.collection('materialAudit').doc(operationId);
      const response = await db.runTransaction(async transaction => {
        const project = await transaction.get(projectRef);
        if (!project.exists) throw fault('project_not_found', 404);
        const scope = scopeFor(project.data(), actor);
        const bom = await transaction.get(bomRef);
        const receipt = await transaction.get(receiptRef);
        const categories = Array.isArray(bom.data()?.categories) ? bom.data().categories : [];
        const matches = [];
        categories.forEach((category, categoryIndex) => (Array.isArray(category.items) ? category.items : []).forEach((item, itemIndex) => { if (item.id === itemId) matches.push({ item, category, categoryIndex, itemIndex }); }));
        if (matches.length > 1) throw fault('duplicate_material_id', 409);
        if (!matches.length) throw fault('material_not_found', 404);
        const match = matches[0];
        if (scope !== null && !scope.includes(match.category.name)) throw fault('material_forbidden', 403);
        if (receipt.exists) {
          const recorded = receipt.data();
          if (recorded.actor_uid !== actor.uid || recorded.actor_email !== actor.email.trim().toLowerCase() || recorded.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          return recorded.result;
        }
        if (versionOf(bom) !== expectedVersion) throw fault('material_version_conflict', 409);
        if (match.item.itemType === 'service' && Object.hasOwn(patch, 'quantity') && patch.quantity < 0.5) throw fault('invalid_material_patch', 400);
        const updated = { ...match.item, ...patch };
        const nextCategories = categories.map((category, index) => index !== match.categoryIndex ? category : { ...category, items: category.items.map((item, index) => index === match.itemIndex ? updated : item) });
        const before = {}, after = {};
        for (const key of Object.keys(patch)) { before[key] = Object.hasOwn(match.item, key) ? match.item[key] : null; after[key] = patch[key]; }
        const result = { ok: true, project_id: id, item_id: itemId, operation_id: operationId, item: updated };
        const actorEmail = actor.email.trim().toLowerCase();
        const createdAt = getServerTimestamp();
        transaction.update(bomRef, { categories: nextCategories });
        transaction.create(auditRef, { actor_uid: actor.uid, actor_email: actorEmail, project_id: id, item_id: itemId, operation_id: operationId, operation: 'patch_material', previous_version: expectedVersion, permission: { role: actor.customClaims.role, category: match.category.name, scope }, before, after, created_at: createdAt });
        transaction.create(receiptRef, { actor_uid: actor.uid, actor_email: actorEmail, payload_hash: payloadHash, result, created_at: createdAt });
        return result;
      });
      return res.json(response);
    } catch (error) {
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.code : 'project_operations_unavailable' });
    }
  };
}

module.exports = { createProjectOperationsHandler };
