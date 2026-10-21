const test = require('node:test');
const assert = require('node:assert/strict');
const { materialReadView } = require('./materialReadView.cjs');

test('preserves safe unknown JSON and explicitly converts Date and Firestore Timestamp values', () => {
  class Timestamp { toDate() { return new Date('2026-02-03T04:05:06.000Z'); } }
  const timestamp = Object.freeze(new Timestamp());
  const raw = [{
    name: 'Mechanical', custom: { nested: ['kept', 3, true, null] },
    items: [{ id: 'motor', customItemField: { retained: true }, purchasedAt: new Date('2025-01-02T00:00:00Z'), addedAt: timestamp }]
  }];
  const originalDate = raw[0].items[0].purchasedAt;
  assert.deepEqual(materialReadView(raw), [{
    name: 'Mechanical', custom: { nested: ['kept', 3, true, null] },
    items: [{ id: 'motor', customItemField: { retained: true }, purchasedAt: '2025-01-02T00:00:00.000Z', addedAt: '2026-02-03T04:05:06.000Z' }]
  }]);
  assert.equal(raw[0].items[0].addedAt, timestamp);
  assert.equal(raw[0].items[0].purchasedAt, originalDate);
  assert.ok(raw[0].items[0].purchasedAt instanceof Date);
});

test('rejects malformed categories and item identities with a stable sanitized integrity error', () => {
  for (const raw of [null, {}, [{ name: '', items: [] }], [{ name: 'Mechanical', items: {} }], [{ name: 'Mechanical', items: [{ name: 'no id' }] }]]) {
    assert.throws(() => materialReadView(raw), error => error.code === 'materials_data_integrity' && error.message === 'materials_data_integrity');
  }
});

test('rejects unsupported SDK values before they can reach the callable encoder', () => {
  let toJSONCalled = false;
  const unsupported = { toJSON() { toJSONCalled = true; return 'leaked'; } };
  class GeoPoint {}
  class DocumentReference {}
  for (const value of [unsupported, new GeoPoint(), new DocumentReference(), Buffer.from([1, 2]), new Uint8Array([1, 2]), 1n]) {
    assert.throws(() => materialReadView([{ name: 'Mechanical', items: [{ id: 'motor', value }] }]), error => error.code === 'materials_data_integrity');
  }
  assert.equal(toJSONCalled, false);
});
