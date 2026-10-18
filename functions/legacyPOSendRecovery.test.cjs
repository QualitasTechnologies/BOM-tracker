const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacyPOSendRecovery, STALE_PREPARING_MS } = require('./legacyPOSendRecovery.cjs');

function fixture({ uid = 'admin', phase = 'preparing', preparingAt = 0, cutover = false, now = STALE_PREPARING_MS + 10_000, dispatchEvidence = false } = {}) {
  const docs = new Map([
    ['projects/P', { memberIds: ['admin'] }],
    ['projects/P/purchaseOrders/PO', {
      projectId: 'P', status: 'pending-approval', legacySendAttemptId: 'attempt-1', legacySendPhase: phase,
      legacySendPreparingAt: new Date(preparingAt), ...(dispatchEvidence ? { legacySendDispatchStartedAt: new Date(preparingAt + 1) } : {}),
    }],
    ...(cutover ? [['pulseMaterialCutovers/P', { project_id: 'P' }]] : []),
  ]);
  const versions = new Map([...docs.keys()].map(path => [path, 1]));
  const ref = path => ({ path, id: path.split('/').pop(), doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`) });
  const snapshot = path => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 1, nanoseconds: versions.get(path) || 0 } });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map(), writes = [];
      const result = await fn({
        get: async document => { reads.set(document.path, versions.get(document.path) || 0); return snapshot(document.path); },
        update: (document, patch) => writes.push(['update', document.path, patch]),
        create: (document, data) => writes.push(['create', document.path, data]),
      });
      if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
      for (const [kind, path] of writes) if (kind === 'create' && docs.has(path)) throw new Error('already exists');
      for (const [kind, path, value] of writes) {
        docs.set(path, kind === 'create' ? structuredClone(value) : { ...docs.get(path), ...structuredClone(value) });
        versions.set(path, (versions.get(path) || 0) + 1);
      }
      return result;
    }
    throw new Error('transaction contention');
  } };
  const actor = { uid, email: `${uid}@qualitastech.com`, emailVerified: true, customClaims: { status: 'approved', role: uid === 'admin' ? 'admin' : 'viewer' } };
  const auth = { verifyIdToken: async token => ({ uid, email: actor.email, token }), getUser: async () => actor };
  const removed = { pdf: [], attempt: [] };
  const recover = createLegacyPOSendRecovery({ db, auth, now: () => now, getServerTimestamp: () => new Date(now),
    removePdf: async path => { removed.pdf.push(path); },
    removeAttempt: async (projectId, attemptId) => { removed.attempt.push([projectId, attemptId]); },
  });
  const call = (attemptId = 'attempt-1') => recover({ auth: { uid }, rawRequest: { get: () => 'Bearer test' }, data: { operation: 'release_stale_preparing', project_id: 'P', po_id: 'PO', attempt_id: attemptId } });
  return { docs, call, removed };
}

test('releases only a stale pre-dispatch reservation and records an audit receipt atomically', async () => {
  const f = fixture();
  const result = await f.call();
  assert.deepEqual(result, { ok: true, released: true, replayed: false, project_id: 'P', po_id: 'PO', attempt_id: 'attempt-1' });
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').legacySendAttemptId, null);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').legacySendPhase, null);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').legacySendPreparingAt, null);
  const receipts = [...f.docs.entries()].filter(([path]) => path.startsWith('pulseLegacyPOSendRecoveries/'));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0][1].operation, 'release_stale_legacy_po_preparation');
  assert.equal(receipts[0][1].attempt_id, 'attempt-1');
  assert.equal(receipts[0][1].actor_uid, 'admin');
  assert.deepEqual(f.removed.pdf, ['purchase-orders/P/legacy-send-attempts/attempt-1.pdf']);
  assert.deepEqual(f.removed.attempt, [['P', 'attempt-1']]);
});

test('fresh, future, and missing preparation timestamps fail closed without writes', async () => {
  for (const preparingAt of [STALE_PREPARING_MS, STALE_PREPARING_MS + 20_000, NaN]) {
    const f = fixture({ preparingAt });
    if (Number.isNaN(preparingAt)) delete f.docs.get('projects/P/purchaseOrders/PO').legacySendPreparingAt;
    const before = structuredClone([...f.docs]);
    assert.equal((await f.call()).error, 'legacy_send_preparation_not_stale');
    assert.deepEqual([...f.docs], before);
  }
});

test('a retried attempt with cleared prior-send fields can release a stale preparation', async () => {
  const f = fixture();
  Object.assign(f.docs.get('projects/P/purchaseOrders/PO'), {
    legacySendDispatchStartedAt: null, legacySendAcceptedAt: null, legacySendProviderId: null,
    legacySendActorUid: null, legacySendRecipientEmail: null, legacySendPdfUrl: null,
    legacySendFileSize: null, legacySendDocumentId: null,
  });
  assert.equal((await f.call()).released, true);
  assert.equal(f.docs.get('projects/P/purchaseOrders/PO').legacySendAttemptId, null);
});

test('dispatching, uncertain, provider accepted and reconciliation phases can never be auto-released', async () => {
  for (const phase of ['dispatching', 'uncertain', 'provider_accepted', 'needs_reconciliation']) {
    const f = fixture({ phase });
    const before = structuredClone([...f.docs]);
    assert.equal((await f.call()).error, 'legacy_send_phase_not_releasable');
    assert.deepEqual([...f.docs], before);
  }
  const evidence = fixture({ phase: 'preparing', dispatchEvidence: true });
  assert.equal((await evidence.call()).error, 'legacy_send_phase_not_releasable');
});

test('stale pre-dispatch recovery can clear an orphaned lock after cutover without touching materials', async () => {
  const cutover = fixture({ cutover: true });
  const bomBefore = structuredClone(cutover.docs.get('projects/P/bom/data'));
  assert.equal((await cutover.call()).released, true);
  assert.equal(cutover.docs.get('projects/P/purchaseOrders/PO').legacySendAttemptId, null);
  assert.deepEqual(cutover.docs.get('projects/P/bom/data'), bomBefore);
  assert.equal(cutover.docs.has('pulseMaterialCutovers/P'), true);
});

test('non-admin and changed-attempt requests fail without mutating the PO', async () => {
  const viewer = fixture({ uid: 'viewer' });
  assert.equal((await viewer.call()).error, 'actor_forbidden');
  const changed = fixture();
  assert.equal((await changed.call('another-attempt')).error, 'legacy_send_attempt_changed');
  for (const f of [viewer, changed]) assert.equal([...f.docs.keys()].some(path => path.startsWith('pulseLegacyPOSendRecoveries/')), false);
});

test('same-request retries replay the receipt and concurrent recoveries release exactly once', async () => {
  const retry = fixture();
  assert.equal((await retry.call()).replayed, false);
  assert.equal((await retry.call()).replayed, true);
  assert.equal([...retry.docs.keys()].filter(path => path.startsWith('pulseLegacyPOSendRecoveries/')).length, 1);

  const concurrent = fixture();
  const results = await Promise.all([concurrent.call(), concurrent.call()]);
  assert.deepEqual(results.map(result => result.released), [true, true]);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal([...concurrent.docs.keys()].filter(path => path.startsWith('pulseLegacyPOSendRecoveries/')).length, 1);
});
