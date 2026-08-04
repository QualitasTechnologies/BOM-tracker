import { describe, expect, it } from 'vitest';
import { calculateQuotationTotals } from '../supportQuotation';

describe('support quotation totals', () => {
  it('calculates engineering, travel, material and GST totals', () => {
    const result = calculateQuotationTotals([
      { id: '1', category: 'engineering', description: 'Engineer', hsnSac: '9983', quantity: 4, unit: 'hours', unitRate: 1500, amount: 0 },
      { id: '2', category: 'travel', description: 'Travel', quantity: 1, unit: 'trip', unitRate: 2000, amount: 0 },
      { id: '3', category: 'material', description: 'Light', quantity: 2, unit: 'nos', unitRate: 1000, amount: 0 },
    ], 18);
    expect(result.subtotal).toBe(10000);
    expect(result.taxAmount).toBe(1800);
    expect(result.total).toBe(11800);
    expect(result.lines[0].hsnSac).toBe('9983');
  });
});
