const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
test('actual project callable keeps all three gates off by default and uses native identity without a service secret', () => {
  const start = source.indexOf('// Native project metadata'); assert.ok(start >= 0);
  for (const [env, expected] of [[{}, false], [{ BOM_NATIVE_PROJECT_MUTATIONS_ENABLED: 'true' }, false],
    [{ BOM_NATIVE_PROJECT_MUTATIONS_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true' }, false],
    [{ BOM_NATIVE_PROJECT_MUTATIONS_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' }, true]]) {
    let engine, config;
    const context = { exports: {}, process: { env }, admin: { auth: () => 'auth', firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'time', delete: () => 'delete' } }) },
      require: name => { assert.equal(name, './nativeProjectOperations.cjs'); return { ...require(name), createNativeProjectOperations: args => { engine = args; return 'handler'; } }; },
      onCall: (args, handler) => { config = args; assert.equal(handler, 'handler'); return 'callable'; },
    };
    const end = source.indexOf('// Native receipt photos', start);
    vm.runInNewContext(source.slice(start, end < 0 ? undefined : end), context);
    assert.equal(context.exports.nativeProjectOperations, 'callable'); assert.equal(engine.auth, 'auth');
    assert.equal(engine.enabled(), expected); assert.equal(engine.getDeleteField(), 'delete'); assert.equal(config.secrets, undefined);
  }
});
