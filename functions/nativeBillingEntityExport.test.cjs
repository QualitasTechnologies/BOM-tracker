const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
test('Billing callable uses fresh native identity and a server-only exact default-off gate', () => {
  const start = source.indexOf('// Native Billing Settings:'); assert.ok(start >= 0);
  let options, config;
  const context = { exports: {}, process: { env: {} },
    admin: { firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'stamp' } }), auth: () => 'auth', storage: () => ({ bucket: () => ({ name: 'project-bucket' }) }) },
    require: name => { assert.equal(name, './nativeBillingEntityOperations.cjs'); return { createNativeBillingEntityOperations: args => { options = args; return 'handler'; } }; },
    onCall: (args, handler) => { assert.equal(handler, 'handler'); config = args; return 'callable'; },
  };
  vm.runInNewContext(source.slice(start, source.indexOf('// Durable PO approval notifications:', start)), context);
  assert.equal(context.exports.nativeBillingEntityOperations, 'callable'); assert.equal(options.db, 'db'); assert.equal(options.auth, 'auth'); assert.equal(options.bucketName, 'project-bucket');
  assert.equal(config.region, 'us-central1'); assert.equal(options.enabled(), false);
  context.process.env.BOM_NATIVE_BILLING_ENTITY_MUTATIONS_ENABLED = 'true'; assert.equal(options.enabled(), true);
  context.process.env.BOM_NATIVE_BILLING_ENTITY_MUTATIONS_ENABLED = '1'; assert.equal(options.enabled(), false);
});
