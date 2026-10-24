export type NativeSupportProfile = Record<string, unknown>;
export type NativeSupportProfileCommand = {
  kind: 'support_profile';
  patch?: Record<string, unknown>;
  machines?: Array<Record<string, unknown>>;
};
export type NativeSupportProfileSnapshot = {
  ok: true; project_id: string; actor_uid: string; version: string;
  support_profile: NativeSupportProfile | null; permissions: { edit: boolean; resolve: boolean };
};
export type NativeSupportProfileRequest = { expected_version: string; operation_id: string; command: NativeSupportProfileCommand };
type Response = Record<string, unknown>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ContextGuard = () => void;
type Client = ReturnType<typeof createNativeSupportProfileClient>;

const profileFields = [
  'commissioningDate', 'machineSerialNumber', 'machineModel', 'siteLocation', 'warrantyStartDate',
  'warrantyEndDate', 'amcStatus', 'amcStartDate', 'amcEndDate', 'amcContractNumber',
  'responseCommitmentHours', 'supportContactId', 'internalNotes',
] as const;
const machineFields = [
  'name', 'lineName', 'model', 'serialNumber', 'siteLocation', 'commissioningDate', 'warrantyStartDate',
  'warrantyEndDate', 'amcStatus', 'amcStartDate', 'amcEndDate', 'amcContractNumber', 'status', 'notes',
] as const;
const revision = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(v)
  && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[1]) < 1e9;
const validDocumentId = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 512
  && !v.includes('/') && !Array.from(v).some(character => character.charCodeAt(0) < 32) && !['.', '..'].includes(v);
const safeOperationId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const record = (v: unknown): v is Response => !!v && typeof v === 'object' && !Array.isArray(v);
const messages: Record<string, string> = {
  project_version_conflict: 'This project changed while your draft was open. Close and reopen Support to review current values.',
  project_forbidden: 'You no longer have access to this project. Your draft has been kept.',
  actor_forbidden: 'Your account no longer has access. Sign in again before continuing.',
  actor_authentication_required: 'Sign in again before continuing. Your draft has been kept.',
  support_profile_mutations_disabled: 'Support profile changes are currently paused.',
  project_read_only: 'Project changes are currently paused. You can still confirm or cancel a saved request.',
  project_request_cancelled: 'This saved request was cancelled. Reopen Support before editing again.',
  operation_conflict: 'The saved request has different values. Confirm or cancel it before another edit.',
  invalid_support_profile_command: 'Some Support details could not be saved. Check the machine names, serial numbers and coverage dates.',
  invalid_support_profile_state: 'Some saved Support details need attention before editing. Your draft has been kept.',
  invalid_project_read_state: 'Some saved project details could not be loaded safely. Please ask an administrator to check them.',
};
const fail = (code: string, message = messages[code] || 'The Support request could not be completed. Your draft has been kept.') => Object.assign(new Error(message), { code: `native-support/${code}` });
const changed = () => fail('actor_session_changed', 'The signed-in account changed. Reopen this project before continuing.');
const invalid = () => fail('invalid-response', 'The Support profile request returned an unexpected response.');
const knownCopy = (input: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields
  .filter(key => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined)
  .map(key => [key, input[key]]));
const allowedProfileField = (key: string) => (profileFields as readonly string[]).includes(key);
const validScalars = (fields: Record<string, unknown>, machine = false) => Object.entries(fields).every(([key, value]) => {
  if (machine && ['name', 'serialNumber'].includes(key)) return typeof value === 'string' && !!value.trim();
  if (value === null) return true;
  if (key === 'responseCommitmentHours') return typeof value === 'number' && Number.isFinite(value);
  if (key === 'amcStatus') return ['none', 'active', 'expired'].includes(String(value));
  if (key === 'status') return ['active', 'inactive', 'decommissioned'].includes(String(value));
  return typeof value === 'string';
});
const sanitizeCommand = (value: unknown): NativeSupportProfileCommand => {
  if (!record(value) || value.kind !== 'support_profile' || Object.keys(value).some(key => !['kind', 'patch', 'machines'].includes(key))) throw invalid();
  const command: NativeSupportProfileCommand = { kind: 'support_profile' };
  if (value.patch !== undefined) {
    if (!record(value.patch) || Object.keys(value.patch).some(key => !allowedProfileField(key)) || !validScalars(value.patch)) throw invalid();
    command.patch = { ...value.patch };
  }
  if (value.machines !== undefined) {
    if (!Array.isArray(value.machines)) throw invalid();
    command.machines = value.machines.map((operation): Record<string, unknown> => {
      if (!record(operation) || !['add', 'patch', 'remove', 'migrate_legacy'].includes(String(operation.kind))) throw invalid();
      if (operation.kind === 'migrate_legacy') {
        if (Object.keys(operation).length !== 1) throw invalid();
        return { kind: 'migrate_legacy' };
      }
      if (operation.kind === 'remove') {
        if (!validDocumentId(operation.id) || Object.keys(operation).some(key => !['kind', 'id'].includes(key))) throw invalid();
        return { kind: 'remove', id: operation.id };
      }
      if (operation.kind === 'patch') {
        if (!validDocumentId(operation.id) || Object.keys(operation).some(key => !['kind', 'id', 'patch'].includes(key)) || !record(operation.patch) || !Object.keys(operation.patch).length || Object.keys(operation.patch).some(key => !(machineFields as readonly string[]).includes(key)) || !validScalars(operation.patch, true)) throw invalid();
        return { kind: 'patch', id: operation.id, patch: { ...operation.patch } };
      }
      if (Object.keys(operation).some(key => !['kind', 'machine'].includes(key)) || !record(operation.machine) || !validDocumentId(operation.machine.id) || Object.keys(operation.machine).some(key => key !== 'id' && !(machineFields as readonly string[]).includes(key))) throw invalid();
      if (typeof operation.machine.name !== 'string' || !operation.machine.name.trim() || typeof operation.machine.serialNumber !== 'string' || !operation.machine.serialNumber.trim() || !validScalars(operation.machine, true)) throw invalid();
      return { kind: 'add', machine: { ...operation.machine } };
    });
  }
  if (!command.patch && !command.machines?.length) throw invalid();
  return command;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const isNativeSupportProfileEnabled = (env: Record<string, unknown> = import.meta.env): boolean =>
  env.VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED === 'true';

const hasLegacyMachine = (profile: Record<string, unknown>) => !Array.isArray(profile.machines) &&
  ['machineSerialNumber', 'machineModel', 'siteLocation', 'commissioningDate'].some(key => !!profile[key]);
const legacyMachine = (profile: Record<string, unknown>): Record<string, unknown> => ({
  id: 'legacy-primary-machine', name: profile.machineModel || 'Primary machine', model: profile.machineModel,
  serialNumber: profile.machineSerialNumber || 'Not recorded', siteLocation: profile.siteLocation,
  commissioningDate: profile.commissioningDate, warrantyStartDate: profile.warrantyStartDate,
  warrantyEndDate: profile.warrantyEndDate, amcStatus: profile.amcStatus, amcStartDate: profile.amcStartDate,
  amcEndDate: profile.amcEndDate, amcContractNumber: profile.amcContractNumber, status: 'active',
});

/** Build an allowlisted explicit command. This function never sends supportContacts or unknown raw fields. */
export function createNativeSupportProfileDiff(
  baseline: NativeSupportProfile | null,
  edited: NativeSupportProfile,
): NativeSupportProfileCommand | null {
  const before = baseline || {};
  if (before.machines !== undefined && before.machines !== null && !Array.isArray(before.machines)) throw invalid();
  if (edited.machines !== undefined && edited.machines !== null && !Array.isArray(edited.machines)) throw invalid();
  const patch: Record<string, unknown> = {};
  for (const key of profileFields) {
    if (Object.prototype.hasOwnProperty.call(edited, key)) {
      if (edited[key] === undefined) {
        if (before[key] !== undefined && before[key] !== null) patch[key] = null;
      } else if (!same(before[key], edited[key])) patch[key] = edited[key];
    } else if (Object.prototype.hasOwnProperty.call(before, key)) {
      patch[key] = null;
    }
  }

  const oldMachines = Array.isArray(before.machines) ? before.machines as Record<string, unknown>[] : hasLegacyMachine(before) ? [legacyMachine(before)] : [];
  const newMachines = Array.isArray(edited.machines) ? edited.machines as Record<string, unknown>[] : oldMachines;
  const oldById = new Map<string, Record<string, unknown>>();
  const newById = new Map<string, Record<string, unknown>>();
  for (const machine of oldMachines) {
    if (!record(machine) || !validDocumentId(machine.id) || oldById.has(machine.id)) throw fail('invalid-machine-id', 'Support machine IDs must be valid and unique.');
    oldById.set(machine.id, machine);
  }
  for (const machine of newMachines) {
    if (!record(machine) || !validDocumentId(machine.id) || newById.has(machine.id)) throw fail('invalid-machine-id', 'Support machine IDs must be valid and unique.');
    newById.set(machine.id, machine);
  }
  const machineOps: Array<Record<string, unknown>> = [];
  for (const [machineId, oldMachine] of oldById) {
    const next = newById.get(machineId);
    if (!next) { machineOps.push({ kind: 'remove', id: machineId }); continue; }
    const machinePatch: Record<string, unknown> = {};
    for (const field of machineFields) {
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        if (next[field] === undefined) {
          if (oldMachine[field] !== undefined && oldMachine[field] !== null) machinePatch[field] = null;
        } else if (!same(oldMachine[field], next[field])) machinePatch[field] = next[field];
      } else if (Object.prototype.hasOwnProperty.call(oldMachine, field)) machinePatch[field] = null;
    }
    if (Object.keys(machinePatch).length) machineOps.push({ kind: 'patch', id: machineId, patch: machinePatch });
  }
  for (const machine of newMachines) {
    if (oldById.has(machine.id)) continue;
    machineOps.push({ kind: 'add', machine: { id: machine.id, ...knownCopy(machine, machineFields) } });
  }
  if (machineOps.length && hasLegacyMachine(before)) machineOps.unshift({ kind: 'migrate_legacy' });
  if (!Object.keys(patch).length && !machineOps.length) return null;
  const command: NativeSupportProfileCommand = { kind: 'support_profile' };
  if (Object.keys(patch).length) command.patch = patch;
  if (machineOps.length) command.machines = machineOps;
  return command;
}

export function createNativeSupportProfileClient(deps: {
  currentUid: () => string | null | undefined | Promise<string | null | undefined>;
  callable: (payload: Record<string, unknown>, expectedUid: string, assertContext?: ContextGuard) => Promise<{ data: unknown }>;
}) {
  const call = async (payload: Record<string, unknown>, projectId: string, uid: string, guard?: ContextGuard) => {
    if (!validDocumentId(projectId) || typeof uid !== 'string' || !uid || uid.length > 128) throw invalid();
    if (await deps.currentUid() !== uid) throw changed();
    guard?.();
    let result: unknown, failure: unknown;
    try { result = (await deps.callable({ ...payload, project_id: projectId, expected_actor_uid: uid }, uid, guard)).data; } catch (e) { failure = e; }
    if (await deps.currentUid() !== uid) throw changed();
    guard?.();
    if (failure) throw fail('request-failed', failure instanceof Error ? failure.message.slice(0, 300) : 'The Support profile save outcome is unconfirmed.');
    if (record(result) && result.ok === false && typeof result.error === 'string' && /^[a-z0-9_-]{1,64}$/.test(result.error)) throw fail(result.error);
    if (!record(result) || result.ok !== true || result.project_id !== projectId || (result.actor_uid !== undefined && result.actor_uid !== uid)) throw invalid();
    return result;
  };
  const validateRequest = (input: NativeSupportProfileRequest) => {
    if (!revision(input.expected_version) || !safeOperationId(input.operation_id) || !record(input.command) || input.command.kind !== 'support_profile') throw invalid();
    return { ...input, command: sanitizeCommand(input.command) };
  };
  return {
    currentUid: deps.currentUid,
    async get(projectId: string, uid: string, guard?: ContextGuard): Promise<NativeSupportProfileSnapshot> {
      const result = await call({ operation: 'support_get' }, projectId, uid, guard);
      if (result.actor_uid !== uid || !revision(result.version) || !(result.support_profile === null || record(result.support_profile)) || !record(result.permissions)
        || typeof result.permissions.edit !== 'boolean' || typeof result.permissions.resolve !== 'boolean') throw invalid();
      return result as NativeSupportProfileSnapshot;
    },
    async command(projectId: string, input: NativeSupportProfileRequest, uid: string, guard?: ContextGuard): Promise<Response> {
      const safe = validateRequest(input);
      const result = await call({ operation: 'command', ...safe }, projectId, uid, guard);
      if (result.operation_id !== input.operation_id) throw invalid();
      return result;
    },
    async resolve(projectId: string, input: NativeSupportProfileRequest, uid: string, guard?: ContextGuard): Promise<Response & { resolution: 'committed' | 'cancelled' }> {
      const safe = validateRequest(input);
      const result = await call({ operation: 'command', ...safe, resolve_only: true }, projectId, uid, guard);
      if (result.operation_id !== input.operation_id || !['committed', 'cancelled'].includes(String(result.resolution))) throw invalid();
      return result as Response & { resolution: 'committed' | 'cancelled' };
    },
  };
}

/** Firebase binding stays dynamic so tests/canonical builds need not depend on Pulse's material client. */
export const nativeSupportProfileClient = createNativeSupportProfileClient({
  currentUid: async () => {
    const { auth } = await import('@/firebase');
    return auth.currentUser?.uid;
  },
  callable: async (payload, expectedUid, guard) => {
    const [{ functions, auth }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    guard?.();
    if (auth.currentUser?.uid !== expectedUid) throw changed();
    return httpsCallable(functions, 'nativeProjectOperations')(payload);
  },
});

type StoredRequest = NativeSupportProfileRequest;
type WorkspaceOptions = { storage?: StorageLike; operationId?: () => string };
const defaultStorage = (): StorageLike => sessionStorage;
const validStoredRequest = (value: unknown): value is StoredRequest => record(value)
  && Object.keys(value).length === 3 && Object.keys(value).every(key => ['expected_version', 'operation_id', 'command'].includes(key))
  && revision(value.expected_version) && safeOperationId(value.operation_id)
  && (() => { try { sanitizeCommand(value.command); return true; } catch { return false; } })();

export type PendingNativeSupportProfileProbe = { kind: 'absent' | 'pending' } | { kind: 'error'; message: string };
/** Discovery hint for the original form; it never authorizes or resolves a saved request. */
export function hasPendingNativeSupportProfile(projectId: string, uid: string, storage?: Pick<StorageLike, 'getItem'>): PendingNativeSupportProfileProbe {
  const unreadable = (): PendingNativeSupportProfileProbe => ({ kind: 'error', message: 'A saved Support profile request could not be read. Restore browser session storage before continuing.' });
  if (!validDocumentId(projectId) || typeof uid !== 'string' || !uid || uid.length > 128) return { kind: 'absent' };
  try {
    const raw = (storage || defaultStorage()).getItem(`bom.support-profile.v1:${JSON.stringify([uid, projectId])}`);
    if (raw === null) return { kind: 'absent' };
    if (raw.length > 270000 || !validStoredRequest(JSON.parse(raw))) return unreadable();
    return { kind: 'pending' };
  } catch { return unreadable(); }
}

export function createNativeSupportProfileWorkspace(projectId: string, client: Client, expectedUid?: string, options: WorkspaceOptions = {}) {
  let uid: string | undefined, snapshot: NativeSupportProfileSnapshot | undefined, invalidated = false, pending = false;
  const storage = options.storage || defaultStorage();
  const storageKey = (actor: string) => `bom.support-profile.v1:${JSON.stringify([actor, projectId])}`;
  const guard = () => { if (invalidated) throw fail('context-changed', 'The project context changed. Reopen before continuing.'); };
  const run = async <T,>(fn: () => Promise<T>) => {
    if (pending) throw fail('pending', 'A Support profile request is already pending.');
    pending = true;
    try {
      guard();
      if (uid !== await client.currentUid()) throw changed();
      guard();
      const value = await fn();
      if (uid !== await client.currentUid()) throw changed();
      guard();
      return value;
    } finally { pending = false; }
  };
  const stored = (): StoredRequest | undefined => {
    try {
      const raw = storage.getItem(storageKey(uid!));
      if (raw === null) return undefined;
      if (raw.length > 270000) throw 0;
      const value: unknown = JSON.parse(raw);
      if (!validStoredRequest(value)) throw 0;
      return value;
    } catch { throw fail('storage-unavailable', 'A saved Support profile request could not be read. Restore browser session storage before continuing.'); }
  };
  return {
    invalidate() { invalidated = true; snapshot = undefined; },
    async load() {
      guard();
      uid ??= await client.currentUid() || undefined;
      if (!uid || expectedUid !== undefined && uid !== expectedUid) throw changed();
      const value = await run(() => client.get(projectId, uid!, guard));
      if (value.project_id !== projectId || value.actor_uid !== uid) throw invalid();
      snapshot = structuredClone(value);
      return structuredClone(value);
    },
    capture() {
      guard();
      if (!snapshot || !uid) throw fail('not-loaded', 'Load the current Support profile before editing.');
      const openingUid = uid, current = structuredClone(snapshot), key = storageKey(openingUid);
      const saved = stored();
      const version = saved?.expected_version || current.version;
      const operationId = saved?.operation_id || (options.operationId || (() => crypto.randomUUID()))();
      let frozen: NativeSupportProfileCommand | undefined = saved?.command;
      const req = (): StoredRequest => {
        if (!frozen) throw fail('nothing-pending', 'There is no saved Support profile request.');
        return { expected_version: version, operation_id: operationId, command: structuredClone(frozen) };
      };
      const save = () => {
        const request = req();
        try {
          const existing = stored();
          if (existing && existing.operation_id !== operationId) throw fail('operation-conflict', 'Another Support request is still unconfirmed. Resolve it first.');
          const raw = JSON.stringify(request);
          storage.setItem(key, raw);
          if (storage.getItem(key) !== raw) throw 0;
        } catch (e) { if (record(e) && typeof e.code === 'string') throw e; throw fail('storage-unavailable', 'Unable to save this Support profile request in browser session storage.'); }
      };
      const clear = () => {
        try { if (stored()?.operation_id === operationId) storage.removeItem(key); } catch { /* A retained settled nonce can be safely resolved again. */ }
      };
      const settle = async () => run(async () => {
        const request = req();
        const result = await client.resolve(projectId, request, openingUid, guard);
        if (result.resolution === 'committed' || result.resolution === 'cancelled') clear();
        return result;
      });
      return {
        baseline: current,
        get pendingCommand() { return stored()?.command; },
        async submit(command: NativeSupportProfileCommand) {
          return run(async () => {
            if (frozen && !same(frozen, command)) throw fail('operation-conflict', 'The saved request has different values. Reopen before changing this draft.');
            frozen ??= structuredClone(command);
            frozen = sanitizeCommand(frozen);
            save();
            const result = await client.command(projectId, req(), openingUid, guard);
            clear();
            return result;
          });
        },
        resolve: () => settle(),
        cancel: () => settle(),
      };
    },
  };
}
