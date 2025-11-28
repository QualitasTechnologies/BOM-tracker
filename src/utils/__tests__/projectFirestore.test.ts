import { describe, it, expect } from 'vitest';
import { getTotalBOMCost } from '../projectFirestore';
import type { BOMCategory, BOMItem } from '@/types/bom';

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
    it('calculates cost for single item with finalized vendor', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 2,
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
          }),
          createBOMItem({
            id: '2',
            quantity: 3,
            finalizedVendor: { name: 'Vendor B', price: 500, leadTime: '1 week', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
          })
        ]),
        createCategory('Sensors', [
          createBOMItem({
            id: '2',
            quantity: 5,
            finalizedVendor: { name: 'Vendor B', price: 200, leadTime: '1 week', availability: 'In Stock' }
          })
        ]),
        createCategory('Control', [
          createBOMItem({
            id: '3',
            quantity: 2,
            finalizedVendor: { name: 'Vendor C', price: 750, leadTime: '3 days', availability: 'In Stock' }
          })
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(3500); // 1000 + (5 * 200) + (2 * 750)
    });
  });

  describe('items without pricing', () => {
    it('returns 0 for items without finalized vendor', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({ id: '1', quantity: 10 }) // No finalizedVendor
        ])
      ];

      const result = getTotalBOMCost(categories);

      expect(result).toBe(0);
    });

    it('returns 0 for items with finalized vendor but no price', () => {
      const categories: BOMCategory[] = [
        createCategory('Motors', [
          createBOMItem({
            id: '1',
            quantity: 10,
            finalizedVendor: { name: 'Vendor A', price: undefined as any, leadTime: '2 weeks', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
          }),
          createBOMItem({ id: '2', quantity: 5 }), // No finalized vendor
          createBOMItem({
            id: '3',
            quantity: 1,
            finalizedVendor: { name: 'Vendor B', price: 500, leadTime: '1 week', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Contractor', price: 2000, leadTime: 'N/A', availability: 'Available' }
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
            finalizedVendor: { name: 'Vendor A', price: 100, leadTime: '1 day', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 0, leadTime: '2 weeks', availability: 'In Stock' }
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
            finalizedVendor: { name: 'Vendor A', price: 50000, leadTime: '4 weeks', availability: 'Special Order' }
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
            finalizedVendor: { name: 'Contractor', price: 3000, leadTime: 'N/A', availability: 'Available' } // 3000/day
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
            finalizedVendor: { name: 'Vendor A', price: 1000, leadTime: '2 weeks', availability: 'In Stock' }
          })
        ]),
        createCategory('Services', [
          createBOMItem({
            id: '2',
            itemType: 'service',
            quantity: 3, // 3 days
            finalizedVendor: { name: 'Contractor', price: 2000, leadTime: 'N/A', availability: 'Available' }
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
            finalizedVendor: { name: 'Basler', price: 25000, leadTime: '3 weeks', availability: 'In Stock' }
          }),
          createBOMItem({
            id: 'lens-1',
            name: 'Lens 16mm',
            quantity: 2,
            finalizedVendor: { name: 'Computar', price: 5000, leadTime: '1 week', availability: 'In Stock' }
          })
        ]),
        createCategory('Motors', [
          createBOMItem({
            id: 'motor-1',
            name: 'Servo Motor',
            quantity: 4,
            finalizedVendor: { name: 'Festo', price: 15000, leadTime: '2 weeks', availability: 'In Stock' }
          }),
          createBOMItem({
            id: 'motor-2',
            name: 'Stepper Motor',
            quantity: 2
            // No finalized vendor yet
          })
        ]),
        createCategory('Services', [
          createBOMItem({
            id: 'svc-1',
            name: 'Integration Services',
            itemType: 'service',
            quantity: 10, // 10 days
            finalizedVendor: { name: 'Integrator', price: 5000, leadTime: 'N/A', availability: 'Available' }
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
