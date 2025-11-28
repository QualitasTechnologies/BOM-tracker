import { describe, it, expect } from 'vitest';
import { parseVendorCSV, validateVendorData, parseBrandCSV, validateBrandData } from '../csvImport';

describe('parseVendorCSV', () => {
  describe('basic parsing', () => {
    it('parses a valid CSV with all columns', () => {
      const csv = `Company,Type,Makes,Email,Phone,Website,Logo,PaymentTerms,LeadTime,Address,ContactPerson,Categories,Notes
Acme Corp,OEM,Brand A; Brand B,acme@test.com,555-1234,www.acme.com,,Net 30,2 weeks,123 Main St,John Doe,Motors; Sensors,Test note`;

      const result = parseVendorCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0].vendor.company).toBe('Acme Corp');
      expect(result[0].vendor.type).toBe('OEM');
      expect(result[0].vendor.makes).toEqual(['Brand A', 'Brand B']);
      expect(result[0].vendor.email).toBe('acme@test.com');
      expect(result[0].vendor.phone).toBe('555-1234');
      expect(result[0].vendor.website).toBe('www.acme.com');
      expect(result[0].vendor.paymentTerms).toBe('Net 30');
      expect(result[0].vendor.leadTime).toBe('2 weeks');
      expect(result[0].vendor.address).toBe('123 Main St');
      expect(result[0].vendor.contactPerson).toBe('John Doe');
      expect(result[0].vendor.categories).toEqual(['Motors', 'Sensors']);
      expect(result[0].vendor.notes).toBe('Test note');
      expect(result[0].lineNumber).toBe(2);
    });

    it('parses multiple vendor rows', () => {
      const csv = `Company,Type,Email
Vendor A,OEM,a@test.com
Vendor B,Dealer,b@test.com
Vendor C,OEM,c@test.com`;

      const result = parseVendorCSV(csv);

      expect(result).toHaveLength(3);
      expect(result[0].vendor.company).toBe('Vendor A');
      expect(result[1].vendor.company).toBe('Vendor B');
      expect(result[2].vendor.company).toBe('Vendor C');
      expect(result[0].lineNumber).toBe(2);
      expect(result[1].lineNumber).toBe(3);
      expect(result[2].lineNumber).toBe(4);
    });
  });

  describe('quote handling', () => {
    it('handles quoted fields with commas', () => {
      const csv = `Company,Address
"Acme, Inc.","123 Main St, Suite 100"`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.company).toBe('Acme, Inc.');
      expect(result[0].vendor.address).toBe('123 Main St, Suite 100');
    });

    it('handles escaped quotes (double quotes)', () => {
      const csv = `Company,Notes
"Test ""Company"" Name","He said ""Hello"""`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.company).toBe('Test "Company" Name');
      expect(result[0].vendor.notes).toBe('He said "Hello"');
    });

    it('handles empty quoted fields', () => {
      const csv = `Company,Email,Notes
"Test Co","",""`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.company).toBe('Test Co');
      expect(result[0].vendor.email).toBe('');
      expect(result[0].vendor.notes).toBe('');
    });
  });

  describe('type validation', () => {
    it('sets type to "OEM" when specified', () => {
      const csv = `Company,Type
Test Corp,OEM`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.type).toBe('OEM');
    });

    it('sets type to "Dealer" when specified', () => {
      const csv = `Company,Type
Test Corp,Dealer`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.type).toBe('Dealer');
    });

    it('defaults to "Dealer" for invalid type values', () => {
      const csv = `Company,Type
Test Corp,InvalidType`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.type).toBe('Dealer');
    });

    it('defaults to "Dealer" when type is empty', () => {
      const csv = `Company,Type
Test Corp,`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.type).toBe('Dealer');
    });
  });

  describe('makes/brands parsing', () => {
    it('splits makes by semicolon', () => {
      const csv = `Company,Makes
Test Corp,Brand A; Brand B; Brand C`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.makes).toEqual(['Brand A', 'Brand B', 'Brand C']);
    });

    it('handles single make', () => {
      const csv = `Company,Makes
Test Corp,Brand A`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.makes).toEqual(['Brand A']);
    });

    it('handles empty makes', () => {
      const csv = `Company,Makes
Test Corp,`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.makes).toEqual([]);
    });

    it('filters empty strings from makes', () => {
      const csv = `Company,Makes
Test Corp,Brand A; ; Brand B; `;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.makes).toEqual(['Brand A', 'Brand B']);
    });

    it('supports "Brands" as alternative header name', () => {
      const csv = `Company,Brands
Test Corp,Brand A; Brand B`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.makes).toEqual(['Brand A', 'Brand B']);
    });
  });

  describe('categories parsing', () => {
    it('splits categories by semicolon', () => {
      const csv = `Company,Categories
Test Corp,Motors; Sensors; Control Systems`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.categories).toEqual(['Motors', 'Sensors', 'Control Systems']);
    });

    it('handles empty categories', () => {
      const csv = `Company,Categories
Test Corp,`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.categories).toEqual([]);
    });
  });

  describe('default values', () => {
    it('sets default paymentTerms when empty', () => {
      const csv = `Company,PaymentTerms
Test Corp,`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.paymentTerms).toBe('Net 30');
    });

    it('sets default leadTime when empty', () => {
      const csv = `Company,LeadTime
Test Corp,`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.leadTime).toBe('2 weeks');
    });
  });

  describe('legacy support', () => {
    it('supports "Name" as alternative to "Company" header', () => {
      const csv = `Name,Email
Test Corp,test@test.com`;

      const result = parseVendorCSV(csv);

      expect(result[0].vendor.company).toBe('Test Corp');
    });
  });

  describe('error handling', () => {
    it('throws error for empty CSV', () => {
      expect(() => parseVendorCSV('')).toThrow('CSV file must contain at least a header row and one data row');
    });

    it('throws error for header-only CSV', () => {
      expect(() => parseVendorCSV('Company,Email,Phone')).toThrow('CSV file must contain at least a header row and one data row');
    });
  });
});

describe('validateVendorData', () => {
  describe('company validation', () => {
    it('returns error when company is missing', () => {
      const errors = validateVendorData({}, 2);

      expect(errors).toContain('Line 2: Company is required');
    });

    it('returns error when company is empty string', () => {
      const errors = validateVendorData({ company: '' }, 2);

      expect(errors).toContain('Line 2: Company is required');
    });

    it('returns error when company is whitespace only', () => {
      const errors = validateVendorData({ company: '   ' }, 2);

      expect(errors).toContain('Line 2: Company is required');
    });

    it('passes when company is provided', () => {
      const errors = validateVendorData({ company: 'Acme Corp' }, 2);

      expect(errors).not.toContain('Line 2: Company is required');
    });
  });

  describe('email validation', () => {
    it('returns error for invalid email format', () => {
      const errors = validateVendorData({ company: 'Acme', email: 'invalid-email' }, 2);

      expect(errors).toContain('Line 2: Invalid email format');
    });

    it('returns error for email without domain', () => {
      const errors = validateVendorData({ company: 'Acme', email: 'test@' }, 2);

      expect(errors).toContain('Line 2: Invalid email format');
    });

    it('returns error for email without @ symbol', () => {
      const errors = validateVendorData({ company: 'Acme', email: 'test.com' }, 2);

      expect(errors).toContain('Line 2: Invalid email format');
    });

    it('passes for valid email', () => {
      const errors = validateVendorData({ company: 'Acme', email: 'test@example.com' }, 2);

      expect(errors).not.toContain('Line 2: Invalid email format');
    });

    it('passes when email is not provided', () => {
      const errors = validateVendorData({ company: 'Acme' }, 2);

      expect(errors).not.toContain('Line 2: Invalid email format');
    });

    it('passes when email is empty string', () => {
      const errors = validateVendorData({ company: 'Acme', email: '' }, 2);

      expect(errors).not.toContain('Line 2: Invalid email format');
    });
  });

  describe('website validation', () => {
    it('returns error for invalid website format', () => {
      const errors = validateVendorData({ company: 'Acme', website: 'not a url at all' }, 2);

      expect(errors).toContain('Line 2: Invalid website format');
    });

    it('passes for valid website with protocol', () => {
      const errors = validateVendorData({ company: 'Acme', website: 'https://example.com' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });

    it('passes for valid website without protocol (auto-adds https)', () => {
      const errors = validateVendorData({ company: 'Acme', website: 'example.com' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });

    it('passes for valid website with www', () => {
      const errors = validateVendorData({ company: 'Acme', website: 'www.example.com' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });

    it('passes when website is not provided', () => {
      const errors = validateVendorData({ company: 'Acme' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });
  });

  describe('multiple errors', () => {
    it('returns multiple errors when multiple fields are invalid', () => {
      const errors = validateVendorData({
        company: '',
        email: 'invalid',
        website: 'not a url'
      }, 5);

      expect(errors).toHaveLength(3);
      expect(errors).toContain('Line 5: Company is required');
      expect(errors).toContain('Line 5: Invalid email format');
      expect(errors).toContain('Line 5: Invalid website format');
    });
  });

  describe('valid vendor', () => {
    it('returns empty array for fully valid vendor', () => {
      const errors = validateVendorData({
        company: 'Acme Corp',
        email: 'test@acme.com',
        website: 'https://acme.com',
        phone: '555-1234',
        address: '123 Main St'
      }, 2);

      expect(errors).toEqual([]);
    });
  });
});

describe('parseBrandCSV', () => {
  describe('basic parsing', () => {
    it('parses a valid brand CSV', () => {
      const csv = `Name,Website,Description,Status
Basler,https://basler.com,Camera manufacturer,active
Cognex,https://cognex.com,Vision systems,inactive`;

      const result = parseBrandCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0].brand.name).toBe('Basler');
      expect(result[0].brand.website).toBe('https://basler.com');
      expect(result[0].brand.description).toBe('Camera manufacturer');
      expect(result[0].brand.status).toBe('active');
      expect(result[0].lineNumber).toBe(2);

      expect(result[1].brand.name).toBe('Cognex');
      expect(result[1].brand.status).toBe('inactive');
      expect(result[1].lineNumber).toBe(3);
    });

    it('supports alternative header names', () => {
      const csv = `Brand,URL,Desc
TestBrand,https://test.com,Test description`;

      const result = parseBrandCSV(csv);

      expect(result[0].brand.name).toBe('TestBrand');
      expect(result[0].brand.website).toBe('https://test.com');
      expect(result[0].brand.description).toBe('Test description');
    });

    it('supports "BrandName" header', () => {
      const csv = `BrandName,Website
TestBrand,https://test.com`;

      const result = parseBrandCSV(csv);

      expect(result[0].brand.name).toBe('TestBrand');
    });
  });

  describe('status handling', () => {
    it('defaults to active for non-inactive status', () => {
      const csv = `Name,Status
Brand A,active
Brand B,
Brand C,unknown`;

      const result = parseBrandCSV(csv);

      expect(result[0].brand.status).toBe('active');
      expect(result[1].brand.status).toBe('active');
      expect(result[2].brand.status).toBe('active');
    });

    it('sets inactive when explicitly specified', () => {
      const csv = `Name,Status
Brand A,inactive`;

      const result = parseBrandCSV(csv);

      expect(result[0].brand.status).toBe('inactive');
    });
  });

  describe('error handling', () => {
    it('throws error for empty CSV', () => {
      expect(() => parseBrandCSV('')).toThrow('CSV file must contain at least a header row and one data row');
    });

    it('throws error for header-only CSV', () => {
      expect(() => parseBrandCSV('Name,Website,Status')).toThrow('CSV file must contain at least a header row and one data row');
    });
  });
});

describe('validateBrandData', () => {
  describe('name validation', () => {
    it('returns error when name is missing', () => {
      const errors = validateBrandData({}, 2);

      expect(errors).toContain('Line 2: Brand name is required');
    });

    it('returns error when name is empty', () => {
      const errors = validateBrandData({ name: '' }, 3);

      expect(errors).toContain('Line 3: Brand name is required');
    });

    it('returns error when name is whitespace only', () => {
      const errors = validateBrandData({ name: '   ' }, 4);

      expect(errors).toContain('Line 4: Brand name is required');
    });

    it('passes when name is provided', () => {
      const errors = validateBrandData({ name: 'Basler' }, 2);

      expect(errors.filter(e => e.includes('Brand name'))).toHaveLength(0);
    });
  });

  describe('website validation', () => {
    it('returns error for invalid website', () => {
      const errors = validateBrandData({ name: 'Basler', website: 'not a url' }, 2);

      expect(errors).toContain('Line 2: Invalid website format');
    });

    it('passes for valid website', () => {
      const errors = validateBrandData({ name: 'Basler', website: 'https://basler.com' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });

    it('passes when website is not provided', () => {
      const errors = validateBrandData({ name: 'Basler' }, 2);

      expect(errors).not.toContain('Line 2: Invalid website format');
    });
  });

  describe('valid brand', () => {
    it('returns empty array for fully valid brand', () => {
      const errors = validateBrandData({
        name: 'Basler',
        website: 'https://basler.com',
        description: 'Camera manufacturer',
        status: 'active'
      }, 2);

      expect(errors).toEqual([]);
    });
  });
});
