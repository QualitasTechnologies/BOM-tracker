import type {DocumentType,NativeProjectDocumentOpening,ProjectDocument} from '@/types/projectDocument';

interface Dependencies {
  currentUid: () => Promise<string>;
  nonce: () => string;
  callable: (body: Record<string,unknown>, uid: string, current: () => boolean) => Promise<{data:unknown}>;
}
const defaults: Dependencies = {
  currentUid: async () => (await import('@/firebase')).auth.currentUser?.uid || '',
  nonce: () => crypto.randomUUID(),
  callable: async (body,uid,current) => {
    const [{functions,auth},{httpsCallable}] = await Promise.all([import('@/firebase'),import('firebase/functions')]);
    if (!current() || auth.currentUser?.uid !== uid) throw Error('The document account or project changed.');
    return httpsCallable(functions,'nativeProjectDocumentOperations')(body);
  },
};
const record = (v: unknown): v is Record<string,any> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 512 && !/[\/\x00-\x1f\x7f]/.test(v) && !['.','..'].includes(v) && !/^__.*__$/.test(v);
const version = (v: unknown): v is string => v === 'missing' || typeof v === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[1]) < 1e9;
const types: DocumentType[] = ['vendor-quote','vendor-po','customer-po','vendor-invoice','spec-sheet'];
const invalid = () => Error('The document service returned an unexpected result.');
const recovery = () => Error('This browser cannot safely recover the saved document deletion. Keep the saved request until it is resolved.');
function validOpening(v: unknown,projectId: string,uid: string): v is NativeProjectDocumentOpening {
  return record(v) && Object.keys(v).length === 5 && v.project_id === projectId && v.actor_uid === uid && version(v.project_version) && version(v.bom_version) && version(v.document_version);
}
async function guard(uid: string,current: () => boolean,deps: Dependencies) {
  if (!current()) throw Error('The document project changed. Reopen the form.');
  if (!uid || await deps.currentUid() !== uid) throw Error('The signed-in account changed. Reopen the form.');
  if (!current()) throw Error('The document project changed. Reopen the form.');
}
async function call(body: Record<string,unknown>,uid: string,current: () => boolean,deps: Dependencies) {
  await guard(uid,current,deps); let response: unknown,error: unknown;
  try { response = (await deps.callable(body,uid,current)).data; } catch (e) { error = e; }
  await guard(uid,current,deps);
  if (error) throw Error('The document request outcome is unconfirmed. Retry or resolve the saved request.');
  if (!record(response) || response.ok !== true) throw Error('The document request was not confirmed. Resolve the saved request before making another change.');
  return response;
}
export async function getNativeProjectDocuments(projectId: string,uid: string,current: () => boolean,deps: Dependencies = defaults): Promise<ProjectDocument[]> {
  if (![projectId,uid].every(id)) throw invalid();
  let cursor: string | undefined; const cursors = new Set<string>(),seen = new Set<string>(),documents: ProjectDocument[] = [];
  do {
    const page = await call({operation:'get',project_id:projectId,expected_actor_uid:uid,...(cursor ? {cursor} : {})},uid,current,deps);
    if (page.project_id !== projectId || !Array.isArray(page.documents) || page.documents.length > 100 || !(page.next_cursor === null || id(page.next_cursor))) throw invalid();
    for (const row of page.documents) {
      if (!record(row) || !id(row.id) || seen.has(row.id) || row.projectId !== projectId || !types.includes(row.type)
        || !['name','url','uploadedBy'].every(key => typeof row[key] === 'string') || !validOpening(row.nativeOpening,projectId,uid)
        || !(row.uploadedAt === null || typeof row.uploadedAt === 'string' && Number.isFinite(Date.parse(row.uploadedAt)))
        || row.linkedBOMItems !== undefined && (!Array.isArray(row.linkedBOMItems) || !row.linkedBOMItems.every(id))
        || row.fileSize !== undefined && (!Number.isSafeInteger(row.fileSize) || row.fileSize < 0)) throw invalid();
      const document: ProjectDocument = {id:row.id,projectId,name:row.name,url:row.url,type:row.type,uploadedAt:row.uploadedAt === null ? new Date(0) : new Date(row.uploadedAt),uploadedBy:row.uploadedBy,nativeOpening:{...row.nativeOpening}};
      if (row.linkedBOMItems !== undefined) document.linkedBOMItems = [...row.linkedBOMItems];
      if (row.fileSize !== undefined) document.fileSize = row.fileSize;
      if (typeof row.sourceUrl === 'string') document.sourceUrl = row.sourceUrl;
      if (record(row.pulseNativeDocument) && ['operation_id','path','generation'].every(key=>typeof row.pulseNativeDocument[key] === 'string')) {
        const {operation_id,path,generation} = row.pulseNativeDocument; document.pulseNativeDocument = {operation_id,path,generation};
      }
      seen.add(row.id); documents.push(document);
    }
    cursor = page.next_cursor ?? undefined;
    if (cursor) { if (cursors.has(cursor)) throw invalid(); cursors.add(cursor); }
  } while (cursor);
  return documents;
}

// Document ids with a saved deletion (pending or resolved-but-unacknowledged, including unreadable records) for one account and project.
export function getPendingNativeProjectDocumentDeletes(uid: string,projectId: string): string[] {
  if (![uid,projectId].every(id)) throw invalid();
  const prefix = 'bom-project-document-delete:v1:' + [uid,projectId].map(encodeURIComponent).join(':') + ':',found = new Set<string>();
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const documentId = decodeURIComponent(k.slice(prefix.length));
      if (!id(documentId)) throw 0;
      found.add(documentId);
    }
  } catch {throw recovery();}
  return [...found].sort();
}

interface DeleteInput {projectId: string; documentId: string; expectedActorUid: string; opening?: NativeProjectDocumentOpening; isCurrent: () => boolean;}
type Resolution = 'committed' | 'cancelled';
interface Saved {v:1; operation_id:string; opening:NativeProjectDocumentOpening; resolution?:Resolution;}
export function createNativeProjectDocumentDeleteAttempt(input: DeleteInput,deps: Dependencies = defaults) {
  const {projectId,documentId,expectedActorUid:uid,isCurrent} = input;
  const originalOpening = input.opening ? {...input.opening} : undefined;
  const key = 'bom-project-document-delete:v1:' + [uid,projectId,documentId].map(encodeURIComponent).join(':');
  let state: Saved | undefined,raw: string | null = null,loaded = false,busy = false,acknowledged: Resolution | undefined;
  const load = () => {
    try {
      if (loaded) {if (sessionStorage.getItem(key) !== raw) throw 0;return;}
      raw = sessionStorage.getItem(key);
      if (raw !== null) {
        if (raw.length > 5000) throw 0; const v = JSON.parse(raw);
        if (!record(v) || v.v !== 1 || !/^[-\w]{1,128}$/.test(v.operation_id) || !validOpening(v.opening,projectId,uid)
          || Object.keys(v).some(k=>!['v','operation_id','opening','resolution'].includes(k)) || v.resolution !== undefined && !['committed','cancelled'].includes(v.resolution)) throw 0;
        state = v as Saved;
      }
      loaded = true;
    } catch {throw recovery();}
  };
  const save = () => {
    try {if (sessionStorage.getItem(key) !== raw) throw 0;const next = JSON.stringify(state);sessionStorage.setItem(key,next);if (sessionStorage.getItem(key) !== next) throw 0;raw = next;}
    catch {throw recovery();}
  };
  const exclusive = async <T,>(fn: () => Promise<T>) => {
    if (busy) throw Error('A document deletion is already running.');busy = true;
    try {await guard(uid,isCurrent,deps);if (![projectId,documentId,uid].every(id)) throw invalid();load();return await fn();} finally {busy = false;}
  };
  const execute = (resolve: boolean) => exclusive(async (): Promise<Resolution> => {
    if (acknowledged) {if (!resolve && acknowledged === 'cancelled') throw Error('This document deletion was cancelled.');return acknowledged;}
    if (!state) {
      if (resolve || !validOpening(originalOpening,projectId,uid)) throw Error('There is no saved deletion or original document opening to use.');
      const operation_id = deps.nonce();if (!/^[-\w]{1,128}$/.test(operation_id)) throw invalid();
      state = {v:1,operation_id,opening:{...originalOpening}};save();
    } else if (!resolve && originalOpening && (!validOpening(originalOpening,projectId,uid) || (['project_version','bom_version','document_version'] as const).some(key=>state!.opening[key] !== originalOpening[key]))) {
      throw Error('A different original opening has a saved document deletion. Resolve that saved request first.');
    }
    if (state.resolution) {if (!resolve && state.resolution === 'cancelled') throw Error('This document deletion was cancelled.');return state.resolution;}
    const o = state.opening;
    const response = await call({operation:resolve?'resolve_delete':'delete',project_id:projectId,document_id:documentId,operation_id:state.operation_id,expected_actor_uid:uid,expected_project_version:o.project_version,expected_bom_version:o.bom_version,expected_document_version:o.document_version},uid,isCurrent,deps);
    if (response.document_id !== documentId || response.operation_id !== state.operation_id || !['committed','cancelled'].includes(response.resolution) || !resolve && response.resolution !== 'committed') throw invalid();
    state.resolution = response.resolution;save();return state.resolution!;
  });
  return {
    run: () => execute(false),
    resolve: () => execute(true),
    acknowledge: () => exclusive(async () => {
      if (!state?.resolution) {if (acknowledged) return;throw Error('The saved document deletion is not resolved.');}
      try {if (sessionStorage.getItem(key) !== raw) throw 0;sessionStorage.removeItem(key);} catch {throw recovery();}
      acknowledged = state.resolution;state = undefined;raw = null;
    }),
  };
}
