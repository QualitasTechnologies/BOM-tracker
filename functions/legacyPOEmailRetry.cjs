const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { updateLegacyPOSend, rejectLegacyPOSend } = require('./legacyPOSendGuard.cjs');
const { finalizeLegacyPOEmail } = require('./legacyPOEmailFinalize.cjs');
const { legacyPOEmailRetryPdfPath } = require('./legacyPOEmailRetryPdf.cjs');
const { isDefinitiveResendRejection } = require('./legacyPOResendOutcome.cjs');

const IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const LIVE_DISPATCH_GRACE_MS = 10 * 60 * 1000;
const fault = (code, status = 409) => Object.assign(new Error(code), { code, status });
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const millis = value => value instanceof Date ? value.getTime()
  : value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validRetryRecord(record, projectId, poId, attemptId, recipientEmail) {
  const email = record?.email;
  const attachment = record?.attachment;
  return record?.project_id === projectId && record?.po_id === poId && record?.attempt_id === attemptId
    && plain(email) && typeof email.from === 'string' && typeof email.to === 'string'
    && Array.isArray(email.cc) && email.cc.every(value => typeof value === 'string')
    && email.to === recipientEmail && typeof email.subject === 'string' && typeof email.html === 'string'
    && plain(attachment) && typeof attachment.filename === 'string' && typeof attachment.type === 'string'
    && record.pdfStoragePath === legacyPOEmailRetryPdfPath(projectId, attemptId)
    && typeof record.pdfSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.pdfSha256)
    && Number.isSafeInteger(record.pdfFileSize) && record.pdfFileSize > 0;
}

/** Retry only the exact server-frozen email with the original Resend idempotency key. */
function createLegacyPOEmailRetry({ db, auth, readPdf, removePdf = async () => {}, removeAttempt = async () => {}, sendEmail, getEmail, now = Date.now,
  getServerTimestamp, finalize = finalizeLegacyPOEmail }) {
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      if (actor.customClaims.role !== 'admin') throw fault('actor_forbidden', 403);
      const data = request.data;
      if (!plain(data) || Object.keys(data).some(key => !['project_id', 'po_id', 'attempt_id'].includes(key))
        || !validId(data.project_id) || !validId(data.po_id)
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
      const attemptRef = db.collection('pulseLegacyPOSendAttempts').doc(projectId).collection('attempts').doc(attemptId);
      const state = await db.runTransaction(async transaction => {
        const po = await transaction.get(poRef);
        const cutover = await transaction.get(cutoverRef);
        const attempt = await transaction.get(attemptRef);
        if (!po.exists) throw fault('purchase_order_not_found', 404);
        if (cutover.exists) throw fault('material_cutover_required');
        const stored = po.data();
        if (stored.legacySendAcceptedAt) throw fault('legacy_send_already_accepted');
        if (stored.legacySendAttemptId !== attemptId) throw fault('legacy_send_attempt_changed');
        if (!['dispatching', 'uncertain', 'needs_reconciliation'].includes(stored.legacySendPhase)
          && !(stored.legacySendPhase === 'provider_accepted' && stored.legacySendProviderId && !stored.legacySendAcceptedAt)) {
          throw fault('legacy_send_not_retryable');
        }
        if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved');
        if (stored.legacySendRetryPayloadReady !== true || !attempt.exists
          || !validRetryRecord(attempt.data(), projectId, poId, attemptId, stored.legacySendRecipientEmail)) throw fault('legacy_send_retry_payload_missing');
        const dispatchStartedAt = millis(stored.legacySendDispatchStartedAt);
        const age = now() - dispatchStartedAt;
        if (!stored.legacySendProviderId && stored.legacySendPhase === 'dispatching'
          && (!Number.isFinite(age) || age < LIVE_DISPATCH_GRACE_MS)) throw fault('legacy_send_retry_too_early');
        if (!stored.legacySendProviderId && (!Number.isFinite(age) || age < 0 || age >= IDEMPOTENCY_RETRY_WINDOW_MS)) {
          throw fault('legacy_send_idempotency_window_expired');
        }
        return { stored, retry: attempt.data() };
      });

      let providerId = state.stored.legacySendProviderId;
      if (!providerId) {
        const pdfBuffer = await readPdf(state.retry.pdfStoragePath);
        if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) throw fault('legacy_send_pdf_missing');
        const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex');
        if (pdfBuffer.length !== state.retry.pdfFileSize || pdfSha256 !== state.retry.pdfSha256) {
          throw fault('legacy_send_pdf_integrity_failed');
        }
        const emailPayload = { ...state.retry.email, attachments: [{ ...state.retry.attachment, content: pdfBuffer.toString('base64') }] };
        await assertAdmin();
        const sent = await sendEmail(emailPayload, { idempotencyKey: attemptId });
        if (sent?.error) {
          if (isDefinitiveResendRejection(sent.error)) {
            const released = await rejectLegacyPOSend({ db, projectId, poId, attemptId, actorUid: actor.uid,
              rejectionName: sent.error.name, getServerTimestamp });
            if (!released) throw fault('legacy_send_attempt_changed');
            await removePdf(state.retry.pdfStoragePath).catch(() => {});
            await removeAttempt(projectId, attemptId).catch(() => {});
            throw fault('legacy_send_provider_rejected');
          }
          throw fault('legacy_send_provider_uncertain');
        }
        providerId = sent?.data?.id;
        if (typeof providerId !== 'string' || !providerId.trim()) throw fault('legacy_send_provider_uncertain');
        const saved = await updateLegacyPOSend({ db, projectId, poId, attemptId, requireNoAcceptedAt: true, providerId,
          patch: { legacySendProviderId: providerId, legacySendPhase: 'needs_reconciliation' } });
        if (!saved) throw fault('legacy_send_attempt_changed');
      }

      const fetched = await getEmail(providerId);
      const acceptedAt = fetched?.data?.created_at;
      const acceptedMs = Date.parse(acceptedAt);
      if (!Number.isFinite(acceptedMs) || acceptedMs <= 0) throw fault('legacy_send_provider_time_unavailable');
      const acceptedSaved = await updateLegacyPOSend({ db, projectId, poId, attemptId, requireNoAcceptedAt: true, providerId,
        patch: { legacySendProviderId: providerId, legacySendAcceptedAt: new Date(acceptedMs).toISOString(), legacySendPhase: 'provider_accepted' } });
      if (!acceptedSaved) throw fault('legacy_send_attempt_changed');

      const result = await finalize({ db, projectId, poId, attemptId, actorUid: state.stored.legacySendActorUid,
        recipientEmail: state.stored.legacySendRecipientEmail, acceptedMs, pdfUrl: state.stored.legacySendPdfUrl,
        fileSize: state.stored.legacySendFileSize, documentId: state.stored.legacySendDocumentId,
        providerId, getServerTimestamp, assertActor: assertAdmin });
      await removeAttempt(projectId, attemptId).catch(() => {});
      return { ok: true, project_id: projectId, po_id: poId, attempt_id: attemptId, phase: 'complete', replayed: result.replayed === true };
    } catch (error) {
      return { ok: false, error: error.status ? error.code : 'legacy_send_retry_unavailable' };
    }
  };
}

module.exports = { createLegacyPOEmailRetry, IDEMPOTENCY_RETRY_WINDOW_MS, LIVE_DISPATCH_GRACE_MS };
