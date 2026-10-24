import { NativeMaterialError, nativeMaterialOperations } from './nativeMaterialOperations';

export type MilestoneStatusValue = 'not-started' | 'in-progress' | 'completed' | 'blocked';
export type MilestoneDelayAttribution = 'internal-team' | 'internal-process' | 'external-client' | 'external-vendor' | 'external-other';
export interface MilestoneDelayInput { reason: string; attribution: MilestoneDelayAttribution; }
export interface MilestoneAddInput { name: string; description?: string; currentPlannedEndDate: string; status?: MilestoneStatusValue; }
export interface MilestoneEditPatch { name?: string; description?: string | null; currentPlannedEndDate?: string; status?: MilestoneStatusValue; }
export type MilestoneCommand =
  | { kind: 'add'; milestone_id: string; input: MilestoneAddInput }
  | { kind: 'edit'; milestone_id: string; patch: MilestoneEditPatch; delay?: MilestoneDelayInput }
  | { kind: 'status'; milestone_id: string; status: MilestoneStatusValue; progress_note?: string }
  | { kind: 'date'; milestone_id: string; new_date: string; delay?: MilestoneDelayInput }
  | { kind: 'delete'; milestone_id: string }
  | { kind: 'reorder'; milestone_ids: string[] }
  | { kind: 'template';time_zone?:string }
  | { kind: 'baseline_lock' };
export interface MilestoneCommandInput { expected_project_version: string; expected_schedule_version: string; operation_id: string; command: MilestoneCommand; }
export interface MilestoneProject { projectId: string; projectName?: string; deadline?: unknown; originalDeadline?: unknown; isBaselined?: boolean; baselinedAt?: unknown; baselinedBy?: unknown; }
export interface MilestoneSnapshot { ok: true; project_id: string; project: MilestoneProject; milestones: Array<Record<string, any> & { id: string }>; project_version: string; schedule_version: string; permissions: { edit: boolean }; }
export interface MilestoneResult { ok: true; project_id: string; operation_id: string; kind: MilestoneCommand['kind']; milestone_id?: string; }
export type MilestoneResolution = MilestoneResult & { resolution: 'committed' | 'cancelled' };
interface Deps { currentUid: () => Promise<string>; callable: (payload: Record<string, unknown>, expectedUid?: string, assertContext?: () => void) => Promise<{ data: unknown }>; }

const MAX_MILESTONES = 400;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_STORED_BYTES = 270 * 1024;
const STATUSES = ['not-started', 'in-progress', 'completed', 'blocked'];
const ATTRIBUTIONS = ['internal-team', 'internal-process', 'external-client', 'external-vendor', 'external-other'];
const PROJECT_KEYS = ['projectId', 'projectName', 'deadline', 'originalDeadline', 'isBaselined', 'baselinedAt', 'baselinedBy'];
const STORAGE_PREFIX = 'bom-native-milestone-pending:v1:';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const scheduleVersion = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
const nonce = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const text = (value: unknown, max: number, allowEmpty = false): value is string => typeof value === 'string' && value.length <= max && (allowEmpty || !!value.trim());
const error = (code: string, message: string) => new NativeMaterialError(code, message);
const changed = () => error('native-milestone/identity-changed', 'The signed-in account changed. Reopen this project before continuing.');
const contextChanged = () => error('native-milestone/context-changed', 'The project context changed. Reopen before continuing.');
const invalid = () => error('native-milestone/invalid-response', 'The schedule service returned an unexpected result.');
const invalidInput = (message: string) => error('native-milestone/invalid-input', message);
const storageFailed = () => error('native-milestone/storage-failed', 'This browser cannot safely keep the pending schedule change. Reload the page and check the schedule before retrying.');

// Builds the command in fixed key order from allow-listed keys so equal commands serialize identically whatever their insertion order.
const onlyKeys = (value: Record<string, any>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key) || value[key] === undefined);
const normalizeDelay = (delay: unknown): MilestoneDelayInput => {
  if (!record(delay) || !onlyKeys(delay, ['reason', 'attribution']) || typeof delay.reason !== 'string' || delay.reason.trim().length < 20 || delay.reason.trim().length > 2000
    || !ATTRIBUTIONS.includes(delay.attribution)) throw invalidInput('A delay needs a reason of at least 20 characters and an attribution.');
  return { reason: delay.reason.trim(), attribution: delay.attribution };
};
const withDelay = <T extends object>(base: T, c: Record<string, any>) => c.delay === undefined ? base : { ...base, delay: normalizeDelay(c.delay) };
export const normalizeMilestoneCommand = (raw: unknown): MilestoneCommand => {
  if (!record(raw)) throw invalidInput('Invalid schedule command.');
  const c = raw;
  const needId = () => { if (!validId(c.milestone_id)) throw invalidInput('Invalid milestone.'); return c.milestone_id as string; };
  const status = (value: unknown) => { if (typeof value !== 'string' || !STATUSES.includes(value)) throw invalidInput('Invalid milestone status.'); return value as MilestoneStatusValue; };
  const date = (value: unknown) => { if (!text(value, 64)) throw invalidInput('Invalid date.'); return value; };
  switch (c.kind) {
    case 'add': {
      const i = c.input;
      if (!onlyKeys(c, ['kind', 'milestone_id', 'input']) || !record(i) || !onlyKeys(i, ['name', 'description', 'currentPlannedEndDate', 'status'])
        || !text(i.name, 500) || (i.description !== undefined && !text(i.description, 5000, true))) throw invalidInput('Invalid new milestone.');
      return { kind: 'add', milestone_id: needId(), input: { name: i.name, ...(i.description !== undefined ? { description: i.description } : {}), currentPlannedEndDate: date(i.currentPlannedEndDate), ...(i.status !== undefined ? { status: status(i.status) } : {}) } };
    }
    case 'edit': {
      const p = c.patch;
      if (!onlyKeys(c, ['kind', 'milestone_id', 'patch', 'delay']) || !record(p) || !onlyKeys(p, ['name', 'description', 'currentPlannedEndDate', 'status'])
        || !Object.values(p).some(v => v !== undefined) || (p.name !== undefined && !text(p.name, 500))
        || (p.description !== undefined && p.description !== null && !text(p.description, 5000, true))) throw invalidInput('Invalid milestone edit.');
      const patch: MilestoneEditPatch = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.description !== undefined) patch.description = p.description;
      if (p.currentPlannedEndDate !== undefined) patch.currentPlannedEndDate = date(p.currentPlannedEndDate);
      if (p.status !== undefined) patch.status = status(p.status);
      return withDelay({ kind: 'edit' as const, milestone_id: needId(), patch }, c) as MilestoneCommand;
    }
    case 'status':
      if (!onlyKeys(c, ['kind', 'milestone_id', 'status', 'progress_note']) || (c.progress_note !== undefined && !text(c.progress_note, 2000, true))) throw invalidInput('Invalid status change.');
      return { kind: 'status', milestone_id: needId(), status: status(c.status), ...(c.progress_note !== undefined ? { progress_note: c.progress_note } : {}) };
    case 'date':
      if (!onlyKeys(c, ['kind', 'milestone_id', 'new_date', 'delay'])) throw invalidInput('Invalid date change.');
      return withDelay({ kind: 'date' as const, milestone_id: needId(), new_date: date(c.new_date) }, c) as MilestoneCommand;
    case 'delete':
      if (!onlyKeys(c, ['kind', 'milestone_id'])) throw invalidInput('Invalid delete.');
      return { kind: 'delete', milestone_id: needId() };
    case 'reorder':
      if (!onlyKeys(c, ['kind', 'milestone_ids']) || !Array.isArray(c.milestone_ids) || !c.milestone_ids.length || c.milestone_ids.length > MAX_MILESTONES
        || !c.milestone_ids.every(validId) || new Set(c.milestone_ids).size !== c.milestone_ids.length) throw invalidInput('Invalid reorder.');
      return { kind: 'reorder', milestone_ids: [...c.milestone_ids] };
    case 'template':
      if(!onlyKeys(c,['kind','time_zone'])||c.time_zone!==undefined&&(typeof c.time_zone!=='string'||!c.time_zone||c.time_zone.length>100))throw invalidInput('Invalid template timezone.');
      return {kind:'template',...(c.time_zone?{time_zone:c.time_zone}:{})};
    case 'baseline_lock':
      if (!onlyKeys(c, ['kind'])) throw invalidInput('Invalid schedule command.');
      return { kind: c.kind };
    default: throw invalidInput('Unknown schedule command.');
  }
};

const normalizeInput = (raw: unknown): MilestoneCommandInput => {
  if (!record(raw) || !onlyKeys(raw, ['expected_project_version', 'expected_schedule_version', 'operation_id', 'command'])
    || !revision(raw.expected_project_version) || !scheduleVersion(raw.expected_schedule_version) || !nonce(raw.operation_id)) throw invalidInput('Invalid schedule request.');
  return { expected_project_version: raw.expected_project_version, expected_schedule_version: raw.expected_schedule_version, operation_id: raw.operation_id, command: normalizeMilestoneCommand(raw.command) };
};
const NO_ID_KINDS = ['reorder', 'template', 'baseline_lock'];

export const createNativeMilestoneClient = (deps: Deps) => {
  const call = async (body: Record<string, unknown>, expectedUid: string, assertContext?: () => void) => {
    if (typeof expectedUid !== 'string' || !expectedUid || expectedUid.length > 128 || !validId(body.project_id)) throw invalidInput('Invalid project or opening account.');
    if (await deps.currentUid() !== expectedUid) throw changed();
    assertContext?.();
    let data: unknown, failure: unknown;
    try { data = (await deps.callable({ ...body, expected_actor_uid: expectedUid }, expectedUid, assertContext)).data; } catch (e) { failure = e; }
    if (await deps.currentUid() !== expectedUid) throw changed();
    assertContext?.();
    // A transport or body error never proves a commit or a cancellation; only a validated resolution does.
    if (failure) throw error('native-milestone/request-failed', failure instanceof Error ? failure.message.slice(0, 300) : 'The schedule request outcome is unconfirmed.');
    if (record(data) && data.ok === false && typeof data.error === 'string' && /^[a-z0-9_-]{1,64}$/.test(data.error)) throw error(data.error, data.error);
    if (!record(data) || data.ok !== true || data.project_id !== body.project_id) throw invalid();
    return data;
  };
  const checkResult = (data: Record<string, any>, input: MilestoneCommandInput) => {
    const { command } = input;
    const expectsId = !NO_ID_KINDS.includes(command.kind);
    if (data.operation_id !== input.operation_id || data.kind !== command.kind
      || (expectsId ? data.milestone_id !== (command as { milestone_id: string }).milestone_id : 'milestone_id' in data && data.milestone_id !== undefined)) throw invalid();
  };
  const body = (projectId: string, raw: unknown) => {
    const input = normalizeInput(raw);
    return { input, payload: { operation: 'command', project_id: projectId, expected_project_version: input.expected_project_version, expected_schedule_version: input.expected_schedule_version, operation_id: input.operation_id, command: input.command } };
  };
  return {
    currentUid: deps.currentUid,
    async get(projectId: string, uid: string, assertContext?: () => void): Promise<MilestoneSnapshot> {
      const data = await call({ operation: 'get', project_id: projectId }, uid, assertContext);
      const list = data.milestones;
      if (!revision(data.project_version) || !scheduleVersion(data.schedule_version) || !record(data.permissions) || typeof data.permissions.edit !== 'boolean'
        || !record(data.project) || data.project.projectId !== projectId || !Array.isArray(list) || list.length > MAX_MILESTONES
        || !list.every(m => record(m) && validId(m.id)) || new Set(list.map(m => m.id)).size !== list.length) throw invalid();
      const project = Object.fromEntries(PROJECT_KEYS.filter(key => key in data.project).map(key => [key, data.project[key]])) as unknown as MilestoneProject;
      return { ok: true, project_id: projectId, project, milestones: list, project_version: data.project_version, schedule_version: data.schedule_version, permissions: { edit: data.permissions.edit } };
    },
    async command(projectId: string, uid: string, raw: MilestoneCommandInput, assertContext?: () => void): Promise<MilestoneResult> {
      const { input, payload } = body(projectId, raw);
      const data = await call(payload, uid, assertContext);
      checkResult(data, input);
      if ('resolution' in data) throw invalid();
      return data as MilestoneResult;
    },
    // Same payload as the original command plus resolve_only; the server hash excludes the flag, so this settles that exact nonce.
    async resolve(projectId: string, uid: string, raw: MilestoneCommandInput, assertContext?: () => void): Promise<MilestoneResolution> {
      const { input, payload } = body(projectId, raw);
      const data = await call({ ...payload, resolve_only: true }, uid, assertContext);
      checkResult(data, input);
      if (data.resolution !== 'committed' && data.resolution !== 'cancelled') throw invalid();
      return data as MilestoneResolution;
    },
  };
};

export const nativeMilestoneOperations = createNativeMilestoneClient({
  currentUid: async () => { if (!nativeMaterialOperations.currentUid) throw changed(); return nativeMaterialOperations.currentUid(); },
  callable: async (payload, expectedUid, assertContext) => {
    const [{ functions, auth }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    if (auth.currentUser?.uid !== expectedUid) throw changed();
    assertContext?.();
    return httpsCallable(functions, 'nativeMilestoneOperations')(payload);
  },
});

type Client = ReturnType<typeof createNativeMilestoneClient>;
export type PendingMilestoneCommand = MilestoneCommandInput;

const storageKey = (uid: string, projectId: string) => `${STORAGE_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(projectId)}`;
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const getStorage = (): Storage => {
  try { const s = globalThis.sessionStorage; if (!s) throw 0; return s; } catch { throw storageFailed(); }
};
const readPending = (uid: string, projectId: string): PendingMilestoneCommand | undefined => {
  const s = getStorage();
  let raw: string | null;
  try { raw = s.getItem(storageKey(uid, projectId)); } catch { throw storageFailed(); }
  if (raw === null) return undefined;
  try {
    if (raw.length > MAX_STORED_BYTES || byteLength(raw) > MAX_STORED_BYTES) throw 0;
    const saved = JSON.parse(raw);
    if (!record(saved) || saved.v !== 1 || Object.keys(saved).sort().join() !== 'command,expected_project_version,expected_schedule_version,operation_id,v'
      || byteLength(JSON.stringify(saved.command)) > MAX_COMMAND_BYTES) throw 0;
    const { v: _v, ...rest } = saved;
    return normalizeInput(rest);
  } catch { throw storageFailed(); }
};
const writePending = (uid: string, projectId: string, pending: PendingMilestoneCommand) => {
  const s = getStorage();
  const raw = JSON.stringify({ v: 1, ...pending });
  if (byteLength(JSON.stringify(pending.command)) > MAX_COMMAND_BYTES || byteLength(raw) > MAX_STORED_BYTES) throw storageFailed();
  try { s.setItem(storageKey(uid, projectId), raw); if (s.getItem(storageKey(uid, projectId)) !== raw) throw 0; } catch { throw storageFailed(); }
};
const clearPending = (uid: string, projectId: string, operationId: string) => {
  // Settling is best effort: the mutation already committed or cancelled, so a storage hiccup must not fail it. A stale record just replays to the same receipt.
  try { if (readPending(uid, projectId)?.operation_id === operationId) getStorage().removeItem(storageKey(uid, projectId)); } catch { /* retained */ }
};

// One session = one opening account/project. Pending commands live in sessionStorage keyed by uid and project, so every component
// instance (and a reloaded module) sees the same unconfirmed request. Only commit/cancel responses clear it.
export const createNativeMilestoneSession = (projectId: string, expectedUid?: string, isContextCurrent: () => boolean = () => true, client: Client = nativeMilestoneOperations) => {
  let uid: string | undefined = expectedUid, snapshot: MilestoneSnapshot | undefined, openingInvalid = false, busy = false;
  const assertContext = () => { if (!isContextCurrent()) throw contextChanged(); };
  const guard = async () => {
    assertContext();
    const current = await client.currentUid();
    uid ??= current;
    if (current !== uid || (expectedUid !== undefined && current !== expectedUid)) throw changed();
    assertContext();
  };
  const run = async <T,>(fn: () => Promise<T>) => {
    if (busy) throw error('native-milestone/busy', 'A schedule request is already running.');
    busy = true;
    try { await guard(); return await fn(); } finally { busy = false; }
  };
  // Re-checks identity/context after the call, including when it failed, so a context change always wins over the call's own error.
  const guarded = async <T,>(fn: () => Promise<T>) => {
    let out: T;
    try { out = await fn(); } catch (e) { await guard(); throw e; }
    await guard();
    return out;
  };
  const fetchSnapshot = async () => {
    const snap = await guarded(() => client.get(projectId, uid!, assertContext));
    snapshot = snap; openingInvalid = false;
    return snap;
  };
  // After a settled mutation the server did not return new revisions, so the opening is stale until a reload succeeds.
  const settled = async (operationId: string) => {
    clearPending(uid!, projectId, operationId);
    openingInvalid = true;
    try { await fetchSnapshot(); } catch { /* committed save stays committed; the next explicit load() refreshes */ }
  };
  return {
    get currentUid() { return uid; },
    get snapshot() { return snapshot; },
    get pending(): PendingMilestoneCommand | undefined { return uid === undefined ? undefined : structuredClone(readPending(uid, projectId)); },
    load: () => run(fetchSnapshot),
    issue: (command: MilestoneCommand): Promise<MilestoneResult> => run(async () => {
      const canonical = normalizeMilestoneCommand(command);
      let pending = readPending(uid!, projectId);
      if (pending) {
        if (JSON.stringify(pending.command) !== JSON.stringify(canonical)) throw error('operation_conflict', 'A saved schedule request is still unconfirmed. Retry it before making a different change.');
      } else {
        if (!snapshot || openingInvalid) throw error('native-milestone/reload-required', 'Reload the schedule before making changes.');
        if (!snapshot.permissions.edit) throw error('forbidden', 'You do not have permission to change this schedule.');
        pending = { expected_project_version: snapshot.project_version, expected_schedule_version: snapshot.schedule_version, operation_id: crypto.randomUUID(), command: canonical };
        writePending(uid!, projectId, pending);
      }
      const request = pending;
      const result = await guarded(() => client.command(projectId, uid!, request, assertContext));
      await settled(request.operation_id);
      return result;
    }),
    // Settles the pending original request (no new nonce). Committed and cancelled both clear it; any error retains it.
    resolve: (): Promise<MilestoneResolution> => run(async () => {
      const request = readPending(uid!, projectId);
      if (!request) throw error('native-milestone/nothing-pending', 'There is no unconfirmed schedule request to resolve.');
      const out = await guarded(() => client.resolve(projectId, uid!, request, assertContext));
      await settled(request.operation_id);
      return out;
    }),
  };
};

export const nativeMilestoneSession = createNativeMilestoneSession;
