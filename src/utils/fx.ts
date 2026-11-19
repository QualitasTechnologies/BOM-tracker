// Exchange-rate helpers for the BOM.
//
// An item priced in a foreign currency gets an INR-per-unit rate fetched on demand when
// the price is first entered; that rate is then stored on the item and never changes, so
// the item's INR cost is stable. If the live API is unreachable the last successfully
// fetched rates (kept in localStorage) are used instead.
import { resolveCurrency, SUPPORTED_CURRENCIES } from '@/types/purchaseOrder';

export interface FxSnapshot {
  rates: Record<string, number>; // INR per 1 unit of the currency
  date: string;                  // YYYY-MM-DD the rates were published
  fetchedAt: string;             // ISO time of the successful fetch
}
export interface FxResult extends FxSnapshot { source: 'live' | 'cached' }

export const FX_CACHE_KEY = 'bom-fx-rates:v1';
const PRIMARY_URL = 'https://open.er-api.com/v6/latest/INR';
const SECONDARY_URL = 'https://api.frankfurter.dev/v1/latest?base=INR';

type Deps = {
  fetchImpl?: (url: string) => Promise<{ ok: boolean; json: () => Promise<any> }>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => Date;
};

// Providers return "units of X per 1 INR"; invert to "INR per 1 unit of X".
const invert = (perInr: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCIES) {
    if (code === 'INR') continue;
    const value = perInr[code];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[code] = 1 / value;
  }
  return out;
};

const readCache = (storage: Deps['storage']): FxSnapshot | null => {
  try {
    const raw = storage?.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.rates && typeof parsed.date === 'string') return parsed as FxSnapshot;
  } catch { /* unreadable cache is treated as absent */ }
  return null;
};

const safeStorage = (): Deps['storage'] => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export async function fetchInrRates(deps: Deps = {}): Promise<FxResult> {
  const fetchImpl = deps.fetchImpl ?? ((url: string) => fetch(url));
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  const now = deps.now ?? (() => new Date());

  for (const url of [PRIMARY_URL, SECONDARY_URL]) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) continue;
      const body = await response.json();
      if (body?.result && body.result !== 'success') continue;
      const rates = invert(body?.rates ?? {});
      if (!Object.keys(rates).length) continue;
      const date = typeof body.date === 'string' ? body.date
        : typeof body.time_last_update_utc === 'string' && Number.isFinite(Date.parse(body.time_last_update_utc))
          ? new Date(body.time_last_update_utc).toISOString().slice(0, 10)
          : now().toISOString().slice(0, 10);
      const snapshot: FxSnapshot = { rates, date, fetchedAt: now().toISOString() };
      try { storage?.setItem(FX_CACHE_KEY, JSON.stringify(snapshot)); } catch { /* cache is best effort */ }
      return { ...snapshot, source: 'live' };
    } catch { /* try the next provider */ }
  }
  const cached = readCache(storage);
  if (cached) return { ...cached, source: 'cached' };
  throw new Error('Exchange rates are unavailable right now and none were saved earlier. Try again shortly.');
}

// Fields to store on an item when its price is entered in `currency`.
export async function fxFieldsFor(currency: string | undefined | null, deps: Deps = {}) {
  const code = resolveCurrency(currency);
  if (code === 'INR') return { currency: null, fxRate: null, fxRateDate: null } as const;
  const snapshot = await fetchInrRates(deps);
  const rate = snapshot.rates[code];
  if (!rate) throw new Error(`No exchange rate is available for ${code}.`);
  return { currency: code, fxRate: rate, fxRateDate: snapshot.date, source: snapshot.source } as const;
}

type Priced = { price?: number; quantity?: number; currency?: string; fxRate?: number };

// INR value of one unit: foreign-currency items use their fixed rate; anything else is INR.
export const itemUnitPriceINR = (item: Priced): number => {
  const price = item.price || 0;
  const foreign = item.currency && item.currency !== 'INR' && typeof item.fxRate === 'number' && item.fxRate > 0;
  return foreign ? price * (item.fxRate as number) : price;
};
export const itemTotalINR = (item: Priced): number => itemUnitPriceINR(item) * (item.quantity || 1);

export const isForeignItem = (item: Priced): boolean =>
  !!item.currency && item.currency !== 'INR' && typeof item.fxRate === 'number' && item.fxRate > 0;
