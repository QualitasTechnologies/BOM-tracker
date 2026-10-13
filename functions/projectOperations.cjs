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
  const limits = { name: 500, description: 4000, make: 500, sku: 500, unit: 100, category: 500 };
  for (const [key, value] of Object.entries(body.patch)) {
    if (Object.hasOwn(limits, key)) {
      if (typeof value !== 'string' || value.length > limits[key] || (['name', 'category'].includes(key) && !value.trim())) throw fault('invalid_material_patch', 400);
    } else if (key === 'itemType') {
      if (!['component', 'service'].includes(value)) throw fault('invalid_material_patch', 400);
    } else if (key === 'finalizedVendor') {
      if (value !== null && (!plain(value) || Object.keys(value).some(field => !['name', 'price', 'leadTime', 'availability'].includes(field))
        || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 500
        || Object.hasOwn(value, 'price') && (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price < 0)
        || ['leadTime', 'availability'].some(field => Object.hasOwn(value, field) && (typeof value[field] !== 'string' || value[field].length > 500)))) throw fault('invalid_material_patch', 400);
    } else if (key === 'quantity' || key === 'price') {
      if (key === 'price' && value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'quantity' ? value <= 0 : value < 0)) throw fault('invalid_material_patch', 400);
    } else throw fault('invalid_material_patch', 400);
  }
  const canonical = value => plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const sortedPatch = canonical(body.patch);
  return digest(JSON.stringify({ item_id: body.item_id, expected_version: body.expected_version, patch: sortedPatch }));
}

// Read-only procurement projection. Every field is listed explicitly: anything else stored on a
// document (download URLs with tokens, storage paths, future fields) never leaves Firebase.
const PROCUREMENT_FIELDS = {
  purchaseOrder: [
    'projectId', 'billingEntityId', 'poNumber', 'vendorId', 'vendorName', 'vendorAddress', 'vendorGstin', 'vendorStateCode', 'vendorStateName', 'vendorEmail', 'vendorPhone',
    'projectReference', 'vendorQuoteReference', 'invoiceToCompany', 'invoiceToAddress', 'invoiceToGstin', 'invoiceToStateCode', 'invoiceToStateName',
    'shipToAddress', 'shipToGstin', 'shipToStateCode', 'shipToStateName', 'items', 'subtotal', 'taxType', 'taxPercentage', 'igstAmount', 'cgstAmount', 'sgstAmount',
    'totalAmount', 'amountInWords', 'currency', 'paymentTerms', 'deliveryTerms', 'dispatchedThrough', 'destination', 'termsAndConditions', 'includeAnnexure',
    'poDate', 'expectedDeliveryDate', 'status', 'submittedForApprovalAt', 'submittedBy', 'changesRequestedAt', 'changesRequestedBy', 'changesRequestedNote',
    'sentAt', 'sentBy', 'sentToEmail', 'closedAt', 'warnings', 'createdAt', 'createdBy', 'updatedAt'
  ],
  purchaseOrderItem: ['bomItemId', 'slNo', 'description', 'itemCode', 'make', 'uom', 'quantity', 'rate', 'discountPercent', 'amount', 'dueDate', 'hsn'],
  purchaseOrderWarning: ['field', 'message', 'severity'],
  document: ['id', 'name', 'type', 'uploadedAt', 'uploadedBy', 'linkedBOMItems', 'fileSize']
};
const DOCUMENT_TYPES = ['vendor-quote', 'vendor-po', 'customer-po', 'vendor-invoice', 'spec-sheet'];
const PO_DATES = new Set(['poDate', 'expectedDeliveryDate', 'submittedForApprovalAt', 'changesRequestedAt', 'sentAt', 'closedAt', 'createdAt', 'updatedAt']);
const PO_NUMBERS = new Set(['subtotal', 'taxPercentage', 'igstAmount', 'cgstAmount', 'sgstAmount', 'totalAmount']);
const PO_BOOLEANS = new Set(['includeAnnexure']);
const ITEM_NUMBERS = new Set(['slNo', 'quantity', 'rate', 'discountPercent', 'amount']);
const DEFAULT_PROCUREMENT_LIMITS = { purchaseOrders: 100, documents: 500 };
const MAX_ID = 512;

const text = value => typeof value === 'string' ? value : null;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const isoOrNull = value => {
  try {
    let date;
    if (value instanceof Date) date = value;
    else if (value && typeof value.toDate === 'function') date = value.toDate();
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) date = new Date(value);
    else return null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch { return null; }
};
const projectFields = (source, fields, readers) => Object.fromEntries(fields.map(key => [key, readers(key)(source[key])]));

function purchaseOrderOf(id, projectId, data) {
  const item = row => projectFields(row, PROCUREMENT_FIELDS.purchaseOrderItem, key => key === 'dueDate' ? isoOrNull : ITEM_NUMBERS.has(key) ? finite : text);
  const warning = row => projectFields(row, PROCUREMENT_FIELDS.purchaseOrderWarning, () => text);
  const reader = key => PO_DATES.has(key) ? isoOrNull : PO_NUMBERS.has(key) ? finite : PO_BOOLEANS.has(key) ? (value => typeof value === 'boolean' ? value : null)
    : key === 'items' ? (value => (Array.isArray(value) ? value : []).filter(plain).map(item)) : key === 'warnings' ? (value => (Array.isArray(value) ? value : []).filter(plain).map(warning)) : text;
  // The route id is authoritative; a stored projectId on a legacy record is never trusted.
  return { id, ...projectFields(data, PROCUREMENT_FIELDS.purchaseOrder, reader), projectId, has_pdf: typeof data.pdfUrl === 'string' && data.pdfUrl.length > 0 };
}

function documentOf(id, data, visibleItemIds) {
  if (!DOCUMENT_TYPES.includes(data.type)) return null;
  const linked = (Array.isArray(data.linkedBOMItems) ? data.linkedBOMItems : []).filter(value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID);
  return {
    id, name: text(data.name), type: data.type, uploadedAt: isoOrNull(data.uploadedAt), uploadedBy: text(data.uploadedBy),
    linkedBOMItems: visibleItemIds ? linked.filter(value => visibleItemIds.has(value)) : linked,
    fileSize: finite(data.fileSize) !== null && data.fileSize >= 0 ? data.fileSize : null
  };
}

const newestFirst = field => (a, b) => (b[field] || '').localeCompare(a[field] || '') || a.id.localeCompare(b.id);

/** Admin SDK writes require both trusted-channel identity and current project/category access. */
function createProjectOperationsHandler({ db, auth, getServiceKey, resolveActor, mutationsEnabled = false, getServerTimestamp, procurementLimits = DEFAULT_PROCUREMENT_LIMITS }) {
  const limits = { ...DEFAULT_PROCUREMENT_LIMITS, ...procurementLimits };
  // Server-only dependency seam. HTTP callers still use the trusted-channel factory by default.
  const actorFor = resolveActor || createProjectActorFactory({ auth, getServiceKey, serviceKeyHeader: 'X-Project-Operations-Key', unavailableCode: 'project_operations_unavailable' });
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
      // Absent resource keeps the legacy materials contract; anything else must be exactly 'procurement'.
      const resource = req.query?.resource;
      if (resource !== undefined && resource !== 'procurement') throw fault('invalid_resource', 400);
      if (resource === 'procurement') {
        if (req.method !== 'GET') throw fault('method_not_allowed', 405);
        const response = await db.runTransaction(async transaction => {
          const project = await transaction.get(projectRef);
          if (!project.exists) throw fault('project_not_found', 404);
          // Project membership gates everything. Category scope narrows documents only: BOM renders
          // POListSection inside the Documents tab for partners with no isPartner check or item filter.
          const scope = scopeFor(project.data(), actor);
          const bom = await transaction.get(bomRef);
          const visibleItemIds = scope === null ? null : new Set((Array.isArray(bom.data()?.categories) ? bom.data().categories : [])
            .filter(category => scope.includes(category.name)).flatMap(category => Array.isArray(category.items) ? category.items : []).map(item => item?.id).filter(value => typeof value === 'string'));
          // Order by document id, never a data field: a missing createdAt would silently drop the record.
          const poRows = await transaction.get(projectRef.collection('purchaseOrders').orderBy('__name__').limit(limits.purchaseOrders + 1));
          const docRows = await transaction.get(db.collection('projectDocuments').where('projectId', '==', id).orderBy('__name__').limit(limits.documents + 1));
          const bomAdmin = actor.customClaims.role === 'admin';
          const orders = poRows.docs.slice(0, limits.purchaseOrders).filter(row => plain(row.data())).map(row => purchaseOrderOf(row.id, id, row.data())).sort(newestFirst('createdAt'));
          const documents = docRows.docs.slice(0, limits.documents).filter(row => plain(row.data())).map(row => {
            const data = row.data();
            if (data.type === 'customer-po' && !bomAdmin) return null;
            const mapped = documentOf(row.id, data, visibleItemIds);
            return mapped && (visibleItemIds === null || mapped.linkedBOMItems.length > 0) ? mapped : null;
          }).filter(Boolean).sort(newestFirst('uploadedAt'));
          return { ok: true, project_id: id, purchase_orders: orders, documents, truncated: { purchase_orders: poRows.docs.length > limits.purchaseOrders, documents: docRows.docs.length > limits.documents }, permissions: { edit: false } };
        });
        return res.json(response);
      }
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
        const updated = { ...match.item, ...patch };
        for (const key of ['price', 'finalizedVendor']) if (Object.hasOwn(patch, key) && patch[key] === null) delete updated[key];
        if (Object.hasOwn(patch, 'itemType') && (typeof updated.quantity !== 'number' || !Number.isFinite(updated.quantity) || updated.quantity <= 0)) throw fault('invalid_material_state', 409);
        if (updated.itemType === 'service' && (Object.hasOwn(patch, 'quantity') || Object.hasOwn(patch, 'itemType')) && updated.quantity < 0.5) throw fault('invalid_material_patch', 400);
        if (Object.hasOwn(patch, 'quantity')) {
          let received = match.item.status === 'received' ? match.item.quantity : 0;
          if (Array.isArray(match.item.fulfillmentTranches) && match.item.fulfillmentTranches.length) {
            if (match.item.fulfillmentTranches.some(row => !row || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0)) throw fault('invalid_material_state', 409);
            received = match.item.fulfillmentTranches.reduce((total, row) => total + row.quantity, 0);
          }
          if (patch.quantity + Number.EPSILON * Math.max(1, received) < received) throw fault('received_quantity_conflict', 409);
        }
        const destination = patch.category ?? match.category.name;
        let nextCategories;
        if (destination !== match.category.name) {
          if (scope !== null && !scope.includes(destination)) throw fault('material_forbidden', 403);
          const settings = await transaction.get(db.collection('settings').doc('bom'));
          const canonical = (Array.isArray(settings.data()?.categories) ? settings.data().categories : [])
            .filter(row => row && !row.parentId && row.isActive !== false).map(row => row.name);
          if (!canonical.includes(destination)) throw fault('invalid_material_category', 400);
          const targets = categories.filter(category => category.name === destination);
          if (targets.length > 1) throw fault('duplicate_material_category', 409);
          if (targets.length && !Array.isArray(targets[0].items)) throw fault('invalid_material_state', 409);
          nextCategories = categories.map((category, index) => index === match.categoryIndex
            ? { ...category, items: category.items.filter((_item, itemIndex) => itemIndex !== match.itemIndex) }
            : category.name === destination ? { ...category, items: [...category.items, updated] } : category);
          if (!targets.length) nextCategories.push({ name: destination, isExpanded: true, items: [updated] });
        } else {
          nextCategories = categories.map((category, index) => index !== match.categoryIndex ? category : { ...category, items: category.items.map((item, index) => index === match.itemIndex ? updated : item) });
        }
        const before = {}, after = {};
        for (const key of Object.keys(patch)) { before[key] = Object.hasOwn(match.item, key) ? match.item[key] : null; after[key] = patch[key]; }
        const result = { ok: true, project_id: id, item_id: itemId, operation_id: operationId, item: updated };
        const actorEmail = actor.email.trim().toLowerCase();
        const createdAt = getServerTimestamp();
        transaction.update(bomRef, { categories: nextCategories });
        transaction.create(auditRef, { actor_uid: actor.uid, actor_email: actorEmail, project_id: id, item_id: itemId, operation_id: operationId, operation: 'patch_material', previous_version: expectedVersion, permission: { role: actor.customClaims.role, category: match.category.name, scope }, before, after, ...(destination !== match.category.name ? { category_transition: { from: match.category.name, to: destination } } : {}), created_at: createdAt });
        transaction.create(receiptRef, { actor_uid: actor.uid, actor_email: actorEmail, payload_hash: payloadHash, result, created_at: createdAt });
        return result;
      });
      return res.json(response);
    } catch (error) {
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.code : 'project_operations_unavailable' });
    }
  };
}

module.exports = { createProjectOperationsHandler, PROCUREMENT_FIELDS, DOCUMENT_TYPES };
