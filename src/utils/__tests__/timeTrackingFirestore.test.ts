import { describe, it, expect } from 'vitest';
import { getTotalManHours, type Engineer, type WeekData } from '../timeTrackingFirestore';

// Helper function to create an engineer with weeks data
const createEngineer = (
  id: string,
  name: string,
  weeks: Record<string, WeekData> = {}
): Engineer & { id: string } => ({
  id,
  name,
  role: 'Engineer',
  department: 'Development',
  weeks
});

// Helper function to create week data
const createWeekData = (total: number, status: 'ok' | 'not-updated' | 'future' = 'ok'): WeekData => ({
  total,
  entries: [],
  status
});

describe('getTotalManHours', () => {
  describe('basic aggregation', () => {
    it('calculates total hours for single engineer with one week', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(40)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(40);
    });

    it('calculates total hours for single engineer with multiple weeks', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(40),
          'W2-2024': createWeekData(35),
          'W3-2024': createWeekData(45)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(120); // 40 + 35 + 45
    });

    it('calculates total hours across multiple engineers', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(40),
          'W2-2024': createWeekData(40)
        }),
        createEngineer('2', 'Jane Smith', {
          'W1-2024': createWeekData(35),
          'W2-2024': createWeekData(38)
        }),
        createEngineer('3', 'Bob Wilson', {
          'W1-2024': createWeekData(42),
          'W2-2024': createWeekData(40)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(235); // (40+40) + (35+38) + (42+40)
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty engineers array', () => {
      const result = getTotalManHours([]);

      expect(result).toBe(0);
    });

    it('returns 0 for engineer with no weeks', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {})
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(0);
    });

    it('returns 0 for engineer with undefined weeks', () => {
      const engineers = [
        createEngineer('1', 'John Doe', undefined as any)
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(0);
    });

    it('handles weeks with 0 hours', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(0),
          'W2-2024': createWeekData(40),
          'W3-2024': createWeekData(0)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(40);
    });

    it('handles week data with undefined total', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': { total: undefined as any, entries: [], status: 'ok' },
          'W2-2024': createWeekData(40)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(40); // undefined treated as 0
    });
  });

  describe('fractional hours', () => {
    it('handles fractional hours (0.5 hour increments)', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(7.5),
          'W2-2024': createWeekData(8.5)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(16); // 7.5 + 8.5
    });

    it('handles precise decimal hours', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(8.25),
          'W2-2024': createWeekData(7.75)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(16); // 8.25 + 7.75
    });
  });

  describe('different week statuses', () => {
    it('includes hours from all statuses (ok, not-updated, future)', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(40, 'ok'),
          'W2-2024': createWeekData(35, 'not-updated'),
          'W3-2024': createWeekData(0, 'future')
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(75); // All weeks included regardless of status
    });
  });

  describe('real-world scenarios', () => {
    it('calculates typical project total hours', () => {
      const engineers = [
        createEngineer('1', 'Senior Engineer', {
          'W1-2024': createWeekData(40),
          'W2-2024': createWeekData(42),
          'W3-2024': createWeekData(38),
          'W4-2024': createWeekData(40)
        }),
        createEngineer('2', 'Junior Engineer', {
          'W1-2024': createWeekData(40),
          'W2-2024': createWeekData(40),
          'W3-2024': createWeekData(35),
          'W4-2024': createWeekData(40)
        }),
        createEngineer('3', 'Part-time Contractor', {
          'W1-2024': createWeekData(20),
          'W2-2024': createWeekData(24),
          'W3-2024': createWeekData(16),
          'W4-2024': createWeekData(20)
        })
      ];

      const result = getTotalManHours(engineers);

      // Senior: 40+42+38+40 = 160
      // Junior: 40+40+35+40 = 155
      // Contractor: 20+24+16+20 = 80
      // Total: 395
      expect(result).toBe(395);
    });

    it('handles engineers joining mid-project (sparse weeks)', () => {
      const engineers = [
        createEngineer('1', 'Original Team Member', {
          'W1-2024': createWeekData(40),
          'W2-2024': createWeekData(40),
          'W3-2024': createWeekData(40),
          'W4-2024': createWeekData(40)
        }),
        createEngineer('2', 'Late Joiner', {
          // No W1, W2 - joined in W3
          'W3-2024': createWeekData(40),
          'W4-2024': createWeekData(40)
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(240); // (4 * 40) + (2 * 40)
    });

    it('handles large numbers of engineers and weeks', () => {
      // Simulate 10 engineers over 12 weeks with 40 hours each
      const engineers = Array.from({ length: 10 }, (_, i) => {
        const weeks: Record<string, WeekData> = {};
        for (let w = 1; w <= 12; w++) {
          weeks[`W${w}-2024`] = createWeekData(40);
        }
        return createEngineer(`${i + 1}`, `Engineer ${i + 1}`, weeks);
      });

      const result = getTotalManHours(engineers);

      expect(result).toBe(4800); // 10 engineers * 12 weeks * 40 hours
    });
  });

  describe('data integrity', () => {
    it('does not modify the input array', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(40)
        })
      ];

      const originalEngineer = { ...engineers[0] };
      getTotalManHours(engineers);

      expect(engineers[0].id).toBe(originalEngineer.id);
      expect(engineers[0].name).toBe(originalEngineer.name);
    });

    it('handles negative hours (should not happen but testing robustness)', () => {
      const engineers = [
        createEngineer('1', 'John Doe', {
          'W1-2024': createWeekData(-5) // Invalid but testing
        })
      ];

      const result = getTotalManHours(engineers);

      expect(result).toBe(-5); // Function doesn't validate, just sums
    });
  });
});
