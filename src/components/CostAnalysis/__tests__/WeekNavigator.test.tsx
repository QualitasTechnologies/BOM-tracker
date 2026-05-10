import { describe, it, expect } from 'vitest';
import { weekRangeFromDate, shiftWeek, formatWeekLabel } from '../WeekNavigator';

describe('weekRangeFromDate', () => {
  it('returns Monday-Sunday for a Wednesday', () => {
    // 2026-05-06 is a Wednesday
    const r = weekRangeFromDate(new Date('2026-05-06T12:00:00Z'));
    expect(r.start).toBe('2026-05-04');
    expect(r.end).toBe('2026-05-10');
  });

  it('returns Monday-Sunday for a Monday', () => {
    const r = weekRangeFromDate(new Date('2026-05-04T12:00:00Z'));
    expect(r.start).toBe('2026-05-04');
    expect(r.end).toBe('2026-05-10');
  });

  it('returns Monday-Sunday for a Sunday', () => {
    // 2026-05-10 is a Sunday → start of week is 2026-05-04
    const r = weekRangeFromDate(new Date('2026-05-10T12:00:00Z'));
    expect(r.start).toBe('2026-05-04');
    expect(r.end).toBe('2026-05-10');
  });
});

describe('shiftWeek', () => {
  it('shifts forward by 7 days', () => {
    const r = shiftWeek({ start: '2026-05-04', end: '2026-05-10' }, 1);
    expect(r.start).toBe('2026-05-11');
    expect(r.end).toBe('2026-05-17');
  });

  it('shifts backward by 7 days', () => {
    const r = shiftWeek({ start: '2026-05-04', end: '2026-05-10' }, -1);
    expect(r.start).toBe('2026-04-27');
    expect(r.end).toBe('2026-05-03');
  });
});

describe('formatWeekLabel', () => {
  it('renders "May 4 – 10, 2026"', () => {
    expect(formatWeekLabel({ start: '2026-05-04', end: '2026-05-10' })).toBe('May 4 – 10, 2026');
  });

  it('renders cross-month "Apr 27 – May 3, 2026"', () => {
    expect(formatWeekLabel({ start: '2026-04-27', end: '2026-05-03' })).toBe('Apr 27 – May 3, 2026');
  });
});
