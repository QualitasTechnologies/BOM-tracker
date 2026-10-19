const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');
const { supportTicketProjectAccess } = require('./nativeSupportTicketCreate.cjs');
const { resolveSupportTicketAssignee } = require('./nativeSupportTicketAssignee.cjs');

const PUBLIC = Symbol('native-support-ticket-assignment');
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
const assertTicketAccess = (project, actor) => {
  try { supportTicketProjectAccess(project, actor); }
  catch (error) {
    if (error?.code === 'support_ticket_project_forbidden') throw fault(error.code, error.status);
    throw error;
  }
};

const supportTicketAssignmentEnabled = env => [
  'BOM_MATERIAL_MUTATIONS_ENABLED',
  'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED',
  'BOM_NATIVE_SUPPORT_TICKET_ASSIGNMENT_ENABLED',
].every(key => env[key] === 'true');

function exact(data, keys) {
  if (!plain(data) || Object.keys(data).some(key => !keys.includes(key))) throw fault('invalid_support_ticket_assignment_request');
}

function createNativeSupportTicketAssignment({ db, auth, enabled = false, getServerTimestamp }) {
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
      throw fault('invalid_support_ticket_assignment_request');
    }
    if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
    if (data.operation === 'get') {
      exact(data, ['operation', 'project_id', 'ticket_id', 'expected_actor_uid']);
      return null;
    }
    exact(data, ['operation', 'project_id', 'ticket_id', 'expected_actor_uid', 'expected_version', 'operation_id', 'command']);
    if (!validVersion(data.expected_version) || !/^[A-Za-z0-9_-]{1,128}$/.test(data.operation_id || '') || !plain(data.command)) {
      throw fault('invalid_support_ticket_assignment_request');
    }
    exact(data.command, ['kind', 'assignee_user_id']);
    if (data.command.kind !== 'assignee_change'
      || !(data.command.assignee_user_id === null || validId(data.command.assignee_user_id))) {
      throw fault('invalid_support_ticket_assignment_request');
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
          const before = ticketSnapshot.data();
          if (before.projectId && before.projectId !== projectId) throw fault('support_ticket_identity_conflict', 409);
          return { ok: true, project_id: projectId, ticket_id: ticketId, version: revision(ticketSnapshot), assignee: before.assignee || null };
        });
      }

      const { expected_version: expectedVersion, operation_id: operationId } = request.data;
      const journalRef = db.collection('pulseNativeSupportTicketOperations').doc(projectId);
      const receiptRef = journalRef.collection('receipts').doc(operationId);
      const auditRef = journalRef.collection('audit').doc(operationId);
      const payloadHash = createHash('sha256').update(JSON.stringify(freeze({
        action: 'assignee_change', project_id: projectId, ticket_id: ticketId,
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
        if (!writesOn()) throw fault('support_ticket_assignment_disabled', 503);
        const control = await transaction.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const mode = control.exists ? control.data()?.mode : 'coexist';
        if (!['coexist', 'pulse_only'].includes(mode)) {
          throw fault(mode === 'read_only' ? 'support_ticket_assignment_read_only' : 'support_ticket_control_unavailable', 503);
        }
        const ticketSnapshot = await transaction.get(ticketRef);
        if (!ticketSnapshot.exists) throw fault('support_ticket_not_found', 404);
        if (revision(ticketSnapshot) !== expectedVersion) throw fault('support_ticket_version_conflict', 409);
        const before = ticketSnapshot.data();
        if (before.projectId && before.projectId !== projectId) throw fault('support_ticket_identity_conflict', 409);
        const oldAssignee = before.assignee || null;
        const unchanged = command.assignee_user_id === null
          ? oldAssignee === null
          : oldAssignee?.userId === command.assignee_user_id;
        if (unchanged) {
          const current = await currentActor();
          const result = { ok: true, project_id: projectId, ticket_id: ticketId, operation_id: operationId, assignee: oldAssignee };
          const receiptData = { actor_uid: current.uid, actor_email: normalizeEmail(current.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };
          assertDocumentBudget([{ path: receiptRef.path, data: receiptData }]);
          transaction.create(receiptRef, receiptData);
          return { ...result, resolution: 'committed' };
        }
        const nextAssignee = command.assignee_user_id === null ? null : resolveSupportTicketAssignee(currentProject, actor, command.assignee_user_id, fault);
        const current = await currentActor();
        const patch = { assignee: nextAssignee, updatedAt: getServerTimestamp() };
        const activityId = `assignee-${operationId}`;
        const activityRef = ticketRef.collection('activities').doc(activityId);
        const activity = {
          type: 'assignment',
          message: nextAssignee ? `Assigned to ${nextAssignee.name}` : 'Ticket unassigned',
          createdAt: getServerTimestamp(), createdBy: current.uid,
          createdByName: (current.displayName || current.email || current.uid).trim(),
        };
        const result = { ok: true, project_id: projectId, ticket_id: ticketId, operation_id: operationId, assignee: nextAssignee };
        const receiptData = { actor_uid: current.uid, actor_email: normalizeEmail(current.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };
        const auditData = {
          action: 'support_ticket_assignee_changed', actor_uid: current.uid, actor_email: normalizeEmail(current.email),
          project_id: projectId, ticket_id: ticketId, operation_id: operationId, payload_hash: payloadHash,
          before: { assignee: oldAssignee }, after: { assignee: nextAssignee }, created_at: getServerTimestamp(),
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

module.exports = { createNativeSupportTicketAssignment, supportTicketAssignmentEnabled };
