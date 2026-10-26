import { describe, expect, it } from 'vitest';
import { isRecoverableLegacyPOAcceptance, isRetryableLegacyPOSend, isStaleLegacyPOSendPreparation, LEGACY_PO_SEND_PREPARATION_STALE_MS, LEGACY_PO_SEND_IDEMPOTENCY_WINDOW_MS, LEGACY_PO_SEND_LIVE_DISPATCH_GRACE_MS } from '../legacyPOSendRecovery';

describe('legacy PO send recovery visibility', () => {
  const now = 1_800_000_000_000;

  it('shows recovery only after a preparing attempt has been stale for fifteen minutes', () => {
    expect(isStaleLegacyPOSendPreparation('preparing', 'attempt-1', new Date(now - LEGACY_PO_SEND_PREPARATION_STALE_MS), now)).toBe(true);
    expect(isStaleLegacyPOSendPreparation('preparing', 'attempt-1', new Date(now - LEGACY_PO_SEND_PREPARATION_STALE_MS + 1), now)).toBe(false);
  });

  it('hides recovery for missing identity, timestamp, future dates, or ambiguous send phases', () => {
    const old = new Date(now - LEGACY_PO_SEND_PREPARATION_STALE_MS - 1);
    expect(isStaleLegacyPOSendPreparation('preparing', null, old, now)).toBe(false);
    expect(isStaleLegacyPOSendPreparation('preparing', 'attempt-1', undefined, now)).toBe(false);
    expect(isStaleLegacyPOSendPreparation('preparing', 'attempt-1', new Date(now + 1), now)).toBe(false);
    for (const phase of ['dispatching', 'uncertain', 'provider_accepted', 'needs_reconciliation']) {
      expect(isStaleLegacyPOSendPreparation(phase, 'attempt-1', old, now)).toBe(false);
    }
  });

  it('offers finalization only when an accepted provider send has durable evidence', () => {
    const complete = {
      attemptId: 'attempt-1', acceptedAt: '2026-10-18T18:30:00.000Z', providerId: 'resend-1',
      actorUid: 'admin', recipientEmail: 'vendor@example.com', pdfUrl: 'https://example.test/po.pdf',
      fileSize: 1200, documentId: 'document-1',
    };
    for (const phase of ['provider_accepted', 'needs_reconciliation']) {
      expect(isRecoverableLegacyPOAcceptance({ ...complete, phase })).toBe(true);
    }
    expect(isRecoverableLegacyPOAcceptance({ ...complete, phase: 'uncertain' })).toBe(false);
    expect(isRecoverableLegacyPOAcceptance({ ...complete, phase: 'provider_accepted', acceptedAt: null })).toBe(false);
    expect(isRecoverableLegacyPOAcceptance({ ...complete, phase: 'provider_accepted', acceptedAt: 'not-a-date' })).toBe(false);
    for (const field of ['actorUid', 'recipientEmail', 'pdfUrl', 'fileSize', 'documentId'] as const) {
      expect(isRecoverableLegacyPOAcceptance({ ...complete, phase: 'provider_accepted', [field]: null })).toBe(false);
    }
  });

  it('allows idempotent retry only with a frozen payload and an unexpired attempt or saved provider ID', () => {
    const good = { phase: 'uncertain', attemptId: 'attempt-1', retryPayloadReady: true,
      status: 'pending-approval', dispatchStartedAt: new Date(now - 1000) };
    expect(isRetryableLegacyPOSend(good, now)).toBe(true);
    expect(isRetryableLegacyPOSend({ ...good, dispatchStartedAt: new Date(now - LEGACY_PO_SEND_IDEMPOTENCY_WINDOW_MS) }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, dispatchStartedAt: undefined, providerId: 're_1' }, now)).toBe(true);
    expect(isRetryableLegacyPOSend({ ...good, retryPayloadReady: false }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, phase: 'preparing' }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, phase: 'dispatching', dispatchStartedAt: new Date(now - LEGACY_PO_SEND_LIVE_DISPATCH_GRACE_MS + 1) }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, phase: 'provider_accepted', acceptedAt: '2026-10-18T17:00:00.000Z', providerId: 're_1' }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, phase: 'provider_accepted', providerId: undefined }, now)).toBe(false);
    expect(isRetryableLegacyPOSend({ ...good, status: 'sent' }, now)).toBe(false);
  });
});
