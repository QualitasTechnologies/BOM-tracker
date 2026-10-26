const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { authorizeLegacyPOSend: authorizeLegacyPOSendImpl, beginLegacyPOSendDispatch, releaseLegacyPOSend, updateLegacyPOSend } = require('./legacyPOSendGuard.cjs');
const authorizeLegacyPOSend = options => authorizeLegacyPOSendImpl({
  getServerTimestamp: () => new Date('2026-10-18T00:00:00Z'), ...options,
});

const request = uid => ({ auth: { uid }, rawRequest: { get: () => 'Bearer test' } });

test('legacy PO email requires a verified admin and returns the stored PO', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  const result = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  assert.equal(result.actor.uid, 'admin');
  assert.equal(result.purchaseOrder.id, 'existing');
  assert.equal(result.purchaseOrder.projectId, 'P');
  assert.equal(result.purchaseOrder.poNumber, 'PO-EX');
  assert.match(f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId, /^[0-9a-f-]{36}$/);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendPhase, 'preparing');
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing').legacySendPreparingAt, new Date('2026-10-18T00:00:00Z'));
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('alice'), projectId: 'P', poId: 'existing' }), /forbidden/i);
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }), /already in progress/i);
});

test('legacy PO email remains available on uncut projects while native procurement is enabled globally', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  const result = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing', nativeEnabled: true });
  assert.equal(result.purchaseOrder.id, 'existing');
});

test('legacy PO email is denied after the reviewed material cutover marker exists', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.set('pulseMaterialCutovers/P', { project_id: 'P', source: 'reviewed_cutover' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  await assert.rejects(
    authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }),
    error => error.code === 'material_cutover_required'
  );
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId, undefined);
});

test('a send reservation can be released before provider dispatch so the PO can be retried', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  const reserved = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  assert.equal(await releaseLegacyPOSend({ db: f.db, projectId: 'P', poId: 'existing', attemptId: reserved.attemptId }), true);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId, null);
  const retry = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  assert.ok(retry.attemptId);
});

test('conditional acceptance update cannot overwrite a saved acceptance or conflicting provider ID', async () => {
  const f = fixture();
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, { legacySendAttemptId: 'attempt-1', legacySendPhase: 'needs_reconciliation',
    legacySendAcceptedAt: '2026-10-18T17:00:00.000Z', legacySendProviderId: 'resend-1' });
  assert.equal(await updateLegacyPOSend({ db: f.db, projectId: 'P', poId: 'existing', attemptId: 'attempt-1',
    requireNoAcceptedAt: true, providerId: 'resend-1', patch: { legacySendAcceptedAt: '2026-10-18T18:00:00.000Z' } }), false);
  assert.equal(po.legacySendAcceptedAt, '2026-10-18T17:00:00.000Z');
  assert.equal(await updateLegacyPOSend({ db: f.db, projectId: 'P', poId: 'existing', attemptId: 'attempt-1',
    providerId: 'resend-2', patch: { legacySendProviderId: 'resend-2' } }), false);
  assert.equal(po.legacySendProviderId, 'resend-1');
});

test('a new reservation clears prior attempt evidence so preparing recovery can work after a retry', async () => {
  const f = fixture({ uid: 'admin' });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.status = 'pending-approval';
  Object.assign(po, { legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
    legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null, legacySendFileSize: null, legacySendDocumentId: null });
  await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  for (const field of ['legacySendDispatchStartedAt', 'legacySendAcceptedAt', 'legacySendProviderId', 'legacySendActorUid',
    'legacySendRecipientEmail', 'legacySendPdfUrl', 'legacySendFileSize', 'legacySendDocumentId']) {
    assert.equal(po[field], null, field);
  }
});

test('the dispatch transaction rechecks cutover and clears/audits a pre-dispatch reservation without sending', async () => {
  const f = fixture({ uid: 'admin' });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.status = 'pending-approval';
  const reserved = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  f.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });
  const result = await beginLegacyPOSendDispatch({ db: f.db, projectId: 'P', poId: 'existing', attemptId: reserved.attemptId,
    patch: { legacySendPhase: 'dispatching', legacySendDispatchStartedAt: new Date() }, actorUid: 'admin', getServerTimestamp: () => new Date() });
  assert.deepEqual(result, { dispatched: false, error: 'material_cutover_required' });
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId, null);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendPhase, null);
  assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseLegacyPOSendRecoveries/P/operations/')), true);
});

test('the dispatch transaction stores an immutable private retry record with the PO reservation', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.delete('pulseMaterialCutovers/P');
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.status = 'pending-approval';
  const reserved = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  const retryPayload = {
    email: { from: 'pulse@example.test', to: 'vendor@example.test', cc: [], subject: 'PO-EX', html: '<p>frozen</p>' },
    attachment: { filename: 'PO-EX.pdf', type: 'application/pdf' },
    pdfStoragePath: 'private/po.pdf',
  };
  const result = await beginLegacyPOSendDispatch({ db: f.db, projectId: 'P', poId: 'existing', attemptId: reserved.attemptId,
    patch: { legacySendPhase: 'dispatching', legacySendDispatchStartedAt: new Date() }, retryPayload,
    actorUid: 'admin', getServerTimestamp: () => new Date() });

  assert.deepEqual(result, { dispatched: true });
  const storedAttempt = f.docs.get(`pulseLegacyPOSendAttempts/P/attempts/${reserved.attemptId}`);
  const { created_at: createdAt, ...frozenAttempt } = storedAttempt;
  assert.deepEqual(frozenAttempt, { project_id: 'P', po_id: 'existing', attempt_id: reserved.attemptId, ...retryPayload });
  assert.ok(createdAt instanceof Date);
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacySendRetryPayloadReady, true);
});

test('legacy PO email rejects unapproved, active-attempt, missing, and non-approved POs', async () => {
  const f = fixture({ uid: 'admin' });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.status = 'pending-approval';
  po.nativeSendAttemptId = 'active-attempt';
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }), /native PO send attempt/i);
  delete po.nativeSendAttemptId;
  po.status = 'sent';
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }), /approved Purchase Orders/i);
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'missing' }), /not found/i);
});

test('the dispatch transaction revalidates the actor after its reads and before any write', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  const reserved = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  const before = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  const denied = Object.assign(new Error('actor_forbidden'), { code: 'actor_forbidden' });
  await assert.rejects(beginLegacyPOSendDispatch({ db: f.db, projectId: 'P', poId: 'existing', attemptId: reserved.attemptId,
    patch: { legacySendPhase: 'dispatching' }, retryPayload: { email: {} }, actorUid: 'admin', getServerTimestamp: () => new Date(),
    assertActor: async () => { throw denied; } }), error => error === denied);
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), before);
  assert.equal(f.docs.has(`pulseLegacyPOSendAttempts/P/attempts/${reserved.attemptId}`), false);
});
