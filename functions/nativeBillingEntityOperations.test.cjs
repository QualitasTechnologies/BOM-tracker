const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, copy } = require('./nativeBillingEntityFixture.cjs');
const open = (f, id = 'B') => f.call({ operation: 'get', entity_id: id });
const edit = async (f, patch = { companyAddress: 'New address' }, extra = {}) => {
  const opening = await open(f);
  return f.call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'edit-1', patch, ...extra });
};

test('catalog/open reuse the primary alias, ordering and canonical record identities without mutation', async () => {
  const f = fixture(); f.docs.get('billingEntities/B').id = 'company';
  const before = copy([...f.docs]), page = await f.call({ operation: 'catalog' });
  assert.equal(page.ok, true); assert.equal(page.entities[0].id, 'D');
  assert.equal(page.entities.find(row => row.id === 'B').legalName, 'Legal Entity');
  const primary = await open(f, 'company'); assert.equal(primary.entity.id, 'company'); assert.equal(primary.entity.isActive, true);
  assert.deepEqual([...f.docs], before);
});

test('create is atomic and same-request retry never creates a second entity', async () => {
  const f = fixture(), request = { operation: 'create', entity_id: 'new', expected_version: 'missing', operation_id: 'create-1', entity: f.input };
  const result = await f.call(request); assert.equal(result.ok, true); assert.deepEqual(await f.call(request), result);
  assert.equal(f.docs.get('billingEntities/new').legalName, 'Legal Entity');
  assert.equal([...f.docs.keys()].filter(p => p.startsWith('pulseBillingEntityAudit/')).length, 1);
  assert.equal((await f.call({ ...request, entity: { ...f.input, nextPoNumber: 2 } })).error, 'billing_entity_operation_conflict');
  const g = fixture({ failAudit: true }); assert.equal((await g.call({ ...request, entity: g.input })).ok, false); assert.equal(g.docs.has('billingEntities/new'), false);
});

test('a stale full-form save cannot reset a counter allocated after opening', async () => {
  const f = fixture(), opening = await open(f);
  f.docs.get('billingEntities/B').nextPoNumber = 11; f.versions.set('billingEntities/B', 2);
  const before = copy([...f.docs]);
  assert.equal((await f.call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'stale', patch: { nextPoNumber: 10, companyAddress: 'Old draft' } })).error, 'billing_entity_version_conflict');
  assert.deepEqual([...f.docs], before);
});

test('valid edits preserve all unknown fields and the independent sequence values', async () => {
  const f = fixture(); assert.equal((await edit(f)).ok, true);
  const stored = f.docs.get('billingEntities/B'); assert.equal(stored.companyAddress, 'New address'); assert.equal(stored.nextPoNumber, 10); assert.deepEqual(stored.legacy, { retained: true });
});

test('company edits map legal name to the existing settings record and cannot delete the primary', async () => {
  const f = fixture(), opening = await open(f, 'company');
  assert.equal((await f.call({ operation: 'update', entity_id: 'company', expected_version: opening.entity_version, operation_id: 'company-edit', patch: { legalName: 'Changed', isActive: false } })).ok, true);
  assert.equal(f.docs.get('settings/company').companyName, 'Changed'); assert.equal(f.docs.has('billingEntities/company'), false);
  assert.equal((await open(f, 'company')).entity.isActive, true);
  assert.equal((await f.call({ operation: 'delete', entity_id: 'company', expected_version: (await open(f, 'company')).entity_version, operation_id: 'delete-primary' })).error, 'primary_company_delete_forbidden');
});

test('the existing company/billing permission distinction and current actor approval are preserved', async () => {
  const f = fixture({ uid: 'partner' });
  assert.equal((await open(f)).ok, true); assert.equal((await edit(f)).error, 'billing_entity_forbidden');
  const primary = await open(f, 'company');
  assert.equal((await f.call({ operation: 'update', entity_id: 'company', expected_version: primary.entity_version, operation_id: 'company', patch: { phone: 'Allowed by existing company policy' } })).ok, true);
  const g = fixture({ onRead: (path, users) => { if (path === 'pulseRuntimeControl/cutover') users.get('admin').disabled = true; } });
  const before = copy([...g.docs]); assert.equal((await edit(g)).ok, false); assert.deepEqual([...g.docs], before);
});

test('delete retains a complete protected archive and never recycles its identity', async () => {
  const f = fixture(), opening = await open(f), original = copy(f.docs.get('billingEntities/B'));
  const request = { operation: 'delete', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'delete-1' };
  const result = await f.call(request); assert.equal(result.ok, true); assert.equal(f.docs.has('billingEntities/B'), false);
  assert.deepEqual(f.docs.get('pulseDeletedBillingEntities/B').entity, original);
  assert.deepEqual(await f.call(request), result);
  assert.equal((await f.call({ operation: 'create', entity_id: 'B', expected_version: 'missing', operation_id: 'recreate', entity: f.input })).error, 'billing_entity_deleted');
});

test('default selection uses a complete pinned catalog and updates flags atomically', async () => {
  const f = fixture(), page = await f.call({ operation: 'catalog' });
  const request = { operation: 'set_default', entity_id: 'B', expected_catalog_version: page.catalog_version, operation_id: 'default-1' };
  assert.equal((await f.call(request)).ok, true);
  assert.equal(f.docs.get('billingEntities/B').isDefault, true); assert.equal(f.docs.get('billingEntities/D').isDefault, false); assert.equal(f.docs.get('settings/company').isDefault, false);
  const g = fixture(), old = await g.call({ operation: 'catalog' }); g.docs.get('billingEntities/D').nextPoNumber++; g.versions.set('billingEntities/D', 2);
  assert.equal((await g.call({ ...request, expected_catalog_version: old.catalog_version })).error, 'billing_entity_catalog_conflict');
});

test('uncertain commits resolve once, while cancelling an uncommitted request fences a delayed save', async () => {
  const f = fixture({ loseReply: true }), opening = await open(f);
  const request = { operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'uncertain', patch: { companyAddress: 'Committed' } };
  assert.equal((await f.call(request)).error, 'billing_entity_operations_unavailable');
  assert.equal((await f.call({ ...request, resolve_only: true })).resolution, 'committed');
  const g = fixture(); const pending = { ...request, expected_version: (await open(g)).entity_version };
  assert.equal((await g.call({ ...pending, resolve_only: true })).resolution, 'cancelled');
  assert.equal((await g.call(pending)).error, 'billing_entity_request_cancelled'); assert.equal(g.docs.get('billingEntities/B').companyAddress, 'Address');
});

test('missing writer fences or disabled writes keep reads and owned receipt recovery available', async () => {
  const f = fixture(); const opening = await open(f), request = { operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'saved', patch: { nextPoNumber: 12 } };
  const result = await f.call(request); assert.equal(result.ok, true);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await open(f)).permissions.edit, false); assert.deepEqual(await f.call(request), result);
  assert.equal((await f.call({ ...request, operation_id: 'next' })).error, 'billing_entity_read_only');
  const g = fixture({ enabled: false }); assert.equal((await open(g)).ok, true); assert.equal((await edit(g)).error, 'billing_entity_mutations_disabled');
});

test('every cutover fence is mandatory and an unknown mode cannot replay receipts', async () => {
  for (const key of ['poClientWritesFenced', 'poCounterClientWritesFenced', 'billingEntityClientWritesFenced']) {
    const f = fixture(); delete f.docs.get('pulseRuntimeControl/cutover')[key];
    assert.equal((await edit(f)).error, 'billing_entity_mutations_disabled');
  }
  const f = fixture(), opening = await open(f);
  const request = { operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'saved-mode', patch: { phone: '123' } };
  assert.equal((await f.call(request)).ok, true);
  f.docs.get('pulseRuntimeControl/cutover').mode = 'unknown';
  assert.equal((await f.call(request)).error, 'billing_entity_read_only');
});

test('a role revoked during entity reads cannot commit a previously authorized edit', async () => {
  let revoke = false;
  const f = fixture({ onRead: (path, users) => { if (revoke && path === 'billingEntities/B') users.get('admin').customClaims.role = 'viewer'; } });
  const opening = await open(f); revoke = true;
  const before = copy([...f.docs]);
  assert.equal((await f.call({ operation: 'update', entity_id: 'B', expected_version: opening.entity_version, operation_id: 'revoked', patch: { phone: '123' } })).ok, false);
  assert.deepEqual([...f.docs], before);
});

test('revocation during a read or receipt lookup never releases the result', async () => {
  for (const operation of ['get', 'catalog']) {
    const f = fixture({ onRead: (path, users) => { if (path === 'billingEntities' || path === 'billingEntities/B') users.get('admin').disabled = true; } });
    const result = await f.call({ operation, ...(operation === 'get' ? { entity_id: 'B' } : {}) });
    assert.equal(result.ok, false); assert.equal(result.entity, undefined); assert.equal(result.entities, undefined);
  }
  let revoke = false;
  const f = fixture({ onRead: (path, users) => { if (revoke && path.startsWith('pulseBillingEntityOperations/')) users.get('admin').disabled = true; } });
  const request = { operation: 'update', entity_id: 'B', expected_version: (await open(f)).entity_version, operation_id: 'receipt-revoked', patch: { phone: '123' } };
  assert.equal((await f.call(request)).ok, true); revoke = true;
  assert.equal((await f.call({ ...request, resolve_only: true })).ok, false);
});

test('new entities retain all original form defaults when a valid minimal entity is submitted', async () => {
  const f = fixture();
  const result = await f.call({ operation: 'create', entity_id: 'minimal', expected_version: 'missing', operation_id: 'minimal', entity: { legalName: 'Minimal', companyAddress: 'Address', gstin: f.input.gstin } });
  assert.equal(result.ok, true); assert.equal(f.docs.get('billingEntities/minimal').nextPoNumber, 1); assert.equal(f.docs.get('billingEntities/minimal').nextQuotationNumber, 1);
});

test('legal identifiers and PO format use the existing form validation', async () => {
  for (const patch of [{ pan: 'bad' }, { cin: 'bad' }, { poNumberFormat: 'invented' }]) {
    const f = fixture(), before = copy([...f.docs]);
    assert.equal((await edit(f, patch)).error, 'invalid_billing_entity_patch'); assert.deepEqual([...f.docs], before);
  }
});

test('audits retain the actual edited values and default transitions', async () => {
  const f = fixture(); assert.equal((await edit(f, { phone: '123' })).ok, true);
  const audit = f.docs.get('pulseBillingEntityAudit/edit-1');
  assert.deepEqual(audit.changes.phone, { before: '', after: '123' });
  const page = await f.call({ operation: 'catalog' });
  assert.equal((await f.call({ operation: 'set_default', entity_id: 'B', expected_catalog_version: page.catalog_version, operation_id: 'default-audit' })).ok, true);
  const defaults = f.docs.get('pulseBillingEntityAudit/default-audit');
  assert.equal(defaults.default_changes.find(row => row.entity_id === 'B').after, true);
});

test('a primary partial edit preserves unknown and independent settings fields', async () => {
  const f = fixture(); f.docs.get('settings/company').unrelated = { retained: 'yes' };
  const before = copy(f.docs.get('settings/company'));
  assert.equal((await f.call({ operation: 'update', entity_id: 'company', expected_version: (await open(f, 'company')).entity_version, operation_id: 'company-partial', patch: { phone: '456' } })).ok, true);
  const after = f.docs.get('settings/company');
  assert.equal(after.companyName, before.companyName); assert.equal(after.nextPoNumber, before.nextPoNumber); assert.deepEqual(after.unrelated, before.unrelated);
});

test('catalog additions and PO allocation during a transaction force conflict rather than stale writes', async () => {
  const f = fixture({ beforeCommit: (docs, versions) => { docs.get('billingEntities/B').nextPoNumber++; versions.set('billingEntities/B', 20); } });
  // Install the contention after opening, since reads also use transactions.
  const opening = await open(f);
  const g = fixture({ beforeCommit: (docs, versions) => { docs.get('billingEntities/B').nextPoNumber++; versions.set('billingEntities/B', 20); } });
  assert.equal((await g.call({ operation: 'update', entity_id: 'B', expected_version: '10:1', operation_id: 'concurrent-po', patch: { nextPoNumber: 10 } })).error, 'billing_entity_version_conflict');
  assert.equal(g.docs.get('billingEntities/B').nextPoNumber, 11);
  assert.equal(opening.entity.nextPoNumber, 11);
});

test('mutation enablement accepts only explicit true and re-evaluates a server gate', async () => {
  for (const enabled of ['true', 1, () => false]) {
    const f = fixture({ enabled }); assert.equal((await edit(f)).error, 'billing_entity_mutations_disabled');
  }
  let enabled = false; const f = fixture({ enabled: () => enabled });
  assert.equal((await edit(f)).error, 'billing_entity_mutations_disabled'); enabled = true;
  assert.equal((await edit(f)).ok, true);
});
