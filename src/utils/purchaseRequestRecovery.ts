import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '@/firebase';
export type PurchaseRequestPending = {
  version: 1;
  uid: string;
  projectId: string;
  body: Record<string, any>;
};
export type PurchaseRequestResult = {
  ok: true;
  success: boolean;
  status:
    | 'sent'
    | 'cancelled'
    | 'sending'
    | 'uncertain'
    | 'needs_reconciliation';
  operation_id: string;
  emailId?: string;
  recipients?: string[];
  can_retry?: boolean;
};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Locks = {
  request: <T>(name: string, work: () => T | Promise<T>) => Promise<T>;
};
type Options = { storage?: Store; locks?: Locks | null };
const key = (uid: string, p: string) =>
  `bom:purchase-request:${encodeURIComponent(uid)}:${encodeURIComponent(p)}`;
const fail = () =>
  new Error(
    'Saved purchase request cannot be verified. Keep it for recovery and contact your administrator.'
  );
export function readPurchaseRequest(
  uid: string,
  projectId: string,
  storage: Store = localStorage
): PurchaseRequestPending | null {
  const raw = storage.getItem(key(uid, projectId));
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw);
    if (
      raw.length > 300000 ||
      p.version !== 1 ||
      p.uid !== uid ||
      p.projectId !== projectId ||
      p.body?.expected_actor_uid !== uid ||
      p.body?.projectDetails?.projectId !== projectId ||
      typeof p.body?.operation_id !== 'string' ||
      !/^[-\w]{1,128}$/.test(p.body.operation_id) ||
      !Array.isArray(p.body.categories) ||
      !Array.isArray(p.body.recipients)
    )
      throw fail();
    return p;
  } catch {
    throw fail();
  }
}
async function locked<T>(
  uid: string,
  projectId: string,
  options: Options,
  work: (storage: Store) => T | Promise<T>
): Promise<T> {
  const locks = options.locks === undefined ? navigator.locks : options.locks;
  if (!locks?.request)
    throw new Error(
      'This browser cannot safely save a purchase request. Use a current supported browser.'
    );
  return locks.request(key(uid, projectId), () =>
    work(options.storage || localStorage)
  );
}
export async function beginPurchaseRequest(
  uid: string,
  projectId: string,
  body: Record<string, any>,
  options: Options = {}
) {
  if (
    !uid ||
    !projectId ||
    body.projectDetails?.projectId !== projectId ||
    auth.currentUser?.uid !== uid
  )
    throw new Error('Account or project changed. Reopen the purchase request.');
  return locked(uid, projectId, options, (storage) => {
    const existing = readPurchaseRequest(uid, projectId, storage);
    if (existing) return { pending: existing, created: false };
    const pending: PurchaseRequestPending = {
      version: 1,
      uid,
      projectId,
      body: JSON.parse(
        JSON.stringify({
          ...body,
          operation_id: crypto.randomUUID(),
          expected_actor_uid: uid,
        })
      ),
    };
    const raw = JSON.stringify(pending);
    if (raw.length > 300000)
      throw new Error('Purchase request is too large. Select fewer items.');
    storage.setItem(key(uid, projectId), raw);
    if (storage.getItem(key(uid, projectId)) !== raw) throw fail();
    return { pending, created: true };
  });
}
export async function clearPurchaseRequest(
  uid: string,
  projectId: string,
  operationId: string,
  options: Options = {}
) {
  return locked(uid, projectId, options, (storage) => {
    const p = readPurchaseRequest(uid, projectId, storage);
    if (p?.body.operation_id === operationId)
      storage.removeItem(key(uid, projectId));
  });
}
async function invoke(body: Record<string, any>) {
  try {
    return await httpsCallable(getFunctions(), 'sendPurchaseRequest')(body);
  } catch (error: any) {
    const messages: Record<string, string> = {
      project_forbidden:
        'Your current account cannot send purchase requests for this project.',
      actor_forbidden:
        'Your current account cannot send purchase requests for this project.',
      purchase_request_forbidden:
        'Your current account cannot send the selected project items.',
      actor_authentication_required:
        'Sign in again before checking the saved purchase request.',
      purchase_request_changed:
        'The selected items or quotes changed. Reopen the request and review them before sending.',
      purchase_request_pending:
        'An earlier request still needs confirmation. Close and reopen this dialog to recover it.',
      purchase_request_read_only:
        'Purchase requests are temporarily read-only. You can still check a saved request.',
      purchase_request_quote_forbidden:
        'A selected quote is no longer available for this project or your access.',
      purchase_request_settings_invalid:
        'Purchase request sender settings need administrator attention.',
      purchase_request_too_large:
        'Select fewer items before sending this purchase request.',
      invalid_purchase_request:
        'Reopen this purchase request and review the selections. Refresh the page if needed.',
    };
    throw new Error(
      messages[error?.message] ||
        'The purchase request could not be confirmed. Keep the saved request and check it again.'
    );
  }
}
export async function callPurchaseRequest(
  p: PurchaseRequestPending,
  resolveOnly = false
): Promise<PurchaseRequestResult> {
  if (auth.currentUser?.uid !== p.uid)
    throw new Error('Account changed. Reopen the purchase request.');
  const { data } = await invoke({
    ...p.body,
    ...(resolveOnly ? { resolve_only: true } : {}),
  });
  if (auth.currentUser?.uid !== p.uid)
    throw new Error('Account changed. Keep this request for recovery.');
  const r = data as PurchaseRequestResult;
  if (
    !r ||
    r.ok !== true ||
    r.operation_id !== p.body.operation_id ||
    ![
      'sent',
      'cancelled',
      'sending',
      'uncertain',
      'needs_reconciliation',
    ].includes(r.status) ||
    r.success !== (r.status === 'sent') ||
    (r.status === 'sent' &&
      (typeof r.emailId !== 'string' ||
        !r.emailId ||
        !Array.isArray(r.recipients) ||
        r.recipients.some((v) => typeof v !== 'string'))) ||
    (r.status !== 'sent' &&
      r.status !== 'cancelled' &&
      typeof r.can_retry !== 'boolean')
  )
    throw new Error(
      'Purchase request outcome is unconfirmed. Keep the saved request and check it again.'
    );
  return r;
}

export async function recoverPurchaseRequest(
  uid: string,
  projectId: string,
  options: Options = {}
): Promise<PurchaseRequestPending | null> {
  if (auth.currentUser?.uid !== uid)
    throw new Error('Account changed. Reopen the purchase request.');
  const { data } = await invoke({
    operation: 'recover',
    project_id: projectId,
    expected_actor_uid: uid,
  });
  if (auth.currentUser?.uid !== uid)
    throw new Error('Account changed. Keep the saved request for recovery.');
  const r = data as { ok?: boolean; pending?: Record<string, any> | null };
  if (r?.ok !== true || r.pending === undefined) throw fail();
  if (r.pending === null) return null;
  const pending: PurchaseRequestPending = {
    version: 1,
    uid,
    projectId,
    body: r.pending,
  };
  const raw = JSON.stringify(pending);
  const checked = readPurchaseRequest(uid, projectId, {
    getItem: () => raw,
    setItem: () => {},
    removeItem: () => {},
  });
  if (!checked) throw fail();
  return locked(uid, projectId, options, (storage) => {
    const prior = readPurchaseRequest(uid, projectId, storage);
    if (prior && prior.body.operation_id !== pending.body.operation_id)
      throw fail();
    storage.setItem(key(uid, projectId), raw);
    if (storage.getItem(key(uid, projectId)) !== raw) throw fail();
    return pending;
  });
}
