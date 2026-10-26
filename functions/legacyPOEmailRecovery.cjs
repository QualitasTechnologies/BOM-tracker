const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { finalizeLegacyPOEmail } = require('./legacyPOEmailFinalize.cjs');

const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);

/** Replays the atomic finalization after the provider acceptance was durably recorded. */
function createLegacyPOEmailRecovery({ db, auth, getServerTimestamp, finalize = finalizeLegacyPOEmail,
  removePdf = async () => {}, removeAttempt = async () => {} }) {
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      if (actor.customClaims.role !== 'admin') throw fault('actor_forbidden', 403);
      const data = request.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).some(key => !['project_id', 'po_id', 'attempt_id'].includes(key))
        || !validId(data.project_id) || !validId(data.po_id)
        || typeof data.attempt_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.attempt_id)) {
        throw fault('invalid_procurement_request', 400);
      }

      const { project_id: projectId, po_id: poId, attempt_id: attemptId } = data;
      const assertAdmin = async () => {
        const fresh = await currentNativeActor(auth, request);
        if (fresh.customClaims?.role !== 'admin') throw fault('actor_forbidden', 403);
      };
      const poRef = db.collection('projects').doc(projectId).collection('purchaseOrders').doc(poId);
      const auditRef = db.collection('pulseProcurementOperations').doc(projectId).collection('audit').doc(`${attemptId}-legacy-email`);
      const state = await db.runTransaction(async transaction => {
        const audit = await transaction.get(auditRef);
        if (audit.exists) {
          const saved = audit.data();
          if (saved.project_id !== projectId || saved.po_id !== poId || saved.attempt_id !== attemptId) throw fault('operation_conflict', 409);
          return { replayed: true };
        }
        const po = await transaction.get(poRef);
        if (!po.exists) throw fault('purchase_order_not_found', 404);
        return { stored: po.data() };
      });
      if (state.replayed) {
        await removeAttempt(projectId, attemptId).catch(() => {});
        return { ok: true, project_id: projectId, po_id: poId, attempt_id: attemptId, phase: 'complete', replayed: true };
      }
      const stored = state.stored;
      if (stored.legacySendAttemptId !== attemptId) throw fault('legacy_send_attempt_changed', 409);
      if (!['provider_accepted', 'needs_reconciliation'].includes(stored.legacySendPhase)) throw fault('legacy_send_not_accepted', 409);
      if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved', 409);
      const acceptedMs = Date.parse(stored.legacySendAcceptedAt);
      if (!Number.isFinite(acceptedMs) || acceptedMs <= 0
        || typeof stored.legacySendActorUid !== 'string' || !stored.legacySendActorUid
        || typeof stored.legacySendRecipientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stored.legacySendRecipientEmail)
        || typeof stored.legacySendPdfUrl !== 'string' || !stored.legacySendPdfUrl
        || !Number.isSafeInteger(stored.legacySendFileSize) || stored.legacySendFileSize < 0
        || !validId(stored.legacySendDocumentId)
        || typeof stored.legacySendProviderId !== 'string' || !stored.legacySendProviderId) {
        throw fault('legacy_send_recovery_data_missing', 409);
      }

      const result = await finalize({ db, projectId, poId, attemptId, actorUid: stored.legacySendActorUid,
        recipientEmail: stored.legacySendRecipientEmail, acceptedMs, pdfUrl: stored.legacySendPdfUrl,
        fileSize: stored.legacySendFileSize, documentId: stored.legacySendDocumentId,
        providerId: stored.legacySendProviderId, getServerTimestamp, assertActor: assertAdmin });
      await removeAttempt(projectId, attemptId).catch(() => {});
      return { ok: true, project_id: projectId, po_id: poId, attempt_id: attemptId,
        phase: 'complete', replayed: result.replayed === true };
    } catch (error) {
      return { ok: false, error: error.status ? error.code : 'legacy_send_recovery_unavailable' };
    }
  };
}

module.exports = { createLegacyPOEmailRecovery };
