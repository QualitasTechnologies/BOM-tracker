const { createHash } = require('node:crypto');
const { createProjectActorFactory } = require('./projectReviewActor.cjs');
const { validateCommand, canonicalCategories, referencedDocuments, applyCommand, assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');

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

function validateFulfillment(body, projectId) {
  if (!plain(body) || Object.keys(body).some(key => !['item_id', 'expected_version', 'operation_id', 'fulfillment'].includes(key))) throw fault('invalid_material_fulfillment', 400);
  // Reuse the editor's identity and opaque revision validation without its patch hash.
  validateBody({ item_id: body.item_id, expected_version: body.expected_version, operation_id: body.operation_id, patch: { name: 'validation' } });
  const value = body.fulfillment;
  if (!plain(value) || Object.keys(value).some(key => !['kind', 'quantity', 'invoiceDocId', 'photoUrl', 'loggedAt'].includes(key))
    || !['receipt', 'fulfillment'].includes(value.kind) || typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0) throw fault('invalid_material_fulfillment', 400);
  if (value.loggedAt !== undefined && (typeof value.loggedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.loggedAt)
    || !Number.isFinite(Date.parse(value.loggedAt)) || new Date(value.loggedAt).toISOString().slice(0, 10) !== value.loggedAt)) throw fault('invalid_material_fulfillment', 400);
  if (value.invoiceDocId !== undefined && (typeof value.invoiceDocId !== 'string' || !value.invoiceDocId || value.invoiceDocId.length > 512 || /[\/\x00-\x1f]/.test(value.invoiceDocId))) throw fault('invalid_material_fulfillment', 400);
  if (value.photoUrl !== undefined) {
    let url, path;
    try { url = new URL(value.photoUrl); path = decodeURIComponent(url.pathname); } catch { throw fault('invalid_receipt_photo', 400); }
    const prefix = `/v0/b/visionbomtracker.firebasestorage.app/o/projects/${projectId}/received-photos/`;
    if (typeof value.photoUrl !== 'string' || value.photoUrl.length > 4096 || url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'
      || url.port || url.username || url.password || url.hash || !path.startsWith(prefix)
      || !path.slice(prefix.length) || path.slice(prefix.length).split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\\]/.test(path)) throw fault('invalid_receipt_photo', 400);
  }
  if (value.kind === 'receipt' && (!Number.isInteger(value.quantity) || value.quantity < 1 || !value.loggedAt || !value.invoiceDocId || !value.photoUrl)) throw fault('invalid_material_fulfillment', 400);
  const sorted = Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  return digest(JSON.stringify({ operation: 'fulfill_material', item_id: body.item_id, expected_version: body.expected_version, fulfillment: sorted }));
}

function appendFulfillment(item, value, operationId) {
  if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0
    || item.itemType !== undefined && !['component', 'service'].includes(item.itemType)
    || item.fulfillmentTranches !== undefined && !Array.isArray(item.fulfillmentTranches)) throw fault('invalid_material_state', 409);
  const service = item.itemType === 'service';
  if (value.kind === 'receipt' && service || value.quantity < (service ? 0.5 : 1)) throw fault('invalid_material_fulfillment', 400);
  if (!service && (!value.invoiceDocId || !value.photoUrl)) throw fault('invalid_material_fulfillment', 400);
  const tranches = item.fulfillmentTranches || [];
  if (tranches.some(row => !plain(row) || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0)) throw fault('invalid_material_state', 409);
  const trancheIds = tranches.map(row => row.id).filter(id => id !== undefined);
  if (trancheIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 512)) throw fault('invalid_material_state', 409);
  if (new Set(trancheIds).size !== trancheIds.length || trancheIds.includes(`tranche-${operationId}`)) throw fault('invalid_material_state', 409);
  const received = tranches.length ? tranches.reduce((total, row) => total + row.quantity, 0) : item.status === 'received' ? item.quantity : 0;
  const total = received + value.quantity;
  const tolerance = Number.EPSILON * Math.max(1, received, total, item.quantity) * 4;
  if (!Number.isFinite(received) || received > item.quantity + tolerance) throw fault('invalid_material_state', 409);
  if (item.status === 'received' && received + tolerance < item.quantity) throw fault('invalid_material_state', 409);
  if (total > item.quantity + tolerance) throw fault('received_quantity_conflict', 409);
  const tranche = { id: `tranche-${operationId}`, quantity: value.quantity, loggedAt: value.kind === 'receipt' ? value.loggedAt : new Date().toISOString().slice(0, 10) };
  for (const key of ['invoiceDocId', 'photoUrl']) if (value[key] !== undefined) tranche[key] = value[key];
  const updated = { ...item, fulfillmentTranches: [...tranches, tranche] };
  if (value.kind === 'receipt') Object.assign(updated, { status: total + tolerance >= item.quantity ? 'received' : 'ordered', actualArrival: item.actualArrival || value.loggedAt, linkedInvoiceDocumentId: value.invoiceDocId, receivedPhotoUrl: value.photoUrl });
  else if (total + tolerance >= item.quantity) updated.status = 'received';
  return updated;
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
      if (!['GET', 'PATCH', 'POST'].includes(req.method)) throw fault('method_not_allowed', 405);
      const actor = await actorFor(req);
      const id = req.query?.project_id;
      if (typeof id !== 'string' || !id || id.length > 512 || id.includes('/')) throw fault('invalid_project_id', 400);
      const projectRef = db.collection('projects').doc(id);
      const bomRef = projectRef.collection('bom').doc('data');
      // Absent resource keeps the legacy materials contract; anything else must be exactly 'procurement'.
      const resource = req.query?.resource;
      if (resource === 'project_create') {
        if (req.method !== 'POST') throw fault('method_not_allowed', 405);
        if (!writesOn()) throw fault('material_mutations_disabled', 503);
        if (actor.customClaims.role !== 'admin' && !actor.email.trim().toLowerCase().endsWith('@qualitastech.com')) throw fault('project_creation_forbidden', 403);
        const body = req.body;
        if (!plain(body) || Object.keys(body).some(key => !['operation_id', 'project'].includes(key))) throw fault('invalid_project_create', 400);
        validateBody({ item_id: 'create', operation_id: body.operation_id, expected_version: 'missing', patch: { name: 'validation' } });
        const data = body.project;
        const fields = ['projectName', 'clientName', 'description', 'status', 'deadline', 'poValue', 'clientId', 'billingEntityId'];
        if (!plain(data) || Object.keys(data).some(key => !fields.includes(key))
          || ['projectName', 'clientName'].some(key => typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 500)
          || typeof data.description !== 'string' || data.description.length > 4000
          || !['Planning', 'Procurement', 'Ongoing', 'Delayed', 'Completed', 'Archived'].includes(data.status)
          || typeof data.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.deadline) || !Number.isFinite(Date.parse(data.deadline)) || new Date(data.deadline).toISOString().slice(0, 10) !== data.deadline
          || typeof data.poValue !== 'number' || !Number.isFinite(data.poValue) || data.poValue < 0
          || ['clientId', 'billingEntityId'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 512 || /[\/\x00-\x1f]/.test(data[key])))
          || /[\x00-\x1f]/.test(id) || !id.trim()) throw fault('invalid_project_create', 400);
        const payloadHash = digest(JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(key => [key, data[key]]))));
        const operations = db.collection('pulseProjectMaterialOperations').doc(id);
        const receiptRef = operations.collection('materialOperations').doc(body.operation_id);
        const auditRef = operations.collection('materialAudit').doc(body.operation_id);
        const actorEmail = actor.email.trim().toLowerCase();
        return res.json(await db.runTransaction(async transaction => {
          const receipt = await transaction.get(receiptRef);
          const project = await transaction.get(projectRef);
          if (receipt.exists) {
            const recorded = receipt.data();
            if (recorded.operation !== 'create_project' || recorded.actor_uid !== actor.uid || recorded.actor_email !== actorEmail || recorded.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
            if (!project.exists) throw fault('project_not_found', 404);
            scopeFor(project.data(), actor);
            return recorded.result;
          }
          if (project.exists) throw fault('project_id_conflict', 409);
          const createdAt = getServerTimestamp();
          const after = { ...data, projectId: id, memberIds: [actor.uid], members: [{ userId: actor.uid, email: actorEmail, displayName: typeof actor.displayName === 'string' && actor.displayName.trim() ? actor.displayName : actorEmail, addedAt: new Date().toISOString().slice(0, 10), addedBy: actor.uid, notificationsEnabled: true }], createdAt };
          const result = { ok: true, project_id: id, operation_id: body.operation_id };
          const audit = { actor_uid: actor.uid, actor_email: actorEmail, operation: 'create_project', project_id: id, operation_id: body.operation_id, before: null, after, created_at: createdAt };
          const recorded = { operation: 'create_project', actor_uid: actor.uid, actor_email: actorEmail, payload_hash: payloadHash, result, created_at: createdAt };
          assertDocumentBudget([{ path: projectRef.path, data: after }, { path: auditRef.path, data: audit }, { path: receiptRef.path, data: recorded }]);
          transaction.create(projectRef, after); transaction.create(auditRef, audit); transaction.create(receiptRef, recorded);
          return result;
        }));
      }
      if (resource !== undefined && !['procurement', 'fulfillment', 'commands'].includes(resource)) throw fault('invalid_resource', 400);
      const fulfilling = resource === 'fulfillment';
      const commanding = resource === 'commands';
      if ((fulfilling || commanding) && req.method !== 'POST' || !fulfilling && !commanding && req.method === 'POST') throw fault('method_not_allowed', 405);
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
          return { ok: true, project_id: id, categories, version: versionOf(bom), permissions: { review: true, edit: writesOn() && (scope === null || categories.length > 0), command: writesOn() && (scope === null || scope.length > 0) } };
        });
        return res.json(response);
      }
      if (!writesOn()) throw fault('material_mutations_disabled', 503);
      if (commanding) {
        const body = req.body;
        if (!plain(body) || Object.keys(body).some(key => !['expected_version', 'operation_id', 'command'].includes(key))) throw fault('invalid_material_command', 400);
        validateBody({ item_id: 'command', expected_version: body.expected_version, operation_id: body.operation_id, patch: { name: 'validation' } });
        if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_INPUT_BYTES) throw fault('material_command_too_large', 400);
        const command = validateCommand(body.command);
        const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
        const payloadHash = digest(JSON.stringify({ operation: 'material_command', expected_version: body.expected_version, command: canonicalize(command) }));
        const operations = db.collection('pulseProjectMaterialOperations').doc(id);
        const receiptRef = operations.collection('materialOperations').doc(body.operation_id);
        const auditRef = operations.collection('materialAudit').doc(body.operation_id);
        const response = await db.runTransaction(async transaction => {
          const project = await transaction.get(projectRef);
          if (!project.exists) throw fault('project_not_found', 404);
          const scope = scopeFor(project.data(), actor);
          // Receipt first: deletion and category removal must remain replayable.
          const receipt = await transaction.get(receiptRef);
          const actorEmail = actor.email.trim().toLowerCase();
          if (receipt.exists) {
            const recorded = receipt.data();
            if (recorded.actor_uid !== actor.uid || recorded.actor_email !== actorEmail || recorded.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
            if (!Array.isArray(recorded.affected_categories) || scope !== null && recorded.affected_categories.some(category => !scope.includes(category))) throw fault('material_forbidden', 403);
            for (const documentId of recorded.document_ids || []) {
              const document = await transaction.get(db.collection('projectDocuments').doc(documentId));
              if (!document.exists || document.data().projectId !== id || document.data().type !== recorded.document_types?.[documentId]
                || document.data().type === 'customer-po' && actor.customClaims.role !== 'admin') throw fault('document_forbidden', 403);
            }
            return recorded.result;
          }
          const bom = await transaction.get(bomRef);
          if (versionOf(bom) !== body.expected_version) throw fault('material_version_conflict', 409);
          if (!bom.exists && command.kind !== 'add_items') throw fault('material_not_found', 404);
          const categories = bom.exists ? bom.data()?.categories : [];
          const settings = await transaction.get(db.collection('settings').doc('bom'));
          const canonical = canonicalCategories(settings.data());
          const documentIds = referencedDocuments(command, categories);
          const documents = new Map();
          const readDocument = async documentId => {
            const document = await transaction.get(db.collection('projectDocuments').doc(documentId));
            if (!document.exists || document.data().projectId !== id || document.data().type === 'customer-po' && actor.customClaims.role !== 'admin') throw fault('document_forbidden', 403);
            documents.set(documentId, document.data());
          };
          if (command.kind === 'delete_items') {
            for (const itemId of command.item_ids) {
              const ownerCategory = categories.find(category => category.items.some(item => item.id === itemId))?.name;
              if (ownerCategory === undefined) throw fault('material_not_found', 404);
              if (scope !== null && !scope.includes(ownerCategory)) throw fault('material_forbidden', 403);
            }
            const uniqueDocumentIds = new Set();
            for (let offset = 0; offset < command.item_ids.length; offset += 30) {
              const itemIds = command.item_ids.slice(offset, offset + 30);
              const linkedRows = await transaction.get(db.collection('projectDocuments').where('projectId', '==', id)
                .where('linkedBOMItems', 'array-contains-any', itemIds).limit(401));
              if (linkedRows.docs.length > 400) throw fault('material_command_too_large');
              for (const row of linkedRows.docs) {
                if (uniqueDocumentIds.has(row.id)) continue;
                uniqueDocumentIds.add(row.id);
                if (uniqueDocumentIds.size > 400) throw fault('material_command_too_large');
                const data = row.data();
                if (!data || data.projectId !== id || data.type === 'customer-po' && actor.customClaims.role !== 'admin') throw fault('document_forbidden', 403);
                documents.set(row.id, data);
                if (!documentIds.includes(row.id)) documentIds.push(row.id);
                if (documentIds.length > 400) throw fault('material_command_too_large');
              }
            }
          }
          for (const documentId of documentIds) if (!documents.has(documentId)) await readDocument(documentId);
          // Document type determines which old scalar link must also be read.
          for (const documentId of referencedDocuments(command, categories, documents)) if (!documents.has(documentId)) { await readDocument(documentId); documentIds.push(documentId); }
          const changes = applyCommand({ categories, command, scope, canonical, documents });
          const result = { ok: true, project_id: id, operation_id: body.operation_id, command_kind: command.kind };
          const createdAt = getServerTimestamp();
          const audit = { actor_uid: actor.uid, actor_email: actorEmail, project_id: id, operation_id: body.operation_id, operation: 'material_command', command_kind: command.kind, previous_version: body.expected_version,
            permission: { role: actor.customClaims.role, scope, categories: changes.affectedCategories }, before: changes.before, after: changes.after, created_at: createdAt };
          const operationReceipt = { actor_uid: actor.uid, actor_email: actorEmail, payload_hash: payloadHash, affected_categories: changes.affectedCategories, document_ids: documentIds,
            document_types: Object.fromEntries([...documents].map(([documentId, data]) => [documentId, data.type])), result, created_at: createdAt };
          const mergedBom = { ...(bom.exists ? bom.data() : {}), categories: changes.categories };
          // Include legacy unknown fields and every touched document in size checks.
          assertDocumentBudget([{ path: bomRef.path, data: mergedBom }, { path: auditRef.path, data: audit }, { path: receiptRef.path, data: operationReceipt },
            ...[...changes.documentUpdates].map(([documentId, fields]) => ({ path: `projectDocuments/${documentId}`, data: { ...documents.get(documentId), ...fields } }))]);
          // All reads and budget checks above precede the first staged write.
          if (bom.exists) transaction.update(bomRef, { categories: changes.categories }); else transaction.create(bomRef, mergedBom);
          for (const [documentId, fields] of changes.documentUpdates) transaction.update(db.collection('projectDocuments').doc(documentId), fields);
          transaction.create(auditRef, audit);
          transaction.create(receiptRef, operationReceipt);
          return result;
        });
        return res.json(response);
      }
      const payloadHash = fulfilling ? validateFulfillment(req.body, id) : validateBody(req.body);
      const { item_id: itemId, expected_version: expectedVersion, operation_id: operationId, fulfillment } = req.body;
      const patch = fulfilling ? {} : req.body.patch;
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
        if (fulfilling && fulfillment.invoiceDocId !== undefined) {
          const invoice = await transaction.get(db.collection('projectDocuments').doc(fulfillment.invoiceDocId));
          const data = invoice.data();
          // The reused dialogs offer every project invoice, including freshly uploaded
          // invoices with no links. Documents-tab link filtering is presentation only.
          if (!invoice.exists || data?.projectId !== id || data.type !== 'vendor-invoice') throw fault('invoice_forbidden', 403);
        }
        if (fulfilling && fulfillment.photoUrl) {
          const photo = new URL(fulfillment.photoUrl);
          const path = decodeURIComponent(photo.pathname).split('/o/')[1];
          const nativePrefix = `projects/${id}/received-photos/finalized/`;
          if (path?.startsWith(`projects/${id}/received-photos/native/`)) throw fault('receipt_photo_unverified', 409);
          if (path?.startsWith(nativePrefix)) {
            const fileName = path.slice(nativePrefix.length);
            if (!/^[a-f0-9]{64}[.]jpg$/.test(fileName)
              || photo.pathname !== `/v0/b/visionbomtracker.firebasestorage.app/o/${encodeURIComponent(path)}`
              || [...photo.searchParams.keys()].length !== 3 || ['alt', 'token', 'generation'].some(key => photo.searchParams.getAll(key).length !== 1)
              || photo.searchParams.get('alt') !== 'media' || !photo.searchParams.get('token') || !/^[1-9]\d*$/.test(photo.searchParams.get('generation'))) throw fault('receipt_photo_unverified', 409);
            const intentSnapshot = await transaction.get(db.collection('pulseNativeUploadIntents').doc(fileName));
            const intent = intentSnapshot.data();
            if (!intentSnapshot.exists || intent.state !== 'finalized' || intent.final_path !== path || intent.project_id !== id || intent.item_id !== itemId
              || intent.actor_uid !== actor.uid || intent.actor_email !== actor.email.trim().toLowerCase()
              || !/^[a-zA-Z0-9_-]{1,128}$/.test(intent.operation_id || '') || intent.generation !== photo.searchParams.get('generation')) throw fault('receipt_photo_unverified', 409);
            const uploadedSnapshot = await transaction.get(db.collection('pulseNativeUploadOperations').doc(id).collection('receipts').doc(intent.operation_id));
            const uploaded = uploadedSnapshot.data();
            if (!uploadedSnapshot.exists || uploaded.project_id !== id || uploaded.item_id !== itemId || uploaded.actor_uid !== actor.uid || uploaded.final_path !== path
              || uploaded.actor_email !== actor.email.trim().toLowerCase() || uploaded.finalized?.photo_url !== fulfillment.photoUrl
              || uploaded.finalized.generation !== intent.generation) throw fault('receipt_photo_unverified', 409);
          }
        }
        if (receipt.exists) {
          const recorded = receipt.data();
          if (recorded.actor_uid !== actor.uid || recorded.actor_email !== actor.email.trim().toLowerCase() || recorded.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          return recorded.result;
        }
        if (versionOf(bom) !== expectedVersion) throw fault('material_version_conflict', 409);
        const updated = fulfilling ? appendFulfillment(match.item, fulfillment, operationId) : { ...match.item, ...patch };
        for (const key of ['price', 'finalizedVendor']) if (Object.hasOwn(patch, key) && patch[key] === null) delete updated[key];
        if (Object.hasOwn(patch, 'itemType') && (typeof updated.quantity !== 'number' || !Number.isFinite(updated.quantity) || updated.quantity <= 0)) throw fault('invalid_material_state', 409);
        if (updated.itemType === 'service' && (Object.hasOwn(patch, 'quantity') || Object.hasOwn(patch, 'itemType')) && updated.quantity < 0.5) throw fault('invalid_material_patch', 400);
        if (Object.hasOwn(patch, 'quantity')) {
          // Legacy received rows without tranches derive their historical total
          // from quantity. Changing it would invent or erase received evidence.
          if (match.item.status === 'received' && !match.item.fulfillmentTranches?.length && patch.quantity !== match.item.quantity) throw fault('received_quantity_conflict', 409);
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
          const canonical = canonicalCategories(settings.data());
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
        if (fulfilling) for (const key of ['fulfillmentTranches', 'status', ...(fulfillment.kind === 'receipt' ? ['actualArrival', 'linkedInvoiceDocumentId', 'receivedPhotoUrl'] : [])]) {
          before[key] = match.item[key] ?? null; after[key] = updated[key] ?? null;
        }
        const result = { ok: true, project_id: id, item_id: itemId, operation_id: operationId, item: updated };
        const actorEmail = actor.email.trim().toLowerCase();
        const createdAt = getServerTimestamp();
        transaction.update(bomRef, { categories: nextCategories });
        transaction.create(auditRef, { actor_uid: actor.uid, actor_email: actorEmail, project_id: id, item_id: itemId, operation_id: operationId, operation: fulfilling ? 'fulfill_material' : 'patch_material', previous_version: expectedVersion, permission: { role: actor.customClaims.role, category: match.category.name, scope }, before, after, ...(destination !== match.category.name ? { category_transition: { from: match.category.name, to: destination } } : {}), created_at: createdAt });
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
