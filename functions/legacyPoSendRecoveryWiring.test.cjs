const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { fixture } = require('./nativePOAuthoringFixture.cjs');

const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
const start = source.indexOf('const { authorizeLegacyPOSend');
const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
const wiringSource = source.slice(start, end);

// Runs the real index.js send/recovery wiring against the real legacy PO modules
// and an in-memory Firestore/Storage/provider. No network or deployed service is used.
function harness({ providerResult, afterRender, afterProvider, render, onRead } = {}) {
  const providerCalls = [];
  const f = fixture({ uid: 'admin', onRead: onRead && ((path, users, docs) => onRead(path, users, docs, providerCalls)) });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  Object.assign(po, { status: 'pending-approval', poNumber: 'PO-EX',
    items: [{ bomItemId: 'bolt', dueDate: new Date('2026-11-20T00:00:00Z') }] });
  let generated = 0;
  const wrap = ref => ({
    path: ref.path, id: ref.path.split('/').pop(),
    doc: id => wrap(ref.doc(id ?? `generated-${++generated}`)),
    collection: name => wrap(ref.collection(name)),
    delete: async () => { f.docs.delete(ref.path); },
  });
  const db = { collection: name => wrap(f.db.collection(name)), runTransaction: fn => f.db.runTransaction(fn) };
  const files = new Map();
  const emailBuilds = [];
  const bucket = { name: 'test-bucket', file: path => ({
    save: async (buffer, options) => {
      if (options?.preconditionOpts?.ifGenerationMatch === 0 && files.has(path)) throw new Error('object exists');
      files.set(path, Buffer.from(buffer));
    },
    download: async () => { if (!files.has(path)) throw new Error('missing object'); return [files.get(path)]; },
    delete: async () => { files.delete(path); },
  }) };
  const state = { providerError: null };
  const context = {
    exports: {}, require, Buffer, Date, process: { env: {} },
    onCall: (_options, handler) => handler,
    resendApiKey: 'secret', getResendApiKey: () => 'secret',
    procurementEnabled: () => false,
    functions: { https: { HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } } },
    logger: { info() {}, warn() {}, error() {} },
    legacyPoAccess: { prepareSend: async request => ({
      uid: request.auth.uid, projectId: 'P', po: { ...f.docs.get('projects/P/purchaseOrders/existing'), id: 'existing', projectId: 'P' },
      companySettings: { companyName: 'Company' }, companyLogoPath: 'logos/stored.png',
      recipientEmail: 'vendor@example.com', ccEmails: ['copy@example.com'],
    }) },
    admin: {
      auth: () => f.auth,
      storage: () => ({ bucket: () => bucket }),
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => new Date('2026-10-19T00:00:00Z') } }),
    },
    Resend: class { constructor() { this.emails = {
      send: async (email, options) => {
        providerCalls.push({ email, options, attemptOnPO: f.docs.get('projects/P/purchaseOrders/existing').legacySendAttemptId });
        if (state.providerError) throw state.providerError;
        const response = providerResult ? providerResult() : { data: { id: 'resend-1' }, error: null };
        await afterProvider?.(f);
        return response;
      },
      get: async () => ({ data: { created_at: '2026-10-18T18:30:00.000Z' } }),
    }; } },
    buildPOEmailData: (purchaseOrder, settings, to, cc, pdfBuffer) => (emailBuilds.push([purchaseOrder, settings, to, cc]), { from: 'info@example.test', to, cc, subject: purchaseOrder.poNumber,
      html: '<p>PO</p>', attachments: [{ content: pdfBuffer.toString('base64'), filename: `${purchaseOrder.poNumber}.pdf`, type: 'application/pdf' }] }),
    generatePOPDFHandler: render || (async () => {
      files.set('generated/po.pdf', Buffer.from('%PDF-original-bytes'));
      await afterRender?.(f);
      return { storagePath: 'generated/po.pdf', pdfUrl: 'https://example.test/generated.pdf', size: 19 };
    }),
  };
  vm.runInNewContext(wiringSource, context);
  const send = () => context.exports.sendPurchaseOrder({ auth: { uid: 'admin' }, rawRequest: { get: () => 'Bearer test' },
    data: { purchaseOrder: { id: 'existing', projectId: 'P' }, recipientEmail: 'vendor@example.com' } });
  return { f, context, send, files, providerCalls, emailBuilds, state, po: () => f.docs.get('projects/P/purchaseOrders/existing') };
}

const attemptRecords = f => [...f.docs.keys()].filter(path => path.startsWith('pulseLegacyPOSendAttempts/P/attempts/'));

test('index.js exports the four recoverable legacy PO callables with their original server options', () => {
  const h = harness();
  for (const name of ['legacyMarkPurchaseOrderSent', 'recoverStaleLegacyPOSend', 'recoverAcceptedLegacyPOSend', 'retryUncertainLegacyPOSend']) {
    assert.equal(typeof h.context.exports[name], 'function', name);
  }
  assert.match(wiringSource, /exports\.retryUncertainLegacyPOSend = onCall\(\s*\{ region: 'us-central1', timeoutSeconds: 540, maxInstances: 5, secrets: \[resendApiKey\] \}/);
  assert.match(wiringSource, /exports\.recoverStaleLegacyPOSend = onCall\(\s*\{ region: 'us-central1', timeoutSeconds: 30, maxInstances: 5 \}/);
  assert.match(wiringSource, /exports\.recoverAcceptedLegacyPOSend = onCall\(\s*\{ region: 'us-central1', timeoutSeconds: 60, maxInstances: 5 \}/);
  assert.match(wiringSource, /exports\.legacyMarkPurchaseOrderSent = onCall\(\s*\{ region: 'us-central1', timeoutSeconds: 30, maxInstances: 5 \}/);
  assert.match(wiringSource, /exports\.sendPurchaseOrder = onCall\(\s*\{ secrets: \[resendApiKey\], timeoutSeconds: 540 \}/);
});

test('the send callable never writes sent state directly or sends without the stored idempotency key', () => {
  const sendSource = wiringSource.slice(0, wiringSource.indexOf('exports.legacyMarkPurchaseOrderSent'));
  assert.doesNotMatch(sendSource, /status:\s*'sent'/);
  assert.doesNotMatch(sendSource, /collection\('projectDocuments'\)\.add\(/);
  assert.match(sendSource, /idempotencyKey:\s*attemptId/);
  assert.match(sendSource, /authorizeLegacyPOSend/);
  assert.match(sendSource, /beginLegacyPOSendDispatch/);
  assert.match(sendSource, /finalizeLegacyPOEmail/);
});

test('an accepted legacy email is reserved, frozen, dispatched once with the stored key, and finalized atomically', async () => {
  const h = harness();
  const result = await h.send();
  assert.equal(h.providerCalls.length, 1);
  const call = h.providerCalls[0];
  assert.equal(call.options.idempotencyKey, call.attemptOnPO);
  assert.match(call.attemptOnPO, /^[0-9a-f-]{36}$/);
  const frozenPath = `purchase-orders/P/legacy-send-attempts/${call.attemptOnPO}.pdf`;
  assert.equal(h.files.get(frozenPath).toString(), '%PDF-original-bytes');
  assert.equal(result.success, true);
  assert.equal(result.message, 'Purchase Order PO-EX sent to vendor@example.com');
  assert.match(result.pdfUrl, /legacy-send-attempts/);
  assert.equal(typeof result.acceptedAt, 'string');
  assert.match(result.actualSentDate, /^\d{4}-\d{2}-\d{2}$/);
  const po = h.po();
  assert.equal(po.status, 'sent');
  assert.equal(po.legacySendAttemptId, null);
  assert.equal(po.pdfUrl, result.pdfUrl);
  assert.equal(po.actualSentDate, result.actualSentDate);
  const item = h.f.docs.get('projects/P/bom/data').categories[0].items[0];
  assert.equal(item.status, 'ordered');
  assert.equal(item.orderDate, result.actualSentDate);
  assert.equal(item.expectedArrival, '2026-11-20');
  const documents = [...h.f.docs.entries()].filter(([path]) => path.startsWith('projectDocuments/'));
  assert.equal(documents.length, 1);
  assert.equal(documents[0][1].url, result.pdfUrl);
  assert.deepEqual(attemptRecords(h.f), []);
  assert.equal(h.files.has(frozenPath), true, 'the exact sent bytes are retained');
});

test('an unconfirmed provider outcome keeps the PO locked with a verified frozen retry payload and no duplicate send', async () => {
  const h = harness();
  h.state.providerError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition' && /could not be confirmed/i.test(error.message));
  const po = h.po();
  assert.equal(po.status, 'pending-approval');
  assert.equal(po.legacySendPhase, 'uncertain');
  assert.equal(po.legacySendRetryPayloadReady, true);
  const [attemptPath] = attemptRecords(h.f);
  const record = h.f.docs.get(attemptPath);
  const bytes = h.files.get(record.pdfStoragePath);
  assert.equal(record.pdfSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(record.pdfFileSize, bytes.length);
  await assert.rejects(h.send(), error => /already in progress|cannot be sent/i.test(error.message));
  assert.equal(h.providerCalls.length, 1);
});

test('a provider response without an email id is treated as uncertain, not as success', async () => {
  const h = harness({ providerResult: () => ({ data: {}, error: null }) });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition');
  assert.equal(h.po().status, 'pending-approval');
  assert.equal(h.po().legacySendPhase, 'uncertain');
});

test('a definitive provider rejection releases the reservation, audits it, and removes retry-only objects', async () => {
  const h = harness({ providerResult: () => ({ data: null, error: { name: 'validation_error', message: 'bad recipient' } }) });
  await assert.rejects(h.send(), error => error.code === 'invalid-argument');
  const po = h.po();
  assert.equal(po.legacySendAttemptId, null);
  assert.equal(po.status, 'pending-approval');
  assert.deepEqual(attemptRecords(h.f), []);
  assert.equal([...h.files.keys()].some(path => path.includes('legacy-send-attempts')), false);
  assert.equal([...h.f.docs.keys()].some(path => path.endsWith('-legacy-email-rejected')), true);
});

test('accepted-but-unfinalized sends stay locked for reconciliation when the cutover marker appears during the provider call', async () => {
  const h = harness({ afterProvider: async f => { f.docs.set('pulseMaterialCutovers/P', { fence: 'legacy_bom_data_writes', version: 1 }); } });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition' && /accepted/i.test(error.message));
  const po = h.po();
  assert.equal(po.status, 'pending-approval');
  assert.match(po.legacySendPhase, /provider_accepted|needs_reconciliation/);
  assert.equal(po.legacySendProviderId, 'resend-1');
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.f.docs.get('projects/P/bom/data').categories[0].items[0].status, undefined);
});

test('legacy send is refused before any PDF or provider work once the project has a cutover marker', async () => {
  let rendered = 0;
  const h = harness({ render: async () => { rendered++; } });
  h.f.docs.set('pulseMaterialCutovers/P', { fence: 'legacy_bom_data_writes', version: 1 });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition');
  assert.equal(rendered, 0);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.po().legacySendAttemptId, undefined);
});

test('a cutover marker created between reservation and dispatch blocks the provider call and clears the reservation', async () => {
  const h = harness({ afterRender: async f => { f.docs.set('pulseMaterialCutovers/P', { fence: 'legacy_bom_data_writes', version: 1 }); } });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition');
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.po().legacySendAttemptId, null);
  assert.equal([...h.f.docs.keys()].some(path => path.startsWith('pulseLegacyPOSendRecoveries/P/operations/')), true);
});

test('wired recovery, retry and manual-mark callables all refuse to mutate a legacy PO after cutover', async () => {
  const h = harness();
  const po = h.po();
  Object.assign(po, { legacySendAttemptId: 'attempt-1', legacySendPhase: 'preparing', legacySendPreparingAt: new Date('2026-01-01T00:00:00Z') });
  h.f.docs.set('pulseMaterialCutovers/P', { fence: 'legacy_bom_data_writes', version: 1 });
  const request = data => ({ auth: { uid: 'admin' }, rawRequest: { get: () => 'Bearer test' }, data });
  const identity = { project_id: 'P', po_id: 'existing', attempt_id: 'attempt-1' };
  assert.deepEqual(await h.context.exports.recoverStaleLegacyPOSend(request({ operation: 'release_stale_preparing', ...identity })), { ok: false, error: 'material_cutover_required' });
  assert.deepEqual(await h.context.exports.retryUncertainLegacyPOSend(request(identity)), { ok: false, error: 'material_cutover_required' });
  assert.equal((await h.context.exports.legacyMarkPurchaseOrderSent(request({ project_id: 'P', po_id: 'existing', operation_id: 'op-1',
    expected_actor_uid: 'admin', actual_sent_date: '2026-10-17', sent_to_email: 'vendor@example.com' }))).error, 'material_cutover_required');
  assert.equal(po.legacySendAttemptId, 'attempt-1');
  assert.equal(po.status, 'pending-approval');
});

test('caller-supplied PO, company, recipient and PDF snapshots are never rendered, emailed or persisted', async () => {
  const rendered = [];
  const h = harness({ render: async request => { rendered.push(request.data); h.files.set('generated/po.pdf', Buffer.from('%PDF-stored')); return { storagePath: 'generated/po.pdf', pdfUrl: 'https://example.test/g.pdf', size: 11 }; } });
  const result = await h.context.exports.sendPurchaseOrder({ auth: { uid: 'admin' }, rawRequest: { get: () => 'Bearer test' }, data: {
    purchaseOrder: { id: 'existing', projectId: 'P', poNumber: 'CALLER-FORGED', status: 'sent' },
    companySettings: { companyName: 'Caller Company' }, recipientEmail: 'vendor@example.com', pdfUrl: 'https://attacker.example/forged.pdf',
  } });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].purchaseOrder.poNumber, 'PO-EX');
  assert.equal(rendered[0].purchaseOrder.status, 'pending-approval');
  assert.equal(rendered[0].companySettings.companyName, 'Company');
  assert.equal(rendered[0].companyLogoPath, 'logos/stored.png');
  assert.equal(h.emailBuilds[0][0].poNumber, 'PO-EX');
  assert.equal(h.emailBuilds[0][1].companyName, 'Company');
  assert.equal(h.emailBuilds[0][2], 'vendor@example.com');
  assert.equal(h.providerCalls[0].email.to, 'vendor@example.com');
  assert.equal(h.providerCalls[0].email.subject, 'PO-EX');
  const [[, document]] = [...h.f.docs.entries()].filter(([path]) => path.startsWith('projectDocuments/'));
  assert.equal(document.uploadedBy, 'admin');
  assert.deepEqual(document.linkedBOMItems, ['bolt']);
  assert.equal(h.po().sentBy, 'admin');
  assert.equal(h.po().sentToEmail, 'vendor@example.com');
  assert.deepEqual(h.providerCalls[0].email.cc, ['copy@example.com']);
  assert.doesNotMatch(result.pdfUrl, /attacker/);
  assert.equal(h.po().pdfUrl, result.pdfUrl);
  assert.equal(h.po().poNumber, 'PO-EX');
});

test('a definitive-rejection cleanup that loses a race keeps the private retry PDF and attempt record', async () => {
  const h = harness({
    providerResult: () => ({ data: null, error: { name: 'validation_error', message: 'bad recipient' } }),
    // A concurrent retry recorded provider evidence before this callable could release the reservation.
    afterProvider: async f => { f.docs.get('projects/P/purchaseOrders/existing').legacySendProviderId = 'resend-from-retry'; },
  });
  await assert.rejects(h.send());
  const po = h.po();
  assert.equal(typeof po.legacySendAttemptId, 'string');
  assert.equal(po.legacySendProviderId, 'resend-from-retry');
  assert.equal(attemptRecords(h.f).length, 1);
  assert.equal([...h.files.keys()].some(path => path.includes('legacy-send-attempts')), true);
  assert.equal([...h.f.docs.keys()].some(path => path.endsWith('-legacy-email-rejected')), false);
});

test('an admin demoted during PDF work is rejected before the provider and the reservation is cleaned up', async () => {
  const h = harness({ afterRender: async f => { f.users.get('admin').customClaims.role = 'viewer'; } });
  await assert.rejects(h.send(), error => error.code === 'permission-denied');
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.po().legacySendAttemptId, null);
  assert.equal(h.po().status, 'pending-approval');
  assert.deepEqual(attemptRecords(h.f), []);
});

test('an admin disabled during PDF work cannot dispatch', async () => {
  const h = harness({ afterRender: async f => { f.users.get('admin').disabled = true; } });
  await assert.rejects(h.send(), error => error.code === 'permission-denied');
  assert.equal(h.providerCalls.length, 0);
});

test('an admin revoked after provider acceptance cannot finalize; the accepted send stays locked for another admin to recover', async () => {
  const h = harness({ afterProvider: async f => { f.users.get('admin').customClaims.role = 'viewer'; } });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition' && /accepted/i.test(error.message));
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.po().status, 'pending-approval');
  assert.equal(h.po().legacySendProviderId, 'resend-1');
  assert.match(h.po().legacySendPhase, /provider_accepted|needs_reconciliation/);
  assert.equal(h.f.docs.get('projects/P/bom/data').categories[0].items[0].status, undefined);
});

test('an admin revoked while the dispatch transaction reads yields zero provider calls and a released reservation', async () => {
  const h = harness({ onRead: (path, users) => { if (path.startsWith('pulseLegacyPOSendAttempts/')) users.get('admin').customClaims.role = 'viewer'; } });
  await assert.rejects(h.send(), error => error.code === 'permission-denied');
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.po().legacySendAttemptId, null);
  assert.deepEqual(attemptRecords(h.f), []);
  assert.equal([...h.files.keys()].some(path => path.includes('legacy-send-attempts')), false);
});

test('an admin revoked while the finalization transaction reads cannot write the PO or BOM; acceptance stays locked', async () => {
  const h = harness({ onRead: (path, users, _docs, calls) => { if (calls.length && path === 'projects/P/bom/data') users.get('admin').customClaims.role = 'viewer'; } });
  await assert.rejects(h.send(), error => error.code === 'failed-precondition' && /accepted/i.test(error.message));
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.po().status, 'pending-approval');
  assert.equal(h.po().legacySendProviderId, 'resend-1');
  assert.equal(h.f.docs.get('projects/P/bom/data').categories[0].items[0].status, undefined);
  assert.equal([...h.f.docs.keys()].some(path => path.startsWith('projectDocuments/')), false);
});
