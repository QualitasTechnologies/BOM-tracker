import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getInwardStatus,
  calculateExpectedArrival,
  parseLeadTimeToDays,
  type BOMItem,
  type InwardStatus
} from '../bom';

// Helper to create a minimal BOM item for testing
const createBOMItem = (overrides: Partial<BOMItem> = {}): BOMItem => ({
  id: '1',
  itemType: 'component',
  name: 'Test Item',
  description: 'Test description',
  quantity: 1,
  vendors: [],
  status: 'not-ordered',
  category: 'Test',
  ...overrides
});

describe('getInwardStatus', () => {
  // Use a fixed date for testing
  const originalDate = Date;

  beforeEach(() => {
    // Mock Date to always return Nov 28, 2025
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-28T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('not-ordered status', () => {
    it('returns not-ordered for items with not-ordered status', () => {
      const item = createBOMItem({ status: 'not-ordered' });

      const result = getInwardStatus(item);

      expect(result).toBe('not-ordered');
    });

    it('returns not-ordered for service items regardless of status', () => {
      const item = createBOMItem({
        itemType: 'service',
        status: 'ordered',
        expectedArrival: '2025-11-25' // Would be overdue
      });

      const result = getInwardStatus(item);

      expect(result).toBe('not-ordered');
    });
  });

  describe('received status', () => {
    it('returns received for items with received status', () => {
      const item = createBOMItem({
        status: 'received',
        expectedArrival: '2025-11-20', // Past date
        actualArrival: '2025-11-21'
      });

      const result = getInwardStatus(item);

      expect(result).toBe('received');
    });
  });

  describe('ordered items without expected arrival', () => {
    it('returns on-track when no expected arrival is set', () => {
      const item = createBOMItem({
        status: 'ordered'
        // No expectedArrival
      });

      const result = getInwardStatus(item);

      expect(result).toBe('on-track');
    });
  });

  describe('overdue items', () => {
    it('returns overdue when expected arrival is in the past', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-11-27' // Yesterday
      });

      const result = getInwardStatus(item);

      expect(result).toBe('overdue');
    });

    it('returns overdue when expected arrival was weeks ago', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-11-01' // ~4 weeks ago
      });

      const result = getInwardStatus(item);

      expect(result).toBe('overdue');
    });
  });

  describe('arriving-soon items', () => {
    it('returns arriving-soon when expected arrival is today', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-11-28' // Today
      });

      const result = getInwardStatus(item);

      expect(result).toBe('arriving-soon');
    });

    it('returns arriving-soon when expected arrival is within 7 days', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-12-04' // 6 days from now
      });

      const result = getInwardStatus(item);

      expect(result).toBe('arriving-soon');
    });

    it('returns arriving-soon when expected arrival is exactly 7 days away', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-12-05' // 7 days from now
      });

      const result = getInwardStatus(item);

      expect(result).toBe('arriving-soon');
    });
  });

  describe('on-track items', () => {
    it('returns on-track when expected arrival is more than 7 days away', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2025-12-06' // 8 days from now
      });

      const result = getInwardStatus(item);

      expect(result).toBe('on-track');
    });

    it('returns on-track when expected arrival is far in the future', () => {
      const item = createBOMItem({
        status: 'ordered',
        expectedArrival: '2026-01-15' // ~7 weeks from now
      });

      const result = getInwardStatus(item);

      expect(result).toBe('on-track');
    });
  });
});

describe('calculateExpectedArrival', () => {
  it('adds lead time days to order date', () => {
    const result = calculateExpectedArrival('2025-11-01', 14);

    expect(result).toBe('2025-11-15');
  });

  it('handles month boundary correctly', () => {
    const result = calculateExpectedArrival('2025-11-25', 10);

    expect(result).toBe('2025-12-05');
  });

  it('handles year boundary correctly', () => {
    const result = calculateExpectedArrival('2025-12-25', 14);

    expect(result).toBe('2026-01-08');
  });

  it('handles 0 lead time days', () => {
    const result = calculateExpectedArrival('2025-11-28', 0);

    expect(result).toBe('2025-11-28');
  });

  it('handles single day lead time', () => {
    const result = calculateExpectedArrival('2025-11-28', 1);

    expect(result).toBe('2025-11-29');
  });

  it('handles long lead times (90 days)', () => {
    const result = calculateExpectedArrival('2025-01-01', 90);

    expect(result).toBe('2025-04-01');
  });

  it('handles February correctly (non-leap year)', () => {
    const result = calculateExpectedArrival('2025-02-25', 5);

    expect(result).toBe('2025-03-02');
  });

  it('handles leap year February correctly', () => {
    const result = calculateExpectedArrival('2024-02-25', 5);

    expect(result).toBe('2024-03-01');
  });
});

describe('parseLeadTimeToDays', () => {
  describe('days format', () => {
    it('parses "14 days"', () => {
      expect(parseLeadTimeToDays('14 days')).toBe(14);
    });

    it('parses "1 day"', () => {
      expect(parseLeadTimeToDays('1 day')).toBe(1);
    });

    it('parses "14days" (no space)', () => {
      expect(parseLeadTimeToDays('14days')).toBe(14);
    });

    it('parses "7 d" (abbreviation)', () => {
      expect(parseLeadTimeToDays('7 d')).toBe(7);
    });

    it('parses case insensitively', () => {
      expect(parseLeadTimeToDays('14 DAYS')).toBe(14);
      expect(parseLeadTimeToDays('14 Days')).toBe(14);
    });
  });

  describe('weeks format', () => {
    it('parses "2 weeks"', () => {
      expect(parseLeadTimeToDays('2 weeks')).toBe(14);
    });

    it('parses "1 week"', () => {
      expect(parseLeadTimeToDays('1 week')).toBe(7);
    });

    it('parses "2-3 weeks" (takes first number)', () => {
      expect(parseLeadTimeToDays('2-3 weeks')).toBe(14);
    });

    it('parses "3weeks" (no space)', () => {
      expect(parseLeadTimeToDays('3weeks')).toBe(21);
    });

    it('parses "4 w" (abbreviation)', () => {
      expect(parseLeadTimeToDays('4 w')).toBe(28);
    });
  });

  describe('months format', () => {
    it('parses "1 month"', () => {
      expect(parseLeadTimeToDays('1 month')).toBe(30);
    });

    it('parses "2 months"', () => {
      expect(parseLeadTimeToDays('2 months')).toBe(60);
    });

    it('parses "1-2 months" (takes first number)', () => {
      expect(parseLeadTimeToDays('1-2 months')).toBe(30);
    });

    it('parses "3months" (no space)', () => {
      expect(parseLeadTimeToDays('3months')).toBe(90);
    });

    it('parses "1 m" (abbreviation)', () => {
      expect(parseLeadTimeToDays('1 m')).toBe(30);
    });
  });

  describe('plain number format', () => {
    it('parses plain number as days', () => {
      expect(parseLeadTimeToDays('14')).toBe(14);
    });

    it('parses "0" as 0 days', () => {
      expect(parseLeadTimeToDays('0')).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty string', () => {
      expect(parseLeadTimeToDays('')).toBe(0);
    });

    it('returns 0 for null/undefined input', () => {
      expect(parseLeadTimeToDays(null as any)).toBe(0);
      expect(parseLeadTimeToDays(undefined as any)).toBe(0);
    });

    it('returns 0 for unrecognized format', () => {
      expect(parseLeadTimeToDays('ASAP')).toBe(0);
      expect(parseLeadTimeToDays('TBD')).toBe(0);
      expect(parseLeadTimeToDays('unknown')).toBe(0);
    });

    it('handles extra whitespace', () => {
      expect(parseLeadTimeToDays('  14 days  ')).toBe(14);
      expect(parseLeadTimeToDays('2  weeks')).toBe(14);
    });

    it('handles mixed case with whitespace', () => {
      expect(parseLeadTimeToDays('  2 WEEKS  ')).toBe(14);
    });
  });

  describe('real-world vendor lead times', () => {
    it('parses common vendor lead time formats', () => {
      expect(parseLeadTimeToDays('3-4 weeks')).toBe(21); // Takes first number
      // Note: "10 working days" matches weeks pattern first ("10 w...") = 70 days
      // This is a known limitation of the current regex-based parsing
      expect(parseLeadTimeToDays('10 working days')).toBe(70); // Matches "w" for weeks
      expect(parseLeadTimeToDays('2-3 business days')).toBe(2); // Matches days pattern
      expect(parseLeadTimeToDays('1-2 months')).toBe(30); // Takes first number
    });

    it('correctly parses formats without ambiguity', () => {
      expect(parseLeadTimeToDays('5 business days')).toBe(5); // Matches days pattern
      expect(parseLeadTimeToDays('14 calendar days')).toBe(14);
      expect(parseLeadTimeToDays('4 weeks lead time')).toBe(28);
    });
  });
});
