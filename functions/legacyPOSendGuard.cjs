const { createHash, randomUUID } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
const fault = (code, message, status) => Object.assign(new Error(message), { code, status });
const recoveryReceiptId = (projectId, poId, attemptId) => createHash('sha256').update(`${projectId}\0${poId}\0${attemptId}\0cutover-before-dispatch`).digest('hex');

async function authorizeLegacyPOSend({ db, auth, request, projectId, poId, getServerTimestamp }) {
  const actor = await currentNativeActor(auth, request);
  if (actor.customClaims.role !== 'admin') throw fault('actor_forbidden', 'Only a project administrator can send a Purchase Order.', 403);
  if (!id(projectId) || !id(poId)) throw fault('invalid_procurement_request', 'A valid project and Purchase Order are required.', 400);
  const attemptId = randomUUID();

  const purchaseOrder = await db.runTransaction(async transaction => {
    const projectRef = db.collection('projects').doc(projectId);
    const poRef = projectRef.collection('purchaseOrders').doc(poId);
    const cutoverRef = db.collection('pulseMaterialCutovers').doc(projectId);
    const project = await transaction.get(projectRef);
    const po = await transaction.get(poRef);
    const cutover = await transaction.get(cutoverRef);
    if (!project.exists || !po.exists) throw fault('purchase_order_not_found', 'Purchase Order not found.', 404);
    if (cutover.exists) throw fault('material_cutover_required', 'This project has moved to Pulse procurement. Reopen it in Pulse to send the Purchase Order.', 409);
    const stored = po.data();
    if (stored.projectId && stored.projectId !== projectId) throw fault('actor_forbidden', 'Purchase Order does not belong to this project.', 403);
    if (stored.nativeSendAttemptId) throw fault('purchase_order_attempt_active', 'A native PO send attempt is already active.', 409);
    if (stored.legacySendAttemptId) throw fault('purchase_order_attempt_active', 'A legacy PO send is already in progress or needs reconciliation.', 409);
    if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved', 'Only approved Purchase Orders can be sent.', 409);
    transaction.update(poRef, { legacySendAttemptId: attemptId, legacySendPhase: 'preparing',
      legacySendPreparingAt: getServerTimestamp(), legacySendDispatchStartedAt: null,
      legacySendAcceptedAt: null, legacySendProviderId: null, legacySendActorUid: null,
      legacySendRecipientEmail: null, legacySendPdfUrl: null, legacySendFileSize: null,
      legacySendDocumentId: null, legacySendRetryPayloadReady: null });
    return { ...stored, id: poId, projectId };
  });

  return { actor, purchaseOrder, attemptId };
}

async function updateLegacyPOSend({ db, projectId, poId, attemptId, patch, clear = false,
  requireNoAcceptedAt = false, providerId = undefined }) {
  const poRef = db.collection('projects').doc(projectId).collection('purchaseOrders').doc(poId);
  return db.runTransaction(async transaction => {
    const po = await transaction.get(poRef);
    if (!po.exists || po.data().legacySendAttemptId !== attemptId) return false;
    const stored = po.data();
    if ((requireNoAcceptedAt && stored.legacySendAcceptedAt)
      || (providerId !== undefined && stored.legacySendProviderId && stored.legacySendProviderId !== providerId)) return false;
    transaction.update(poRef, clear
      ? { ...patch, legacySendAttemptId: null, legacySendPhase: null, legacySendPreparingAt: null,
        legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
        legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null,
        legacySendFileSize: null, legacySendDocumentId: null, legacySendRetryPayloadReady: null }
      : patch);
    return true;
  });
}

async function rejectLegacyPOSend({ db, projectId, poId, attemptId, actorUid, rejectionName, getServerTimestamp }) {
  const poRef = db.collection('projects').doc(projectId).collection('purchaseOrders').doc(poId);
  const auditRef = db.collection('pulseProcurementOperations').doc(projectId).collection('audit')
    .doc(`${attemptId}-legacy-email-rejected`);
  return db.runTransaction(async transaction => {
    const po = await transaction.get(poRef);
    const audit = await transaction.get(auditRef);
    if (audit.exists) {
      const saved = audit.data();
      if (saved.project_id !== projectId || saved.po_id !== poId || saved.attempt_id !== attemptId) return false;
      return true;
    }
    if (!po.exists || po.data().legacySendAttemptId !== attemptId) return false;
    const stored = po.data();
    if (stored.status !== 'pending-approval' || stored.legacySendProviderId || stored.legacySendAcceptedAt
      || !['dispatching', 'uncertain', 'needs_reconciliation'].includes(stored.legacySendPhase)) return false;
    transaction.update(poRef, { legacySendAttemptId: null, legacySendPhase: null, legacySendPreparingAt: null,
      legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
      legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null,
      legacySendFileSize: null, legacySendDocumentId: null, legacySendRetryPayloadReady: null });
    transaction.create(auditRef, { operation: 'legacy_po_email_rejected', project_id: projectId, po_id: poId,
      attempt_id: attemptId, actor_uid: actorUid, provider_rejection_name: rejectionName,
      created_at: getServerTimestamp() });
    return true;
  });
}

async function beginLegacyPOSendDispatch({ db, projectId, poId, attemptId, patch, retryPayload, actorUid, getServerTimestamp }) {
  const projectRef = db.collection('projects').doc(projectId);
  const poRef = projectRef.collection('purchaseOrders').doc(poId);
  const cutoverRef = db.collection('pulseMaterialCutovers').doc(projectId);
  const receiptRef = db.collection('pulseLegacyPOSendRecoveries').doc(projectId).collection('operations')
    .doc(recoveryReceiptId(projectId, poId, attemptId));
  const attemptRef = db.collection('pulseLegacyPOSendAttempts').doc(projectId).collection('attempts').doc(attemptId);
  return db.runTransaction(async transaction => {
    const po = await transaction.get(poRef);
    const cutover = await transaction.get(cutoverRef);
    const attempt = await transaction.get(attemptRef);
    if (!po.exists || po.data().legacySendAttemptId !== attemptId || po.data().legacySendPhase !== 'preparing') {
      return { dispatched: false, error: 'legacy_send_attempt_changed' };
    }
    if (attempt.exists) return { dispatched: false, error: 'legacy_send_attempt_changed' };
    if (cutover.exists) {
      transaction.update(poRef, { legacySendAttemptId: null, legacySendPhase: null, legacySendPreparingAt: null,
        legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
        legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null,
        legacySendFileSize: null, legacySendDocumentId: null, legacySendRetryPayloadReady: null });
      transaction.create(receiptRef, { operation: 'legacy_po_send_blocked_by_cutover', project_id: projectId,
        po_id: poId, attempt_id: attemptId, actor_uid: actorUid, created_at: getServerTimestamp() });
      return { dispatched: false, error: 'material_cutover_required' };
    }
    transaction.create(attemptRef, { project_id: projectId, po_id: poId, attempt_id: attemptId,
      ...retryPayload, created_at: getServerTimestamp() });
    transaction.update(poRef, { ...patch, legacySendRetryPayloadReady: true });
    return { dispatched: true };
  });
}

module.exports = {
  authorizeLegacyPOSend,
  releaseLegacyPOSend: args => updateLegacyPOSend({ ...args, patch: {}, clear: true }),
  updateLegacyPOSend,
  rejectLegacyPOSend,
  beginLegacyPOSendDispatch,
};
