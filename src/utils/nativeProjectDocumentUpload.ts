import type {DocumentType,ProjectDocument} from '@/types/projectDocument';

interface Input {
  projectId: string; documentType: DocumentType; expectedActorUid: string;
  file?: Blob; name?: string; isCurrent: () => boolean;
}
interface Dependencies {
  currentUid: () => Promise<string>; nonce: () => string; digest: (blob: Blob) => Promise<string>;
  callable: (body: Record<string, unknown>, uid: string, current: () => boolean) => Promise<{data: unknown}>;
  upload: (path: string, blob: Blob, uid: string, current: () => boolean, contentType: string) => Promise<unknown>;
}
interface SavedDocument {
  id: string; projectId: string; name: string; type: DocumentType; url: string; uploadedAt: string; uploadedBy: string;
  linkedBOMItems: []; fileSize: number; pulseNativeDocument: {operation_id: string; path: string; generation: string};
}
interface Saved {
  v: 1; document_id: string; operation_id: string; name: string; document_type: DocumentType; content_type: string;
  byte_size: number; sha256: string; path?: string; write_started: boolean; document?: SavedDocument; generation?: string;
}
const TYPES: DocumentType[] = ['vendor-quote','vendor-po','customer-po','vendor-invoice','spec-sheet'];
const KEY_PREFIX = 'bom-project-document:v1:';
const BUCKET = 'visionbomtracker.firebasestorage.app';
const MAX_BYTES = 10485760;
const fail = (message: string) => new Error(message);
const validId = (id: unknown): id is string => typeof id === 'string' && !!id.trim() && id.length <= 512 && !/[\/\x00-\x1f\x7f]/.test(id);
const nonceId = (id: unknown): id is string => typeof id === 'string' && /^[-\w]{1,128}$/.test(id);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const mime = (value: unknown): value is string => typeof value === 'string' && /^[\x20-\x7e]{1,256}$/.test(value);
const docName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const docType = (value: unknown): value is DocumentType => TYPES.includes(value as DocumentType);
const sizeOk = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < MAX_BYTES;
const isoDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const storageKey = (uid: string, projectId: string, type: string) => KEY_PREFIX + [uid,projectId,type].map(encodeURIComponent).join(':');
const sameKeys = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => k in value);
const toDocument = (d: SavedDocument): ProjectDocument => ({
  id: d.id, projectId: d.projectId, name: d.name, url: d.url, type: d.type, uploadedAt: new Date(d.uploadedAt),
  uploadedBy: d.uploadedBy, linkedBOMItems: [], fileSize: d.fileSize,
  pulseNativeDocument: {...d.pulseNativeDocument},
});

const defaultDependencies: Dependencies = {
  currentUid: async () => (await import('@/firebase')).auth.currentUser?.uid || '',
  nonce: () => crypto.randomUUID(),
  digest: async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join(''),
  callable: async (body, uid, current) => {
    const [{functions,auth},{httpsCallable}] = await Promise.all([import('@/firebase'),import('firebase/functions')]);
    if (!current() || auth.currentUser?.uid !== uid) throw fail('The document account or project changed.');
    return httpsCallable(functions,'nativeProjectDocumentOperations')(body);
  },
  upload: async (path,blob,uid,current,contentType) => {
    const [{storage,auth},{ref,uploadBytes}] = await Promise.all([import('@/firebase'),import('firebase/storage')]);
    if (!current() || auth.currentUser?.uid !== uid) throw fail('The document account or project changed.');
    return uploadBytes(ref(storage,path),blob,{contentType});
  },
};

// Types with a saved request (pending or finished-but-unacknowledged, including unreadable ones) for one account and project.
export const getPendingNativeProjectDocumentTypes = (uid: string, projectId: string): DocumentType[] => {
  const found = new Set<string>();
  try {
    const prefix = storageKey(uid,projectId,'');
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) found.add(decodeURIComponent(k.slice(prefix.length)));
    }
  } catch { throw fail('This browser cannot read saved document uploads. Restore recovery storage before starting another upload.'); }
  return TYPES.filter(t => found.has(t));
};

// Saved metadata permits finalize/cancel after a reload without storing file bytes.
// Once a Storage request starts it is never sent again; only server proof can settle it.
export const createNativeProjectDocumentUploadAttempt = (input: Input, deps: Dependencies = defaultDependencies) => {
  const {projectId,documentType,expectedActorUid:uid,file,isCurrent} = input;
  const key = storageKey(uid,projectId,documentType);
  const stagingPrefix = `projects/${projectId}/documents/native/staging/`;
  let state: Saved | undefined, loaded = false, busy = false, cancelled = false, savedRaw: string | null = null, badStorage = false;
  let result: ProjectDocument | undefined;
  const invalid = () => fail('The document service returned an unexpected result.');
  const storageError = () => fail('This browser cannot safely recover the document upload. Keep the form open and resolve the saved request.');
  const validPath = (path: unknown): path is string => typeof path === 'string' && path.startsWith(stagingPrefix) && /^[a-f0-9]{64}\.bin$/.test(path.slice(stagingPrefix.length));
  const finalPathOf = (path: string) => path.replace('/documents/native/staging/','/documents/native/finalized/');
  const validateFinal = (value: Record<string, any>, s: Saved) => {
    const d = value.document;
    if (!s.path || value.operation_id !== s.operation_id || value.path !== s.path || typeof value.generation !== 'string' || !/^[1-9]\d*$/.test(value.generation) || !record(d)) throw invalid();
    const finalPath = finalPathOf(s.path), marker = d.pulseNativeDocument;
    if (!sameKeys(d,['id','projectId','name','type','url','uploadedAt','uploadedBy','linkedBOMItems','fileSize','pulseNativeDocument'])
      || d.id !== s.document_id || d.projectId !== projectId || d.name !== s.name || d.type !== s.document_type || d.uploadedBy !== uid || d.fileSize !== s.byte_size
      || !Array.isArray(d.linkedBOMItems) || d.linkedBOMItems.length !== 0 || !isoDate(d.uploadedAt) || typeof d.url !== 'string'
      || !record(marker) || !sameKeys(marker,['operation_id','path','generation'])
      || marker.operation_id !== s.operation_id || marker.path !== finalPath || marker.generation !== value.generation) throw invalid();
    let url: URL; try { url = new URL(d.url); } catch { throw invalid(); }
    if (url.origin !== 'https://firebasestorage.googleapis.com' || url.username || url.password || url.hash
      || url.pathname !== `/v0/b/${BUCKET}/o/${encodeURIComponent(finalPath)}`
      || [...url.searchParams.keys()].length !== 3 || ['alt','token','generation'].some(k => url.searchParams.getAll(k).length !== 1)
      || url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token') || url.searchParams.get('generation') !== value.generation) throw invalid();
    return d as SavedDocument;
  };
  const load = () => {
    try {
      if (loaded) { if (sessionStorage.getItem(key) !== savedRaw) throw 0; return; }
      const raw = sessionStorage.getItem(key); savedRaw = raw; if (raw === null) { loaded = true; return; }
      if (raw.length > 20000) throw 0; const saved = JSON.parse(raw);
      if (!record(saved) || saved.v !== 1 || !nonceId(saved.document_id) || !nonceId(saved.operation_id) || !docName(saved.name) || saved.document_type !== documentType
        || !mime(saved.content_type) || !sizeOk(saved.byte_size) || !/^[a-f0-9]{64}$/.test(saved.sha256)
        || typeof saved.write_started !== 'boolean' || (saved.path !== undefined && !validPath(saved.path)) || (saved.write_started && !saved.path)
        || Object.keys(saved).some(k => !['v','document_id','operation_id','name','document_type','content_type','byte_size','sha256','path','write_started','document','generation'].includes(k))
        || (saved.document !== undefined) !== (saved.generation !== undefined)) throw 0;
      state = saved as Saved;
      if (state.document !== undefined) { validateFinal({ok:true,operation_id:state.operation_id,path:state.path,generation:state.generation,document:state.document},state); result = toDocument(state.document); }
      loaded = true; badStorage = false;
    } catch { loaded = false; state = undefined; result = undefined; badStorage = true; throw storageError(); }
  };
  const save = () => {
    try {
      if (sessionStorage.getItem(key) !== savedRaw) throw 0;
      const raw = JSON.stringify(state); sessionStorage.setItem(key,raw); if (sessionStorage.getItem(key) !== raw) throw 0; savedRaw = raw;
    } catch { throw storageError(); }
  };
  const clear = () => {
    try { if (sessionStorage.getItem(key) !== savedRaw) throw 0; sessionStorage.removeItem(key); savedRaw = null; state = undefined; }
    catch { throw storageError(); }
  };
  const guard = async () => {
    if (!isCurrent()) throw fail('The document project changed. Reopen the form.');
    if (!uid || await deps.currentUid() !== uid) throw fail('The signed-in account changed. Reopen the form.');
    if (!isCurrent()) throw fail('The document project changed. Reopen the form.');
  };
  const call = async (operation: string, extra: Record<string, unknown> = {}) => {
    await guard(); let response: unknown, error: unknown;
    try { response = (await deps.callable({operation,project_id:projectId,document_id:state!.document_id,operation_id:state!.operation_id,expected_actor_uid:uid,...extra},uid,isCurrent)).data; } catch (e) { error = e; }
    await guard();
    if (error) throw fail('The document request outcome is unconfirmed. Retry the saved request or cancel it.');
    if (!record(response) || response.ok !== true) throw fail('The document could not be confirmed. Retry or cancel the saved upload before selecting a new file.');
    return response;
  };
  const runExclusive = async <T,>(fn: () => Promise<T>) => {
    if (busy) throw fail('A document request is already running.'); busy = true;
    try {
      await guard();
      if (![projectId,uid].every(validId) || !docType(documentType)) throw fail('Invalid document project or type.');
      load(); return await fn();
    } finally { busy = false; }
  };
  const selectedName = () => input.name ?? (file && typeof (file as File).name === 'string' ? (file as File).name : undefined);
  const prepareSelection = async () => {
    if (cancelled) throw fail('This upload was cancelled. Select the file again.');
    if (state?.document) {
      if (file && !(await matches())) throw fail('A different document is still unacknowledged. Finish or cancel that upload first.');
      return;
    }
    if (file && (!mime(file.type || 'application/octet-stream') || !sizeOk(file.size))) throw fail('Select a file smaller than 10 MB.');
    const name = selectedName();
    if (file && !docName(name)) throw fail('The document needs a name of at most 4096 characters.');
    if (!file) { if (!state) throw fail('Select the original document to start its upload.'); return; }
    if (state && !(await matches())) throw fail('A different document is still unconfirmed. Retry or cancel that upload first.');
    if (!state) {
      const sha256 = await deps.digest(file); await guard();
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw fail('Could not fingerprint the document.');
      const document_id = deps.nonce(), operation_id = deps.nonce();
      if (!nonceId(document_id) || !nonceId(operation_id)) throw fail('Could not create a document request id.');
      state = {v:1,document_id,operation_id,name:name!,document_type:documentType,content_type:file.type || 'application/octet-stream',byte_size:file.size,sha256,write_started:false}; save();
    }
  };
  async function matches() {
    const f = file!, s = state!;
    if (f.size !== s.byte_size || (f.type || 'application/octet-stream') !== s.content_type || selectedName() !== s.name) return false;
    const digest = await deps.digest(f); await guard();
    return digest === s.sha256;
  }
  const settle = (s: Saved, response: Record<string, any>) => {
    s.document = validateFinal(response,s); s.generation = response.generation; save(); result = toDocument(s.document);
    return result;
  };
  return {
    get needsRecovery() { return badStorage || !!state; },
    prepare: () => runExclusive(prepareSelection),
    run: () => runExclusive(async (): Promise<ProjectDocument> => {
      if (result && !state) return result;
      await prepareSelection();
      if (state?.document) return result!;
      if (!state) throw storageError();
      if (!state.write_started && !file) throw fail('Select the original document to finish its saved upload.');
      if (!state.path) {
        const response = await call('reserve',{name:state.name,document_type:state.document_type,content_type:state.content_type,byte_size:state.byte_size,sha256:state.sha256});
        if (response.operation_id !== state.operation_id || !validPath(response.path) || typeof response.expires_at !== 'string' || !Number.isFinite(Date.parse(response.expires_at))) throw invalid();
        state.path = response.path; save();
      }
      if (!state.write_started) {
        await guard(); state.write_started = true; save(); let failure: unknown;
        try { await deps.upload(state.path,file!,uid,isCurrent,state.content_type); } catch (error) { failure = error; }
        await guard(); if (failure) throw fail('The document upload outcome is unconfirmed. Retry to check it, or cancel the saved upload.');
      }
      return settle(state,await call('finalize'));
    }),
    cancel: () => runExclusive(async (): Promise<{resolution: 'cancelled' | 'committed'; document?: ProjectDocument}> => {
      if (!state) throw fail('There is no saved document upload to resolve.');
      if (state.document) return {resolution:'committed',document:result};
      const response = await call('cancel');
      if (response.operation_id !== state.operation_id || !['committed','cancelled'].includes(response.resolution)) throw invalid();
      if (response.resolution === 'committed') return {resolution:'committed',document:settle(state,response)};
      clear(); cancelled = true; return {resolution:'cancelled'};
    }),
    acknowledge: () => runExclusive(async () => {
      if (!state) { if (result) return; throw fail('There is no saved document upload to acknowledge.'); }
      if (!state.document) throw fail('The document upload is not complete yet.');
      clear();
    }),
  };
};
export type NativeProjectDocumentUploadAttempt = ReturnType<typeof createNativeProjectDocumentUploadAttempt>;
