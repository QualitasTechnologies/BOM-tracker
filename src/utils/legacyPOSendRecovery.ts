export const LEGACY_PO_SEND_PREPARATION_STALE_MS = 15 * 60 * 1000;
export const LEGACY_PO_SEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const LEGACY_PO_SEND_LIVE_DISPATCH_GRACE_MS = 10 * 60 * 1000;

export const isStaleLegacyPOSendPreparation = (
  phase: string | null | undefined,
  attemptId: string | null | undefined,
  preparingAt: Date | null | undefined,
  now = Date.now(),
): boolean => {
  if (phase !== 'preparing' || !attemptId || !(preparingAt instanceof Date)) return false;
  const startedAt = preparingAt.getTime();
  return Number.isFinite(startedAt) && startedAt >= 0 && startedAt <= now
    && now - startedAt >= LEGACY_PO_SEND_PREPARATION_STALE_MS;
};

export interface LegacyPOAcceptanceEvidence {
  phase?: string | null;
  attemptId?: string | null;
  acceptedAt?: string | null;
  providerId?: string | null;
  actorUid?: string | null;
  recipientEmail?: string | null;
  pdfUrl?: string | null;
  fileSize?: number | null;
  documentId?: string | null;
}

export const isRecoverableLegacyPOAcceptance = (evidence: LegacyPOAcceptanceEvidence): boolean =>
  (evidence.phase === 'provider_accepted' || evidence.phase === 'needs_reconciliation')
  && !!evidence.attemptId && typeof evidence.acceptedAt === 'string' && Number.isFinite(Date.parse(evidence.acceptedAt))
  && typeof evidence.providerId === 'string' && !!evidence.providerId.trim()
  && typeof evidence.actorUid === 'string' && !!evidence.actorUid.trim()
  && typeof evidence.recipientEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(evidence.recipientEmail)
  && typeof evidence.pdfUrl === 'string' && !!evidence.pdfUrl.trim()
  && Number.isSafeInteger(evidence.fileSize) && (evidence.fileSize as number) >= 0
  && typeof evidence.documentId === 'string' && !!evidence.documentId.trim()
  && !/[\/\x00-\x1f]/.test(evidence.documentId) && !['.', '..'].includes(evidence.documentId);

export interface LegacyPOSendRetryEvidence {
  status?: string | null;
  phase?: string | null;
  attemptId?: string | null;
  acceptedAt?: string | null;
  retryPayloadReady?: boolean | null;
  providerId?: string | null;
  dispatchStartedAt?: Date | null;
}

export const isRetryableLegacyPOSend = (evidence: LegacyPOSendRetryEvidence, now = Date.now()): boolean => {
  if (evidence.status !== 'pending-approval'
    || !['dispatching', 'uncertain', 'needs_reconciliation', 'provider_accepted'].includes(evidence.phase || '')
    || typeof evidence.attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(evidence.attemptId)
    || evidence.retryPayloadReady !== true) return false;
  if (evidence.phase === 'provider_accepted' && evidence.acceptedAt) return false;
  if (evidence.phase === 'provider_accepted' && !(typeof evidence.providerId === 'string' && evidence.providerId.trim())) return false;
  if (typeof evidence.providerId === 'string' && evidence.providerId.trim()) return true;
  if (!(evidence.dispatchStartedAt instanceof Date)) return false;
  const startedAt = evidence.dispatchStartedAt.getTime();
  const age = now - startedAt;
  if (evidence.phase === 'dispatching' && age < LEGACY_PO_SEND_LIVE_DISPATCH_GRACE_MS) return false;
  return Number.isFinite(startedAt) && startedAt > 0 && age >= 0 && age < LEGACY_PO_SEND_IDEMPOTENCY_WINDOW_MS;
};
