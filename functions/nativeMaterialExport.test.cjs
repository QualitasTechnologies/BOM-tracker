const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
const start = source.indexOf('// Reused BOM UI uses its real Firebase session;');

test('actual callable export requires both explicit mutation flags and no machine secret', () => {
  assert.notEqual(start, -1);
  for (const [env, expected] of [
    [{}, false], [{ BOM_MATERIAL_MUTATIONS_ENABLED: 'true' }, false],
    [{ BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' }, false],
    [{ BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' }, true]
  ]) {
    let engine, config;
    const context = { exports: {}, process: { env }, admin: { firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'server-time' } }), auth: () => 'auth' },
      require: name => { assert.equal(name, './nativeMaterialOperations.cjs'); return { createNativeMaterialOperations: options => { engine = options; return 'handler'; } }; },
      onCall: (options, handler) => { config = options; assert.equal(handler, 'handler'); return 'callable'; }
    };
    vm.runInNewContext(source.slice(start, source.indexOf('// Durable native PO recovery', start)), context);
    assert.equal(context.exports.nativeMaterialOperations, 'callable');
    assert.equal(engine.mutationsEnabled(), expected);
    assert.equal(engine.getServerTimestamp(), 'server-time');
    assert.equal(config.secrets, undefined);
  }
});

test('actual callable export pins explicit small runtime options for this target only', () => {
  const end = source.indexOf('// Durable native PO recovery', start);
  const configs = [];
  const context = { exports: {}, process: { env: {} }, admin: { firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 't' } }), auth: () => 'auth' },
    require: () => ({ createNativeMaterialOperations: () => 'handler' }), onCall: options => { configs.push(options); return 'callable'; } };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(configs.length, 1);
  assert.deepEqual({ ...configs[0] }, { region: 'us-central1', timeoutSeconds: 30, maxInstances: 5, memory: '256MiB', concurrency: 1 });
  // Neighbouring upload/procurement/project targets keep their own separately reviewed options.
  assert.doesNotMatch(source.slice(source.indexOf('// Native receipt photos')), /nativeUploadOperations = onCall\(\s*\{[^}]*concurrency/);
});
