const {materialWritesAllowed} = require('./materialWriterOwnership.cjs');
const fault = (code, status) => Object.assign(new Error(code), {code, status});
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
function targetOf(bom, itemId) {
  const matches = [];
  for (const category of Array.isArray(bom?.categories) ? bom.categories : []) {
    for (const item of Array.isArray(category?.items) ? category.items : []) if (item?.id === itemId) matches.push({category, item});
  }
  if (matches.length !== 1) throw fault(matches.length ? 'spec_search_conflict' : 'bom_item_not_found', matches.length ? 409 : 404);
  return matches[0];
}
const identityOf = ({category, item}) => JSON.stringify([category.name, item.id, item.name, item.make || '', item.sku || '', item.itemType || 'component', item.specificationUrl ?? null]);

// Retain the original legacy request/response shape. Ownership is checked before
// dispatch and again in the result transaction so an in-flight callback cannot
// cross a handover boundary or replace unrelated concurrent material changes.
function createLegacySpecSearch({db, fetch: fetchImpl = globalThis.fetch, getServerTimestamp, now = () => new Date(), logger = {error() {}}}) {
  return async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(204).send('');
    if (request.method !== 'POST') return response.status(405).json({error: 'Method not allowed. Use POST.'});
    try {
      const {bomItemId, projectId, itemName, make, sku, userId} = request.body || {};
      if (!validId(projectId) || !validId(bomItemId) || typeof itemName !== 'string' || !itemName.trim()) throw fault('invalid_spec_search_request', 400);
      const bomRef = db.collection('projects').doc(projectId).collection('bom').doc('data');
      const ownerRef = db.collection('pulseMaterialCutovers').doc(projectId);
      const controlRef = db.collection('pulseRuntimeControl').doc('cutover');
      async function writableTarget(transaction) {
        const control = await transaction.get(controlRef), owner = await transaction.get(ownerRef), bom = await transaction.get(bomRef);
        const data = control.exists ? control.data() : null;
        const mode = data && Object.hasOwn(data, 'mode') ? data.mode : 'coexist';
        if (mode !== 'coexist' || !materialWritesAllowed(owner, 'legacy')) throw fault('material_read_only', 503);
        if (!bom.exists) throw fault('bom_not_found', 404);
        const current = bom.data();
        return {bom: current, target: targetOf(current, bomItemId)};
      }
      const initial = await db.runTransaction(writableTarget), identity = identityOf(initial.target);
      const searchId = `spec-search-${bomItemId}-${now().getTime()}`;
      const result = await fetchImpl('https://n8n.qualitastech.com/webhook/spec-search', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({searchId, bomItemId, projectId, itemName, make: make || '', sku: sku || '', userId: userId || 'system', timestamp: now().toISOString()})});
      if (!result.ok) throw fault('spec_search_dispatch_failed', 502);
      const found = await result.json();
      if (found.success && found.specificationUrl) {
        await db.runTransaction(async transaction => {
          const current = await writableTarget(transaction);
          if (identityOf(current.target) !== identity) throw fault('spec_search_conflict', 409);
          current.target.item.specificationUrl = found.specificationUrl;
          current.target.item.updatedAt = now().toISOString();
          transaction.update(bomRef, {categories: current.bom.categories, updatedAt: getServerTimestamp()});
        });
      }
      return response.status(200).json({success: true, searchId, status: 'completed', specificationUrl: found.specificationUrl || null,
        message: found.specificationUrl ? 'Spec sheet found and saved!' : 'Search completed but no spec sheet found.'});
    } catch (error) {
      logger.error('Legacy spec search failed', {code: error.code || 'spec_search_unavailable'});
      return response.status(error.status || 500).json({success: false, error: error.status ? error.code : 'spec_search_unavailable'});
    }
  };
}
module.exports = {createLegacySpecSearch};
