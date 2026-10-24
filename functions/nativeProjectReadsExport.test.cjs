const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('scoped reads bind the real backend, private cursor key and independent default-off gate', async () => {
  const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
  const start = source.indexOf('// Authorized original-screen reads.');
  assert.ok(start >= 0);
  const key = Buffer.alloc(32, 7).toString('base64url');
  let keyReads = 0, config;
  const secret = { value: () => { keyReads++; return key; } };
  const actor = { uid: 'alice', email: 'alice@example.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } };
  const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => actor };
  const project = { projectId: 'P', memberIds: ['alice'], projectName: 'Build' };
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => project, updateTime: { seconds: 1, nanoseconds: 0 } }) }) };
  const context = { exports: {}, process: { env: {} }, require,
    defineSecret: name => { assert.equal(name, 'BOM_PROJECT_READ_CURSOR_KEY'); return secret; },
    admin: { auth: () => auth, firestore: () => db, storage: () => ({ bucket: () => ({ name: 'test' }) }) },
    onCall: (settings, handler) => { config = settings; return handler; },
  };
  vm.runInNewContext(source.slice(start), context);
  assert.equal(config.region, 'us-central1'); assert.equal(config.secrets.length, 1); assert.equal(config.secrets[0], secret);
  const request = { auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic' }, data: { operation: 'get', project_id: 'P' } };
  assert.equal((await context.exports.nativeProjectReads(request)).error, 'project_reads_disabled'); assert.equal(keyReads, 0);
  context.process.env.BOM_MATERIAL_MUTATIONS_ENABLED = 'true';
  context.process.env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED = 'true';
  assert.equal((await context.exports.nativeProjectReads(request)).error, 'project_reads_disabled');
  context.process.env.BOM_SCOPED_READS_ENABLED = 'true';
  const result = await context.exports.nativeProjectReads(request);
  assert.equal(result.ok, true); assert.equal(result.project.projectName, 'Build'); assert.equal(result.actor_uid, 'alice'); assert.equal(keyReads, 1);
  context.process.env.BOM_SCOPED_READS_ENABLED = 'false';
  assert.equal((await context.exports.nativeProjectReads(request)).error, 'project_reads_disabled');
});
