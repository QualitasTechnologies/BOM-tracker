const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
const { createLegacyPoAccess } = require('./legacyPoAccess.cjs');

function createRealPreviewAccess() {
  const storedProject = { name: 'Stored project', memberIds: ['member-1'], billingEntityId: 'entity-1' };
  const storedPO = { projectId: 'project-1', poNumber: 'PO-STORED', status: 'draft', items: [{ itemName: 'Stored item' }], billingEntityId: 'entity-1' };
  const storedEntity = { legalName: 'Stored Company', companyAddress: 'Stored Address' };
  const admin = {
    auth: () => ({ getUser: async () => ({ customClaims: { role: 'member', status: 'approved' } }) }),
    firestore: () => ({
      collection: name => ({
        doc: id => ({
          get: async () => {
            const value = name === 'projects' && id === 'project-1'
              ? storedProject
              : name === 'billingEntities' && id === 'entity-1'
                ? storedEntity
                : undefined;
            return { exists: Boolean(value), id, data: () => value };
          },
          collection: child => ({
            doc: childId => ({ get: async () => ({ exists: child === 'purchaseOrders' && childId === 'po-1', id: childId, data: () => storedPO }) }),
          }),
        }),
      }),
    }),
  };
  return createLegacyPoAccess({ admin, functions: { https: { HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } } } });
}

test('public PDF callable maps the real access helper output to the renderer purchaseOrder contract', async () => {
  const start = source.indexOf('exports.generatePOPDF = onCall(');
  const end = source.indexOf('\nfunction buildPOEmailData', start);
  const calls = [];
  const context = {
    exports: {},
    onCall: callback => callback,
    resendApiKey: 'secret',
    legacyPoAccess: createRealPreviewAccess(),
    generatePOPDFHandler: async request => { calls.push(['render', request]); return 'rendered'; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const request = { auth: { uid: 'member-1' }, data: { purchaseOrder: { id: 'po-1', projectId: 'project-1', poNumber: 'Forged PO' } } };
  assert.equal(await context.exports.generatePOPDF(request), 'rendered');
  assert.deepEqual(calls.map(call => call[0]), ['render']);
  assert.equal(calls[0][1].data.purchaseOrder.poNumber, 'PO-STORED');
  assert.equal(calls[0][1].data.companySettings.companyName, 'Stored Company');
});

test('send callable validates authorization before invoking PDF, provider, or persistence side effects', async () => {
  const start = source.indexOf('exports.sendPurchaseOrder = onCall(');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  const denied = Object.assign(new Error('fresh admin required'), { code: 'permission-denied' });
  let sideEffects = 0;
  const context = {
    exports: { generatePOPDF: { run: async () => { sideEffects++; return { storagePath: 'po.pdf', pdfUrl: 'url' }; } } },
    onCall: (_options, callback) => callback,
    resendApiKey: 'secret',
    process: { env: {} },
    procurementEnabled: () => false,
    legacyPoAccess: { prepareSend: async () => { throw denied; } },
    functions: { https: { HttpsError: class extends Error {} } },
    logger: { info() {}, error() {} },
    admin: {
      storage: () => ({ bucket: () => ({ file: () => ({ download: async () => { sideEffects++; return [Buffer.from('pdf')]; } }) }) }),
      firestore: Object.assign(() => ({
        collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ update: async () => { sideEffects++; } }) }) }) }),
      }), { FieldValue: { serverTimestamp: () => 'timestamp' } }),
    },
    Resend: class { constructor() { this.emails = { send: async () => { sideEffects++; } }; } },
    getResendApiKey: () => 'secret',
    buildPOEmailData: () => ({}),
  };
  vm.runInNewContext(source.slice(start, end), context);
  const callable = context.exports.sendPurchaseOrder;
  await assert.rejects(callable({
    auth: null,
    data: { purchaseOrder: { id: 'po-1', projectId: 'project-1', items: [] }, companySettings: {}, recipientEmail: 'vendor@example.com' },
  }), error => error.code === 'permission-denied');
  assert.equal(sideEffects, 0);
});

test('send callable passes the server-side native procurement gate into the shared legacy guard', async () => {
  const start = source.indexOf('exports.sendPurchaseOrder = onCall(');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  let sideEffects = 0;
  let receivedOptions;
  const context = {
    exports: { generatePOPDF: { run: async () => { sideEffects++; return { storagePath: 'po.pdf', pdfUrl: 'url' }; } } },
    onCall: (_options, callback) => callback,
    resendApiKey: 'secret',
    process: { env: {} },
    procurementEnabled: () => true,
    legacyPoAccess: {
      prepareSend: async (_request, options) => {
        receivedOptions = options;
        if (options?.nativeEnabled) throw Object.assign(new Error('Native procurement is enabled'), { code: 'failed-precondition' });
        return {
          uid: 'admin-1', projectId: 'project-1', po: { id: 'po-1', poNumber: 'PO-1', items: [] },
          companySettings: { companyName: 'Stored Company' }, recipientEmail: 'vendor@example.com', ccEmails: [],
        };
      },
    },
    functions: { https: { HttpsError: class extends Error {} } },
    logger: { info() {}, error() {} },
    admin: { storage: () => ({ bucket: () => ({ file: () => ({ download: async () => { sideEffects++; return [Buffer.from('pdf')]; } }) }) }) },
    Resend: class { constructor() { this.emails = { send: async () => { sideEffects++; } }; } },
    getResendApiKey: () => 'secret',
    buildPOEmailData: () => ({}),
    generatePOPDFHandler: async () => { sideEffects++; return { storagePath: 'po.pdf', pdfUrl: 'url' }; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  await assert.rejects(context.exports.sendPurchaseOrder({ data: {
    purchaseOrder: { id: 'po-1', projectId: 'project-1' }, recipientEmail: 'vendor@example.com',
  } }), error => error.code === 'failed-precondition');
  assert.equal(receivedOptions?.nativeEnabled, true);
  assert.equal(sideEffects, 0);
});

test('valid admin send preserves response contract and uses prepared stored values for all sends and writes', async () => {
  const start = source.indexOf('exports.sendPurchaseOrder = onCall(');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  const storedPO = { id: 'po-1', projectId: 'project-1', poNumber: 'PO-STORED', items: [{ bomItemId: 'bom-1' }] };
  const prepared = {
    uid: 'admin-1', projectId: 'project-1', po: storedPO,
    companySettings: { companyName: 'Stored Company' }, companyLogoPath: 'logos/stored.png',
    recipientEmail: 'vendor@example.com', ccEmails: ['admin@example.com'],
  };
  let builtEmailArgs, providerEmailData, updateData, documentData, renderData;
  const context = {
    exports: {},
    onCall: (_options, callback) => callback,
    resendApiKey: 'secret',
    process: { env: {} },
    procurementEnabled: () => false,
    legacyPoAccess: { prepareSend: async () => prepared },
    functions: { https: { HttpsError: class extends Error {} } },
    logger: { info() {}, error() {} },
    admin: {
      storage: () => ({ bucket: () => ({ file: () => ({ download: async () => [Buffer.from('stored-pdf')] }) }) }),
      firestore: Object.assign(() => ({
        collection: name => name === 'projects'
          ? { doc: projectId => ({ collection: () => ({ doc: poId => ({ update: async data => { updateData = { projectId, poId, data }; } }) }) }) }
          : { add: async data => { documentData = data; return { id: 'document-1' }; } },
      }), { FieldValue: { serverTimestamp: () => 'timestamp' } }),
    },
    Resend: class { constructor() { this.emails = { send: async data => { providerEmailData = data; } }; } },
    getResendApiKey: () => 'secret',
    buildPOEmailData: (...args) => { builtEmailArgs = args; return { to: args[2] }; },
    generatePOPDFHandler: async request => { renderData = request.data; return { storagePath: 'stored.pdf', pdfUrl: 'stored-url', size: 42 }; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const result = await context.exports.sendPurchaseOrder({ data: {
    purchaseOrder: { ...storedPO, poNumber: 'CALLER-FORGED' },
    companySettings: { companyName: 'Caller Company' }, recipientEmail: 'caller@example.com',
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, message: 'Purchase Order PO-STORED sent to vendor@example.com', pdfUrl: 'stored-url' });
  assert.equal(renderData.purchaseOrder.poNumber, 'PO-STORED');
  assert.equal(renderData.companySettings.companyName, 'Stored Company');
  assert.equal(renderData.companyLogoPath, 'logos/stored.png');
  assert.equal(builtEmailArgs[0], storedPO);
  assert.equal(builtEmailArgs[1].companyName, 'Stored Company');
  assert.equal(builtEmailArgs[2], 'vendor@example.com');
  assert.deepEqual(providerEmailData, { to: 'vendor@example.com' });
  assert.deepEqual(JSON.parse(JSON.stringify(updateData)), { projectId: 'project-1', poId: 'po-1', data: {
    status: 'sent', sentAt: 'timestamp', sentBy: 'admin-1', sentToEmail: 'vendor@example.com', pdfUrl: 'stored-url',
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(documentData.linkedBOMItems)), ['bom-1']);
  assert.equal(documentData.uploadedBy, 'admin-1');
});
