import { describe, expect, it } from 'vitest';
import { acceptedAtToBusinessDate, getPOPromisedDates } from '../poDateMapping';

describe('PO date mapping', () => {
  it('uses the item promised date before the PO-level date and preserves date-only values', () => {
    expect(getPOPromisedDates({
      items: [
        { bomItemId: 'item-a', dueDate: new Date('2026-11-20T00:00:00.000Z') },
        { bomItemId: 'item-b' },
      ],
      expectedDeliveryDate: new Date('2026-11-30T00:00:00.000Z'),
    } as any)).toEqual({ 'item-a': '2026-11-20', 'item-b': '2026-11-30' });
  });

  it('does not invent promised dates when the PO has no delivery promise', () => {
    expect(getPOPromisedDates({ items: [{ bomItemId: 'item-a' }] } as any)).toEqual({});
  });

  it('uses the Asia/Kolkata calendar day from provider acceptance time', () => {
    expect(acceptedAtToBusinessDate('2026-10-17T19:00:00.000Z')).toBe('2026-10-18');
  });

  it('leaves the order date unset when the server did not return acceptedAt', () => {
    expect(acceptedAtToBusinessDate()).toBeUndefined();
  });
});
