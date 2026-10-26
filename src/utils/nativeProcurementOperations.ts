import { auth, functions } from '@/firebase';
import { httpsCallable } from 'firebase/functions';

export type POSendPhase = 'prepared' | 'pending' | 'uncertain' | 'accepted' | 'material_pending' | 'metadata_pending' | 'needs_reconciliation' | 'complete' | 'cancelled';
export interface POSendOutcome {
  ok: true;
  project_id: string;
  po_id: string;
  attempt_id: string;
  phase: POSendPhase;
  mode?: 'email' | 'mark';
  actual_sent_date?: string;
  recipient_email?: string;
  cc_emails?: string[];
  problem?: string;
}
export interface POSendSnapshot {
  ok: true;
  project_id: string;
  po_id: string;
  po_version: string;
  material_version: string;
  purchase_order: Record<string, unknown>;
  material_items: Array<{ id: string; name: string; status: string; quantity: number; category: string }>;
  permissions: { send: boolean; legacy_send?: boolean };
  attempt: POSendOutcome | null;
}
export type POSendIntent =
  | { mode: 'email'; recipient_email: string; cc_emails: string[] }
  | { mode: 'mark'; recipient_email: string; cc_emails: string[]; actual_sent_date: string };

type FrozenPOSend = POSendIntent & { attempt_id: string; expected_po_version: string; expected_material_version: string };

// A manual mark records the calendar day the PO was really sent: a real YYYY-MM-DD date, never inferred.
const isDateOnly = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

const phases: POSendPhase[] = ['prepared', 'pending', 'uncertain', 'accepted', 'material_pending', 'metadata_pending', 'needs_reconciliation', 'complete', 'cancelled'];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isVersion = (value: unknown) => value === 'missing' || typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value);
const nativeError = (code: string, message: string) => Object.assign(new Error(message), { code });
const invalidResponse = () => nativeError('native-procurement/invalid-response', 'The PO service returned an unexpected result.');
const identityChanged = () => nativeError('native-procurement/identity-changed', 'The signed-in account changed. Reopen this PO before continuing.');

// Keep this false while legacy writes remain allowed. For the rules rollout, deploy the enabled
// callable first, turn this client gate on and release the bundle, then tighten Firestore rules.
// The native branch never falls back if the callable is unavailable or denies sending.
export const isNativePOSendEnabled = () => import.meta.env.VITE_BOM_NATIVE_PO_SEND_ENABLED === 'true';

const call = async (operation: string, projectId: string, poId: string, uid: string, body: Record<string, unknown> = {}) => {
  if (!uid || auth.currentUser?.uid !== uid) throw identityChanged();
  const result = await httpsCallable(functions, 'nativeProcurementOperations')({
    operation, project_id: projectId, po_id: poId, expected_actor_uid: uid, ...body,
  });
  if (auth.currentUser?.uid !== uid) throw identityChanged();
  const data = result.data;
  if (isRecord(data) && data.ok === false && typeof data.error === 'string') {
    const message = data.error === 'procurement_mutations_disabled'
      ? 'PO sending is disabled until the native procurement rollout is enabled.'
      : data.error;
    throw nativeError(data.error, message);
  }
  if (!isRecord(data) || data.ok !== true || data.project_id !== projectId || data.po_id !== poId) throw invalidResponse();
  return data;
};

const parseOutcome = (data: Record<string, unknown>, expectedAttempt?: string): POSendOutcome => {
  const phase = data.phase;
  if (typeof data.attempt_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.attempt_id)
    || (expectedAttempt && data.attempt_id !== expectedAttempt) || typeof phase !== 'string'
    || !phases.includes(phase as POSendPhase)) throw invalidResponse();
  return data as unknown as POSendOutcome;
};

export const createNativePOSendSession = (projectId: string, poId: string, expectedUid?: string, isContextCurrent: () => boolean = () => true) => {
  let uid: string | undefined;
  let snapshot: POSendSnapshot | undefined;
  let preview: POSendSnapshot | undefined;
  let attemptId = globalThis.crypto.randomUUID();
  let frozenInput: FrozenPOSend | undefined;
  let invalidated = false;
  let pending = false;
  const assertContext = () => {
    if (invalidated || !isContextCurrent()) throw nativeError('native-procurement/context-changed', 'The PO context changed. Reopen before continuing.');
  };
  const guard = async () => {
    assertContext();
    if (uid !== await getUid()) throw identityChanged();
    assertContext();
  };
  const getUid = async () => auth.currentUser?.uid || '';
  const run = async <T,>(operation: () => Promise<T>) => {
    if (pending) throw nativeError('native-procurement/pending', 'A PO request is already pending.');
    pending = true;
    try { await guard(); const result = await operation(); await guard(); return result; }
    finally { pending = false; }
  };
  const remember = (result: POSendOutcome) => { attemptId = result.attempt_id; return result; };
  return {
    invalidate() { invalidated = true; },
    async load() {
      assertContext(); uid ??= await getUid();
      if (!uid || (expectedUid !== undefined && uid !== expectedUid)) throw identityChanged();
      return run(async () => {
        const data = await call('open', projectId, poId, uid!);
        if (!isVersion(data.po_version) || !isVersion(data.material_version) || !isRecord(data.purchase_order)
          || data.purchase_order.id !== poId || data.purchase_order.projectId !== projectId
          || !isRecord(data.permissions) || typeof data.permissions.send !== 'boolean'
          || !Array.isArray(data.material_items) || (data.attempt !== null && !isRecord(data.attempt))) throw invalidResponse();
        snapshot = data as POSendSnapshot;
        if (snapshot.attempt) attemptId = snapshot.attempt.attempt_id;
        return snapshot;
      });
    },
    async send(intent: POSendIntent) {
      return run(async () => {
        if (!snapshot || !snapshot.permissions.send) throw nativeError('procurement_mutations_disabled', 'PO sending is disabled until the native procurement rollout is enabled.');
        if (intent.mode !== 'email' && intent.mode !== 'mark') throw nativeError('native-procurement/invalid-input', 'Invalid PO send request.');
        if (intent.mode === 'mark' && !isDateOnly((intent as { actual_sent_date?: unknown }).actual_sent_date)) throw nativeError('native-procurement/invalid-input', 'Enter the actual sent date as a valid date.');
        if (intent.mode === 'email' && 'actual_sent_date' in intent) throw nativeError('native-procurement/invalid-input', 'An actual sent date is only valid when marking a PO as sent.');
        const recipient_email = intent.recipient_email.trim().toLowerCase();
        const cc_emails = [...new Set(intent.cc_emails.map(value => value.trim().toLowerCase()))].sort();
        const frozenFields = { attempt_id: attemptId, expected_po_version: snapshot.po_version, expected_material_version: snapshot.material_version };
        const input: FrozenPOSend = intent.mode === 'mark'
          ? { mode: 'mark', recipient_email, cc_emails, actual_sent_date: intent.actual_sent_date, ...frozenFields }
          : { mode: 'email', recipient_email, cc_emails, ...frozenFields };
        if (frozenInput && JSON.stringify(frozenInput) !== JSON.stringify(input)) throw nativeError('operation_conflict', 'The saved request has different recipients or mode. Recover or cancel it before starting another.');
        frozenInput ??= structuredClone(input);
        return remember(parseOutcome(await call('send', projectId, poId, uid!, frozenInput), attemptId));
      });
    },
    async recover() { return run(async () => remember(parseOutcome(await call('recover', projectId, poId, uid!, snapshot?.attempt?.attempt_id ? { attempt_id: snapshot.attempt.attempt_id } : frozenInput ? { attempt_id: attemptId } : {}), snapshot?.attempt?.attempt_id || (frozenInput ? attemptId : undefined)))); },
    async reviewMaterials() {
      return run(async () => {
        const data = await call('open', projectId, poId, uid!);
        if (!Array.isArray(data.material_items) || !isVersion(data.material_version)) throw invalidResponse();
        preview = data as POSendSnapshot;
        return preview;
      });
    },
    async reconcile() {
      return run(async () => {
        if (!preview) throw nativeError('native-procurement/review-required', 'Review current materials before retrying their update.');
        return remember(parseOutcome(await call('reconcile', projectId, poId, uid!, { attempt_id: attemptId, expected_material_version: preview.material_version }), attemptId));
      });
    },
    async cancel() { return run(async () => remember(parseOutcome(await call('cancel', projectId, poId, uid!, { attempt_id: attemptId }), attemptId))); },
  };
};
