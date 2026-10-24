const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativePoRuntime, procurementEnabled } = require('./nativePoRuntime.cjs');

function fixture(rows = {}) {
  const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }), limit: count => ({ path: name, count }) }) };
  const transaction = { get: async ref => ref.count ? { docs: Object.entries(rows).filter(([path]) => path.startsWith(`${ref.path}/`)).map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data })) }
    : { exists: !!rows[ref.path], data: () => rows[ref.path] } };
  const rendered = [], sent = [], built = [];
  const runtime = createNativePoRuntime({ db, bucket: {}, renderPdf: async (...args) => { rendered.push(args); return { path: 'artifact' }; },
    downloadArtifact: async () => Buffer.from('exact bytes'), buildEmail: (...args) => { built.push(args); return { message: 'original' }; },
    createResend: () => ({ emails: { send: async (...args) => { sent.push(args); return { data: { id: 'accepted' }, error: null }; } } }) });
  return { runtime, transaction, rendered, sent, built };
}
test('native send requires every default-off write gate', () => {
  assert.equal(procurementEnabled({}), false);
  assert.equal(procurementEnabled({ BOM_NATIVE_PROCUREMENT_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true' }), false);
  assert.equal(procurementEnabled({ BOM_NATIVE_PROCUREMENT_ENABLED: 'true', BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' }), true);
});
test('billing comes from the stored PO then project, with the original default selection', async () => {
  const f = fixture({ 'settings/company': { companyName: 'Company' }, 'billingEntities/B': { legalName: 'Vendor Legal', displayName: 'Name', isDefault: true, logoPath: 'logos/B' } });
  assert.equal((await f.runtime.resolveBilling({ billingEntityId: 'company' }, { billingEntityId: 'B' }, f.transaction)).companyName, 'Company');
  const billing = await f.runtime.resolveBilling({}, { billingEntityId: 'B' }, f.transaction);
  assert.equal(billing.companyName, 'Vendor Legal'); assert.equal(billing.logoPath, 'logos/B');
  assert.equal((await f.runtime.resolveBilling({}, {}, f.transaction)).companyName, 'Vendor Legal');
  assert.equal(await f.runtime.resolveBilling({ billingEntityId: 'missing' }, {}, f.transaction), null);
  await assert.rejects(f.runtime.resolveBilling({ billingEntityId: '../bad' }, {}, f.transaction));
});
test('original PDF renderer receives frozen server data and an internal attested destination', async () => {
  const f = fixture(); const po = { id: 'PO', projectId: 'P' }, billing = { companyName: 'Company', logoPath: 'logo' };
  const intent = { project_id: 'P', po_id: 'PO', attempt_id: 'one', payload_hash: 'a'.repeat(64), artifact_key: 'private'.repeat(12) };
  await f.runtime.prepareArtifact(po, billing, intent); await f.runtime.prepareArtifact(po, billing, intent);
  assert.deepEqual(f.rendered[0], f.rendered[1]);
  assert.deepEqual(f.rendered[0][0].data, { purchaseOrder: po, companySettings: billing, companyLogoPath: 'logo' });
  assert.match(f.rendered[0][1].path, /^native-purchase-orders\/[a-f0-9]{64}\.pdf$/);
  assert.equal(f.rendered[0][1].key, intent.artifact_key);
});
test('provider uses the original email builder, exact attachment bytes and idempotency option', async () => {
  const f = fixture(); const frozen = { purchaseOrder: { poNumber: 'PO-1' }, companySettings: { companyName: 'Company' }, recipientEmail: 'vendor@example.com', ccEmails: ['admin@example.com'], artifact: {} };
  assert.deepEqual(await f.runtime.sendEmail(frozen, 'stable-key'), { id: 'accepted' });
  assert.deepEqual(f.sent[0], [{ message: 'original' }, { idempotencyKey: 'stable-key' }]);
  assert.deepEqual(f.built[0], [frozen.purchaseOrder, frozen.companySettings, frozen.recipientEmail, frozen.ccEmails, Buffer.from('exact bytes')]);
});
test('Resend errors and missing acknowledgments cannot be reported as accepted', async () => {
  for (const result of [{ error: { message: 'rejected' }, data: null }, { data: {}, error: null }]) {
    const f = createNativePoRuntime({ db: {}, bucket: {}, downloadArtifact: async () => Buffer.from('pdf'), buildEmail: () => ({}), createResend: () => ({ emails: { send: async () => result } }) });
    await assert.rejects(f.sendEmail({ artifact: {} }, 'key'));
  }
});
