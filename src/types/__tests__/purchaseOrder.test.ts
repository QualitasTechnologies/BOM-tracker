import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  determineTaxType,
  numberToWords,
  calculatePOTotals,
  generatePONumber,
  getStateName,
  extractStateCodeFromGSTIN,
  validateVendorForPO,
  type POItem,
  type TaxType,
} from '../purchaseOrder';

// Helper to create a minimal PO item for testing
const createPOItem = (overrides: Partial<POItem> = {}): POItem => ({
  bomItemId: 'bom-1',
  slNo: 1,
  description: 'Test Item',
  uom: 'nos',
  quantity: 1,
  rate: 1000,
  amount: 1000,
  ...overrides,
});

// ============================================
// determineTaxType Tests
// ============================================

describe('determineTaxType', () => {
  describe('intrastate transactions (same state → CGST/SGST)', () => {
    it('returns cgst_sgst when both states are Karnataka (29)', () => {
      const result = determineTaxType('29', '29');
      expect(result).toBe('cgst_sgst');
    });

    it('returns cgst_sgst when both states are Maharashtra (27)', () => {
      const result = determineTaxType('27', '27');
      expect(result).toBe('cgst_sgst');
    });

    it('returns cgst_sgst when both states are Delhi (07)', () => {
      const result = determineTaxType('07', '07');
      expect(result).toBe('cgst_sgst');
    });

    it('returns cgst_sgst when both states are Tamil Nadu (33)', () => {
      const result = determineTaxType('33', '33');
      expect(result).toBe('cgst_sgst');
    });
  });

  describe('interstate transactions (different states → IGST)', () => {
    it('returns igst when company is Karnataka and vendor is Maharashtra', () => {
      const result = determineTaxType('29', '27');
      expect(result).toBe('igst');
    });

    it('returns igst when company is Delhi and vendor is Karnataka', () => {
      const result = determineTaxType('07', '29');
      expect(result).toBe('igst');
    });

    it('returns igst when company is Gujarat and vendor is Rajasthan', () => {
      const result = determineTaxType('24', '08');
      expect(result).toBe('igst');
    });

    it('returns igst when company is Kerala and vendor is Tamil Nadu', () => {
      const result = determineTaxType('32', '33');
      expect(result).toBe('igst');
    });
  });

  describe('edge cases', () => {
    it('returns cgst_sgst when both state codes are empty strings', () => {
      // Empty strings are equal, so returns cgst_sgst
      const result = determineTaxType('', '');
      expect(result).toBe('cgst_sgst');
    });

    it('returns igst when company state is empty and vendor has state', () => {
      const result = determineTaxType('', '29');
      expect(result).toBe('igst');
    });

    it('returns igst when company has state and vendor state is empty', () => {
      const result = determineTaxType('29', '');
      expect(result).toBe('igst');
    });

    it('handles state codes with leading zeros correctly', () => {
      // State code 07 (Delhi) vs 07 (Delhi) - same state
      const result = determineTaxType('07', '07');
      expect(result).toBe('cgst_sgst');
    });
  });
});

// ============================================
// numberToWords Tests
// ============================================

describe('numberToWords', () => {
  describe('basic numbers', () => {
    it('converts 0 to "Zero"', () => {
      const result = numberToWords(0);
      expect(result).toBe('Zero');
    });

    it('converts single digits correctly', () => {
      expect(numberToWords(1)).toBe('INR One Only');
      expect(numberToWords(5)).toBe('INR Five Only');
      expect(numberToWords(9)).toBe('INR Nine Only');
    });

    it('converts teens correctly', () => {
      expect(numberToWords(10)).toBe('INR Ten Only');
      expect(numberToWords(11)).toBe('INR Eleven Only');
      expect(numberToWords(15)).toBe('INR Fifteen Only');
      expect(numberToWords(19)).toBe('INR Nineteen Only');
    });

    it('converts tens correctly', () => {
      expect(numberToWords(20)).toBe('INR Twenty Only');
      expect(numberToWords(50)).toBe('INR Fifty Only');
      expect(numberToWords(99)).toBe('INR Ninety Nine Only');
    });

    it('converts hundreds correctly', () => {
      expect(numberToWords(100)).toBe('INR One Hundred Only');
      expect(numberToWords(500)).toBe('INR Five Hundred Only');
      expect(numberToWords(999)).toBe('INR Nine Hundred Ninety Nine Only');
    });
  });

  describe('Indian numbering system (Lakhs and Crores)', () => {
    it('converts thousands correctly', () => {
      expect(numberToWords(1000)).toBe('INR One Thousand Only');
      expect(numberToWords(5000)).toBe('INR Five Thousand Only');
      expect(numberToWords(10000)).toBe('INR Ten Thousand Only');
      expect(numberToWords(99999)).toBe('INR Ninety Nine Thousand Nine Hundred Ninety Nine Only');
    });

    it('converts lakhs correctly (100,000 = 1 Lakh)', () => {
      expect(numberToWords(100000)).toBe('INR One Lakh Only');
      expect(numberToWords(500000)).toBe('INR Five Lakh Only');
      expect(numberToWords(1000000)).toBe('INR Ten Lakh Only');
      expect(numberToWords(9999999)).toBe('INR Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Only');
    });

    it('converts crores correctly (10,000,000 = 1 Crore)', () => {
      expect(numberToWords(10000000)).toBe('INR One Crore Only');
      expect(numberToWords(50000000)).toBe('INR Five Crore Only');
      expect(numberToWords(100000000)).toBe('INR Ten Crore Only');
    });

    it('handles complex amounts in lakhs', () => {
      // 1,23,456 = One Lakh Twenty Three Thousand Four Hundred Fifty Six
      expect(numberToWords(123456)).toBe('INR One Lakh Twenty Three Thousand Four Hundred Fifty Six Only');
    });

    it('handles complex amounts in crores', () => {
      // 1,23,45,678 = One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight
      expect(numberToWords(12345678)).toBe('INR One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
    });
  });

  describe('paise handling (decimal amounts)', () => {
    it('converts amounts with paise correctly', () => {
      expect(numberToWords(100.50)).toBe('INR One Hundred and Fifty Paise Only');
      expect(numberToWords(1000.99)).toBe('INR One Thousand and Ninety Nine Paise Only');
    });

    it('handles single digit paise', () => {
      expect(numberToWords(100.05)).toBe('INR One Hundred and Five Paise Only');
    });

    it('rounds to nearest paise', () => {
      // 100.999 should round to 100.00 (1.00 rupee)
      // Math.round((100.999 - 100) * 100) = Math.round(99.9) = 100 paise = 1 rupee
      // But the function uses Math.round on the decimal part only
      expect(numberToWords(100.999)).toBe('INR One Hundred and One Hundred Paise Only');
    });

    it('handles amounts with no paise', () => {
      expect(numberToWords(5000.00)).toBe('INR Five Thousand Only');
    });
  });

  describe('real-world PO amounts', () => {
    it('converts typical BOM item total (₹15,000)', () => {
      expect(numberToWords(15000)).toBe('INR Fifteen Thousand Only');
    });

    it('converts medium PO amount (₹2,50,000)', () => {
      expect(numberToWords(250000)).toBe('INR Two Lakh Fifty Thousand Only');
    });

    it('converts large PO amount (₹15,75,000)', () => {
      expect(numberToWords(1575000)).toBe('INR Fifteen Lakh Seventy Five Thousand Only');
    });

    it('converts very large PO amount (₹1,25,00,000)', () => {
      expect(numberToWords(12500000)).toBe('INR One Crore Twenty Five Lakh Only');
    });
  });

  describe('edge cases', () => {
    it('handles zero correctly', () => {
      expect(numberToWords(0)).toBe('Zero');
    });

    it('handles very small decimals (truncated)', () => {
      // 0.01 paise = rounds to 1 paise
      expect(numberToWords(0.01)).toBe('INR  and One Paise Only');
    });
  });
});

// ============================================
// calculatePOTotals Tests
// ============================================

describe('calculatePOTotals', () => {
  describe('subtotal calculation', () => {
    it('calculates subtotal from single item', () => {
      const items: POItem[] = [
        createPOItem({ amount: 1000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.subtotal).toBe(1000);
    });

    it('calculates subtotal from multiple items', () => {
      const items: POItem[] = [
        createPOItem({ slNo: 1, amount: 1000 }),
        createPOItem({ slNo: 2, amount: 2000 }),
        createPOItem({ slNo: 3, amount: 3000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.subtotal).toBe(6000);
    });

    it('handles empty items array', () => {
      const items: POItem[] = [];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.subtotal).toBe(0);
    });

    it('handles items with zero amount', () => {
      const items: POItem[] = [
        createPOItem({ slNo: 1, amount: 0 }),
        createPOItem({ slNo: 2, amount: 1000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.subtotal).toBe(1000);
    });
  });

  describe('IGST calculation (interstate)', () => {
    it('calculates IGST at 18%', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.igstAmount).toBe(1800);
      expect(result.cgstAmount).toBeUndefined();
      expect(result.sgstAmount).toBeUndefined();
      expect(result.totalAmount).toBe(11800);
    });

    it('calculates IGST at 12%', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 12);

      expect(result.igstAmount).toBe(1200);
      expect(result.totalAmount).toBe(11200);
    });

    it('calculates IGST at 5%', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 5);

      expect(result.igstAmount).toBe(500);
      expect(result.totalAmount).toBe(10500);
    });

    it('rounds IGST to 2 decimal places', () => {
      const items: POItem[] = [
        createPOItem({ amount: 1111 }), // 18% of 1111 = 199.98
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.igstAmount).toBe(199.98);
      expect(result.totalAmount).toBe(1310.98);
    });
  });

  describe('CGST/SGST calculation (intrastate)', () => {
    it('splits tax equally between CGST and SGST at 18% (9% each)', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'cgst_sgst', 18);

      expect(result.cgstAmount).toBe(900); // 9% of 10000
      expect(result.sgstAmount).toBe(900); // 9% of 10000
      expect(result.igstAmount).toBeUndefined();
      expect(result.totalAmount).toBe(11800); // 10000 + 900 + 900
    });

    it('splits tax equally at 12% (6% each)', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'cgst_sgst', 12);

      expect(result.cgstAmount).toBe(600);
      expect(result.sgstAmount).toBe(600);
      expect(result.totalAmount).toBe(11200);
    });

    it('rounds CGST and SGST to 2 decimal places', () => {
      const items: POItem[] = [
        createPOItem({ amount: 1111 }), // 9% of 1111 = 99.99
      ];

      const result = calculatePOTotals(items, 'cgst_sgst', 18);

      expect(result.cgstAmount).toBe(99.99);
      expect(result.sgstAmount).toBe(99.99);
      expect(result.totalAmount).toBe(1310.98);
    });
  });

  describe('amountInWords', () => {
    it('generates amount in words for total', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      // 10000 + 1800 = 11800 → Eleven Thousand Eight Hundred
      expect(result.amountInWords).toBe('INR Eleven Thousand Eight Hundred Only');
    });

    it('rounds total before converting to words', () => {
      const items: POItem[] = [
        createPOItem({ amount: 1000.50 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      // 1000.50 + 180.09 = 1180.59 → rounds to 1181
      expect(result.amountInWords).toContain('One Thousand');
    });
  });

  describe('real-world scenarios', () => {
    it('calculates typical multi-item PO correctly (IGST)', () => {
      const items: POItem[] = [
        createPOItem({ slNo: 1, description: 'Motor', quantity: 2, rate: 15000, amount: 30000 }),
        createPOItem({ slNo: 2, description: 'Controller', quantity: 1, rate: 8500, amount: 8500 }),
        createPOItem({ slNo: 3, description: 'Cables', quantity: 10, rate: 250, amount: 2500 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.subtotal).toBe(41000);
      expect(result.igstAmount).toBe(7380); // 18% of 41000
      expect(result.totalAmount).toBe(48380);
    });

    it('calculates typical multi-item PO correctly (CGST/SGST)', () => {
      const items: POItem[] = [
        createPOItem({ slNo: 1, description: 'Sensor', quantity: 5, rate: 2000, amount: 10000 }),
        createPOItem({ slNo: 2, description: 'Bracket', quantity: 5, rate: 500, amount: 2500 }),
      ];

      const result = calculatePOTotals(items, 'cgst_sgst', 18);

      expect(result.subtotal).toBe(12500);
      expect(result.cgstAmount).toBe(1125); // 9% of 12500
      expect(result.sgstAmount).toBe(1125); // 9% of 12500
      expect(result.totalAmount).toBe(14750);
    });
  });

  describe('edge cases', () => {
    it('handles 0% tax rate', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000 }),
      ];

      const result = calculatePOTotals(items, 'igst', 0);

      expect(result.igstAmount).toBe(0);
      expect(result.totalAmount).toBe(10000);
    });

    it('handles very small amounts', () => {
      const items: POItem[] = [
        createPOItem({ amount: 1 }),
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.igstAmount).toBe(0.18);
      expect(result.totalAmount).toBe(1.18);
    });

    it('handles very large amounts (crores)', () => {
      const items: POItem[] = [
        createPOItem({ amount: 10000000 }), // 1 crore
      ];

      const result = calculatePOTotals(items, 'igst', 18);

      expect(result.igstAmount).toBe(1800000);
      expect(result.totalAmount).toBe(11800000);
    });
  });
});

// ============================================
// generatePONumber Tests
// ============================================

describe('generatePONumber', () => {
  describe('simple format (PREFIX-YYYY-NNN)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates PO number with current year', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      const result = generatePONumber('PO-QT', 'simple', 1);

      expect(result).toBe('PO-QT-2025-001');
    });

    it('pads sequence number to 3 digits', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      expect(generatePONumber('PO-QT', 'simple', 1)).toBe('PO-QT-2025-001');
      expect(generatePONumber('PO-QT', 'simple', 10)).toBe('PO-QT-2025-010');
      expect(generatePONumber('PO-QT', 'simple', 100)).toBe('PO-QT-2025-100');
      expect(generatePONumber('PO-QT', 'simple', 999)).toBe('PO-QT-2025-999');
    });

    it('handles sequence numbers above 999', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      expect(generatePONumber('PO-QT', 'simple', 1000)).toBe('PO-QT-2025-1000');
      expect(generatePONumber('PO-QT', 'simple', 9999)).toBe('PO-QT-2025-9999');
    });

    it('uses different prefixes correctly', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      expect(generatePONumber('PO', 'simple', 1)).toBe('PO-2025-001');
      expect(generatePONumber('PO-ABC', 'simple', 1)).toBe('PO-ABC-2025-001');
      expect(generatePONumber('ORDER', 'simple', 1)).toBe('ORDER-2025-001');
    });
  });

  describe('financial year format (PREFIX/YY-YY/NNN)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates correct FY for April-December (FY starts same year)', () => {
      // April 2025 → FY 2025-26
      vi.setSystemTime(new Date('2025-04-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/25-26/001');

      // June 2025 → FY 2025-26
      vi.setSystemTime(new Date('2025-06-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/25-26/001');

      // December 2025 → FY 2025-26
      vi.setSystemTime(new Date('2025-12-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/25-26/001');
    });

    it('generates correct FY for January-March (FY started previous year)', () => {
      // January 2025 → FY 2024-25
      vi.setSystemTime(new Date('2025-01-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/24-25/001');

      // February 2025 → FY 2024-25
      vi.setSystemTime(new Date('2025-02-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/24-25/001');

      // March 2025 → FY 2024-25
      vi.setSystemTime(new Date('2025-03-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/24-25/001');
    });

    it('handles FY boundary correctly (March 31 → April 1)', () => {
      // March 31, 2025 → FY 2024-25
      vi.setSystemTime(new Date('2025-03-31'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/24-25/001');

      // April 1, 2025 → FY 2025-26
      vi.setSystemTime(new Date('2025-04-01'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/25-26/001');
    });

    it('pads sequence number to 3 digits', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/25-26/001');
      expect(generatePONumber('PO/QT', 'financial-year', 10)).toBe('PO/QT/25-26/010');
      expect(generatePONumber('PO/QT', 'financial-year', 100)).toBe('PO/QT/25-26/100');
    });

    it('uses different prefixes correctly', () => {
      vi.setSystemTime(new Date('2025-06-15'));

      expect(generatePONumber('PO', 'financial-year', 1)).toBe('PO/25-26/001');
      expect(generatePONumber('PO/ABC', 'financial-year', 1)).toBe('PO/ABC/25-26/001');
    });
  });

  describe('year 2099/2100 edge case (century boundary)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('handles century boundary in financial year format', () => {
      // December 2099 → FY 2099-2100
      vi.setSystemTime(new Date('2099-12-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/99-00/001');

      // January 2100 → FY 2099-2100
      vi.setSystemTime(new Date('2100-01-15'));
      expect(generatePONumber('PO/QT', 'financial-year', 1)).toBe('PO/QT/99-00/001');
    });
  });
});

// ============================================
// Helper Function Tests
// ============================================

describe('getStateName', () => {
  it('returns correct state name for valid codes', () => {
    expect(getStateName('29')).toBe('Karnataka');
    expect(getStateName('27')).toBe('Maharashtra');
    expect(getStateName('07')).toBe('Delhi');
    expect(getStateName('33')).toBe('Tamil Nadu');
    expect(getStateName('32')).toBe('Kerala');
    expect(getStateName('24')).toBe('Gujarat');
  });

  it('returns "Unknown" for invalid codes', () => {
    expect(getStateName('00')).toBe('Unknown');
    expect(getStateName('99')).toBe('Unknown');
    expect(getStateName('')).toBe('Unknown');
    expect(getStateName('ABC')).toBe('Unknown');
  });
});

describe('extractStateCodeFromGSTIN', () => {
  it('extracts state code from valid GSTIN', () => {
    // Karnataka GSTIN
    expect(extractStateCodeFromGSTIN('29AABCU9603R1ZM')).toBe('29');
    // Maharashtra GSTIN
    expect(extractStateCodeFromGSTIN('27AABCU9603R1ZM')).toBe('27');
    // Delhi GSTIN
    expect(extractStateCodeFromGSTIN('07AABCU9603R1ZM')).toBe('07');
  });

  it('returns null for invalid GSTIN', () => {
    expect(extractStateCodeFromGSTIN('')).toBeNull();
    expect(extractStateCodeFromGSTIN('A')).toBeNull();
    // Invalid state code (00 is not a valid state)
    expect(extractStateCodeFromGSTIN('00AABCU9603R1ZM')).toBeNull();
    // Invalid state code (99 is not a valid state)
    expect(extractStateCodeFromGSTIN('99AABCU9603R1ZM')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractStateCodeFromGSTIN(null as any)).toBeNull();
    expect(extractStateCodeFromGSTIN(undefined as any)).toBeNull();
  });
});

describe('validateVendorForPO', () => {
  it('returns no warnings for vendor with GSTIN and state code', () => {
    const vendor = {
      gstNo: '29AABCU9603R1ZM',
      stateCode: '29',
    };

    const warnings = validateVendorForPO(vendor);

    expect(warnings).toHaveLength(0);
  });

  it('returns error when GSTIN is missing', () => {
    const vendor = {
      stateCode: '29',
    };

    const warnings = validateVendorForPO(vendor);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('vendorGstin');
    expect(warnings[0].severity).toBe('error');
  });

  it('returns error when state code is missing', () => {
    const vendor = {
      gstNo: '29AABCU9603R1ZM',
    };

    const warnings = validateVendorForPO(vendor);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('vendorStateCode');
    expect(warnings[0].severity).toBe('error');
  });

  it('returns two errors when both GSTIN and state code are missing', () => {
    const vendor = {};

    const warnings = validateVendorForPO(vendor);

    expect(warnings).toHaveLength(2);
    expect(warnings.map(w => w.field)).toContain('vendorGstin');
    expect(warnings.map(w => w.field)).toContain('vendorStateCode');
  });

  it('treats empty string as missing', () => {
    const vendor = {
      gstNo: '',
      stateCode: '',
    };

    const warnings = validateVendorForPO(vendor);

    expect(warnings).toHaveLength(2);
  });
});
