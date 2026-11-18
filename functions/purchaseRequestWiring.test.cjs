const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const text = fs.readFileSync(__dirname + '/index.js', 'utf8');
const start = text.search(
  /const \{\s*createPurchaseRequestOperations\s*,?\s*\}/
);
assert.ok(start >= 0, 'the callable must be wired to the checked factory');
const source = text.slice(
  start,
  text.indexOf('// ==================== EXPENSE APPROVAL NOTIFICATIONS', start)
);
function fixture(response = { data: { id: 'provider-id' } }) {
  let sends = 0;
  const user = {
    uid: 'U',
    email: 'u@example.com',
    emailVerified: true,
    customClaims: { role: 'user', status: 'pending' },
  };
  const ctx = vm.createContext({
    require,
    AbortSignal,
    Resend: class {
      constructor() {
        this.emails = {
          send: async () => {
            sends++;
            return response;
          },
        };
      }
    },
    getResendApiKey: () => 'fake',
    resendApiKey: 'fake',
    admin: {
      auth: () => ({
        getUser: async () => user,
        verifyIdToken: async () => ({ uid: 'U', email: user.email }),
      }),
      firestore: () => ({ collection: () => ({ doc: () => ({}) }) }),
      storage: () => ({ bucket: () => ({ name: 'fixture.invalid' }) }),
    },
    functions: {
      https: {
        HttpsError: class extends Error {
          constructor(code, message) {
            super(message);
            this.code = code;
          }
        },
      },
    },
    logger: { info() {}, error() {} },
    onCall: (_options, fn) => fn,
    groupItemsByVendor: () => [],
    generatePREmailHTML: () => '<p>Fixture</p>',
    stripHtml: () => 'Fixture',
    exports: {},
  });
  vm.runInContext(source, ctx);
  return {
    call: () =>
      ctx.exports.sendPurchaseRequest({
        auth: { uid: 'U' },
        rawRequest: { get: () => 'Bearer fixture' },
        data: {
          projectDetails: { projectId: 'P', projectName: 'Fixture' },
          categories: [],
          recipients: ['qa@example.com'],
          operation_id: 'fixture',
          expected_actor_uid: 'U',
        },
      }),
    sends: () => sends,
  };
}
test('actual purchase-request entrypoint refuses an unapproved signed-in user before provider access', async () => {
  const f = fixture();
  await assert.rejects(
    () => f.call(),
    (e) => e.code === 'permission-denied' && e.message === 'actor_forbidden'
  );
  assert.equal(f.sends(), 0, 'unapproved user reached the provider');
});
