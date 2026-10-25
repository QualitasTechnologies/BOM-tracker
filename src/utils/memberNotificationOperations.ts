export type MemberNotificationPreference = { member_uid: string; notifications_enabled: boolean };
export type MemberNotificationSnapshot = { ok: true; project_id: string; version: string; preferences: MemberNotificationPreference[] };
export type MemberNotificationResult = {
  ok: true;
  project_id: string;
  member_uid: string;
  notifications_enabled: boolean;
  operation_id: string;
  changed: boolean;
  resolution: 'committed' | 'cancelled';
};

type PendingRequest = {
  operation: 'set';
  project_id: string;
  member_uid: string;
  notifications_enabled: boolean;
  expected_actor_uid: string;
  expected_version: string;
  operation_id: string;
};
type ContextCheck = () => void;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Dependencies = {
  currentUid: () => string | null | undefined | Promise<string | null | undefined>;
  callable: (payload: Record<string, unknown>, expectedUid: string, assertContext?: ContextCheck) => Promise<{ data: unknown }>;
  storage?: () => StorageLike | null | undefined;
  newOperationId?: () => string;
};

export class MemberNotificationError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'MemberNotificationError';
    this.code = code;
    this.status = status;
  }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validId = (value: unknown, max = 128): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !value.includes('/') && !Array.from(value).some((character) => character.charCodeAt(0) < 32);
const validVersion = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1_000_000_000;
const fail = (code: string, message: string, status?: number) => new MemberNotificationError(code, message, status);
const accountChanged = () => fail('member-notification/identity-changed', 'The signed-in account changed. Reopen the project before continuing.');
const invalidResponse = () => fail('member-notification/invalid-response', 'The notification service returned an unexpected result. The saved request is still available to resolve.');
const storageError = () => fail('member-notification/storage-unavailable', 'A saved notification request cannot be read or saved in browser session storage. Restore session storage before continuing.');
const pendingError = () => fail('member-notification/pending', 'A pending notification request is still unconfirmed. Resolve it before changing its values.');
const keyFor = (uid: string, projectId: string) => `pulse.member-notification.v1:${JSON.stringify([uid, projectId])}`;
const parsePending = (raw: string | null): PendingRequest | null => {
  if (raw === null) return null;
  try {
    if (raw.length > 4096) throw 0;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.operation !== 'set' || !validId(value.project_id, 512) || !validId(value.member_uid)
      || typeof value.notifications_enabled !== 'boolean' || !validId(value.expected_actor_uid)
      || !validVersion(value.expected_version) || !validId(value.operation_id)) throw 0;
    return {
      operation: 'set', project_id: value.project_id, member_uid: value.member_uid,
      notifications_enabled: value.notifications_enabled, expected_actor_uid: value.expected_actor_uid,
      expected_version: value.expected_version, operation_id: value.operation_id,
    };
  } catch { throw storageError(); }
};
const sameIntent = (left: PendingRequest, right: Omit<PendingRequest, 'operation_id'>) =>
  left.project_id === right.project_id && left.member_uid === right.member_uid
  && left.notifications_enabled === right.notifications_enabled && left.expected_actor_uid === right.expected_actor_uid
  && left.expected_version === right.expected_version;
const clone = <T,>(value: T): T => structuredClone(value);

export const createMemberNotificationClient = (deps: Dependencies) => {
  const storage = () => {
    try { return deps.storage ? deps.storage() : globalThis.sessionStorage; }
    catch { throw storageError(); }
  };
  const read = (projectId: string, uid: string) => {
    try {
      const request = parsePending(storage()?.getItem(keyFor(uid, projectId)) ?? null);
      if (request && (request.project_id !== projectId || request.expected_actor_uid !== uid)) throw storageError();
      return request;
    }
    catch (error) { if (error instanceof MemberNotificationError) throw error; throw storageError(); }
  };
  const save = (request: PendingRequest) => {
    try {
      const target = storage();
      if (!target) throw 0;
      const key = keyFor(request.expected_actor_uid, request.project_id);
      const raw = JSON.stringify(request);
      target.setItem(key, raw);
      if (target.getItem(key) !== raw) throw 0;
    } catch { throw storageError(); }
  };
  const clear = (request: PendingRequest) => {
    try {
      const current = read(request.project_id, request.expected_actor_uid);
      if (current && JSON.stringify(current) === JSON.stringify(request)) storage()?.removeItem(keyFor(request.expected_actor_uid, request.project_id));
    }
    catch { /* Keep a settled receipt locally when storage cannot be cleared; replay remains safe. */ }
  };
  const guard = async (uid: string, assertContext?: ContextCheck) => {
    if (await deps.currentUid() !== uid) throw accountChanged();
    assertContext?.();
  };
  const call = async (payload: Record<string, unknown>, uid: string, assertContext?: ContextCheck) => {
    await guard(uid, assertContext);
    let response: unknown;
    try { response = (await deps.callable({ ...payload, expected_actor_uid: uid }, uid, assertContext)).data; }
    catch (cause) {
      await guard(uid, assertContext);
      throw fail('member-notification/outcome-unconfirmed', cause instanceof Error
        ? `The notification save outcome is unconfirmed: ${cause.message.slice(0, 200)}`
        : 'The notification save outcome is unconfirmed. Retry the same request or resolve it.');
    }
    await guard(uid, assertContext);
    if (record(response) && response.ok === false && typeof response.error === 'string' && Number.isInteger(response.status)) {
      const status = response.status as number;
      if (status >= 400 && status < 500) {
        throw fail(response.error, response.error.replace(/[_-]+/g, ' '), status);
      }
      throw fail('member-notification/outcome-unconfirmed', 'The notification save outcome is unconfirmed. Retry the same request or resolve it.', status);
    }
    return response;
  };
  const verifyResult = (value: unknown, request: PendingRequest, resolving: boolean): MemberNotificationResult => {
    if (!record(value) || value.ok !== true || value.project_id !== request.project_id || value.member_uid !== request.member_uid
      || value.notifications_enabled !== request.notifications_enabled || value.operation_id !== request.operation_id
      || typeof value.changed !== 'boolean') throw invalidResponse();
    if (resolving) {
      if (!['committed', 'cancelled'].includes(String(value.resolution)) || (value.resolution === 'cancelled' && value.changed !== false)) throw invalidResponse();
    } else if (value.resolution !== 'committed') throw invalidResponse();
    return clone(value) as unknown as MemberNotificationResult;
  };

  return {
    async load(projectId: string, expectedUid: string, assertContext?: ContextCheck): Promise<MemberNotificationSnapshot> {
      if (!validId(projectId, 512) || !validId(expectedUid)) throw invalidResponse();
      const value = await call({ operation: 'get', project_id: projectId }, expectedUid, assertContext);
      if (!record(value) || value.ok !== true || value.project_id !== projectId || !validVersion(value.version)
        || !Array.isArray(value.preferences) || value.preferences.some((item) => !record(item) || !validId(item.member_uid) || typeof item.notifications_enabled !== 'boolean')) throw invalidResponse();
      return clone({ ok: true, project_id: projectId, version: value.version, preferences: value.preferences.map((item) => ({ member_uid: item.member_uid, notifications_enabled: item.notifications_enabled })) });
    },
    async setPreference(projectId: string, memberUid: string, enabled: boolean, expectedVersion: string, expectedUid: string, assertContext?: ContextCheck): Promise<MemberNotificationResult> {
      if (!validId(projectId, 512) || !validId(memberUid) || typeof enabled !== 'boolean' || !validVersion(expectedVersion) || !validId(expectedUid)) throw invalidResponse();
      await guard(expectedUid, assertContext);
      const intent = { operation: 'set' as const, project_id: projectId, member_uid: memberUid, notifications_enabled: enabled, expected_actor_uid: expectedUid, expected_version: expectedVersion };
      const existing = read(projectId, expectedUid);
      if (existing && !sameIntent(existing, intent)) throw pendingError();
      const request: PendingRequest = existing ?? { ...intent, operation_id: deps.newOperationId?.() ?? globalThis.crypto.randomUUID() };
      if (!validId(request.operation_id)) throw fail('member-notification/invalid-operation-id', 'A valid notification request ID could not be created.');
      if (!existing) save(request);
      try {
        const result = await call(request, expectedUid, assertContext);
        const verified = verifyResult(result, request, false);
        clear(request);
        return verified;
      } catch (error) {
        if (error instanceof MemberNotificationError && error.status !== undefined && error.status >= 400 && error.status < 500) clear(request);
        throw error;
      }
    },
    async resolvePending(projectId: string, expectedUid: string, assertContext?: ContextCheck): Promise<MemberNotificationResult> {
      if (!validId(projectId, 512) || !validId(expectedUid)) throw invalidResponse();
      await guard(expectedUid, assertContext);
      const request = read(projectId, expectedUid);
      if (!request) throw fail('member-notification/nothing-pending', 'There is no saved notification request to resolve.');
      const result = await call({ ...request, resolve_only: true }, expectedUid, assertContext);
      const verified = verifyResult(result, request, true);
      clear(request);
      return verified;
    },
    hasPending(projectId: string, expectedUid: string): boolean {
      if (!validId(projectId, 512) || !validId(expectedUid)) return false;
      return read(projectId, expectedUid) !== null;
    },
  };
};

export const memberNotificationOperations = createMemberNotificationClient({
  currentUid: async () => {
    const [{ auth }] = await Promise.all([import('@/firebase')]);
    return auth.currentUser?.uid;
  },
  callable: async (payload, expectedUid, assertContext) => {
    const [{ functions, auth }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    assertContext?.();
    if (auth.currentUser?.uid !== expectedUid) throw accountChanged();
    return httpsCallable(functions, 'updateProjectMemberNotifications')(payload);
  },
});
