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
