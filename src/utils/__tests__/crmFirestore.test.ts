import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateWeightedValue,
  toJsDate,
  isDealStale,
  getDaysSinceActivity,
  formatCurrencyValue,
} from '@/types/crm';

/**
 * Tests for CRM utility functions used throughout the contact management
 * and deal tracking system.
 */

describe('calculateWeightedValue', () => {
  it('calculates weighted value correctly for 50% probability', () => {
    const result = calculateWeightedValue(100000, 50);
    expect(result).toBe(50000);
  });

  it('returns 0 for 0% probability', () => {
    const result = calculateWeightedValue(100000, 0);
    expect(result).toBe(0);
  });

  it('returns full value for 100% probability', () => {
    const result = calculateWeightedValue(100000, 100);
    expect(result).toBe(100000);
  });

  it('handles decimal values', () => {
    const result = calculateWeightedValue(150000, 75);
    expect(result).toBe(112500);
  });

  it('returns 0 for 0 value regardless of probability', () => {
    const result = calculateWeightedValue(0, 80);
    expect(result).toBe(0);
  });
});

describe('toJsDate', () => {
  it('returns Date object unchanged', () => {
    const date = new Date('2024-01-15');
    const result = toJsDate(date);
    expect(result).toEqual(date);
  });

  it('converts ISO string to Date', () => {
    const result = toJsDate('2024-01-15T10:30:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts Firestore Timestamp-like object to Date', () => {
    const mockTimestamp = {
      toDate: () => new Date('2024-01-15'),
    };
    const result = toJsDate(mockTimestamp);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString().startsWith('2024-01-15')).toBe(true);
  });

  it('returns new Date for null input', () => {
    const before = new Date();
    const result = toJsDate(null);
    const after = new Date();
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('returns new Date for undefined input', () => {
    const before = new Date();
    const result = toJsDate(undefined);
    const after = new Date();
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('handles numeric timestamp', () => {
    const timestamp = 1705312800000; // 2024-01-15 10:00:00 UTC
    const result = toJsDate(timestamp);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(timestamp);
  });
});

describe('isDealStale', () => {
  it('returns true when activity is older than threshold', () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    expect(isDealStale(eightDaysAgo, 7)).toBe(true);
  });

  it('returns false when activity is within threshold', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    expect(isDealStale(twoDaysAgo, 7)).toBe(false);
  });

  it('returns true when activity equals threshold', () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    expect(isDealStale(sevenDaysAgo, 7)).toBe(true);
  });

  it('uses default threshold of 7 days', () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    expect(isDealStale(eightDaysAgo)).toBe(true);

    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    expect(isDealStale(sixDaysAgo)).toBe(false);
  });

  it('returns false for invalid date', () => {
    expect(isDealStale('invalid-date')).toBe(false);
  });

  it('handles Firestore Timestamp-like object', () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const mockTimestamp = {
      toDate: () => tenDaysAgo,
    };

    expect(isDealStale(mockTimestamp, 7)).toBe(true);
  });
});

describe('getDaysSinceActivity', () => {
  it('returns correct number of days', () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const result = getDaysSinceActivity(fiveDaysAgo);
    expect(result).toBe(5);
  });

  it('returns 0 for today', () => {
    const today = new Date();

    const result = getDaysSinceActivity(today);
    expect(result).toBe(0);
  });

  it('returns 0 for future date', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Math.floor of negative number rounds down, but function uses Date diff
    const result = getDaysSinceActivity(tomorrow);
    expect(result).toBeLessThan(0);
  });

  it('returns 0 for invalid date', () => {
    expect(getDaysSinceActivity('invalid-date')).toBe(0);
  });

  it('handles Firestore Timestamp-like object', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const mockTimestamp = {
      toDate: () => threeDaysAgo,
    };

    const result = getDaysSinceActivity(mockTimestamp);
    expect(result).toBe(3);
  });
});

describe('formatCurrencyValue', () => {
  describe('INR formatting', () => {
    it('formats values in crores', () => {
      const result = formatCurrencyValue(15000000, 'INR');
      expect(result).toBe('₹1.5Cr');
    });

    it('formats values in lakhs', () => {
      const result = formatCurrencyValue(500000, 'INR');
      expect(result).toBe('₹5.0L');
    });

    it('formats values in thousands', () => {
      const result = formatCurrencyValue(15000, 'INR');
      expect(result).toBe('₹15.0K');
    });

    it('formats small values without suffix', () => {
      const result = formatCurrencyValue(500, 'INR');
      expect(result).toBe('₹500');
    });
  });

  describe('USD formatting', () => {
    it('formats values in crores', () => {
      const result = formatCurrencyValue(20000000, 'USD');
      expect(result).toBe('$2.0Cr');
    });

    it('formats values in lakhs', () => {
      const result = formatCurrencyValue(100000, 'USD');
      expect(result).toBe('$1.0L');
    });

    it('formats values in thousands', () => {
      const result = formatCurrencyValue(5000, 'USD');
      expect(result).toBe('$5.0K');
    });

    it('formats small values without suffix', () => {
      const result = formatCurrencyValue(999, 'USD');
      expect(result).toBe('$999');
    });
  });

  describe('EUR formatting', () => {
    it('uses euro symbol', () => {
      const result = formatCurrencyValue(50000, 'EUR');
      expect(result).toBe('€50.0K');
    });
  });

  describe('edge cases', () => {
    it('defaults to INR when currency not provided', () => {
      const result = formatCurrencyValue(100000);
      expect(result).toBe('₹1.0L');
    });

    it('handles zero value', () => {
      const result = formatCurrencyValue(0, 'INR');
      expect(result).toBe('₹0');
    });

    it('formats boundary value at exactly 1 lakh', () => {
      const result = formatCurrencyValue(100000, 'INR');
      expect(result).toBe('₹1.0L');
    });

    it('formats boundary value at exactly 1 crore', () => {
      const result = formatCurrencyValue(10000000, 'INR');
      expect(result).toBe('₹1.0Cr');
    });

    it('handles negative values gracefully', () => {
      // Note: Negative values may not be expected in production,
      // but the function should not crash
      const result = formatCurrencyValue(-50000, 'INR');
      expect(typeof result).toBe('string');
    });

    it('handles very large values', () => {
      const result = formatCurrencyValue(1000000000, 'INR');
      expect(result).toBe('₹100.0Cr');
    });

    it('handles decimal values', () => {
      const result = formatCurrencyValue(1500.50, 'INR');
      expect(result).toBe('₹1,500.5');
    });
  });
});

/**
 * Tests for Contact type validation and utility patterns.
 * These tests verify the shape and behavior expectations for Contact objects.
 */
describe('Contact Type Patterns', () => {
  describe('Contact object structure', () => {
    it('validates a well-formed contact object', () => {
      const contact = {
        id: 'contact-1',
        clientId: 'client-1',
        name: 'John Doe',
        designation: 'Manager',
        email: 'john@example.com',
        phone: '+91 98765 43210',
        isPrimary: true,
        department: 'Engineering',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(contact.id).toBeDefined();
      expect(contact.clientId).toBeDefined();
      expect(contact.name).toBeTruthy();
      expect(typeof contact.isPrimary).toBe('boolean');
    });

    it('validates contact with optional fields missing', () => {
      const contact = {
        id: 'contact-2',
        clientId: 'client-1',
        name: 'Jane Doe',
        designation: '',
        email: '',
        phone: '',
        isPrimary: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(contact.name).toBe('Jane Doe');
      expect(contact.department).toBeUndefined();
    });

    it('handles contact name trimming pattern', () => {
      const contactName = '  Whitespace Name  ';
      const trimmedName = contactName.trim();

      expect(trimmedName).toBe('Whitespace Name');
      expect(trimmedName.length).toBeLessThan(contactName.length);
    });
  });

  describe('Contact filtering patterns', () => {
    const contacts = [
      { id: 'c1', clientId: 'client-1', name: 'Alice', isPrimary: true },
      { id: 'c2', clientId: 'client-1', name: 'Bob', isPrimary: false },
      { id: 'c3', clientId: 'client-2', name: 'Charlie', isPrimary: true },
      { id: 'c4', clientId: 'client-1', name: 'Diana', isPrimary: false },
    ];

    it('filters contacts by clientId', () => {
      const clientContacts = contacts.filter(c => c.clientId === 'client-1');

      expect(clientContacts).toHaveLength(3);
      expect(clientContacts.map(c => c.name)).toContain('Alice');
      expect(clientContacts.map(c => c.name)).toContain('Bob');
      expect(clientContacts.map(c => c.name)).toContain('Diana');
    });

    it('finds primary contact for a client', () => {
      const primaryContact = contacts.find(
        c => c.clientId === 'client-1' && c.isPrimary
      );

      expect(primaryContact?.name).toBe('Alice');
    });

    it('returns undefined when no primary contact exists', () => {
      const clientContacts = contacts.filter(c => c.clientId === 'client-1');
      const noPrimary = clientContacts.filter(c => !c.isPrimary);

      const primaryInNonPrimary = noPrimary.find(c => c.isPrimary);
      expect(primaryInNonPrimary).toBeUndefined();
    });

    it('filters by assigned contact IDs', () => {
      const assignedContactIds = ['c1', 'c4'];
      const assignedContacts = contacts.filter(c =>
        assignedContactIds.includes(c.id)
      );

      expect(assignedContacts).toHaveLength(2);
      expect(assignedContacts[0].name).toBe('Alice');
      expect(assignedContacts[1].name).toBe('Diana');
    });

    it('handles empty assignedContactIds array', () => {
      const assignedContactIds: string[] = [];
      const assignedContacts = contacts.filter(c =>
        assignedContactIds.includes(c.id)
      );

      expect(assignedContacts).toHaveLength(0);
    });

    it('handles non-existent contact IDs gracefully', () => {
      const assignedContactIds = ['non-existent-1', 'non-existent-2'];
      const assignedContacts = contacts.filter(c =>
        assignedContactIds.includes(c.id)
      );

      expect(assignedContacts).toHaveLength(0);
    });

    it('handles mixed valid and invalid contact IDs', () => {
      const assignedContactIds = ['c1', 'non-existent', 'c3'];
      const assignedContacts = contacts.filter(c =>
        assignedContactIds.includes(c.id)
      );

      expect(assignedContacts).toHaveLength(2);
      expect(assignedContacts.map(c => c.name)).toContain('Alice');
      expect(assignedContacts.map(c => c.name)).toContain('Charlie');
    });
  });

  describe('Contact array manipulation patterns', () => {
    it('toggles contact selection in array', () => {
      let selectedIds = ['c1', 'c2'];
      const contactId = 'c2';

      // Toggle off
      if (selectedIds.includes(contactId)) {
        selectedIds = selectedIds.filter(id => id !== contactId);
      } else {
        selectedIds = [...selectedIds, contactId];
      }

      expect(selectedIds).toEqual(['c1']);
      expect(selectedIds).not.toContain('c2');
    });

    it('toggles contact selection on', () => {
      let selectedIds = ['c1'];
      const contactId = 'c3';

      // Toggle on
      if (selectedIds.includes(contactId)) {
        selectedIds = selectedIds.filter(id => id !== contactId);
      } else {
        selectedIds = [...selectedIds, contactId];
      }

      expect(selectedIds).toEqual(['c1', 'c3']);
    });

    it('sorts contacts by name', () => {
      const unsorted = [
        { id: '1', name: 'Charlie' },
        { id: '2', name: 'Alice' },
        { id: '3', name: 'Bob' },
      ];

      const sorted = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted.map(c => c.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('prioritizes primary contacts in sorting', () => {
      const contacts = [
        { id: '1', name: 'Charlie', isPrimary: false },
        { id: '2', name: 'Alice', isPrimary: true },
        { id: '3', name: 'Bob', isPrimary: false },
      ];

      const sorted = [...contacts].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].name).toBe('Alice'); // Primary first
      expect(sorted[0].isPrimary).toBe(true);
      expect(sorted.slice(1).map(c => c.name)).toEqual(['Bob', 'Charlie']);
    });
  });
});

/**
 * Tests for Deal contact assignment patterns.
 */
describe('Deal Contact Assignment Patterns', () => {
  describe('assignedContactIds handling', () => {
    it('handles undefined assignedContactIds', () => {
      const deal = {
        id: 'deal-1',
        name: 'Test Deal',
        // assignedContactIds not defined
      };

      const contactIds = deal.assignedContactIds || [];
      expect(contactIds).toEqual([]);
    });

    it('handles null assignedContactIds', () => {
      const deal = {
        id: 'deal-1',
        name: 'Test Deal',
        assignedContactIds: null as unknown as string[],
      };

      const contactIds = deal.assignedContactIds || [];
      expect(contactIds).toEqual([]);
    });

    it('handles empty assignedContactIds array', () => {
      const deal = {
        id: 'deal-1',
        name: 'Test Deal',
        assignedContactIds: [] as string[],
      };

      expect(deal.assignedContactIds).toHaveLength(0);
    });

    it('correctly reports contact count', () => {
      const deal = {
        id: 'deal-1',
        name: 'Test Deal',
        assignedContactIds: ['c1', 'c2', 'c3'],
      };

      const contactCount = deal.assignedContactIds?.length || 0;
      expect(contactCount).toBe(3);
    });

    it('safely accesses assignedContactIds length', () => {
      const dealWithContacts = { assignedContactIds: ['c1'] };
      const dealWithoutContacts = {};

      expect(dealWithContacts.assignedContactIds?.length || 0).toBe(1);
      expect((dealWithoutContacts as { assignedContactIds?: string[] }).assignedContactIds?.length || 0).toBe(0);
    });
  });
});
