const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createLegacyPOEmailRecovery } = require('./legacyPOEmailRecovery.cjs');

function setup({ uid = 'admin', phase = 'needs_reconciliation', cutover = false } = {}) {
  const f = fixture({ uid });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, {
    status: 'pending-approval', legacySendAttemptId: 'attempt-1', legacySendPhase: phase,
    legacySendAcceptedAt: '2026-10-18T18:30:00.000Z', legacySendProviderId: 'resend-email-1',
    legacySendActorUid: 'admin', legacySendRecipientEmail: 'vendor@example.com',
    legacySendPdfUrl: 'https://example.test/po.pdf', legacySendFileSize: 1200, legacySendDocumentId: 'legacy-doc-1',
    items: [{ bomItemId: 'bolt', dueDate: '2026-11-20T00:00:00+05:30' }],
  });
  if (cutover) f.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });
  const removed = { pdf: [], attempt: [] };
  f.docs.set('pulseLegacyPOSendAttempts/P/attempts/attempt-1', {
    project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1',
    email: { from: 'pulse@example.com', to: 'vendor@example.com', cc: [], subject: 'PO-EX', html: '<p>PO</p>' },
    attachment: { filename: 'PO-EX.pdf', type: 'application/pdf' },
    pdfStoragePath: 'purchase-orders/P/legacy-send-attempts/attempt-1.pdf',
  });
  const recover = createLegacyPOEmailRecovery({ db: f.db, auth: f.auth,
    removePdf: async path => { removed.pdf.push(path); },
    removeAttempt: async (projectId, attemptId) => { removed.attempt.push([projectId, attemptId]); },
    getServerTimestamp: () => new Date('2026-10-19T00:00:00Z') });
  const call = data => recover({ auth: { uid }, rawRequest: { get: () => 'Bearer test' }, data });
  return { ...f, call, removed };
}

test('admin recovery completes finalization from durable provider acceptance exactly once', async () => {
  const f = setup();
  const recovered = await f.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' });
  assert.deepEqual(recovered, { ok: true, project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1', phase: 'complete', replayed: false });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  assert.equal(po.status, 'sent');
  assert.equal(po.sentToEmail, 'vendor@example.com');
  assert.equal(po.sentBy, 'admin');
  assert.equal(po.legacySendAttemptId, null);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-11-20');
  assert.equal(f.docs.has('projectDocuments/legacy-doc-1'), true);
  assert.deepEqual(f.removed.pdf, []);
  assert.deepEqual(f.removed.attempt, [['P', 'attempt-1']]);
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
  const replay = await f.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' });
  assert.deepEqual(replay, { ok: true, project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1', phase: 'complete', replayed: true });
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
  assert.deepEqual(f.removed.pdf, []);
});

test('recovery cannot release or finalize an email that has not been durably accepted', async () => {
  const f = setup({ phase: 'uncertain' });
  const result = await f.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' });
  assert.equal(result.error, 'legacy_send_not_accepted');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').status, 'pending-approval');
});

test('recovery requires a current admin and refuses malformed accepted evidence', async () => {
  const viewer = setup({ uid: 'alice' });
  assert.equal((await viewer.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' })).error, 'actor_forbidden');
  const missing = setup();
  delete missing.docs.get('projects/P/purchaseOrders/existing').legacySendProviderId;
  assert.equal((await missing.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' })).error, 'legacy_send_recovery_data_missing');
});

test('cutover prevents recovery from writing through the legacy BOM path', async () => {
  const f = setup({ cutover: true });
  const before = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  const result = await f.call({ project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' });
  assert.equal(result.error, 'material_cutover_required');
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), before);
});
