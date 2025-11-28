import { describe, it, expect } from 'vitest';
import { validateBrand } from '../brandFirestore';
import type { BrandInput } from '@/types/brand';

describe('validateBrand', () => {
  describe('brand name validation', () => {
    it('returns error when name is missing', () => {
      const brand: Partial<BrandInput> = {};

      const errors = validateBrand(brand);

      expect(errors).toContain('Brand name is required');
    });

    it('returns error when name is empty string', () => {
      const brand: Partial<BrandInput> = { name: '' };

      const errors = validateBrand(brand);

      expect(errors).toContain('Brand name is required');
    });

    it('returns error when name is only whitespace', () => {
      const brand: Partial<BrandInput> = { name: '   ' };

      const errors = validateBrand(brand);

      expect(errors).toContain('Brand name is required');
    });

    it('passes when name is valid', () => {
      const brand: Partial<BrandInput> = { name: 'Basler' };

      const errors = validateBrand(brand);

      expect(errors).not.toContain('Brand name is required');
    });
  });

  describe('website URL validation', () => {
    it('passes when website is not provided', () => {
      const brand: Partial<BrandInput> = { name: 'Test Brand' };

      const errors = validateBrand(brand);

      expect(errors).not.toContain('Invalid website URL format');
    });

    it('returns error for invalid URL format', () => {
      const brand: Partial<BrandInput> = {
        name: 'Test Brand',
        website: 'not-a-url'
      };

      const errors = validateBrand(brand);

      expect(errors).toContain('Invalid website URL format');
    });

    it('returns error for URL without protocol', () => {
      const brand: Partial<BrandInput> = {
        name: 'Test Brand',
        website: 'www.example.com'
      };

      const errors = validateBrand(brand);

      expect(errors).toContain('Invalid website URL format');
    });

    it('passes for valid http URL', () => {
      const brand: Partial<BrandInput> = {
        name: 'Test Brand',
        website: 'http://example.com'
      };

      const errors = validateBrand(brand);

      expect(errors).not.toContain('Invalid website URL format');
    });

    it('passes for valid https URL', () => {
      const brand: Partial<BrandInput> = {
        name: 'Test Brand',
        website: 'https://www.basler.com'
      };

      const errors = validateBrand(brand);

      expect(errors).not.toContain('Invalid website URL format');
    });

    it('passes for URL with path', () => {
      const brand: Partial<BrandInput> = {
        name: 'Test Brand',
        website: 'https://example.com/products/cameras'
      };

      const errors = validateBrand(brand);

      expect(errors).not.toContain('Invalid website URL format');
    });
  });

  describe('complete validation', () => {
    it('returns no errors for valid brand', () => {
      const brand: Partial<BrandInput> = {
        name: 'Cognex',
        website: 'https://www.cognex.com',
        status: 'active'
      };

      const errors = validateBrand(brand);

      expect(errors).toHaveLength(0);
    });

    it('returns multiple errors when multiple fields are invalid', () => {
      const brand: Partial<BrandInput> = {
        name: '',
        website: 'invalid-url'
      };

      const errors = validateBrand(brand);

      expect(errors).toHaveLength(2);
      expect(errors).toContain('Brand name is required');
      expect(errors).toContain('Invalid website URL format');
    });

    it('allows brand with only required name field', () => {
      const brand: Partial<BrandInput> = {
        name: 'Simple Brand'
      };

      const errors = validateBrand(brand);

      expect(errors).toHaveLength(0);
    });
  });
});
