const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

test('upload callable uses native dependencies and all three default-off gates', () => {
  const start = source.indexOf('// Native receipt photos'); assert.ok(start >= 0);
  const flags = ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_UPLOADS_ENABLED'];
  for (let mask = 0; mask < 8; mask++) {
    const env = Object.fromEntries(flags.filter((_key, bit) => mask & (1 << bit)).map(key => [key, 'true']));
    let engine, config;
    const context = { exports: {}, process: { env },
      admin: { auth: () => 'auth', storage: () => ({ bucket: () => 'bucket' }), firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'time' } }) },
      require: name => { assert.equal(name, './nativeUploadOperations.cjs'); return { createNativeUploadOperations: dependencies => { engine = dependencies; return 'handler'; } }; },
      onCall: (options, handler) => { config = options; assert.equal(handler, 'handler'); return 'callable'; },
    };
    vm.runInNewContext(source.slice(start), context);
    assert.equal(context.exports.nativeUploadOperations, 'callable');
    assert.equal(engine.enabled(), mask === 7, `gate combination ${mask}`);
    assert.equal(engine.db, 'db'); assert.equal(engine.auth, 'auth'); assert.equal(engine.bucket, 'bucket');
    assert.equal(engine.getServerTimestamp(), 'time'); assert.equal(config.region, 'us-central1');
    assert.equal(config.timeoutSeconds, 60); assert.equal(config.maxInstances, 5); assert.equal(config.secrets, undefined);
    for (const key of flags) { const previous = env[key]; env[key] = 'TRUE'; assert.equal(engine.enabled(), false); if (previous === undefined) delete env[key]; else env[key] = previous; }
  }
});
