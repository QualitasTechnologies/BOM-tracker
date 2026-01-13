import { describe, it, expect } from 'vitest';
import { getTotalBOMCost, batchUpdateItemStatus } from '../projectFirestore';
import type { BOMCategory, BOMItem, BOMStatus } from '@/types/bom';

// Helper function to create a minimal BOM item
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

// Helper function to create a BOM category
const createCategory = (name: string, items: BOMItem[]): BOMCategory => ({
  name,
  items,
  isExpanded: true
});

describe('getTotalBOMCost', () => {
  describe('basic cost calculation', () => {
    it('calculates cost for single item with price', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 2,
            price: 1000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(2000); // 2 * 1000
    });

    it('calculates cost for multiple items in single category', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 2,
            price: 1000,
          }),
          createBOMItem({
            id: '2',
            quantity: 3,
            price: 500,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(3500); // (2 * 1000) + (3 * 500)
    });

    it('calculates cost across multiple categories', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 1,
            price: 1000,
          })
        ]),
        createCategory('Sensors', [
          createBOMItem({
            id: '2',
            quantity: 5,
            price: 200,
          })
        ]),
        createCategory('Control', [
          createBOMItem({
            id: '3',
            quantity: 2,
            price: 750,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(3500); // 1000 + (5 * 200) + (2 * 750)
    });
  });

  describe('items without pricing', () => {
    it('returns 0 for items without price', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: '1', quantity: 10 }) // No price
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(0);
    });

    it('returns 0 for items with undefined price', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 10,
            price: undefined as any,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(0);
    });

    it('skips items without price but includes items with price', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 2,
            price: 1000,
          }),
          createBOMItem({ id: '2', quantity: 5 }), // No price
          createBOMItem({
            id: '3',
            quantity: 1,
            price: 500,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(2500); // (2 * 1000) + 0 + (1 * 500)
    });
  });

  describe('quantity handling', () => {
    it('uses quantity of 1 when quantity is undefined', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: undefined as any,
            price: 1000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(1000); // Uses default of 1
    });

    it('handles quantity of 0 (uses default of 1 when falsy)', () => {
      // Note: The implementation uses (item.quantity || 1), so 0 becomes 1
      // This is intentional to prevent accidental zero-cost items
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 0,
            price: 1000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      // 0 is falsy, so it falls back to 1
      expect(result).toBe(1000);
    });

    it('handles fractional quantities (for services with 0.5 day minimum)', () => {
      const categories: BOMCategory[] = [
        createCategory('Services', [
          createBOMItem({
            id: '1',
            itemType: 'service',
            quantity: 0.5, // Half day
            price: 2000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(1000); // 0.5 * 2000
    });

    it('handles decimal quantities for precise costing', () => {
      const categories: BOMCategory[] = [
        createCategory('Materials', [
          createBOMItem({
            id: '1',
            quantity: 1.5,
            price: 100,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(150); // 1.5 * 100
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty categories array', () => {
      const result = getTotalBOMCost([]);

      expect(result).toBe(0);
    });

    it('returns 0 for categories with empty items arrays', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', []),
        createCategory('Sensors', [])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(0);
    });

    it('handles price of 0', () => {
      const categories: BOMCategory[] = [
        createCategory('Free Samples', [
          createBOMItem({
            id: '1',
            quantity: 10,
            price: 0,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(0);
    });

    it('handles large quantities and prices', () => {
      const categories: BOMCategory[] = [
        createCategory('Expensive Items', [
          createBOMItem({
            id: '1',
            quantity: 1000,
            price: 50000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(50000000); // 1000 * 50000
    });
  });

  describe('services vs components', () => {
    it('calculates cost the same way for services (duration * rate)', () => {
      const categories: BOMCategory[] = [
        createCategory('Services', [
          createBOMItem({
            id: '1',
            itemType: 'service',
            quantity: 5, // 5 days
            price: 3000, // 3000/day
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(15000); // 5 days * 3000/day
    });

    it('calculates combined cost of components and services', () => {
      const categories: BOMCategory[] = [
        createCategory('Components', [
          createBOMItem({
            id: '1',
            itemType: 'component',
            quantity: 2,
            price: 1000,
          })
        ]),
        createCategory('Services', [
          createBOMItem({
            id: '2',
            itemType: 'service',
            quantity: 3, // 3 days
            price: 2000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(8000); // (2 * 1000) + (3 * 2000)
    });
  });

  describe('real-world scenarios', () => {
    it('calculates total for a typical BOM with mixed items', () => {
      const categories: BOMCategory[] = [
        createCategory('Vision Systems', [
          createBOMItem({
            id: 'cam-1',
            name: 'Basler Camera',
            quantity: 2,
            price: 25000,
          }),
          createBOMItem({
            id: 'lens-1',
            name: 'Lens 16mm',
            quantity: 2,
            price: 5000,
          })
        ]),
        createCategory('Motors', [
          createBOMItem({
            id: 'motor-1',
            name: 'Servo Motor',
            quantity: 4,
            price: 15000,
          }),
          createBOMItem({
            id: 'motor-2',
            name: 'Stepper Motor',
            quantity: 2
            // No price yet
          })
        ]),
        createCategory('Services', [
          createBOMItem({
            id: 'svc-1',
            name: 'Integration Services',
            itemType: 'service',
            quantity: 10, // 10 days
            price: 5000,
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      // Vision: (2 * 25000) + (2 * 5000) = 60000
      // Motors: (4 * 15000) + 0 = 60000
      // Services: (10 * 5000) = 50000
      // Total: 170000
      expect(result).toBe(170000);
    });
  });
});

describe('batchUpdateItemStatus', () => {
  describe('basic functionality', () => {
    it('updates a single item status', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      expect(result[0].items[0].status).toBe('ordered');
    });

    it('updates multiple items in same category', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
          createBOMItem({ id: 'item-2', status: 'not-ordered' }),
          createBOMItem({ id: 'item-3', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1', 'item-2'], 'ordered');

      expect(result[0].items[0].status).toBe('ordered');
      expect(result[0].items[1].status).toBe('ordered');
      expect(result[0].items[2].status).toBe('not-ordered'); // Not in the list
    });

    it('updates items across multiple categories', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'motor-1', status: 'not-ordered' }),
        ]),
        createCategory('Sensors', [
          createBOMItem({ id: 'sensor-1', status: 'not-ordered' }),
        ]),
        createCategory('Control', [
          createBOMItem({ id: 'control-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(
        categories,
        ['motor-1', 'control-1'],
        'ordered'
      );

      expect(result[0].items[0].status).toBe('ordered');     // motor-1
      expect(result[1].items[0].status).toBe('not-ordered'); // sensor-1 (not updated)
      expect(result[2].items[0].status).toBe('ordered');     // control-1
    });
  });

  describe('edge cases', () => {
    it('handles empty itemIds array', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, [], 'ordered');

      expect(result[0].items[0].status).toBe('not-ordered'); // Unchanged
    });

    it('handles non-existent itemIds gracefully', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['non-existent'], 'ordered');

      expect(result[0].items[0].status).toBe('not-ordered'); // Unchanged
    });

    it('handles empty categories array', () => {
      const result = batchUpdateItemStatus([], ['item-1'], 'ordered');

      expect(result).toEqual([]);
    });

    it('handles category with empty items array', () => {
      const categories: BOMCategory[] = [
        createCategory('Empty Category', [])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      expect(result[0].items).toEqual([]);
    });
  });

  describe('immutability', () => {
    it('does not mutate the original categories', () => {
      const originalItem = createBOMItem({ id: 'item-1', status: 'not-ordered' });
      const categories: BOMCategory[] = [
        createCategory('Motors', [originalItem])
      ];

      batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      // Original should be unchanged
      expect(categories[0].items[0].status).toBe('not-ordered');
      expect(originalItem.status).toBe('not-ordered');
    });

    it('returns new array references', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      expect(result).not.toBe(categories);
      expect(result[0]).not.toBe(categories[0]);
      expect(result[0].items).not.toBe(categories[0].items);
      expect(result[0].items[0]).not.toBe(categories[0].items[0]);
    });
  });

  describe('status transitions', () => {
    it('can update from not-ordered to ordered', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'not-ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      expect(result[0].items[0].status).toBe('ordered');
    });

    it('can update from ordered to received', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'item-1', status: 'ordered' }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'received');

      expect(result[0].items[0].status).toBe('received');
    });

    it('preserves other item properties when updating status', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: 'item-1',
            name: 'Test Motor',
            quantity: 5,
            price: 1000,
            status: 'not-ordered',
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
          }),
        ])
      ];

      const result = batchUpdateItemStatus(categories, ['item-1'], 'ordered');

      expect(result[0].items[0]).toEqual({
        ...categories[0].items[0],
        status: 'ordered'
      });
      expect(result[0].items[0].name).toBe('Test Motor');
      expect(result[0].items[0].quantity).toBe(5);
      expect(result[0].items[0].finalizedVendor?.name).toBe('Vendor A');
    });
  });

  describe('PO send scenario (the bug this function fixes)', () => {
    it('updates all items in a PO atomically - preventing race condition', () => {
      // This test simulates what happens when a PO with 3 items is sent
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: 'po-item-1', name: 'Motor A', status: 'not-ordered' }),
          createBOMItem({ id: 'po-item-2', name: 'Motor B', status: 'not-ordered' }),
          createBOMItem({ id: 'other-item', name: 'Motor C', status: 'not-ordered' }),
        ]),
        createCategory('Sensors', [
          createBOMItem({ id: 'po-item-3', name: 'Sensor A', status: 'not-ordered' }),
        ])
      ];

      // PO contains items 1, 2, and 3
      const poItemIds = ['po-item-1', 'po-item-2', 'po-item-3'];

      const result = batchUpdateItemStatus(categories, poItemIds, 'ordered');

      // All PO items should be ordered
      expect(result[0].items[0].status).toBe('ordered'); // po-item-1
      expect(result[0].items[1].status).toBe('ordered'); // po-item-2
      expect(result[1].items[0].status).toBe('ordered'); // po-item-3

      // Non-PO item should remain not-ordered
      expect(result[0].items[2].status).toBe('not-ordered'); // other-item
    });
  });
});
