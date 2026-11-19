const test = require('node:test');
const assert = require('node:assert/strict');
let commands;
try { commands = require('./materialCommands.cjs'); } catch {}
const item = (extra = {}) => ({ id: 'new', itemType: 'component', name: 'New', description: '', category: 'Mech', quantity: 1, ...extra });
test('bounded commands expose deterministic validation/application', () => {
  assert.equal(typeof commands?.validateCommand, 'function'); assert.equal(typeof commands?.applyCommand, 'function');
});
test('command input rejects replacement arrays, extra keys, duplicates and oversized payloads', () => {
  for (const value of [{ kind: 'replace', categories: [] }, { kind: 'add_items', items: [item()], actor_uid: 'admin' }, { kind: 'delete_items', item_ids: ['x', 'x'] }, { kind: 'add_items', items: Array.from({ length: 201 }, (_, i) => item({ id: String(i) })) }, { kind: 'patch_items', updates: [{ item_id: 'x', patch: { fulfillmentTranches: [] } }] }, { kind: 'add_items', items: [item({ quantity: NaN })] }, { kind: 'add_items', items: [item({ itemType: 'service', quantity: 0.4 })] }]) {
    assert.throws(() => commands.validateCommand(value));
  }
  assert.throws(() => commands.validateCommand({ kind: 'add_items', items: Array.from({ length: 100 }, (_, i) => item({ id: String(i), description: 'x'.repeat(4000) })) }), { code: 'material_command_too_large' });
});
test('Firestore budget estimates nested fields, Timestamp and binary without JSON loss', () => {
  assert.equal(commands.estimateDocumentBytes({ a: 'é' }, 'c/d'), 16 + 4 + 32 + 2 + 3);
  assert.ok(commands.estimateDocumentBytes({ stamp: { seconds: 10, nanoseconds: 1, toDate() { return new Date(); } }, binary: Buffer.alloc(100) }, 'c/d') > 100);
  assert.throws(() => commands.assertDocumentBudget([{ path: 'c/d', data: { large: Buffer.alloc(901 * 1024) } }]), { code: 'material_document_too_large' });
  assert.throws(() => commands.estimateDocumentBytes({ unknown: new Set(['x']) }, 'c/d'), { code: 'material_size_unavailable' });
});

test('mixed document delta requires explicit disjoint bounded lists and exact keys', () => {
  for (const command of [
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a'], remove_item_ids: [] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: [], remove_item_ids: ['a'] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a'], remove_item_ids: ['b'] }
  ]) assert.deepEqual(commands.validateCommand(command), command);
  for (const command of [
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: [], remove_item_ids: [] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a'], remove_item_ids: ['a'] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a', 'a'], remove_item_ids: [] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a'] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: [], remove_item_ids: null },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a/b'], remove_item_ids: [] },
    { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['a'], remove_item_ids: [], linkedBOMItems: [] }
  ]) assert.throws(() => commands.validateCommand(command), { code: 'invalid_material_command' });
  assert.throws(() => commands.validateCommand({ kind: 'link_document_delta', document_id: 'quote', add_item_ids: Array.from({ length: 101 }, (_, i) => `a-${i}`), remove_item_ids: Array.from({ length: 100 }, (_, i) => `r-${i}`) }), { code: 'material_command_too_large' });
});


test('Firestore budget accepts preserved document references and geographical points without flattening them', () => {
  class DocumentReference { constructor(path) { this.path = path; } isEqual() { return false; } }
  class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } isEqual() { return false; } }
  const ref = new DocumentReference('legacy/kept'), point = new GeoPoint(12, 34);
  const data = { ref, point };
  // Document name16+path strings; point16. Include outer names and doc32.
  assert.equal(commands.estimateDocumentBytes(data, 'c/d'), 16 + 4 + 32 + 4 + 16 + 7 + 5 + 6 + 16);
  assert.equal(data.ref, ref); assert.equal(data.point, point);
});

test('foreign-currency price fields are accepted, bounded and clearable', () => {
  const fx = { price: 189.5, currency: 'USD', fxRate: 84.2, fxRateDate: '2026-11-19' };
  assert.deepEqual(commands.validateCommand({ kind: 'add_items', items: [item(fx)] }).items[0].currency, 'USD');
  const patch = { kind: 'patch_items', updates: [{ item_id: 'a', patch: fx }] };
  assert.deepEqual(commands.validateCommand(patch), patch);
  const clear = { kind: 'patch_items', updates: [{ item_id: 'a', patch: { currency: null, fxRate: null, fxRateDate: null } }] };
  assert.deepEqual(commands.validateCommand(clear), clear);
  for (const bad of [{ currency: 'usd' }, { currency: 'US' }, { fxRate: 0 }, { fxRate: -1 }, { fxRate: 1e7 }, { fxRate: '84' }, { fxRateDate: '2026-13-45' }, { fxRateDate: 'today' }]) {
    assert.throws(() => commands.validateCommand({ kind: 'patch_items', updates: [{ item_id: 'a', patch: bad }] }), { code: 'invalid_material_command' });
  }
  assert.throws(() => commands.validateCommand({ kind: 'add_items', items: [item({ currency: null })] }));
});
