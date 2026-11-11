const test = require('node:test'), assert = require('node:assert/strict');
const domain = require('./billingEntityDomain.generated.cjs');

test('generated helpers still match the original Settings source', () => {
  const path = require('node:path');
  const root = require('node:fs').existsSync(path.resolve(__dirname, '../scripts/build-billing-entity-domain.mjs')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../apps/bom');
  require('node:child_process').execFileSync(process.execPath, [path.resolve(root, 'scripts/build-billing-entity-domain.mjs'), '--check', `--source-root=${root}`, `--output=${path.resolve(__dirname, 'billingEntityDomain.generated.cjs')}`], { cwd: root, stdio: 'pipe' });
});

test('the primary alias and its defaults use the original Settings model', () => {
  const raw = domain.defaultCompanySettings(), primary = domain.companyAsBillingEntity(raw);
  assert.equal(primary.id, 'company'); assert.equal(primary.legalName, raw.companyName);
  assert.equal(primary.poNumberPrefix, raw.poNumberPrefix); assert.equal(primary.isActive, true);
  assert.equal(primary.nextPoNumber, 1); assert.equal(primary.quotationPrefix, 'SVC');
  assert.equal(domain.companyAsBillingEntity({ ...raw, isActive: false }).isActive, true);
});

test('default selection and sorting preserve explicit, Datasensor, primary and first fallback', () => {
  const company = { id: 'company', legalName: 'Primary', displayName: 'Primary' };
  const ds = { id: 'D', legalName: 'Data Sensor India', displayName: 'Datasensor' };
  const other = { id: 'O', legalName: 'Other', displayName: 'Other' };
  assert.equal(domain.getDefaultBillingEntity([other, company, ds]).id, 'D');
  assert.equal(domain.getDefaultBillingEntity([company, ds, { ...other, isDefault: true }]).id, 'O');
  assert.equal(domain.getDefaultBillingEntity([other, company]).id, 'company');
  assert.equal(domain.getDefaultBillingEntity([other]).id, 'O');
  assert.equal(domain.sortBillingEntities([other, company, ds])[0].id, 'D');
});

test('company updates use the existing alias mapping and never add an active switch to the primary', () => {
  const mapped = domain.billingEntityPatchToCompanySettings({ legalName: 'Legal', displayName: 'Display', nextPoNumber: 42, isActive: false, unknown: 'retain elsewhere' });
  assert.equal(mapped.companyName, 'Legal'); assert.equal(mapped.nextPoNumber, 42);
  assert.equal(Object.hasOwn(mapped, 'isActive'), false); assert.equal(Object.hasOwn(mapped, 'unknown'), false);
  assert.equal(domain.billingEntityPatchToCompanySettings({ displayName: 'Fallback' }).companyName, 'Fallback');
});

test('the original blank form retains independent sequence and quotation fields', () => {
  const blank = domain.emptyBillingEntity();
  assert.equal(blank.nextPoNumber, 1); assert.equal(blank.nextQuotationNumber, 1);
  assert.equal(blank.isDefault, false); assert.equal(blank.isActive, true);
  assert.equal(blank.poNumberFormat, 'simple'); assert.equal(blank.defaultValidityDays, 30);
  assert.equal(blank.poNumberPrefix, 'PO-DS'); assert.equal(blank.logoPath, '');
});
