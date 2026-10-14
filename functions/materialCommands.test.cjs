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
