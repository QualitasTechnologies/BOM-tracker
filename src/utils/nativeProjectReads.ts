export type NativeProjectReadOpening = {
  project_id: string;
  actor_uid: string;
  project_version: string;
  bom_version: string;
  document_version?: string;
};
export type NativeProjectSnapshot = { project_id: string; actor_uid: string; version: string; project: Record<string, unknown> };
export type NativeProjectPage = { projects: Array<{ project_id: string; version: string; project: Record<string, unknown> }>; next_cursor: string | null };
export type NativeProjectDocumentPage = { project_id: string; project_version: string; bom_version: string; documents: NativeProjectDocument[]; next_cursor: string | null };
export type NativeProjectDocument = Record<string, unknown> & { id: string; projectId: string; type: string; url?: string; nativeOpening: NativeProjectReadOpening };
export type NativeGalleryInvoice = { project_id: string; actor_uid: string; project_version: string; bom_version: string; document: NativeProjectDocument & { nativeOpening: NativeProjectReadOpening & { document_version: string } } };
export type NativeReadContextGuard = () => void;
export type NativeProjectReadErrorCode = 'access' | 'not_found' | 'paused' | 'integrity' | 'identity_changed' | 'request_failed' | 'sign_in_required' | 'invalid_request';
export type NativeProjectReadError = Error & { code: NativeProjectReadErrorCode };
export type NativeReadCallable = (payload: Record<string, unknown>, expectedUid?: string, assertContext?: NativeReadContextGuard) => Promise<{ data: unknown }>;
export type NativeProjectReadDependencies = { currentUid: () => Promise<string | null> | string | null; callable: NativeReadCallable };
export type NativeProjectReadClient = {
  get(projectId: string, uid: string, assertContext?: NativeReadContextGuard): Promise<NativeProjectSnapshot>;
  list(options: { limit?: number; cursor?: string | null }, uid: string, assertContext?: NativeReadContextGuard): Promise<NativeProjectPage>;
  documents(projectId: string, options: { limit?: number; cursor?: string | null }, uid: string, assertContext?: NativeReadContextGuard): Promise<NativeProjectDocumentPage>;
  galleryInvoice(projectId: string, itemId: string, uid: string, assertContext?: NativeReadContextGuard): Promise<NativeGalleryInvoice>;
};

function readError(code: NativeProjectReadErrorCode, message: string): NativeProjectReadError { return Object.assign(new Error(message), { code }); }
const integrity = () => readError('integrity', 'Project data failed an integrity check. Refresh and try again.');
const invalidRequest = () => readError('invalid_request', 'The project read request was invalid.');
const changed = () => readError('identity_changed', 'Your signed-in account or project context changed. Refresh and try again.');
const signedOut = () => readError('sign_in_required', 'Sign in again to read project data.');
const requestFailed = () => readError('request_failed', 'Project data is temporarily unavailable. Try again.');

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\/\x00-\x1f\x7f]/.test(value)
    && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}
function validRevision(value: unknown, allowMissing = false): value is string {
  if (allowMissing && value === 'missing') return true;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)) return false;
  const [secondsText, nanosText] = value.split(':');
  const seconds = Number(secondsText), nanos = Number(nanosText);
  return Number.isSafeInteger(seconds) && Number.isSafeInteger(nanos) && nanos < 1e9;
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function safeJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || value instanceof Date || seen.has(value)) return false;
  if (Array.isArray(value)) {
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    const ok = keys.every(key => {
      if (key === 'length') return true;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value') && safeJson(descriptor.value, seen);
    }) && keys.filter(key => key !== 'length').length === value.length;
    seen.delete(value); return ok;
  }
  if (!record(value)) return false;
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  const ok = keys.every(key => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor?.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value') && safeJson(descriptor.value, seen);
  });
  seen.delete(value); return ok;
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function checkCursor(options: { limit?: number; cursor?: string | null }): void {
  if (!record(options) || !exactKeys(options, ['limit', 'cursor'])
    || options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)
    || options.cursor !== undefined && options.cursor !== null && (typeof options.cursor !== 'string' || !options.cursor.trim() || options.cursor.length > 4096)) throw invalidRequest();
}
function guard(assertContext?: NativeReadContextGuard): void { try { assertContext?.(); } catch { throw changed(); } }
function envelope(data: unknown, keys: string[]): Record<string, unknown> {
  if (!record(data) || !safeJson(data) || data.ok !== true || !exactKeys(data, ['ok', ...keys])) throw integrity();
  return data;
}
function assertOpening(value: unknown, projectId: string, uid: string, versions?: Partial<NativeProjectReadOpening>): asserts value is NativeProjectReadOpening {
  if (!record(value) || !exactKeys(value, ['project_id', 'actor_uid', 'project_version', 'bom_version', 'document_version'])
    || value.project_id !== projectId || value.actor_uid !== uid || !validRevision(value.project_version)
    || !validRevision(value.bom_version, true)
    || value.document_version !== undefined && !validRevision(value.document_version)) throw integrity();
  for (const key of ['project_version', 'bom_version', 'document_version'] as const) if (versions?.[key] !== undefined && value[key] !== versions[key]) throw integrity();
}
function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
function parseDocument(value: unknown, projectId: string, uid: string, parent?: Partial<NativeProjectReadOpening>): NativeProjectDocument {
  if (!record(value) || !validId(value.id) || value.projectId !== projectId || typeof value.type !== 'string'
    || !safeJson(value) || value.url !== undefined && !safeUrl(value.url)) throw integrity();
  assertOpening(value.nativeOpening, projectId, uid, parent);
  if (value.nativeOpening.document_version === undefined) throw integrity();
  return value as NativeProjectDocument;
}
function failure(data: unknown): never {
  if (!record(data) || !safeJson(data) || data.ok !== false || !exactKeys(data, ['ok', 'error', 'status']) || typeof data.error !== 'string' || !Number.isInteger(data.status)) throw integrity();
  const code = data.error;
  if (code === 'actor_authentication_required') throw signedOut();
  if (['actor_forbidden', 'project_forbidden', 'project_document_forbidden', 'material_forbidden'].includes(code)) throw readError('access', 'You do not have access to this project.');
  if (['project_not_found', 'project_read_invoice_unavailable'].includes(code)) throw readError('not_found', 'This project data is unavailable.');
  if (code === 'project_reads_disabled') throw readError('paused', 'Project reads are paused.');
  if (code === 'actor_session_changed') throw changed();
  if (['invalid_project_read_request', 'invalid_project_read_cursor', 'invalid_project_read_state', 'invalid_project_document_state', 'project_identity_conflict'].includes(code)) throw integrity();
  throw requestFailed();
}

export function createNativeProjectReadClient(deps: NativeProjectReadDependencies): NativeProjectReadClient {
  async function call<T>(payload: Record<string, unknown>, uid: string, projectId: string | null, assertContext: NativeReadContextGuard | undefined, parse: (data: unknown) => T): Promise<T> {
    if (typeof uid !== 'string' || !uid) throw signedOut();
    guard(assertContext);
    let current: string | null;
    try { current = await deps.currentUid(); } catch { guard(assertContext); throw signedOut(); }
    guard(assertContext);
    if (!current) throw signedOut();
    if (current !== uid) throw changed();
    let response: { data: unknown };
    try { response = await deps.callable(payload, uid, assertContext); }
    catch {
      guard(assertContext);
      let failedUid: string | null;
      try { failedUid = await deps.currentUid(); } catch { guard(assertContext); throw requestFailed(); }
      guard(assertContext);
      if (!failedUid) throw signedOut();
      if (failedUid !== uid) throw changed();
      throw requestFailed();
    }
    guard(assertContext);
    try { current = await deps.currentUid(); } catch { throw signedOut(); }
    guard(assertContext);
    if (!current) throw signedOut();
    if (current !== uid) throw changed();
    const dataDescriptor = response && Object.getOwnPropertyDescriptor(response, 'data');
    if (!record(response) || !dataDescriptor?.enumerable || !Object.prototype.hasOwnProperty.call(dataDescriptor, 'value')) throw integrity();
    if (record(response.data) && response.data.ok === false) failure(response.data);
    return parse(response.data);
  }
  return {
    get(projectId, uid, assertContext) {
      if (!validId(projectId)) return Promise.reject(invalidRequest());
      return call({ operation: 'get', project_id: projectId }, uid, projectId, assertContext, raw => {
        const data = envelope(raw, ['project_id', 'actor_uid', 'version', 'project']);
        if (data.project_id !== projectId || data.actor_uid !== uid || !validRevision(data.version) || !record(data.project) || !safeJson(data.project) || data.project.projectId !== projectId) throw integrity();
        return { project_id: projectId, actor_uid: uid, version: data.version, project: data.project };
      });
    },
    async list(options, uid, assertContext) {
      checkCursor(options);
      const payload: Record<string, unknown> = { operation: 'list' };
      if (options.limit !== undefined) payload.limit = options.limit;
      if (options.cursor !== undefined) payload.cursor = options.cursor;
      return call(payload, uid, null, assertContext, raw => {
        const data = envelope(raw, ['actor_uid', 'projects', 'next_cursor']);
        const limit = options.limit ?? 50;
        if (data.actor_uid !== uid || !Array.isArray(data.projects) || data.projects.length > limit
          || !(data.next_cursor === null || typeof data.next_cursor === 'string' && !!data.next_cursor.trim() && data.next_cursor.length <= 4096)) throw integrity();
        const ids = new Set<string>();
        const projects = data.projects.map(row => {
          if (!record(row) || !exactKeys(row, ['project_id', 'version', 'project']) || !validId(row.project_id) || ids.has(row.project_id)
            || !validRevision(row.version) || !record(row.project) || !safeJson(row.project) || row.project.projectId !== row.project_id) throw integrity();
          ids.add(row.project_id);
          return row as NativeProjectPage['projects'][number];
        });
        return { projects, next_cursor: data.next_cursor as string | null };
      });
    },
    async documents(projectId, options, uid, assertContext) {
      if (!validId(projectId)) return Promise.reject(invalidRequest());
      checkCursor(options);
      const payload: Record<string, unknown> = { operation: 'documents', project_id: projectId };
      if (options.limit !== undefined) payload.limit = options.limit;
      if (options.cursor !== undefined) payload.cursor = options.cursor;
      return call(payload, uid, projectId, assertContext, raw => {
        const data = envelope(raw, ['project_id', 'actor_uid', 'project_version', 'bom_version', 'documents', 'next_cursor']);
        const limit = options.limit ?? 50;
        if (data.project_id !== projectId || data.actor_uid !== uid || !validRevision(data.project_version)
          || !validRevision(data.bom_version, true) || !Array.isArray(data.documents) || data.documents.length > limit
          || !(data.next_cursor === null || typeof data.next_cursor === 'string' && !!data.next_cursor.trim() && data.next_cursor.length <= 4096)) throw integrity();
        const opening = { project_id: projectId, actor_uid: uid, project_version: data.project_version, bom_version: data.bom_version };
        const ids = new Set<string>();
        return { ...opening, documents: data.documents.map(row => {
          const document = parseDocument(row, projectId, uid, opening);
          if (ids.has(document.id)) throw integrity();
          ids.add(document.id);
          return document;
        }), next_cursor: data.next_cursor as string | null };
      });
    },
    galleryInvoice(projectId, itemId, uid, assertContext) {
      if (!validId(projectId) || !validId(itemId)) return Promise.reject(invalidRequest());
      return call({ operation: 'gallery_invoice', project_id: projectId, item_id: itemId }, uid, projectId, assertContext, raw => {
        const data = envelope(raw, ['project_id', 'actor_uid', 'project_version', 'bom_version', 'document']);
        if (data.project_id !== projectId || data.actor_uid !== uid || !validRevision(data.project_version)
          || !validRevision(data.bom_version, true)) throw integrity();
        const opening = { project_id: projectId, actor_uid: uid, project_version: data.project_version, bom_version: data.bom_version };
        return { ...opening, document: parseDocument(data.document, projectId, uid, opening) as NativeGalleryInvoice['document'] };
      });
    },
  };
}

let defaultClient: NativeProjectReadClient | undefined;
async function getDefaultClient(): Promise<NativeProjectReadClient> {
  if (defaultClient) return defaultClient;
  const [{ auth, functions }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
  defaultClient = createNativeProjectReadClient({
    currentUid: () => auth.currentUser?.uid ?? null,
    callable: async (payload, expectedUid, assertContext) => {
      guard(assertContext);
      if (!expectedUid || auth.currentUser?.uid !== expectedUid) throw changed();
      const result = await httpsCallable<Record<string, unknown>, unknown>(functions, 'nativeProjectReads')(payload);
      guard(assertContext);
      if (auth.currentUser?.uid !== expectedUid) throw changed();
      return result;
    },
  });
  return defaultClient;
}
export const nativeProjectReads: NativeProjectReadClient = {
  async get(...args) { return (await getDefaultClient()).get(...args); },
  async list(...args) { return (await getDefaultClient()).list(...args); },
  async documents(...args) { return (await getDefaultClient()).documents(...args); },
  async galleryInvoice(...args) { return (await getDefaultClient()).galleryInvoice(...args); },
};
