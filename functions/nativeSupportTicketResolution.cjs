const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');
const { supportTicketProjectAccess } = require('./nativeSupportTicketCreate.cjs');

const PUBLIC = Symbol('native-support-ticket-resolution');
const fault = (code, status = 400, details = {}) => Object.assign(new Error(code), { code, status, details, [PUBLIC]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 128
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const freeze = value => value instanceof Date ? value.toISOString()
  : value && typeof value.toDate === 'function' ? value.toDate().toISOString()
    : Array.isArray(value) ? value.map(freeze)
      : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, freeze(value[key])])) : value;
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const revision = snapshot => `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const FIELD_NAMES = Object.freeze(['root_cause', 'corrective_action', 'preventive_action', 'resolution_summary']);
const FIELD_VALUES = Object.freeze(['rootCause', 'correctiveAction', 'preventiveAction', 'resolutionSummary']);
const assertTicketAccess = (project, actor) => {
  try { supportTicketProjectAccess(project, actor); }
  catch (error) {
    if (error?.code === 'support_ticket_project_forbidden') throw fault(error.code, error.status);
    throw error;
  }
};

const supportTicketResolutionEnabled = env => [
  'BOM_MATERIAL_MUTATIONS_ENABLED',
  'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED',
  'BOM_NATIVE_SUPPORT_TICKET_RESOLUTION_ENABLED',
].every(key => env[key] === 'true');

function exact(data, keys) {
  if (!plain(data) || Object.keys(data).some(key => !keys.includes(key))) throw fault('invalid_support_ticket_resolution_request');
}

function resolutionRecord(ticket) {
  return Object.fromEntries(FIELD_VALUES.map((field, index) => [field,
    typeof ticket[FIELD_VALUES[index]] === 'string' ? ticket[FIELD_VALUES[index]] : '',
  ]));
}

function auditValues(ticket) {
  return Object.fromEntries(FIELD_VALUES.map(field => [field, Object.hasOwn(ticket, field) ? ticket[field] : null]));
}

function createNativeSupportTicketResolution({ db, auth, enabled = false, getServerTimestamp }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  async function actorOf(request) {
    try { return await currentNativeActor(auth, request); }
    catch (error) {
      const known = { actor_authentication_required: 401, actor_forbidden: 403, identity_provider_unavailable: 503 };
      if (Object.hasOwn(known, error?.code) && known[error.code] === error.status) throw fault(error.code, error.status);
      throw error;
    }
  }
  function requestShape(data, actor) {
    if (!plain(data) || Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_INPUT_BYTES
      || !['get', 'command'].includes(data.operation) || !validId(data.project_id) || !validId(data.ticket_id)) {
      throw fault('invalid_support_ticket_resolution_request');
    }
    if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
    if (data.operation === 'get') {
      exact(data, ['operation', 'project_id', 'ticket_id', 'expected_actor_uid']);
      return null;
    }
    exact(data, ['operation', 'project_id', 'ticket_id', 'expected_actor_uid', 'expected_version', 'operation_id', 'command']);
    if (!validVersion(data.expected_version) || !/^[A-Za-z0-9_-]{1,128}$/.test(data.operation_id || '') || !plain(data.command)) {
      throw fault('invalid_support_ticket_resolution_request');
    }
    exact(data.command, ['kind', ...FIELD_NAMES]);
    if (data.command.kind !== 'resolution_save'
      || FIELD_NAMES.some(field => typeof data.command[field] !== 'string' || data.command[field].length > 20000)) {
      throw fault('invalid_support_ticket_resolution_request');
    }
    return data.command;
  }

  return async request => {
    try {
      const actor = await actorOf(request);
      const command = requestShape(request.data, actor);
      const { project_id: projectId, ticket_id: ticketId } = request.data;
      const projectRef = db.collection('projects').doc(projectId);
      const ticketRef = projectRef.collection('supportTickets').doc(ticketId);

      if (!command) {
        return await db.runTransaction(async transaction => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists) throw fault('support_ticket_project_not_found', 404);
          const project = projectSnapshot.data();
          if (project.projectId && project.projectId !== projectId) throw fault('support_ticket_project_identity_conflict', 409);
          assertTicketAccess(project, actor);
          const ticketSnapshot = await transaction.get(ticketRef);
          if (!ticketSnapshot.exists) throw fault('support_ticket_not_found', 404);
          const ticket = ticketSnapshot.data();
          if (ticket.projectId && ticket.projectId !== projectId) throw fault('support_ticket_identity_conflict', 409);
          return { ok: true, project_id: projectId, ticket_id: ticketId, version: revision(ticketSnapshot), resolution_record: resolutionRecord(ticket) };
        });
      }

      const { expected_version: expectedVersion, operation_id: operationId } = request.data;
      const journalRef = db.collection('pulseNativeSupportTicketOperations').doc(projectId);
      const receiptRef = journalRef.collection('receipts').doc(operationId);
      const auditRef = journalRef.collection('audit').doc(operationId);
      const payloadHash = createHash('sha256').update(JSON.stringify(freeze({
        action: 'resolution_save', project_id: projectId, ticket_id: ticketId,
        expected_version: expectedVersion, command,
      }))).digest('hex');

      return await db.runTransaction(async transaction => {
        const projectDoc = await transaction.get(projectRef);
        if (!projectDoc.exists) throw fault('support_ticket_project_not_found', 404);
        const currentProject = projectDoc.data();
        if (currentProject.projectId && currentProject.projectId !== projectId) throw fault('support_ticket_project_identity_conflict', 409);
        assertTicketAccess(currentProject, actor);
        const receipt = await transaction.get(receiptRef);
        const currentActor = async () => {
          const current = await actorOf(request);
          if (current.uid !== actor.uid || normalizeEmail(current.email) !== normalizeEmail(actor.email)) throw fault('actor_session_changed', 403);
          assertTicketAccess(currentProject, current);
          return current;
        };
        if (receipt.exists) {
          await currentActor();
          const old = receipt.data();
          if (old.actor_uid !== actor.uid || old.actor_email !== normalizeEmail(actor.email) || old.payload_hash !== payloadHash) {
            throw fault('operation_conflict', 409);
          }
          return { ...old.result, resolution: 'replayed' };
        }
        if (!writesOn()) throw fault('support_ticket_resolution_disabled', 503);
        const control = await transaction.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const mode = control.exists ? control.data()?.mode : 'coexist';
        if (!['coexist', 'pulse_only'].includes(mode)) {
          throw fault(mode === 'read_only' ? 'support_ticket_resolution_read_only' : 'support_ticket_control_unavailable', 503);
        }
        const ticketSnapshot = await transaction.get(ticketRef);
        if (!ticketSnapshot.exists) throw fault('support_ticket_not_found', 404);
        if (revision(ticketSnapshot) !== expectedVersion) throw fault('support_ticket_version_conflict', 409);
        const before = ticketSnapshot.data();
        if (before.projectId && before.projectId !== projectId) throw fault('support_ticket_identity_conflict', 409);
        const fields = Object.fromEntries(FIELD_NAMES.map((field, index) => [FIELD_VALUES[index], command[field]]));
        const unchanged = FIELD_NAMES.every((field, index) =>
          (typeof before[FIELD_VALUES[index]] === 'string' ? before[FIELD_VALUES[index]] : '') === command[field]);
        const result = {
          ok: true, project_id: projectId, ticket_id: ticketId, operation_id: operationId,
          resolution_record: commandResolutionRecord(command),
        };
        const current = await currentActor();
        const receiptData = { actor_uid: current.uid, actor_email: normalizeEmail(current.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };

        if (unchanged) {
          assertDocumentBudget([{ path: receiptRef.path, data: receiptData }]);
          transaction.create(receiptRef, receiptData);
          return { ...result, resolution: 'committed' };
        }

        const patch = { ...fields, updatedAt: getServerTimestamp() };
        const activityRef = ticketRef.collection('activities').doc(`resolution-${operationId}`);
        const activity = {
          type: 'resolution', message: 'RCA and solution record updated', createdAt: getServerTimestamp(),
          createdBy: current.uid, createdByName: (current.displayName || current.email || current.uid).trim(),
        };
        const auditData = {
          action: 'support_ticket_resolution_saved', actor_uid: current.uid, actor_email: normalizeEmail(current.email),
          project_id: projectId, ticket_id: ticketId, operation_id: operationId, payload_hash: payloadHash,
          before: auditValues(before), after: fields, created_at: getServerTimestamp(),
        };
        assertDocumentBudget([
          { path: ticketRef.path, data: { ...before, ...patch } },
          { path: activityRef.path, data: activity },
          { path: receiptRef.path, data: receiptData },
          { path: auditRef.path, data: auditData },
        ]);
        transaction.update(ticketRef, patch);
        transaction.create(activityRef, activity);
        transaction.create(receiptRef, receiptData);
        transaction.create(auditRef, auditData);
        return { ...result, resolution: 'committed' };
      });
    } catch (error) {
      return { ok: false, error: error?.[PUBLIC] ? error.code : 'support_ticket_service_unavailable', status: error?.[PUBLIC] ? error.status : 503, ...(error?.details || {}) };
    }
  };
}

function commandResolutionRecord(command) {
  return Object.fromEntries(FIELD_VALUES.map((field, index) => [field, command[FIELD_NAMES[index]]]));
}

module.exports = { createNativeSupportTicketResolution, supportTicketResolutionEnabled };
