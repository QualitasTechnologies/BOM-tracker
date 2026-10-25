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
    let engine, config, notificationEngine, notificationConfig;
    const context = { exports: {}, process: { env }, admin: { auth: () => 'auth', firestore: Object.assign(() => 'db', { FieldValue: { serverTimestamp: () => 'time', delete: () => 'delete' } }) },
      require: name => {
        if (name === './nativeProjectOperations.cjs') return { ...require(name), createNativeProjectOperations: args => { engine = args; return 'project-handler'; } };
        assert.equal(name, './projectMemberNotifications.cjs');
        return { createProjectMemberNotifications: args => { notificationEngine = args; return 'notification-handler'; } };
      },
      onCall: (args, handler) => {
        if (handler === 'project-handler') { config = args; return 'project-callable'; }
        notificationConfig = args; return 'notification-callable';
      },
    };
    const end = source.indexOf('// Native receipt photos', start);
    vm.runInNewContext(source.slice(start, end < 0 ? undefined : end), context);
    assert.equal(context.exports.nativeProjectOperations, 'project-callable'); assert.equal(engine.auth, 'auth');
    assert.equal(engine.enabled(), expected); assert.equal(engine.getDeleteField(), 'delete'); assert.equal(config.secrets, undefined);
    assert.equal(engine.supportProfileEnabled(), false);
    env.BOM_NATIVE_SUPPORT_PROFILE_ENABLED='true';assert.equal(engine.supportProfileEnabled(),expected);
    env.BOM_NATIVE_SUPPORT_PROFILE_ENABLED='false';assert.equal(engine.supportProfileEnabled(),false);
    assert.equal(context.exports.updateProjectMemberNotifications, 'notification-callable');
    assert.equal(notificationEngine.auth, 'auth'); assert.equal(notificationConfig.secrets, undefined);
  }
});
