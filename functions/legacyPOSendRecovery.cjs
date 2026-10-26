const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { legacyPOEmailRetryPdfPath } = require('./legacyPOEmailRetryPdf.cjs');

const STALE_PREPARING_MS = 15 * 60 * 1000;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const millis = value => value instanceof Date ? value.getTime()
  : value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
const recoveryId = (projectId, poId, attemptId) => createHash('sha256').update(`${projectId}\0${poId}\0${attemptId}`).digest('hex');

/**
 * Release only a stale reservation which is provably still before provider dispatch.
 * The reservation writer must set legacySendPreparingAt in the same transaction that
 * sets legacySendPhase='preparing'; absent timestamps fail closed.
 */
function createLegacyPOSendRecovery({ db, auth, now = Date.now, staleAfterMs = STALE_PREPARING_MS,
  getServerTimestamp, removePdf = async () => {}, removeAttempt = async () => {} }) {
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      if (actor.customClaims.role !== 'admin') throw fault('actor_forbidden', 403);
      const data = request.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).some(key => !['operation', 'project_id', 'po_id', 'attempt_id'].includes(key))
        || data.operation !== 'release_stale_preparing' || !id(data.project_id) || !id(data.po_id)
        || typeof data.attempt_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.attempt_id)) {
        throw fault('invalid_procurement_request', 400);
      }

      const { project_id: projectId, po_id: poId, attempt_id: attemptId } = data;
      const assertAdmin = async () => {
        const fresh = await currentNativeActor(auth, request);
        if (fresh.customClaims?.role !== 'admin') throw fault('actor_forbidden', 403);
      };
      const projectRef = db.collection('projects').doc(projectId);
      const poRef = projectRef.collection('purchaseOrders').doc(poId);
      const cutoverRef = db.collection('pulseMaterialCutovers').doc(projectId);
      const receiptRef = db.collection('pulseLegacyPOSendRecoveries').doc(projectId)
        .collection('operations').doc(recoveryId(projectId, poId, attemptId));

      const result = await db.runTransaction(async transaction => {
        const cutover = await transaction.get(cutoverRef);
        if (cutover.exists) throw fault('material_cutover_required', 409);
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const saved = receipt.data();
          if (saved.po_id !== poId || saved.attempt_id !== attemptId || saved.project_id !== projectId) throw fault('operation_conflict', 409);
          return { ok: true, released: true, replayed: true, project_id: projectId, po_id: poId, attempt_id: attemptId };
        }

        const project = await transaction.get(projectRef);
        const po = await transaction.get(poRef);
        if (!project.exists || !po.exists) throw fault('purchase_order_not_found', 404);
        const stored = po.data();
        if (stored.projectId && stored.projectId !== projectId) throw fault('procurement_forbidden', 403);
        if (stored.nativeSendAttemptId) throw fault('purchase_order_attempt_active', 409);
        if (stored.legacySendAttemptId !== attemptId) throw fault('legacy_send_attempt_changed', 409);
        if (stored.legacySendPhase !== 'preparing') throw fault('legacy_send_phase_not_releasable', 409);
        if (stored.legacySendDispatchStartedAt != null || stored.legacySendAcceptedAt != null
          || stored.legacySendProviderId != null) throw fault('legacy_send_phase_not_releasable', 409);
        if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved', 409);
        const preparingAt = millis(stored.legacySendPreparingAt);
        const currentTime = now();
        if (!Number.isFinite(preparingAt) || preparingAt < 0 || preparingAt > currentTime
          || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0 || currentTime - preparingAt < staleAfterMs) {
          throw fault('legacy_send_preparation_not_stale', 409);
        }

        await assertAdmin();
        const audit = {
          operation: 'release_stale_legacy_po_preparation', project_id: projectId, po_id: poId,
          attempt_id: attemptId, actor_uid: actor.uid, actor_email: actor.email,
          phase_before: stored.legacySendPhase, preparing_at: stored.legacySendPreparingAt,
          stale_after_ms: staleAfterMs, created_at: getServerTimestamp(),
        };
        transaction.update(poRef, { legacySendAttemptId: null, legacySendPhase: null, legacySendPreparingAt: null,
          legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
          legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null,
          legacySendFileSize: null, legacySendDocumentId: null, legacySendRetryPayloadReady: null });
        transaction.create(receiptRef, audit);
        return { ok: true, released: true, replayed: false, project_id: projectId, po_id: poId, attempt_id: attemptId };
      });
      if (result.released) {
        await removePdf(legacyPOEmailRetryPdfPath(projectId, attemptId)).catch(() => {});
        await removeAttempt(projectId, attemptId).catch(() => {});
      }
      return result;
    } catch (error) {
      return { ok: false, error: error.status ? error.code : 'legacy_send_recovery_unavailable' };
    }
  };
}

module.exports = { createLegacyPOSendRecovery, STALE_PREPARING_MS };
