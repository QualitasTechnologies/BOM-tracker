const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

test('Support ticket resolution callable is provider-free and strictly default-off behind all three gates', () => {
  let options, config;
  const context = {
    exports: {}, process: { env: {} },
    admin: { auth: () => ({}), firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } }) },
    require: () => ({
      supportTicketResolutionEnabled: env => ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SUPPORT_TICKET_RESOLUTION_ENABLED'].every(key => env[key] === 'true'),
      createNativeSupportTicketResolution: value => { options = value; return 'handler'; },
    }),
    onCall: (settings, handler) => { config = settings; return handler; },
  };
  const start = source.indexOf('// Native Support ticket resolution');
  const end = source.indexOf('// Native materials stage', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(context.exports.nativeSupportTicketResolution, 'handler');
  assert.equal(config.region, 'us-central1');
  assert.equal(config.secrets, undefined);
  assert.equal(options.enabled(), false);
  const env = context.process.env;
  env.BOM_MATERIAL_MUTATIONS_ENABLED = 'true';
  env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED = 'true';
  assert.equal(options.enabled(), false);
  env.BOM_NATIVE_SUPPORT_TICKET_RESOLUTION_ENABLED = 'true';
  assert.equal(options.enabled(), true);
  env.BOM_NATIVE_SUPPORT_TICKET_RESOLUTION_ENABLED = 'TRUE';
  assert.equal(options.enabled(), false);
});
