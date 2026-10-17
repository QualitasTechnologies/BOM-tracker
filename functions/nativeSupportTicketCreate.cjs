const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');

const PUBLIC = Symbol('native-support-ticket-create');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status, [PUBLIC]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 128
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const sort = value => Array.isArray(value) ? value.map(sort)
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
    : value instanceof Date ? value.toISOString() : value;
const hash = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const supportTicketCreateEnabled = env => ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_CREATE_ENABLED'].every(key => env[key] === 'true');
const access = (project, actor) => {
  // Matches projects/{projectId}/{subcollection=**} in firestore.rules: approved
  // actors are checked by currentNativeActor; admins bypass members, and null or
  // absent memberIds retain the legacy fallback. Support has no category scope.
  if (actor.customClaims.role !== 'admin' && project.memberIds != null
    && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid))) {
    throw fault('support_ticket_project_forbidden', 403);
  }
};

const inputKeys = [
  'projectId', 'projectName', 'clientName', 'clientId', 'machineId', 'machineName', 'machineSerialNumber',
  'title', 'description', 'category', 'priority', 'channel', 'reportedByName', 'reportedByContactId',
  'reportedByEmail', 'reportedByPhone', 'reportedAt', 'coverageType', 'coverageNotes', 'commercialStatus',
  'assignee', 'siteVisitRequired', 'downtime', 'machineStopped',
];
const ignoredClientFields = new Set(['id', 'actor_uid', 'actorUid', 'createdBy', 'createdByName', 'ticketNumber', 'status', 'createdAt', 'updatedAt', 'firstResponseTargetAt', 'resolutionTargetAt', 'activityId']);
const requiredText = ['projectId', 'projectName', 'clientName', 'title', 'description', 'reportedByName'];
const limits = { projectName: 500, clientName: 500, clientId: 512, machineId: 512, machineName: 500,
  machineSerialNumber: 200, title: 500, description: 10000, reportedByName: 300,
  reportedByContactId: 512, reportedByEmail: 254, reportedByPhone: 100, coverageNotes: 4000 };
const enums = {
  category: ['vision-performance', 'camera-lens-lighting', 'software', 'electrical', 'mechanical', 'plc-integration', 'network', 'preventive-maintenance', 'training', 'other'],
  priority: ['critical', 'high', 'medium', 'low'], channel: ['email', 'phone', 'whatsapp', 'site', 'internal'],
  coverageType: ['warranty', 'amc', 'chargeable', 'goodwill', 'undetermined'],
  commercialStatus: ['not-required', 'assessment-required', 'quotation-required', 'quotation-prepared', 'quotation-sent', 'accepted', 'rejected', 'invoiced'],
};
function validate(data) {
  if (!plain(data) || Object.keys(data).some(key => !['project_id', 'operation_id', 'input'].includes(key))
    || !validId(data.project_id) || !/^[A-Za-z0-9_-]{1,128}$/.test(data.operation_id || '')
    || !plain(data.input) || Buffer.byteLength(JSON.stringify(data), 'utf8') > 32 * 1024) throw fault('invalid_support_ticket_request');
  const input = data.input;
  for (const key of Object.keys(input)) if (!inputKeys.includes(key) && !ignoredClientFields.has(key)) throw fault('invalid_support_ticket_request');
  if (requiredText.some(key => typeof input[key] !== 'string' || !input[key].trim() || input[key].length > limits[key])
    || input.projectId !== data.project_id) throw fault('invalid_support_ticket_request');
  for (const [key, max] of Object.entries(limits)) if (Object.hasOwn(input, key)
    && input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > max)) throw fault('invalid_support_ticket_request');
  for (const [key, choices] of Object.entries(enums)) if (!choices.includes(input[key])) throw fault('invalid_support_ticket_request');
  for (const key of ['siteVisitRequired', 'downtime', 'machineStopped']) if (typeof input[key] !== 'boolean') throw fault('invalid_support_ticket_request');
  if (input.reportedByEmail !== undefined && input.reportedByEmail !== ''
    && !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(input.reportedByEmail)) throw fault('invalid_support_ticket_request');
  if (input.assignee !== undefined && (!plain(input.assignee)
    || Object.keys(input.assignee).some(key => !['userId', 'name', 'email'].includes(key))
    || typeof input.assignee.userId !== 'string' || !input.assignee.userId.trim() || input.assignee.userId.length > 128
    || typeof input.assignee.name !== 'string' || !input.assignee.name.trim() || input.assignee.name.length > 300
    || (input.assignee.email !== undefined && (typeof input.assignee.email !== 'string' || input.assignee.email.length > 254)))) throw fault('invalid_support_ticket_request');
  return Object.fromEntries(inputKeys.filter(key => Object.hasOwn(input, key) && key !== 'reportedAt').map(key => [key, input[key]]));
}

function createNativeSupportTicketCreate({ db, auth, enabled = false, getServerTimestamp, now = () => new Date() }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  async function actorOf(request) {
    try { return await currentNativeActor(auth, request); }
    catch (error) {
      const known = { actor_authentication_required: 401, actor_forbidden: 403, identity_provider_unavailable: 503 };
      if (Object.hasOwn(known, error?.code) && known[error.code] === error.status) throw fault(error.code, error.status);
      throw error;
    }
  }
  return async request => {
    try {
      const actor = await actorOf(request);
      const input = validate(request.data);
      const { project_id: projectId, operation_id: operationId } = request.data;
      const projectRef = db.collection('projects').doc(projectId);
      const journalRef = db.collection('pulseNativeSupportTicketOperations').doc(projectId);
      const receiptRef = journalRef.collection('receipts').doc(operationId);
      const auditRef = journalRef.collection('audit').doc(operationId);
      const payloadHash = hash({ project_id: projectId, input });
      const ticketRef = projectRef.collection('supportTickets').doc();
      const createdAt = now();

      return await db.runTransaction(async transaction => {
        const projectSnapshot = await transaction.get(projectRef);
        if (!projectSnapshot.exists) throw fault('support_ticket_project_not_found', 404);
        const project = projectSnapshot.data();
        if (project.projectId && project.projectId !== projectId) throw fault('support_ticket_project_identity_conflict', 409);
        access(project, actor);
        const receipt = await transaction.get(receiptRef);
        const currentActor = async () => {
          const current = await actorOf(request);
          if (current.uid !== actor.uid || normalizeEmail(current.email) !== normalizeEmail(actor.email)) throw fault('actor_session_changed', 403);
          access(project, current);
          return current;
        };
        if (receipt.exists) {
          const current = await currentActor();
          const old = receipt.data();
          if (old.actor_uid !== actor.uid || old.actor_email !== normalizeEmail(actor.email) || old.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          return { ...old.result, resolution: 'replayed' };
        }
        if (!writesOn()) throw fault('support_ticket_create_disabled', 503);
        const control = await transaction.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const mode = control.exists ? control.data()?.mode : 'coexist';
        if (!['coexist', 'pulse_only'].includes(mode)) {
          throw fault(mode === 'read_only' ? 'support_ticket_create_read_only' : 'support_ticket_control_unavailable', 503);
        }
        const current = await currentActor();
        const ticketNumber = `SUP-${createdAt.getUTCFullYear()}-${ticketRef.id.slice(0, 6).toUpperCase()}`;
        const reportedAt = createdAt;
        const hours = { critical: [2, 8], high: [4, 24], medium: [8, 72], low: [24, 120] }[input.priority];
        const ticket = {
          ...input, reportedAt, status: 'open', createdAt: getServerTimestamp(), updatedAt: getServerTimestamp(),
          createdBy: current.uid, createdByName: (current.displayName || current.email || current.uid).trim(),
          ticketNumber, customerConfirmation: 'pending',
          firstResponseTargetAt: new Date(reportedAt.getTime() + hours[0] * 3600000),
          resolutionTargetAt: new Date(reportedAt.getTime() + hours[1] * 3600000),
        };
        const activity = { type: 'created', message: `Ticket ${ticketNumber} created`, createdAt: getServerTimestamp(), createdBy: current.uid, createdByName: ticket.createdByName };
        const result = { ok: true, project_id: projectId, operation_id: operationId, ticket_id: ticketRef.id, ticket_number: ticketNumber };
        const receiptData = { actor_uid: current.uid, actor_email: normalizeEmail(current.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };
        const auditData = { action: 'support_ticket_created', actor_uid: current.uid, actor_email: normalizeEmail(current.email), project_id: projectId, ticket_id: ticketRef.id, ticket_number: ticketNumber, operation_id: operationId, payload_hash: payloadHash, before: null, after: ticket, created_at: getServerTimestamp() };
        transaction.create(ticketRef, ticket);
        transaction.create(ticketRef.collection('activities').doc('created'), activity);
        transaction.create(receiptRef, receiptData);
        transaction.create(auditRef, auditData);
        return { ...result, resolution: 'committed' };
      });
    } catch (error) {
      return { ok: false, error: error?.[PUBLIC] ? error.code : 'support_ticket_service_unavailable', status: error?.[PUBLIC] ? error.status : 503 };
    }
  };
}

module.exports = { createNativeSupportTicketCreate, supportTicketCreateEnabled };
