// Durable request journal shared by the typed material client and the direct command client.
// A material write is persisted (exact payload, per signed-in user + project) BEFORE it leaves the
// browser. An unresolved request can only be resent byte-for-byte or explicitly resolved with
// `resolve_only: true`; it never silently becomes a new nonce or a new business write.

export type MaterialResolution = 'committed' | 'cancelled';
export type PendingNativeMaterialRecovery =
  | { kind: 'absent' }
  | { kind: 'pending'; operation: string; resolved: boolean; resolution?: MaterialResolution }
  | { kind: 'error'; message: string };

export class NativeMaterialRecoveryError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'NativeMaterialError'; this.code = code; }
}

type Payload = Record<string, unknown>;
type Entry = { v: 1; uid: string; token: string; payload: Payload; attempts: number; resolution?: MaterialResolution };
/** Binds every later settle/resolve/acknowledge to the exact entry that was begun. */
export interface MaterialWriteTicket { uid: string; projectId: string; token: string; attempt: number }

export const MATERIAL_JOURNAL_OPERATIONS = ['patch', 'fulfill', 'command', 'create_project'] as const;
const MAX_ENTRY_CHARS = 300_000;
const NONCE = /^[A-Za-z0-9_-]{1,128}$/;
// Known refusals that prove nothing was committed. Everything else (network, timeout, internal, malformed
// response, project_operations_unavailable, identity_provider_unavailable, unknown codes) stays ambiguous.
// Either way only the FIRST attempt of a request can be released.
const DEFINITE_REJECTIONS = new Set([
  'material_version_conflict', 'material_forbidden', 'project_forbidden', 'material_mutations_disabled',
  'material_category_not_found', 'material_not_found', 'nonempty_material_category', 'received_quantity_conflict',
  'material_request_cancelled', 'material_initialization_conflict', 'material_state_conflict', 'material_command_too_large',
  'material_document_too_large', 'material_read_only', 'material_cutover_required', 'operation_conflict',
  'project_id_conflict', 'invalid_project_create', 'invalid_material_patch', 'invalid_material_fulfillment', 'invalid_material_command',
  'invalid_material_version', 'invalid_receipt_photo', 'invalid_resource', 'invalid_material_request', 'invalid_material_state',
  'invalid_material_category', 'invalid_item_id', 'invalid_operation_id', 'invalid_project_id', 'actor_forbidden', 'invoice_forbidden', 'document_forbidden',
  'project_creation_forbidden', 'project_not_found', 'project_version_conflict', 'native-material/invalid-input',
  'functions/permission-denied', 'functions/unauthenticated', 'functions/invalid-argument', 'functions/failed-precondition', 'functions/not-found',
]);

const isRecord = (value: unknown): value is Payload => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (code: string, message: string) => new NativeMaterialRecoveryError(code, message);
const unreadable = () => fail('native-material/storage-unavailable',
  'A saved BOM change could not be read. Restore browser session storage before editing this BOM.');
const recoveryRequired = () => fail('native-material/recovery-required',
  'A previous BOM change was not confirmed. Check its status before making another change.');

const canonical = (value: unknown): string => JSON.stringify(value, (_key, field) => isRecord(field)
  ? Object.fromEntries(Object.keys(field).sort().map(key => [key, field[key]])) : field);
const keyFor = (uid: string, projectId: string) => `pulse.material-write.v1:${JSON.stringify([uid, projectId])}`;

export const isDefiniteMaterialRejection = (code: unknown) => typeof code === 'string' && DEFINITE_REJECTIONS.has(code);

const read = (uid: string, projectId: string): Entry | undefined => {
  try {
    const raw = sessionStorage.getItem(keyFor(uid, projectId));
    if (raw === null) return undefined;
    if (raw.length > MAX_ENTRY_CHARS) throw 0;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.v !== 1 || value.uid !== uid || !isRecord(value.payload)
      || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value.token)
      || !Object.keys(value).every(key => ['v', 'uid', 'token', 'payload', 'attempts', 'resolution'].includes(key))
      || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 1
      || value.resolution !== undefined && value.resolution !== 'committed' && value.resolution !== 'cancelled') throw 0;
    const payload = value.payload;
    if (!MATERIAL_JOURNAL_OPERATIONS.some(op => op === payload.operation) || payload.project_id !== projectId
      || typeof payload.operation_id !== 'string' || !NONCE.test(payload.operation_id) || 'resolve_only' in payload) throw 0;
    return value as unknown as Entry;
  } catch {
    throw unreadable();
  }
};

const write = (entry: Entry, projectId: string) => {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_ENTRY_CHARS) throw 0;
    const key = keyFor(entry.uid, projectId);
    sessionStorage.setItem(key, raw);
    if (sessionStorage.getItem(key) !== raw) throw 0;
  } catch {
    throw fail('native-material/storage-unavailable', 'Unable to save this BOM change in browser session storage, so it was not sent.');
  }
};

const clear = (uid: string, projectId: string) => {
  try { sessionStorage.removeItem(keyFor(uid, projectId)); } catch { /* an unreadable entry keeps blocking new writes */ }
};

/** Non-throwing probe for UI. */
export const probeNativeMaterialRecovery = (uid: string | null | undefined, projectId: string): PendingNativeMaterialRecovery => {
  if (!uid || typeof projectId !== 'string' || !projectId) return { kind: 'absent' };
  try {
    const entry = read(uid, projectId);
    return entry ? { kind: 'pending', operation: String(entry.payload.operation), resolved: !!entry.resolution, ...(entry.resolution ? { resolution: entry.resolution } : {}) } : { kind: 'absent' };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
};

const newToken = () => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID().replace(/-/g, '') : '';
  return random || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 48).padEnd(8, '0');
};
const current = (ticket: { uid: string; projectId: string; token: string }): Entry | undefined => {
  try { const entry = read(ticket.uid, ticket.projectId); return entry?.token === ticket.token ? entry : undefined; } catch { return undefined; }
};
const changed = () => fail('native-material/recovery-changed', 'This BOM change was already handled elsewhere. Reload the page.');

/** Saved requests for this user across projects (for pages that have no project yet, e.g. creation). */
export const listPendingNativeMaterialProjects = (uid: string | null | undefined): { projectId: string; operation: string }[] => {
  if (!uid) return [];
  const found: { projectId: string; operation: string }[] = [];
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith('pulse.material-write.v1:')) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(key.slice('pulse.material-write.v1:'.length)); } catch { continue; }
      if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== uid || typeof parsed[1] !== 'string') continue;
      const projectId = parsed[1];
      const probe = probeNativeMaterialRecovery(uid, projectId);
      found.push({ projectId, operation: probe.kind === 'pending' ? probe.operation : 'unknown' });
    }
  } catch { /* unreadable storage: nothing to list; writes stay blocked per project */ }
  return found;
};

/** Persist the frozen payload before sending. Returns the exact payload to send plus a ticket for this entry. */
export const beginMaterialWrite = (uid: string, payload: Payload): { payload: Payload; ticket: MaterialWriteTicket } => {
  const frozen = JSON.parse(JSON.stringify(payload)) as Payload;
  const projectId = frozen.project_id as string;
  const existing = read(uid, projectId);
  if (existing && (existing.resolution || canonical(existing.payload) !== canonical(frozen))) throw recoveryRequired();
  const attempt = (existing?.attempts ?? 0) + 1;
  const token = existing?.token ?? newToken();
  write({ v: 1, uid, token, payload: existing?.payload ?? frozen, attempts: attempt }, projectId);
  return { payload: existing?.payload ?? frozen, ticket: { uid, projectId, token, attempt } };
};

/**
 * success clears; a definite rejection clears only while this is still the first and only attempt; everything
 * else is retained. A completion for an entry that was already cleared or replaced changes nothing.
 */
export const settleMaterialWrite = (ticket: MaterialWriteTicket, outcome: 'success' | 'rejected' | 'ambiguous') => {
  const entry = current(ticket);
  // A resolved entry is only cleared by `acknowledge` after an authoritative read, never by a late original completion.
  if (!entry || entry.resolution) return;
  if (outcome === 'success' || outcome === 'rejected' && ticket.attempt === 1 && entry.attempts === 1) clear(ticket.uid, ticket.projectId);
};

/** Commands path: same business request (ignoring nonce/version) reuses the frozen payload. */
export const reuseFrozenMaterialRequest = (uid: string, projectId: string, candidate: Payload): Payload | undefined => {
  const existing = read(uid, projectId);
  if (!existing) return undefined;
  const strip = (payload: Payload) => { const { operation_id, expected_version, ...rest } = payload; void operation_id; void expected_version; return canonical(rest); };
  if (existing.resolution || strip(existing.payload) !== strip(candidate)) throw recoveryRequired();
  return existing.payload;
};

const validateResolution = (payload: Payload, data: unknown): { resolution: MaterialResolution; result: Payload } => {
  const bad = () => fail('native-material/invalid-response', 'Unexpected response from the material service');
  if (!isRecord(data) || data.ok !== true || data.project_id !== payload.project_id || data.operation_id !== payload.operation_id
    || data.resolution !== 'committed' && data.resolution !== 'cancelled') throw bad();
  const committed = data.resolution === 'committed';
  if (payload.operation === 'patch' || payload.operation === 'fulfill') {
    // A cancelled request committed nothing, so the backend returns no item; a committed one returns it.
    if (data.item_id !== payload.item_id || committed && (!isRecord(data.item) || data.item.id !== payload.item_id)) throw bad();
  } else if (payload.operation === 'command') {
    if (!isRecord(payload.command) || committed && data.command_kind !== payload.command.kind
      || data.command_kind !== undefined && data.command_kind !== payload.command.kind) throw bad();
  }
  const { resolution, item, ...rest } = data;
  return { resolution: resolution as MaterialResolution, result: committed ? { ...rest, ...(item !== undefined ? { item } : {}) } : rest };
};

interface Identity { currentUid: () => Promise<string> | string }
const checkUid = async (identity: Identity, expected?: string) => {
  const uid = await identity.currentUid();
  if (expected !== undefined && uid !== expected) throw fail('native-material/identity-changed', 'The signed-in account changed; reload before continuing');
  return uid;
};

/** Explicit recovery: independent of feature flags and edit/command permission. */
export const resolveMaterialRequest = async (
  identity: Identity & { send: (payload: Payload) => Promise<unknown> }, projectId: string,
): Promise<{ resolution: MaterialResolution; result: Payload }> => {
  const uid = await checkUid(identity);
  const entry = read(uid, projectId);
  if (!entry) throw fail('native-material/nothing-pending', 'There is no pending BOM change to check.');
  const ticket = { uid, projectId, token: entry.token };
  const data = await identity.send({ ...entry.payload, resolve_only: true });
  await checkUid(identity, uid);
  if (isRecord(data) && data.ok === false && typeof data.error === 'string') throw fail(data.error, data.error);
  const out = validateResolution(entry.payload, data);
  const latest = current(ticket);
  if (!latest || latest.resolution && latest.resolution !== out.resolution) throw changed();
  write({ ...latest, resolution: out.resolution }, projectId);
  return out;
};

/**
 * Clears a resolved request only after an authoritative read succeeds. A cancelled creation may leave the project
 * missing: only the authoritative `project_not_found` (never a network/403/generic 404) is accepted for that,
 * in which case `null` is returned.
 */
export const acknowledgeMaterialRequest = async <T extends { version: string }>(
  identity: Identity & { read: () => Promise<T> }, projectId: string,
): Promise<T | null> => {
  const uid = await checkUid(identity);
  const entry = read(uid, projectId);
  if (!entry) throw fail('native-material/nothing-pending', 'There is no pending BOM change to confirm.');
  if (!entry.resolution) throw fail('native-material/not-resolved', 'Check the status of the pending BOM change first.');
  const ticket = { uid, projectId, token: entry.token };
  let snapshot: T | null = null;
  try {
    snapshot = await identity.read();
  } catch (error) {
    const missingOk = entry.payload.operation === 'create_project' && entry.resolution === 'cancelled'
      && isRecord(error) && (error as { code?: unknown }).code === 'project_not_found';
    if (!missingOk) throw error;
  }
  await checkUid(identity, uid);
  if (snapshot && entry.resolution === 'committed' && typeof entry.payload.expected_version === 'string' && snapshot.version === entry.payload.expected_version) {
    throw fail('native-material/read-not-current', 'The saved change is not visible yet. Refresh and try again.');
  }
  const latest = current(ticket);
  if (!latest || !latest.resolution) throw changed();
  clear(uid, projectId);
  return snapshot;
};
