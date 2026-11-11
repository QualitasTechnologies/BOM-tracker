import type { BillingEntity } from './settingsFirestore';

type Mutation = { operation: 'create' | 'update' | 'delete'; entity_id: string; expected_version: string; entity?: Record<string, unknown>; patch?: Record<string, unknown> }
  | { operation: 'set_default'; entity_id: string; expected_catalog_version: string };
type Payload = Record<string, unknown>;
type Resolution = 'committed' | 'cancelled';
interface Saved { v: 1; request: Payload; resolution?: Resolution }
interface Dependencies {
  currentUid: () => Promise<string>;
  nonce: () => string;
  callable: (body: Payload) => Promise<{ data: unknown }>;
}
const defaults: Dependencies = {
  currentUid: async () => (await import('@/firebase')).auth.currentUser?.uid || '',
  nonce: () => crypto.randomUUID(),
  callable: async body => {
    const [{ functions }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    return httpsCallable(functions, 'nativeBillingEntityOperations')(body);
  },
};
const record = (value: unknown): value is Payload => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const version = (value: unknown) => value === 'missing' || typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value);
const invalid = () => Error('The billing service returned an unexpected result. Keep the saved request and check its status.');
const recovery = () => Error('The saved billing request changed or cannot be read. Restore browser recovery storage before continuing.');
export const isNativeBillingEntityEnabled = () => import.meta.env.VITE_BOM_NATIVE_BILLING_ENTITY_WRITES_ENABLED === 'true';
export const hasPendingNativeBillingEntityRequest = (uid: string | undefined) => {
  if (!uid) return false;
  try { return sessionStorage.getItem(`pulse.billing-entity-write.v1:${JSON.stringify(uid)}`) !== null; }
  catch { return true; }
};

// One durable intent per account serialises the original Settings actions. No
// fallback to SDK writes is allowed after native transport is selected.
export function createNativeBillingEntitySession(uid: string, isCurrent: () => boolean = () => true, deps: Dependencies = defaults) {
  const key = `pulse.billing-entity-write.v1:${JSON.stringify(uid)}`;
  let state: Saved | undefined, raw: string | null = null, loaded = false, busy = false, invalidated = false, storageFailed = false;
  const guard = async () => {
    if (invalidated || !isCurrent()) throw Error('The billing screen changed. Reopen Settings.');
    if (!uid || await deps.currentUid() !== uid) throw Error('The signed-in account changed. Reopen Settings.');
    if (invalidated || !isCurrent()) throw Error('The billing screen changed. Reopen Settings.');
  };
  const load = () => {
    try {
      if (storageFailed) throw 0;
      const current = sessionStorage.getItem(key);
      if (loaded) { if (current !== raw) throw 0; return; }
      raw = current;
      if (raw !== null) {
        if (raw.length > 300000) throw 0;
        const value: unknown = JSON.parse(raw);
        if (!record(value) || value.v !== 1 || !record(value.request) || Object.keys(value).some(k => !['v', 'request', 'resolution'].includes(k))) throw 0;
        const r = value.request;
        if (r.expected_actor_uid !== uid || !validId(r.entity_id) || !validId(r.operation_id) || !['create', 'update', 'delete', 'set_default'].includes(r.operation as string)
          || value.resolution !== undefined && !['committed', 'cancelled'].includes(value.resolution as string)) throw 0;
        if (r.operation === 'set_default' ? typeof r.expected_catalog_version !== 'string' || !/^[a-f0-9]{64}$/.test(r.expected_catalog_version) : !version(r.expected_version)) throw 0;
        if (r.operation === 'create' && !record(r.entity) || r.operation === 'update' && !record(r.patch)) throw 0;
        const allowed = ['operation', 'entity_id', 'operation_id', 'expected_actor_uid', ...(r.operation === 'set_default' ? ['expected_catalog_version'] : ['expected_version']), ...(r.operation === 'create' ? ['entity'] : r.operation === 'update' ? ['patch'] : [])];
        if (Object.keys(r).some(k => !allowed.includes(k))) throw 0;
        state = value as unknown as Saved;
      }
      loaded = true;
    } catch { throw recovery(); }
  };
  const save = () => {
    try {
      if (sessionStorage.getItem(key) !== raw) throw 0;
      const next = JSON.stringify(state); sessionStorage.setItem(key, next);
      if (sessionStorage.getItem(key) !== next) throw 0;
      raw = next;
    } catch { storageFailed = true; throw recovery(); }
  };
  const call = async (body: Payload) => {
    await guard(); let response: unknown, failed = false;
    try { response = (await deps.callable(body)).data; } catch { failed = true; }
    await guard();
    if (failed) throw Error('The billing request outcome is unconfirmed. Retry or check the saved request status.');
    if (record(response) && response.ok === false && typeof response.error === 'string') {
      const messages: Record<string, string> = {
        billing_entity_version_conflict: 'This entity changed after you opened it. Check the saved request, then reopen it.',
        billing_entity_catalog_conflict: 'The entity list changed. Check the saved request, then choose the default again.',
        billing_entity_mutations_disabled: 'Billing changes are paused for rollout.',
        billing_entity_read_only: 'Billing changes are currently read-only.',
        billing_entity_forbidden: 'Your current access does not allow this billing change.',
      };
      throw Error(messages[response.error] || 'The billing request was not confirmed. Check the saved request status before another change.');
    }
    if (!record(response) || response.ok !== true) throw invalid();
    return response;
  };
  const catalog = async () => {
    const page = await call({ operation: 'catalog', expected_actor_uid: uid });
    if (!Array.isArray(page.entities) || page.entities.length > 301 || !page.entities.every(row => record(row) && validId(row.id) && typeof row.legalName === 'string')
      || new Set(page.entities.map(row => row.id)).size !== page.entities.length || typeof page.catalog_version !== 'string' || !/^[a-f0-9]{64}$/.test(page.catalog_version)) throw invalid();
    if (!record(page.permissions) || typeof page.permissions.create !== 'boolean' || typeof page.permissions.set_default !== 'boolean') throw invalid();
    return { entities: page.entities as BillingEntity[], catalog_version: page.catalog_version, permissions: page.permissions as { create: boolean; set_default: boolean } };
  };
  const exclusive = async <T,>(fn: () => Promise<T>) => {
    if (busy) throw Error('A billing request is already running.'); busy = true;
    try { await guard(); load(); return await fn(); } finally { busy = false; }
  };
  const execute = async (resolve: boolean): Promise<Resolution> => {
    if (!state) throw Error('There is no saved billing request.');
    if (state.resolution) return state.resolution;
    const result = await call({ ...state.request, ...(resolve ? { resolve_only: true } : {}) });
    load(); // Another mounted screen cannot replace an in-flight intent.
    if (resolve && result.resolution === 'cancelled') state.resolution = 'cancelled';
    else {
      if (result.entity_id !== state.request.entity_id || result.operation_id !== state.request.operation_id || result.kind !== state.request.operation || resolve && result.resolution !== 'committed') throw invalid();
      state.resolution = 'committed';
    }
    save(); return state.resolution;
  };
  return {
    invalidate() { invalidated = true; },
    pending() { try { load(); return !!state; } catch { return true; } },
    catalog: () => exclusive(catalog),
    open: (entityId: string) => exclusive(async () => {
      if (!validId(entityId)) throw invalid();
      const result = await call({ operation: 'get', entity_id: entityId, expected_actor_uid: uid });
      if (!record(result.entity) || result.entity.id !== entityId || !version(result.entity_version) || !record(result.permissions) || typeof result.permissions.edit !== 'boolean' || typeof result.permissions.delete !== 'boolean') throw invalid();
      return { entity: result.entity as unknown as BillingEntity, entity_version: result.entity_version as string, permissions: result.permissions as { edit: boolean; delete: boolean } };
    }),
    mutate: (input: Mutation) => exclusive(async () => {
      if (state) throw Error('Check the saved billing request before another change.');
      const operation_id = deps.nonce(); if (!validId(operation_id)) throw invalid();
      const request = JSON.parse(JSON.stringify({ ...input, operation_id, expected_actor_uid: uid }));
      if (JSON.stringify(request).length > 270000) throw invalid();
      state = { v: 1, request }; save();
      return execute(false);
    }),
    retry: () => exclusive(() => execute(false)),
    resolve: () => exclusive(() => execute(true)),
    acknowledge: () => exclusive(async () => {
      if (!state?.resolution) throw Error('Check the saved billing request status first.');
      const page = await catalog(); load();
      try { if (sessionStorage.getItem(key) !== raw) throw 0; sessionStorage.removeItem(key); } catch { throw recovery(); }
      state = undefined; raw = null; return page;
    }),
  };
}
