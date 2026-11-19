import { describe, it, expect } from 'vitest';
import { fetchInrRates, fxFieldsFor, itemTotalINR, itemUnitPriceINR, isForeignItem, FX_CACHE_KEY } from '../fx';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
};
const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });
const down = async () => { throw new Error('network'); };
const now = () => new Date('2026-11-19T10:00:00Z');

describe('fetchInrRates', () => {
  it('inverts "per INR" rates into INR per unit and caches them', async () => {
    const storage = memory();
    const result = await fetchInrRates({
      fetchImpl: ok({ result: 'success', time_last_update_utc: 'Thu, 19 Nov 2026 00:02:31 +0000', rates: { USD: 0.0125, EUR: 0.0108 } }),
      storage, now,
    });
    expect(result.source).toBe('live');
    expect(result.rates.USD).toBeCloseTo(80, 5);
    expect(result.date).toBe('2026-11-19');
    expect(JSON.parse(storage.getItem(FX_CACHE_KEY) as string).rates.USD).toBeCloseTo(80, 5);
  });

  it('falls back to the second provider when the first fails', async () => {
    let calls = 0;
    const result = await fetchInrRates({
      fetchImpl: async () => { calls++; if (calls === 1) throw new Error('down'); return { ok: true, json: async () => ({ date: '2026-11-18', rates: { USD: 0.02 } }) }; },
      storage: memory(), now,
    });
    expect(calls).toBe(2);
    expect(result.rates.USD).toBeCloseTo(50, 5);
    expect(result.date).toBe('2026-11-18');
  });

  it('uses the last fetched rates when every provider fails', async () => {
    const storage = memory();
    await fetchInrRates({ fetchImpl: ok({ result: 'success', rates: { USD: 0.0125 } }), storage, now });
    const result = await fetchInrRates({ fetchImpl: down, storage, now });
    expect(result.source).toBe('cached');
    expect(result.rates.USD).toBeCloseTo(80, 5);
  });

  it('throws a clear error when providers fail and nothing was cached', async () => {
    await expect(fetchInrRates({ fetchImpl: down, storage: memory(), now })).rejects.toThrow(/unavailable/i);
  });

  it('ignores a provider response that reports failure or has no usable rates', async () => {
    await expect(fetchInrRates({ fetchImpl: ok({ result: 'error' }), storage: memory(), now })).rejects.toThrow();
    await expect(fetchInrRates({ fetchImpl: ok({ rates: { USD: 0 } }), storage: memory(), now })).rejects.toThrow();
  });
});

describe('fxFieldsFor', () => {
  it('clears the fx fields for INR without calling the API', async () => {
    const fields = await fxFieldsFor('INR', { fetchImpl: down, storage: memory() });
    expect(fields).toEqual({ currency: null, fxRate: null, fxRateDate: null });
  });

  it('returns the rate and its date for a foreign currency', async () => {
    const fields = await fxFieldsFor('USD', { fetchImpl: ok({ result: 'success', rates: { USD: 0.0125 } }), storage: memory(), now });
    expect(fields.currency).toBe('USD');
    expect(fields.fxRate).toBeCloseTo(80, 5);
  });

  it('fails when the currency is missing from the rate table', async () => {
    await expect(fxFieldsFor('EUR', { fetchImpl: ok({ result: 'success', rates: { USD: 0.0125 } }), storage: memory(), now }))
      .rejects.toThrow(/EUR/);
  });
});

describe('item INR values', () => {
  it('treats items without a currency as INR', () => {
    expect(itemUnitPriceINR({ price: 100 })).toBe(100);
    expect(itemTotalINR({ price: 100, quantity: 3 })).toBe(300);
    expect(isForeignItem({ price: 100 })).toBe(false);
  });

  it('converts foreign items with their fixed rate', () => {
    const item = { price: 189.5, quantity: 2, currency: 'USD', fxRate: 84 };
    expect(isForeignItem(item)).toBe(true);
    expect(itemTotalINR(item)).toBeCloseTo(189.5 * 2 * 84, 6);
  });

  it('does not convert when the rate is missing or the currency is INR', () => {
    expect(itemTotalINR({ price: 50, quantity: 1, currency: 'USD' })).toBe(50);
    expect(itemTotalINR({ price: 50, quantity: 1, currency: 'INR', fxRate: 84 })).toBe(50);
  });
});
