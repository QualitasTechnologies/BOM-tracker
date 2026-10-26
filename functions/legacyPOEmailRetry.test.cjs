const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createLegacyPOEmailRetry, IDEMPOTENCY_RETRY_WINDOW_MS } = require('./legacyPOEmailRetry.cjs');
const { createHash } = require('node:crypto');

const request = (uid, data) => ({ data, auth: { uid }, rawRequest: { get: () => 'Bearer test' } });
const now = Date.parse('2026-10-18T18:00:00.000Z');
const attemptId = 'attempt-1';
const email = { from: 'pulse@example.test', to: 'vendor@example.test', cc: [], subject: 'PO-1', html: '<p>PO</p>' };
const attemptPath = `pulseLegacyPOSendAttempts/P/attempts/${attemptId}`;
const pdfBytes = Buffer.from('pdf bytes');

function preparedFixture({ phase = 'uncertain', providerId = null, age = 60_000, status = 'pending-approval' } = {}) {
  const f = fixture({ uid: 'admin', cutover: false, now });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, {
    status,
    legacySendAttemptId: attemptId,
    legacySendPhase: phase,
    legacySendDispatchStartedAt: new Date(now - age),
    legacySendAcceptedAt: null,
    legacySendProviderId: providerId,
    legacySendActorUid: 'admin',
    legacySendRecipientEmail: 'vendor@example.test',
    legacySendPdfUrl: 'https://storage.example.test/po.pdf',
    legacySendFileSize: 42,
    legacySendDocumentId: 'document-1',
    legacySendRetryPayloadReady: true,
  });
  f.docs.set(attemptPath, {
    project_id: 'P', po_id: 'existing', attempt_id: attemptId,
    email: structuredClone(email), attachment: { filename: 'PO-1.pdf', type: 'application/pdf' },
    pdfStoragePath: 'purchase-orders/P/legacy-send-attempts/attempt-1.pdf',
    pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'), pdfFileSize: pdfBytes.length,
  });
  return f;
}

function retryFor(f, overrides = {}) {
  const calls = { sent: [], lookedUp: [], pdf: [], removedPdf: [], removedAttempt: [], finalized: [] };
  const retry = createLegacyPOEmailRetry({
    db: f.db, auth: f.auth, now: () => now,
    readPdf: async path => { calls.pdf.push(path); return pdfBytes; },
    removePdf: async path => { calls.removedPdf.push(path); },
    removeAttempt: async (projectId, id) => { calls.removedAttempt.push([projectId, id]); },
    sendEmail: async (payload, options) => { calls.sent.push({ payload, options }); return { data: { id: 'resend-1' } }; },
    getEmail: async id => { calls.lookedUp.push(id); return { data: { id, created_at: '2026-10-18T17:30:00.000Z' } }; },
    getServerTimestamp: () => new Date(now),
    finalize: async args => { calls.finalized.push(args); return { replayed: false }; },
    ...overrides,
  });
  return { retry, calls };
}

test('retries the frozen email with the original idempotency key, reads provider acceptance, then finalizes', async () => {
  const f = preparedFixture();
  const { retry, calls } = retryFor(f);
  const result = await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId }));

  assert.deepEqual(result, { ok: true, project_id: 'P', po_id: 'existing', attempt_id: attemptId, phase: 'complete', replayed: false });
  assert.equal(calls.sent.length, 1);
  assert.deepEqual(calls.sent[0].options, { idempotencyKey: attemptId });
  assert.deepEqual(calls.sent[0].payload, { ...email, attachments: [{ filename: 'PO-1.pdf', type: 'application/pdf', content: Buffer.from('pdf bytes').toString('base64') }] });
  assert.deepEqual(calls.pdf, ['purchase-orders/P/legacy-send-attempts/attempt-1.pdf']);
  assert.deepEqual(calls.lookedUp, ['resend-1']);
  assert.equal(calls.finalized[0].providerId, 'resend-1');
  assert.equal(calls.finalized[0].acceptedMs, Date.parse('2026-10-18T17:30:00.000Z'));
  assert.deepEqual(calls.removedPdf, []);
  assert.deepEqual(calls.removedAttempt, [['P', attemptId]]);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendPhase, 'provider_accepted');
});

test('a provider ID already saved is looked up without sending again', async () => {
  const f = preparedFixture({ phase: 'needs_reconciliation', providerId: 'resend-saved' });
  const { retry, calls } = retryFor(f);
  const result = await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId }));
  assert.equal(result.ok, true);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.pdf.length, 0);
  assert.deepEqual(calls.lookedUp, ['resend-saved']);
});

test('a retry without a provider ID is refused after the Resend idempotency window', async () => {
  const f = preparedFixture({ age: IDEMPOTENCY_RETRY_WINDOW_MS });
  const { retry, calls } = retryFor(f);
  const result = await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId }));
  assert.deepEqual(result, { ok: false, error: 'legacy_send_idempotency_window_expired' });
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.lookedUp.length, 0);
});

test('a live dispatch cannot be retried during the original send callable grace period', async () => {
  const f = preparedFixture({ phase: 'dispatching', age: 2 * 60 * 1000 });
  const { retry, calls } = retryFor(f);
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), {
    ok: false, error: 'legacy_send_retry_too_early',
  });
  assert.equal(calls.sent.length, 0);
});

test('retry rejects a changed frozen PDF path or recipient', async () => {
  for (const mutate of [
    record => { record.pdfStoragePath = 'projects/other/secret.pdf'; },
    record => { record.email.to = 'other@example.test'; },
  ]) {
    const f = preparedFixture();
    mutate(f.docs.get(attemptPath));
    const { retry, calls } = retryFor(f);
    assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), {
      ok: false, error: 'legacy_send_retry_payload_missing',
    });
    assert.equal(calls.sent.length, 0);
  }
});

test('retry refuses frozen PDF bytes that no longer match the saved size and hash', async () => {
  const f = preparedFixture();
  const { retry, calls } = retryFor(f, { readPdf: async () => Buffer.from('tampered') });
  const result = await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId }));
  assert.deepEqual(result, { ok: false, error: 'legacy_send_pdf_integrity_failed' });
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.lookedUp.length, 0);
});

test('retry refuses already-recorded provider acceptance and leaves it for accepted recovery', async () => {
  const f = preparedFixture({ phase: 'needs_reconciliation', providerId: 'resend-accepted' });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.legacySendAcceptedAt = '2026-10-18T17:31:00.000Z';
  const before = structuredClone(po);
  const { retry, calls } = retryFor(f);
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), {
    ok: false, error: 'legacy_send_already_accepted',
  });
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), before);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.lookedUp.length, 0);
});

test('a definitive Resend rejection releases the lock with an audit receipt and removes retry-only files', async () => {
  const f = preparedFixture();
  const { retry, calls } = retryFor(f, { sendEmail: async () => ({ error: { name: 'validation_error' } }) });
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), {
    ok: false, error: 'legacy_send_provider_rejected',
  });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  assert.equal(po.legacySendAttemptId, null);
  assert.deepEqual(calls.removedAttempt, [['P', attemptId]]);
  assert.deepEqual(calls.removedPdf, ['purchase-orders/P/legacy-send-attempts/attempt-1.pdf']);
  const audit = f.docs.get('pulseProcurementOperations/P/audit/attempt-1-legacy-email-rejected');
  assert.equal(audit.operation, 'legacy_po_email_rejected');
  assert.equal(audit.provider_rejection_name, 'validation_error');
});

test('retry is blocked for non-admins, changed attempts, missing private payload, and cutover projects', async () => {
  const f = preparedFixture();
  const { retry } = retryFor(f);
  assert.deepEqual(await retry(request('viewer', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), { ok: false, error: 'actor_forbidden' });
  f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId = 'other-attempt';
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), { ok: false, error: 'legacy_send_attempt_changed' });
  f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId = attemptId;
  f.docs.delete(attemptPath);
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), { ok: false, error: 'legacy_send_retry_payload_missing' });
  f.docs.set(attemptPath, { project_id: 'P', po_id: 'existing', attempt_id: attemptId, email, attachment: { filename: 'PO-1.pdf', type: 'application/pdf' }, pdfStoragePath: 'purchase-orders/P/legacy-send-attempts/attempt-1.pdf' });
  f.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), { ok: false, error: 'material_cutover_required' });
});

test('retry does not send when the PO is no longer pending approval', async () => {
  const f = preparedFixture({ status: 'sent' });
  const { retry, calls } = retryFor(f);
  assert.deepEqual(await retry(request('admin', { project_id: 'P', po_id: 'existing', attempt_id: attemptId })), { ok: false, error: 'purchase_order_not_approved' });
  assert.equal(calls.sent.length, 0);
});
