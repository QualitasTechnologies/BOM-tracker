import { describe, it, expect } from 'vitest';
import {
  validateClient,
  validateVendor,
  validatePRSettings,
  getCategoriesFlat,
  buildCategoryTree,
  validateEmail,
  type BOMCategory
} from '../settingsFirestore';

describe('validateClient', () => {
  describe('company name validation', () => {
    it('returns error when company is missing', () => {
      const errors = validateClient({});

      expect(errors).toContain('Company name is required');
    });

    it('returns error when company is empty string', () => {
      const errors = validateClient({ company: '' });

      expect(errors).toContain('Company name is required');
    });

    it('returns error when company is whitespace only', () => {
      const errors = validateClient({ company: '   ' });

      expect(errors).toContain('Company name is required');
    });

    it('passes when company is provided', () => {
      const errors = validateClient({ company: 'Acme Corp' });

      expect(errors).not.toContain('Company name is required');
    });
  });

  describe('email validation', () => {
    it('returns error for invalid email format', () => {
      const errors = validateClient({ company: 'Acme', email: 'invalid-email' });

      expect(errors).toContain('Invalid email format');
    });

    it('returns error for email without @', () => {
      const errors = validateClient({ company: 'Acme', email: 'testexample.com' });

      expect(errors).toContain('Invalid email format');
    });

    it('returns error for email without domain extension', () => {
      const errors = validateClient({ company: 'Acme', email: 'test@example' });

      expect(errors).toContain('Invalid email format');
    });

    it('passes for valid email', () => {
      const errors = validateClient({ company: 'Acme', email: 'test@example.com' });

      expect(errors).not.toContain('Invalid email format');
    });

    it('passes when email is not provided', () => {
      const errors = validateClient({ company: 'Acme' });

      expect(errors).not.toContain('Invalid email format');
    });

    it('passes when email is empty string', () => {
      const errors = validateClient({ company: 'Acme', email: '' });

      expect(errors).not.toContain('Invalid email format');
    });
  });

  describe('valid client', () => {
    it('returns empty array for valid client with all fields', () => {
      const errors = validateClient({
        company: 'Acme Corp',
        email: 'contact@acme.com',
        phone: '555-1234',
        address: '123 Main St',
        contactPerson: 'John Doe'
      });

      expect(errors).toEqual([]);
    });

    it('returns empty array for valid client with only required fields', () => {
      const errors = validateClient({ company: 'Acme Corp' });

      expect(errors).toEqual([]);
    });
  });
});

describe('validateVendor', () => {
  describe('company name validation', () => {
    it('returns error when company is missing', () => {
      const errors = validateVendor({});

      expect(errors).toContain('Company name is required');
    });

    it('returns error when company is empty', () => {
      const errors = validateVendor({ company: '' });

      expect(errors).toContain('Company name is required');
    });

    it('returns error when company is whitespace only', () => {
      const errors = validateVendor({ company: '   ' });

      expect(errors).toContain('Company name is required');
    });
  });

  describe('email validation', () => {
    it('returns error for invalid email format', () => {
      const errors = validateVendor({ company: 'Acme', email: 'not-an-email' });

      expect(errors).toContain('Invalid email format');
    });

    it('passes for valid email', () => {
      const errors = validateVendor({ company: 'Acme', email: 'vendor@acme.com' });

      expect(errors).not.toContain('Invalid email format');
    });

    it('passes when email is not provided', () => {
      const errors = validateVendor({ company: 'Acme' });

      expect(errors).not.toContain('Invalid email format');
    });
  });

  describe('rating validation', () => {
    it('returns error when rating is negative', () => {
      const errors = validateVendor({ company: 'Acme', rating: -1 });

      expect(errors).toContain('Rating must be between 0 and 5');
    });

    it('returns error when rating is greater than 5', () => {
      const errors = validateVendor({ company: 'Acme', rating: 6 });

      expect(errors).toContain('Rating must be between 0 and 5');
    });

    it('returns error when rating is 10', () => {
      const errors = validateVendor({ company: 'Acme', rating: 10 });

      expect(errors).toContain('Rating must be between 0 and 5');
    });

    it('passes for rating of 0', () => {
      const errors = validateVendor({ company: 'Acme', rating: 0 });

      expect(errors).not.toContain('Rating must be between 0 and 5');
    });

    it('passes for rating of 5', () => {
      const errors = validateVendor({ company: 'Acme', rating: 5 });

      expect(errors).not.toContain('Rating must be between 0 and 5');
    });

    it('passes for rating of 3.5', () => {
      const errors = validateVendor({ company: 'Acme', rating: 3.5 });

      expect(errors).not.toContain('Rating must be between 0 and 5');
    });

    it('passes when rating is not provided', () => {
      const errors = validateVendor({ company: 'Acme' });

      expect(errors).not.toContain('Rating must be between 0 and 5');
    });
  });

  describe('multiple errors', () => {
    it('returns all errors when multiple fields are invalid', () => {
      const errors = validateVendor({
        company: '',
        email: 'invalid',
        rating: -5
      });

      expect(errors).toHaveLength(3);
      expect(errors).toContain('Company name is required');
      expect(errors).toContain('Invalid email format');
      expect(errors).toContain('Rating must be between 0 and 5');
    });
  });

  describe('valid vendor', () => {
    it('returns empty array for valid vendor', () => {
      const errors = validateVendor({
        company: 'Acme Corp',
        email: 'vendor@acme.com',
        rating: 4
      });

      expect(errors).toEqual([]);
    });
  });
});

describe('validatePRSettings', () => {
  describe('companyName validation', () => {
    it('returns error when companyName is missing', () => {
      const errors = validatePRSettings({
        fromEmail: 'sender@test.com',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Company name is required');
    });

    it('returns error when companyName is empty', () => {
      const errors = validatePRSettings({
        companyName: '',
        fromEmail: 'sender@test.com',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Company name is required');
    });

    it('returns error when companyName is whitespace only', () => {
      const errors = validatePRSettings({
        companyName: '   ',
        fromEmail: 'sender@test.com',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Company name is required');
    });
  });

  describe('fromEmail validation', () => {
    it('returns error when fromEmail is missing', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Sender email is required');
    });

    it('returns error when fromEmail is empty', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: '',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Sender email is required');
    });

    it('returns error when fromEmail format is invalid', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'invalid-email',
        recipients: ['recipient@test.com']
      });

      expect(errors).toContain('Invalid sender email format');
    });
  });

  describe('recipients validation', () => {
    it('returns error when recipients is missing', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'sender@test.com'
      });

      expect(errors).toContain('At least one recipient email is required');
    });

    it('returns error when recipients is empty array', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'sender@test.com',
        recipients: []
      });

      expect(errors).toContain('At least one recipient email is required');
    });

    it('returns error for invalid recipient email', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'sender@test.com',
        recipients: ['invalid-email']
      });

      expect(errors.some(e => e.includes('Invalid email format at position 1'))).toBe(true);
    });

    it('returns error for multiple invalid recipient emails with positions', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'sender@test.com',
        recipients: ['valid@test.com', 'invalid1', 'invalid2']
      });

      expect(errors.some(e => e.includes('Invalid email format at position 2'))).toBe(true);
      expect(errors.some(e => e.includes('Invalid email format at position 3'))).toBe(true);
    });
  });

  describe('valid settings', () => {
    it('returns empty array for valid settings', () => {
      const errors = validatePRSettings({
        companyName: 'Qualitas Technologies',
        fromEmail: 'info@qualitastech.com',
        recipients: ['purchasing@qualitastech.com', 'admin@qualitastech.com']
      });

      expect(errors).toEqual([]);
    });

    it('returns empty array for single recipient', () => {
      const errors = validatePRSettings({
        companyName: 'Test Co',
        fromEmail: 'sender@test.com',
        recipients: ['recipient@test.com']
      });

      expect(errors).toEqual([]);
    });
  });
});

describe('validateEmail', () => {
  it('returns true for valid email', () => {
    expect(validateEmail('test@example.com')).toBe(true);
  });

  it('returns true for email with subdomain', () => {
    expect(validateEmail('test@mail.example.com')).toBe(true);
  });

  it('returns true for email with plus sign', () => {
    expect(validateEmail('test+alias@example.com')).toBe(true);
  });

  it('returns false for email without @', () => {
    expect(validateEmail('testexample.com')).toBe(false);
  });

  it('returns false for email without domain extension', () => {
    expect(validateEmail('test@example')).toBe(false);
  });

  it('returns false for email with spaces', () => {
    expect(validateEmail('test @example.com')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateEmail('')).toBe(false);
  });
});

describe('getCategoriesFlat', () => {
  it('returns only parent categories (those without parentId)', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true },
      { id: '2', name: 'Servo Motors', parentId: '1', order: 1, isActive: true },
      { id: '3', name: 'Sensors', order: 2, isActive: true },
      { id: '4', name: 'Proximity', parentId: '3', order: 1, isActive: true }
    ];

    const result = getCategoriesFlat(categories);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Motors');
    expect(result[1].name).toBe('Sensors');
  });

  it('returns empty array for empty input', () => {
    const result = getCategoriesFlat([]);

    expect(result).toEqual([]);
  });

  it('returns empty array when all categories have parentId', () => {
    const categories: BOMCategory[] = [
      { id: '2', name: 'Servo Motors', parentId: '1', order: 1, isActive: true },
      { id: '4', name: 'Proximity', parentId: '3', order: 1, isActive: true }
    ];

    const result = getCategoriesFlat(categories);

    expect(result).toEqual([]);
  });

  it('returns all categories when none have parentId', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true },
      { id: '2', name: 'Sensors', order: 2, isActive: true },
      { id: '3', name: 'Control', order: 3, isActive: true }
    ];

    const result = getCategoriesFlat(categories);

    expect(result).toHaveLength(3);
  });
});

describe('buildCategoryTree', () => {
  it('builds tree structure with subcategories', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true },
      { id: '2', name: 'Servo Motors', parentId: '1', order: 1, isActive: true },
      { id: '3', name: 'Stepper Motors', parentId: '1', order: 2, isActive: true },
      { id: '4', name: 'Sensors', order: 2, isActive: true },
      { id: '5', name: 'Proximity', parentId: '4', order: 1, isActive: true }
    ];

    const result = buildCategoryTree(categories);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Motors');
    expect(result[0].subcategories).toHaveLength(2);
    expect(result[0].subcategories?.[0].name).toBe('Servo Motors');
    expect(result[0].subcategories?.[1].name).toBe('Stepper Motors');
    expect(result[1].name).toBe('Sensors');
    expect(result[1].subcategories).toHaveLength(1);
    expect(result[1].subcategories?.[0].name).toBe('Proximity');
  });

  it('handles categories with no subcategories', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true },
      { id: '2', name: 'Sensors', order: 2, isActive: true }
    ];

    const result = buildCategoryTree(categories);

    expect(result).toHaveLength(2);
    expect(result[0].subcategories).toEqual([]);
    expect(result[1].subcategories).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const result = buildCategoryTree([]);

    expect(result).toEqual([]);
  });

  it('handles deeply orphaned subcategories (no matching parent)', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true },
      { id: '2', name: 'Orphan', parentId: '999', order: 1, isActive: true }
    ];

    const result = buildCategoryTree(categories);

    // Only Motors should be returned, Orphan won't appear as it has no valid parent
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Motors');
    expect(result[0].subcategories).toEqual([]);
  });

  it('preserves category properties in tree structure', () => {
    const categories: BOMCategory[] = [
      { id: '1', name: 'Motors', order: 1, isActive: true, color: '#FF0000', description: 'Motor category' },
      { id: '2', name: 'Servo', parentId: '1', order: 1, isActive: false, icon: 'gear' }
    ];

    const result = buildCategoryTree(categories);

    expect(result[0].color).toBe('#FF0000');
    expect(result[0].description).toBe('Motor category');
    expect(result[0].subcategories?.[0].isActive).toBe(false);
    expect(result[0].subcategories?.[0].icon).toBe('gear');
  });
});
