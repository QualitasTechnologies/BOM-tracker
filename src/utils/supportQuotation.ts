import type { SupportQuotationLine } from '@/types/support';

export const calculateQuotationTotals = (
  lines: SupportQuotationLine[],
  taxPercent: number,
) => {
  const normalizedLines = lines.map((line) => ({
    ...line,
    quantity: Number(line.quantity) || 0,
    unitRate: Number(line.unitRate) || 0,
    amount: Math.round((Number(line.quantity) || 0) * (Number(line.unitRate) || 0) * 100) / 100,
  }));
  const subtotal = Math.round(normalizedLines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const safeTaxPercent = Math.max(0, Number(taxPercent) || 0);
  const taxAmount = Math.round(subtotal * safeTaxPercent) / 100;
  return {
    lines: normalizedLines,
    subtotal,
    taxAmount,
    total: Math.round((subtotal + taxAmount) * 100) / 100,
  };
};

export const createQuotationLine = (
  category: SupportQuotationLine['category'],
): SupportQuotationLine => ({
  id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  category,
  description:
    category === 'engineering'
      ? 'Engineering support services'
      : category === 'travel'
        ? 'Travel and site expenses'
        : 'Material / replacement part',
  quantity: 1,
  unit: category === 'engineering' ? 'hours' : category === 'travel' ? 'trip' : 'nos',
  unitRate: 0,
  amount: 0,
});
