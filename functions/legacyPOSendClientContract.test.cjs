const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { assertLegacyPOSendClientContract, LEGACY_PO_SEND_CLIENT_VERSION } = require('./legacyPOSendClientContract.cjs');

const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

test('the contract version is exactly 1', () => {
  assert.equal(LEGACY_PO_SEND_CLIENT_VERSION, 1);
});

test('accepts only the exact numeric marker 1', () => {
  assert.doesNotThrow(() => assertLegacyPOSendClientContract({ serverMaterialFinalizationVersion: 1 }));
});

for (const [label, data] of [
  ['absent data', undefined], ['null data', null], ['missing marker (cached old client)', { recipientEmail: 'a@b.c' }],
  ['zero', { serverMaterialFinalizationVersion: 0 }], ['string "1"', { serverMaterialFinalizationVersion: '1' }],
  ['true', { serverMaterialFinalizationVersion: true }], ['future version 2', { serverMaterialFinalizationVersion: 2 }],
  ['null marker', { serverMaterialFinalizationVersion: null }], ['array', { serverMaterialFinalizationVersion: [1] }],
]) {
  test(`rejects ${label} with an actionable failed-precondition reload message`, () => {
    assert.throws(() => assertLegacyPOSendClientContract(data), error => {
      assert.equal(error.code, 'failed-precondition');
      assert.match(error.message, /reload/i);
      assert.match(error.message, /not sent/i);
      return true;
    });
  });
}

function wiring({ data, access = 'ok' }) {
  const start = source.indexOf('const { authorizeLegacyPOSend');
  const end = source.indexOf('// ==================== SUPPORT TICKET COMMUNICATIONS', start);
  const calls = [];
  const touch = name => () => { calls.push(name); throw Object.assign(new Error(`${name} reached`), { code: 'test-stop' }); };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const context = {
    exports: {}, require, onCall: (_o, handler) => handler, resendApiKey: 'secret', process: { env: {} },
    procurementEnabled: () => false,
    legacyPoAccess: { prepareSend: async () => { calls.push('prepareSend'); throw Object.assign(new Error('denied'), { code: 'permission-denied' }); } },
    functions: { https: { HttpsError } }, logger: { info() {}, warn() {}, error() {} },
    admin: {
      auth: () => ({ getUser: touch('auth.getUser') }), storage: () => ({ bucket: touch('storage.bucket') }),
      firestore: Object.assign(() => ({ collection: touch('firestore.collection'), runTransaction: touch('firestore.runTransaction') }),
        { FieldValue: { serverTimestamp: () => 'ts' } }),
    },
    Resend: class { constructor() { calls.push('provider'); } }, getResendApiKey: () => 'secret',
    buildPOEmailData: touch('email'), generatePOPDFHandler: touch('pdf'),
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { calls, run: () => context.exports.sendPurchaseOrder({ auth: { uid: 'admin' }, data }) };
}

for (const [label, data] of [
  ['no marker', { purchaseOrder: { id: 'po', projectId: 'p' }, recipientEmail: 'v@x.com' }],
  ['wrong marker', { purchaseOrder: { id: 'po', projectId: 'p' }, serverMaterialFinalizationVersion: 2 }],
  ['no data', undefined],
]) {
  test(`sendPurchaseOrder rejects ${label} before access/auth, reservation, PDF or provider`, async () => {
    const h = wiring({ data });
    await assert.rejects(h.run(), error => error.code === 'failed-precondition' && /reload/i.test(error.message));
    assert.deepEqual(h.calls, []);
  });
}

test('with the marker, the authoritative access check still runs and can deny', async () => {
  const h = wiring({ data: { purchaseOrder: { id: 'po', projectId: 'p' }, serverMaterialFinalizationVersion: 1 } });
  await assert.rejects(h.run(), error => error.code === 'permission-denied');
  assert.deepEqual(h.calls, ['prepareSend']);
});
