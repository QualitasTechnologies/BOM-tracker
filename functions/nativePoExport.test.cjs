const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

test('native PDF path uses the original renderer, cached artifact and no legacy overwrite', async () => {
  const start = source.indexOf('async function generatePOPDFHandler(');
  const end = source.indexOf('exports.generatePOPDF = onCall(', start);
  assert.ok(start >= 0 && end > start, 'original renderer must have a server-only internal entry');
  let writes = 0, cached = null;
  const context = { Buffer, PDFDocument: require('pdfkit'), createLegacyPoAccess: () => ({ preparePreview() {}, prepareSend() {} }), logger: { info() {}, error() {}, warn() {} },
    functions: { https: { HttpsError: Error } }, admin: { storage: () => ({ bucket: () => ({ file: () => { throw Error('legacy upload called'); } }) }) },
    formatDateSafe: () => '14/10/2026', formatIndianCurrency: n => String(n), numberToWords: () => 'Two rupees',
    readNativePoArtifact: async () => cached,
    writeNativePoArtifact: async (_bucket, target, bytes) => { writes++; assert.ok(bytes.subarray(0, 4).equals(Buffer.from('%PDF'))); return cached = { path: target.path, generation: '1', size: bytes.length }; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const request = { data: { purchaseOrder: { projectId: 'P', poNumber: 'PO-1', items: [{ itemName: 'Bolt', quantity: 1, unitPrice: 2, totalPrice: 2 }], totalAmount: 2 }, companySettings: { companyName: 'Company' } } };
  const first = await context.generatePOPDFHandler(request, { path: 'native-path' });
  assert.equal(first.path, 'native-path'); assert.equal(writes, 1);
  assert.deepEqual(await context.generatePOPDFHandler(request, { path: 'native-path' }), first);
  assert.equal(writes, 1);
});
test('actual native callable wires current identity, secret and all three gates', () => {
  const start = source.indexOf('// Durable native PO recovery'); assert.ok(start >= 0);
  let options, config;
  const context = { exports: {}, process: { env: {} }, resendApiKey: 'secret', Resend: class {}, getResendApiKey: () => 'secret-value',
    generatePOPDFHandler() {}, buildPOEmailData() {}, admin: { storage: () => ({ bucket: () => 'bucket' }), auth: () => 'auth',
      firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'timestamp' } }) },
    require: name => name === './nativeProcurementOperations.cjs' ? { createNativeProcurementOperations: args => { options = args; return 'handler'; } } : require(name),
    onCall: (args, handler) => { assert.equal(handler, 'handler'); config = args; return 'callable'; },
  };
  vm.runInNewContext(source.slice(start, source.indexOf('// Native project metadata', start)), context);
  assert.equal(context.exports.nativeProcurementOperations, 'callable');
  assert.equal(options.auth, 'auth'); assert.equal(options.enabled(), false);
  context.process.env = { BOM_NATIVE_PROCUREMENT_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true' };
  assert.equal(options.enabled(), true); assert.equal(config.secrets[0], 'secret');
});
test('the public PDF callable cannot choose the internal artifact destination', async () => {
  const start = source.indexOf('exports.generatePOPDF = onCall('), end = source.indexOf('\nfunction buildPOEmailData', start);
  const calls = [];
  const context = { exports: {}, onCall: callback => callback,
    legacyPoAccess: { preparePreview: async request => { calls.push(['access', request]); return { po: { id: 'stored-po' } }; } },
    generatePOPDFHandler: (...args) => { calls.push(['render', ...args]); return 'legacy'; } };
  vm.runInNewContext(source.slice(start, end), context);
  const request = { data: { immutableTarget: { path: 'forged-native-path' } } };
  assert.equal(await context.exports.generatePOPDF(request), 'legacy');
  assert.deepEqual(calls[0], ['access', request]);
  assert.deepEqual(calls[1][1].data.purchaseOrder, { id: 'stored-po' });
});
test('the shared original email builder preserves recipients, PO details and exact attachment bytes', () => {
  const start = source.indexOf('function buildPOEmailData('), end = source.indexOf('\n/**', start);
  const context = { formatDateSafe: () => '14/10/2026', formatIndianCurrency: () => 'Rs. 2' };
  vm.runInNewContext(source.slice(start, end), context);
  const bytes = Buffer.from('exact attachment');
  const result = context.buildPOEmailData({ poNumber: 'PO-1', vendorName: 'Vendor', items: [{}], totalAmount: 2 }, { companyName: 'Company' }, 'vendor@example.com', ['admin@example.com'], bytes);
  assert.equal(result.to, 'vendor@example.com'); assert.equal(result.cc[0], 'admin@example.com');
  assert.equal(result.subject, 'Purchase Order PO-1 - Company'); assert.ok(result.html.includes('Dear Vendor'));
  assert.equal(result.attachments[0].content, bytes.toString('base64')); assert.equal(result.attachments[0].filename, 'PO-1.pdf');
});
