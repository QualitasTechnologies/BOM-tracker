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
  const start = source.indexOf('const { authorizeLegacyPOSend');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  const denied = Object.assign(new Error('fresh admin required'), { code: 'permission-denied' });
  let sideEffects = 0;
  const context = {
    exports: { generatePOPDF: { run: async () => { sideEffects++; return { storagePath: 'po.pdf', pdfUrl: 'url' }; } } },
    require,
    onCall: (_options, callback) => callback,
    resendApiKey: 'secret',
    process: { env: {} },
    procurementEnabled: () => false,
    legacyPoAccess: { prepareSend: async () => { throw denied; } },
    functions: { https: { HttpsError: class extends Error {} } },
    logger: { info() {}, error() {} },
    admin: {
      auth: () => ({}),
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
  const start = source.indexOf('const { authorizeLegacyPOSend');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  let sideEffects = 0;
  let receivedOptions;
  const context = {
    exports: { generatePOPDF: { run: async () => { sideEffects++; return { storagePath: 'po.pdf', pdfUrl: 'url' }; } } },
    require,
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
    admin: { auth: () => ({}), firestore: () => ({}), storage: () => ({ bucket: () => ({ file: () => ({ download: async () => { sideEffects++; return [Buffer.from('pdf')]; } }) }) }) },
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
