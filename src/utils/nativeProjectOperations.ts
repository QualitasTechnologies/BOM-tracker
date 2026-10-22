export class NativeProjectError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeProjectError';
    this.code = code;
  }
}

export type NativeProjectPatch = Partial<Record<'projectName' | 'clientName' | 'clientId' | 'billingEntityId' | 'description' | 'status' | 'deadline', string>> & { pulseProjectId?: number | null };
export type NativeProjectCommand = { kind: 'metadata'; patch: NativeProjectPatch; delay?:{reason:string;attribution:'internal-team'|'internal-process'|'external-client'|'external-vendor'|'external-other'} } | { kind: 'archive' } | { kind: 'restore' }
  | { kind: 'member_add'; user_id: string; category_scope?: string[] }
  | { kind: 'member_remove'; user_id: string }
  | { kind: 'member_scope'; user_id: string; category_scope: string[] }
  | { kind: 'member_notifications'; user_id: string; enabled: boolean }
  | { kind: 'recipient_add'; email: string; name: string }
  | { kind: 'recipient_remove'; email: string }
  | { kind: 'recipient_notifications'; email: string; enabled: boolean };
export interface NativeProjectSnapshot { ok: true; project_id: string; version: string; project: Record<string, unknown>; permissions: { edit: boolean; manage_members: boolean; notifications: boolean; restore: boolean; restore_resolve: boolean } }
export interface NativeProjectResult { ok: true; project_id: string; operation_id: string }
interface Deps { currentUid: () => Promise<string>; callable: (payload: Record<string, unknown>, expectedUid?: string, assertContext?: () => void) => Promise<{ data: unknown }> }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => typeof value === 'string' && value.trim() && value.length <= 512 && !value.includes('/') && !Array.from(value).some(character => character.charCodeAt(0) < 32) && !['.', '..'].includes(value);
const revision = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const error = (code: string, message: string) => new NativeProjectError(code, message);
const changed = () => error('native-project/identity-changed', 'The signed-in account changed. Reopen the project before continuing.');
const invalid = () => error('native-project/invalid-response', 'The project service returned an unexpected result.');
const messages: Record<string, string> = {
  delay_required:'Add a reason and attribution before changing a baselined deadline.',
  project_read_only:'Project changes are currently paused. Pending requests can still be resolved.',
  project_request_cancelled:'The original project request was cancelled. Reopen the project to edit current values.',
  project_version_conflict: 'The project changed while this edit was open. Close and reopen it to review current values.',
  customer_po_required: 'Upload the Customer PO before changing Planning to Ongoing.',
  actor_session_changed: 'The signed-in account changed. Reopen the project before continuing.',
  project_mutations_disabled: 'Project editing is not enabled here yet.',
  project_status_writers_not_fenced: 'Project restore is unavailable until legacy status updates are secured.',
  project_not_archived: 'This project is no longer archived. Refresh the project list before continuing.',
  project_already_archived: 'This project is already archived. Refresh the project list before continuing.',
  project_status_transition_invalid: 'Use the dedicated archive or restore action to change an archived project.',
  last_project_member: 'Project must have at least one member.',
  legacy_membership_migration_required: 'This legacy project needs its access list reconciled before membership can change. Existing access has been preserved.',
  client_unavailable: 'The selected client is no longer available. Close and reopen to review current clients.',
  client_identity_conflict: 'The selected client name and client record do not match.',
  billing_entity_unavailable: 'The selected billing entity is no longer active or available.',
};
export const createNativeProjectClient = (deps: Deps) => {
  const call = async (payload: Record<string, unknown>, uid: string, assertContext?: () => void) => {
    if (!id(payload.project_id) || typeof uid !== 'string' || !uid || uid.length > 128) throw invalid();
    if (await deps.currentUid() !== uid) throw changed();
    assertContext?.();
    let result: unknown, failure: unknown;
    try { result = (await deps.callable({ ...payload, expected_actor_uid: uid }, uid, assertContext)).data; } catch (e) { failure = e; }
    if (await deps.currentUid() !== uid) throw changed();
    assertContext?.();
    if (failure) throw error('native-project/request-failed', failure instanceof Error ? failure.message.slice(0, 300) : 'Project save outcome is unconfirmed.');
    if (object(result) && result.ok === false && typeof result.error === 'string' && /^[a-z0-9_-]{1,64}$/.test(result.error)) throw error(result.error, messages[result.error] || result.error);
    if (!object(result) || result.ok !== true || result.project_id !== payload.project_id) throw invalid();
    return result;
  };
  return {
    currentUid: deps.currentUid,
    async get(projectId: string, uid: string, assertContext?: () => void): Promise<NativeProjectSnapshot> {
      const result = await call({ operation: 'get', project_id: projectId }, uid, assertContext);
      if (!revision(result.version) || !object(result.project) || result.project.projectId !== projectId || !object(result.permissions)
        || ['edit', 'manage_members', 'notifications', 'restore', 'restore_resolve'].some(key => typeof result.permissions[key] !== 'boolean')) throw invalid();
      return result as NativeProjectSnapshot;
    },
    async command(projectId: string, input: { expected_version: string; operation_id: string; command: NativeProjectCommand }, uid: string, assertContext?: () => void): Promise<NativeProjectResult> {
      if (!revision(input.expected_version) || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.operation_id)) throw invalid();
      const result = await call({ operation: 'command', project_id: projectId, ...input }, uid, assertContext);
      if (result.operation_id !== input.operation_id) throw invalid();
      return result as NativeProjectResult;
    },
    async resolve(projectId:string,input:{expected_version:string;operation_id:string;command:NativeProjectCommand},uid:string,assertContext?:()=>void):Promise<NativeProjectResult&{resolution:'committed'|'cancelled'}>{
      if(!revision(input.expected_version)||!/^[-\w]{1,128}$/.test(input.operation_id)||!['metadata','restore'].includes(input.command.kind))throw invalid();
      const result=await call({operation:'command',project_id:projectId,...input,resolve_only:true},uid,assertContext);
      if(result.operation_id!==input.operation_id||!['committed','cancelled'].includes(result.resolution))throw invalid();
      return result as NativeProjectResult&{resolution:'committed'|'cancelled'};
    },
  };
};
export const nativeProjectOperations = createNativeProjectClient({
  currentUid: async () => {
    const { auth } = await import('@/firebase');
    const user = auth.currentUser;
    if (!user || typeof user.uid !== 'string' || !user.uid || user.isAnonymous) throw error('native-project/unauthenticated', 'Sign in to change project settings.');
    return user.uid;
  },
  callable: async (payload, expectedUid, assertContext) => {
    const [{ functions, auth }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    assertContext?.();
    if (auth.currentUser?.uid !== expectedUid) throw changed();
    return httpsCallable(functions, 'nativeProjectOperations')(payload);
  },
});

export type PendingNativeProjectRestoreProbe = { kind: 'absent' | 'pending' } | { kind: 'error'; message: string };

/** Local discovery hint only; the server still decides whether a saved restore may be resolved. */
export const hasPendingNativeProjectRestore = (projectId: string, uid: string): PendingNativeProjectRestoreProbe => {
  const unreadable = (): PendingNativeProjectRestoreProbe => ({ kind: 'error', message: 'A saved restore request could not be read. Restore browser session storage before continuing.' });
  if (!id(projectId) || typeof uid !== 'string' || !uid) return { kind: 'absent' };
  try {
    const raw = sessionStorage.getItem(`pulse.project-restore.v1:${JSON.stringify([uid, projectId])}`);
    if (raw === null) return { kind: 'absent' };
    if (raw.length > 270000) return unreadable();
    const value: unknown = JSON.parse(raw);
    if (object(value) && revision(value.expected_version) && typeof value.operation_id === 'string'
      && /^[-\w]{1,128}$/.test(value.operation_id) && object(value.command) && value.command.kind === 'restore') return { kind: 'pending' };
    return unreadable();
  } catch {
    return unreadable();
  }
};

export const createNativeProjectWorkspace = (projectId: string, client = nativeProjectOperations, expectedUid?: string) => {
  let uid: string | undefined, snapshot: NativeProjectSnapshot | undefined, invalidated = false, pending = false;
  const assertContext = () => {
    if (invalidated) throw error('native-project/context-changed', 'The project context changed. Reopen before continuing.');
  };
  const guard = async () => {
    if (invalidated) throw error('native-project/context-changed', 'The project context changed. Reopen before continuing.');
    if (uid !== await client.currentUid()) throw changed();
    if (invalidated) throw error('native-project/context-changed', 'The project context changed. Reopen before continuing.');
  };
  const run = async <T,>(callback: () => Promise<T>) => {
    if (pending) throw error('native-project/pending', 'A project request is already pending.');
    pending = true;
    try { await guard(); const result = await callback(); await guard(); return result; } finally { pending = false; }
  };
  return {
    invalidate() { invalidated = true; snapshot = undefined; },
    async load() {
      if (invalidated) throw error('native-project/context-changed', 'The project context changed. Reopen before continuing.');
      uid ??= await client.currentUid();
      if (expectedUid !== undefined && uid !== expectedUid) throw changed();
      const result = await run(() => client.get(projectId, uid!, assertContext));
      snapshot = structuredClone(result); return structuredClone(result);
    },
    capture(namespace?:'metadata'|'restore') {
      if (invalidated || !snapshot || !uid) throw error('native-project/not-loaded', 'Load current project values before editing.');
      const key=`pulse.project-${namespace || 'metadata'}.v1:${JSON.stringify([uid,projectId])}`;
      const stored=()=>{
        if(!namespace)return undefined;
        try{const raw=sessionStorage.getItem(key);if(!raw)return undefined;if(raw.length>270000)throw 0;const value=JSON.parse(raw);
          const isMetadata=namespace==='metadata'&&value.command?.kind==='metadata'&&object(value.command.patch),isRestore=namespace==='restore'&&value.command?.kind==='restore';
          if(!revision(value.expected_version)||!/^[-\w]{1,128}$/.test(value.operation_id)||!object(value.command)||!(isMetadata||isRestore))throw 0;return value as {expected_version:string;operation_id:string;command:NativeProjectCommand};
        }catch{throw error('native-project/storage-unavailable','The saved project request cannot be read. Restore browser session storage before editing.');}
      };
      const saved=stored(),version = saved?.expected_version||snapshot.version, openingUid = uid, operationId = saved?.operation_id||crypto.randomUUID();
      let frozen: NativeProjectCommand | undefined=saved?.command;
      const clear=()=>{if(namespace){try{if(stored()?.operation_id===operationId)sessionStorage.removeItem(key);}catch{/* A retained settled nonce replays its receipt safely. */}}};
      return { get pendingCommand(){return stored()?.command;}, async submit(command: NativeProjectCommand) {
        return run(async () => {
          if (frozen && JSON.stringify(frozen) !== JSON.stringify(command)) throw error('operation_conflict', 'The saved request has different values. Close and reopen before changing the draft.');
          frozen ??= structuredClone(command);
          if(namespace){
            const existing=stored();if(existing&&existing.operation_id!==operationId)throw error('operation_conflict','Another project request is still unconfirmed. Resolve it first.');
            try{const raw=JSON.stringify({expected_version:version,operation_id:operationId,command:frozen});sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw 0;}catch{throw error('native-project/storage-unavailable','Unable to save this project request in browser session storage.');}
          }
          const result=await client.command(projectId, { expected_version: version, operation_id: operationId, command: structuredClone(frozen) }, openingUid, assertContext);await guard();clear();return result;
        });
      },async resolve(){return run(async()=>{
        frozen??=stored()?.command;if(!frozen||namespace!=='restore'&&frozen.kind!=='metadata'||namespace==='restore'&&frozen.kind!=='restore')throw error('native-project/nothing-pending','There is no pending project request.');
        const result=await client.resolve(projectId,{expected_version:version,operation_id:operationId,command:structuredClone(frozen)},openingUid,assertContext);await guard();clear();return result;
      });} };
    },
  };
};
