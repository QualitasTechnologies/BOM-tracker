const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarDate, isDateOnly } = require('./calendarDate.cjs');

test('date-only validator accepts real calendar days only', () => {
  assert.equal(isDateOnly('2026-11-20'), true);
  assert.equal(isDateOnly('2026-02-30'), false);
  assert.equal(isDateOnly('2026-11-20T00:00:00Z'), false);
});

test('calendar date keeps the encoded day for valid ISO strings with timezone offsets', () => {
  assert.equal(calendarDate('2026-11-20T00:00:00+05:30'), '2026-11-20');
  assert.equal(calendarDate('2026-11-20T23:30:00-08:00'), '2026-11-20');
  assert.equal(calendarDate('2026-11-20Tgarbage'), null);
  assert.equal(calendarDate('2026-02-30T00:00:00Z'), null);
});

test('Date and Timestamp values use the Pulse UTC-midnight calendar convention', () => {
  assert.equal(calendarDate(new Date('2026-11-20T00:00:00.000Z')), '2026-11-20');
  assert.equal(calendarDate({ toDate: () => new Date('2026-11-20T00:00:00.000Z') }), '2026-11-20');
  assert.equal(calendarDate(new Date('invalid')), null);
});
