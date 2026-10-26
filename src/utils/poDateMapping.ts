import type { PurchaseOrder } from '@/types/purchaseOrder';

export const acceptedAtToBusinessDate = (acceptedAt?: string | number | Date): string | undefined => {
  if (acceptedAt === undefined) return undefined;
  const date = acceptedAt instanceof Date ? acceptedAt : new Date(acceptedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const getPOPromisedDates = (po: PurchaseOrder): Record<string, string> => {
  const toDateOnly = (value?: Date | string | null): string | undefined => {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    // PO date inputs are stored as UTC-midnight dates; retain their calendar day.
    return date.toISOString().slice(0, 10);
  };
  const poDate = toDateOnly(po.expectedDeliveryDate);
  return Object.fromEntries(po.items.flatMap(item => {
    const promised = toDateOnly(item.dueDate) || poDate;
    return promised ? [[item.bomItemId, promised]] : [];
  }));
};
