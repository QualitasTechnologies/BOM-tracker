const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseOrderAcceptanceDate } = require('./purchaseOrderAcceptanceDate.cjs');

test('provider acceptance timestamp is stable ISO and order date follows the Asia/Kolkata calendar', () => {
  const beforeMidnight = purchaseOrderAcceptanceDate(Date.parse('2026-10-18T18:29:59.000Z'));
  assert.deepEqual(beforeMidnight, {
    acceptedAt: '2026-10-18T18:29:59.000Z',
    actualSentDate: '2026-10-18',
    sentAtMillis: Date.parse('2026-10-18T18:29:59.000Z'),
  });
  const afterMidnight = purchaseOrderAcceptanceDate(Date.parse('2026-10-18T18:30:00.000Z'));
  assert.equal(afterMidnight.actualSentDate, '2026-10-19');
});

test('provider acceptance timestamp rejects invalid epochs', () => {
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => purchaseOrderAcceptanceDate(value), TypeError);
});
