const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { finalizeLegacyPOEmail } = require('./legacyPOEmailFinalize.cjs');

function setup(options = {}) {
  const f = fixture({ uid: 'admin', ...options });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, { status: 'pending-approval', legacySendAttemptId: 'attempt-1', legacySendPhase: 'provider_accepted',
    items: [{ bomItemId: 'bolt', dueDate: new Date('2026-11-20T00:00:00Z') }] });
  const finalize = () => finalizeLegacyPOEmail({ db: f.db, projectId: 'P', poId: 'existing', attemptId: 'attempt-1',
    actorUid: 'admin', recipientEmail: 'vendor@example.com', acceptedMs: Date.parse('2026-10-18T18:30:00.000Z'),
    pdfUrl: 'https://example.test/po.pdf', fileSize: 1200, documentId: 'doc-1',
    providerId: 'resend-email-1',
    getServerTimestamp: () => new Date('2026-10-19T00:00:00Z') });
  if (options.cutover) f.docs.set('pulseMaterialCutovers/P', { project_id: 'P' });
  return { ...f, finalize };
}

test('legacy email acceptance atomically records PO, linked BOM, document, and audit with IST order date', async () => {
  const f = setup();
  const result = await f.finalize();
  assert.equal(result.ok, true);
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  assert.equal(po.status, 'sent');
  assert.equal(po.actualSentDate, '2026-10-19');
  assert.equal(po.legacySendAttemptId, null);
  const item = f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.status, 'ordered');
  assert.equal(item.orderDate, '2026-10-19');
  assert.equal(item.expectedArrival, '2026-11-20');
  assert.equal(f.docs.get('projectDocuments/doc-1').url, 'https://example.test/po.pdf');
  const audit = [...f.docs.entries()].find(([path]) => path.includes('/audit/'))[1];
  assert.equal(audit.provider_id, 'resend-email-1');
  assert.equal(audit.actor_uid, 'admin');
});

test('legacy email finalization preserves the calendar day of an offset promised-date string', async () => {
  const f = setup();
  f.docs.get('projects/P/purchaseOrders/existing').items[0].dueDate = '2026-11-20T00:00:00+05:30';
  await f.finalize();
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].expectedArrival, '2026-11-20');
});

test('legacy email finalization retry returns its durable audit without rewriting data', async () => {
  const f = setup();
  await f.finalize();
  const before = structuredClone(f.docs.get('projects/P/bom/data'));
  const replay = await f.finalize();
  assert.equal(replay.replayed, true);
  assert.deepEqual(f.docs.get('projects/P/bom/data'), before);
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});

test('cutover race refuses legacy finalization and leaves the send lock for reconciliation', async () => {
  const f = setup({ cutover: true });
  const before = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  await assert.rejects(f.finalize(), error => error.code === 'material_cutover_required');
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), before);
  assert.equal(f.docs.has('projectDocuments/doc-1'), false);
});

test('audit failure rolls back sent metadata, BOM changes, and document publication together', async () => {
  const f = setup({ failAudit: true });
  const poBefore = structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
  const bomBefore = structuredClone(f.docs.get('projects/P/bom/data'));
  await assert.rejects(f.finalize(), /audit/i);
  assert.deepEqual(f.docs.get('projects/P/purchaseOrders/existing'), poBefore);
  assert.deepEqual(f.docs.get('projects/P/bom/data'), bomBefore);
  assert.equal(f.docs.has('projectDocuments/doc-1'), false);
});
