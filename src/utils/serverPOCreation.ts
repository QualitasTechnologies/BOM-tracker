import type { CreatePOInput } from './poFirestore';
import type { CompanySettings } from '@/types/purchaseOrder';

type Deps = {
  uid: () => string | undefined;
  call: (request: Record<string, unknown>) => Promise<{ data: any }>;
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  uuid: () => string;
};
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const messages: Record<string, string> = {
  actor_forbidden: 'Your account is not approved for this action.',
  project_forbidden: 'You do not have access to this project.',
  billing_version_conflict: 'Billing details changed. Review them and retry.',
  vendor_version_conflict: 'Vendor details changed. Reopen the form and retry.',
  material_version_conflict: 'The BOM changed. Reopen the form and retry.',
  legacy_po_creation_fenced: 'PO creation is temporarily unavailable during the purchasing cutover.',
};
export function createServerPOCreator(deps: Deps) {
  return async (input: CreatePOInput, billing: CompanySettings): Promise<string> => {
    const uid = deps.uid();
    if (!uid || uid !== input.createdBy) throw new Error('Your account changed. Reopen the PO form.');
    const guard = () => { if (deps.uid() !== uid) throw new Error('Your account changed. Reopen the PO form.'); };
    const { projectId, createdBy: _actor, ...fields } = input;
    const clean = JSON.parse(JSON.stringify(fields));
    clean.items = clean.items.map(({ slNo: _serial, ...item }: Record<string, unknown>) => item);
    const legal = Object.fromEntries(['companyName','companyAddress','gstin','stateCode','stateName'].map(key => [key, billing[key as keyof CompanySettings] || '']));
    const storage = deps.storage(), key = 'bom-po-create:v1:' + JSON.stringify([uid, projectId]);
    let pending: Record<string, any> | null = null;
    try { const raw = storage.getItem(key); if (raw) pending = JSON.parse(raw); }
    catch { throw new Error('The saved PO request could not be read. Do not create another PO until the earlier request is checked.'); }
    if (pending && (pending.operation !== 'create' || pending.project_id !== projectId || pending.expected_actor_uid !== uid
      || typeof pending.po_id !== 'string' || typeof pending.operation_id !== 'string' || !pending.input || !pending.billing_snapshot)) {
      throw new Error('The saved PO request needs review before another PO can be created.');
    }
    const send = async (request: Record<string, unknown>) => {
      guard();
      const { data } = await deps.call(request);
      guard();
      return data;
    };
    if (pending && (!equal(pending.input, clean) || !equal(pending.billing_snapshot, legal))) {
      const result = await send({ ...pending, resolve_only: true });
      if (result?.ok !== true || result.project_id !== projectId || result.po_id !== pending.po_id
        || result.operation_id !== pending.operation_id || !['committed','cancelled'].includes(result.resolution)) {
        throw new Error('The earlier PO result is still unconfirmed. Check Documents before trying again.');
      }
      storage.removeItem(key);
      pending = null;
      if (result.resolution === 'committed') throw new Error('Your earlier PO was saved. Open Documents and complete that draft before creating another.');
    }
    if (!pending) {
      const opening = await send({ operation: 'open', project_id: projectId, expected_actor_uid: uid });
      if (opening?.ok !== true) throw new Error(messages[opening?.error] || 'PO creation is unavailable. Reopen the form and retry.');
      if (opening.project_id !== projectId || opening.permissions?.create !== true || typeof opening.material_version !== 'string'
        || opening.material_version === 'missing') throw new Error('You cannot create a PO here, or the current BOM could not be loaded.');
      pending = { operation: 'create', project_id: projectId, expected_actor_uid: uid,
        po_id: deps.uuid(), operation_id: deps.uuid(), expected_material_version: opening.material_version,
        input: clean, billing_snapshot: legal };
      // Persist BEFORE issuing the write, so a reload or lost acknowledgement
      // reuses exactly the same request and never allocates a second number.
      storage.setItem(key, JSON.stringify(pending));
    }
    let result: any;
    try { result = await send(pending); }
    catch { throw new Error('PO creation is unconfirmed. Retry with the same values to check the original request; do not create a separate order.'); }
    if (result?.ok === false && typeof result.error === 'string' && result.error !== 'po_authoring_unavailable') {
      // An error on a retry does not prove the first request never committed
      // (access might have changed after a lost acknowledgement). Settle the
      // exact receipt atomically before allowing another request/number.
      try {
        const settled = await send({ ...pending, resolve_only: true });
        if (settled?.ok === true && settled.project_id === projectId && settled.po_id === pending.po_id
          && settled.operation_id === pending.operation_id && ['committed','cancelled'].includes(settled.resolution)) {
          storage.removeItem(key);
          if (settled.resolution === 'committed') return settled.po_id;
        }
      } catch { /* Keep the durable request until its outcome is confirmed. */ }
      throw new Error(messages[result.error] || 'The PO was not created (' + result.error + '). Review the details and retry.');
    }
    if (result?.ok !== true || result.project_id !== projectId || result.po_id !== pending.po_id
      || result.operation_id !== pending.operation_id || result.kind !== 'create') {
      throw new Error('PO creation is unconfirmed. Retry with the same values to check the original request.');
    }
    storage.removeItem(key);
    return result.po_id;
  };
}
import { auth, functions } from '@/firebase';
import { httpsCallable } from 'firebase/functions';
export const createServerPurchaseOrder = createServerPOCreator({
  uid: () => auth.currentUser?.uid,
  call: payload => httpsCallable(functions, 'legacyPOCreation')(payload),
  storage: () => sessionStorage,
  uuid: () => crypto.randomUUID(),
});

