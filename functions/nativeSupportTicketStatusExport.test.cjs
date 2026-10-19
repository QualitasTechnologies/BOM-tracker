const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

test('Support ticket status callable is provider-free and strictly default-off behind all three gates', () => {
  let options, config;
  const context = {
    exports: {}, process: { env: {} },
    admin: { auth: () => ({}), firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } }) },
    require: () => ({
      supportTicketStatusEnabled: env => ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED'].every(key => env[key] === 'true'),
      createNativeSupportTicketStatus: value => { options = value; return 'handler'; },
    }),
    onCall: (settings, handler) => { config = settings; return handler; },
  };
  const start = source.indexOf('// Native Support ticket status changes');
  const end = source.indexOf('// Native Support ticket assignment', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(context.exports.nativeSupportTicketStatus, 'handler');
  assert.equal(config.region, 'us-central1');
  assert.equal(config.secrets, undefined);
  assert.equal(options.enabled(), false);
  const env = context.process.env;
  env.BOM_MATERIAL_MUTATIONS_ENABLED = 'true';
  env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED = 'true';
  assert.equal(options.enabled(), false);
  env.BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED = 'true';
  assert.equal(options.enabled(), true);
  env.BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED = 'TRUE';
  assert.equal(options.enabled(), false);
});
