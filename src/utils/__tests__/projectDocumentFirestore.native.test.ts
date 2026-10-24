import {beforeEach,describe,expect,it,vi} from 'vitest';

const h=vi.hoisted(()=>({
 auth:{currentUser:{uid:'alice'} as {uid:string}|null},
 enabled:vi.fn(()=>false),
 getDocs:vi.fn(),addDoc:vi.fn(),deleteDoc:vi.fn(),updateDoc:vi.fn(),deleteObject:vi.fn(),uploadBytes:vi.fn(),getDownloadURL:vi.fn(),
 getNative:vi.fn(),createUpload:vi.fn(),createDelete:vi.fn(),
}));
vi.mock('@/firebase',()=>({db:{},storage:{},auth:h.auth}));
vi.mock('firebase/firestore',()=>({collection:()=>'col',addDoc:h.addDoc,query:(...a:any[])=>({q:a}),where:(...a:any[])=>a,getDocs:h.getDocs,deleteDoc:h.deleteDoc,doc:()=>'docref',updateDoc:h.updateDoc,Timestamp:{now:()=>({toDate:()=>new Date(0)})}}));
vi.mock('firebase/storage',()=>({ref:()=>'sref',uploadBytes:h.uploadBytes,getDownloadURL:h.getDownloadURL,deleteObject:h.deleteObject}));
vi.mock('../projectDocumentMode',()=>({nativeProjectDocumentsEnabled:h.enabled}));
vi.mock('../nativeProjectDocumentUpload',async orig=>({...await orig<any>(),createNativeProjectDocumentUploadAttempt:h.createUpload}));
vi.mock('../nativeProjectDocumentOperations',async orig=>({...await orig<any>(),getNativeProjectDocuments:h.getNative,createNativeProjectDocumentDeleteAttempt:h.createDelete}));
import * as svc from '../projectDocumentFirestore';

const opening={project_id:'P',actor_uid:'alice',project_version:'1:1',bom_version:'2:2',document_version:'3:3'};
const nativeDoc=(id:string,type:string)=>({id,projectId:'P',name:id,url:'https://x/'+id,type,uploadedAt:new Date(1),uploadedBy:'alice',nativeOpening:opening});
const snap=(rows:any[])=>({docs:rows.map(r=>({id:r.id,data:()=>{const {id:_id,...rest}=r;return rest;}}))});
const file=(name='a.pdf')=>new File(['abc'],name,{type:'application/pdf'});
const upKey=(type:string,uid='alice',p='P')=>'bom-project-document:v1:'+[uid,p,type].map(encodeURIComponent).join(':');
const delKey=(id:string,uid='alice',p='P')=>'bom-project-document-delete:v1:'+[uid,p,id].map(encodeURIComponent).join(':');
const uploadAttempt=(over:any={})=>({run:vi.fn(async()=>nativeDoc('N','vendor-quote')),cancel:vi.fn(async()=>({resolution:'cancelled'})),acknowledge:vi.fn(async()=>{}),prepare:vi.fn(),...over});
const deleteAttempt=(over:any={})=>({run:vi.fn(async()=>'committed'),resolve:vi.fn(async()=>'cancelled'),acknowledge:vi.fn(async()=>{}),...over});

beforeEach(()=>{
 vi.unstubAllEnvs();
 sessionStorage.clear();vi.restoreAllMocks();Object.values(h).forEach((m:any)=>m.mockReset?.());
 h.auth.currentUser={uid:'alice'};h.enabled.mockReturnValue(false);
 h.getDocs.mockResolvedValue(snap([]));h.addDoc.mockResolvedValue({id:'L1'});h.getDownloadURL.mockResolvedValue('https://legacy/url');
 h.getNative.mockResolvedValue([]);h.createUpload.mockImplementation(()=>uploadAttempt());h.createDelete.mockImplementation(()=>deleteAttempt());
});

describe('upload dispatch',()=>{
 it('keeps the legacy SDK path for flag-off use with no saved request',async()=>{
  const d=await svc.uploadProjectDocument(file(),'P','vendor-quote','alice');
  expect(h.uploadBytes).toHaveBeenCalledTimes(1);expect(h.createUpload).not.toHaveBeenCalled();
  expect(d).toMatchObject({id:'L1',name:'a.pdf',type:'vendor-quote',linkedBOMItems:[],fileSize:3});expect(d.uploadedAt).toBeInstanceOf(Date);
 });
 it('flag-on runs the native attempt with original inputs, never touches the SDK and does not acknowledge',async()=>{
  h.enabled.mockReturnValue(true);const f=file(),isCurrent=()=>true,a=uploadAttempt();h.createUpload.mockReturnValue(a);
  const d=await svc.uploadProjectDocument(f,'P','vendor-quote','alice',{isCurrent});
  expect(h.createUpload).toHaveBeenCalledWith({projectId:'P',documentType:'vendor-quote',expectedActorUid:'alice',file:f,isCurrent});
  expect(d.id).toBe('N');expect(a.run).toHaveBeenCalledTimes(1);expect(a.acknowledge).not.toHaveBeenCalled();
  expect(h.uploadBytes).not.toHaveBeenCalled();expect(h.addDoc).not.toHaveBeenCalled();
 });
 it('an existing saved request for that type routes native even with the flag off; other types stay legacy',async()=>{
  sessionStorage.setItem(upKey('vendor-quote'),'{}');
  await svc.uploadProjectDocument(file(),'P','vendor-quote','alice');expect(h.createUpload).toHaveBeenCalledTimes(1);expect(h.uploadBytes).not.toHaveBeenCalled();
  await svc.uploadProjectDocument(file(),'P','spec-sheet','alice');expect(h.createUpload).toHaveBeenCalledTimes(1);expect(h.uploadBytes).toHaveBeenCalledTimes(1);
 });
 it('saved requests for another account or project do not redirect',async()=>{
  sessionStorage.setItem(upKey('vendor-quote','bob'),'{}');sessionStorage.setItem(upKey('vendor-quote','alice','Q'),'{}');
  await svc.uploadProjectDocument(file(),'P','vendor-quote','alice');expect(h.createUpload).not.toHaveBeenCalled();expect(h.uploadBytes).toHaveBeenCalled();
 });
 it('unreadable or malformed recovery storage fails closed instead of using the SDK',async()=>{
  sessionStorage.setItem('bom-project-document:v1:alice:P:%E0%A4%A','{}');
  await expect(svc.uploadProjectDocument(file(),'P','vendor-quote','alice')).rejects.toThrow(/recover|storage|saved/i);
  sessionStorage.clear();sessionStorage.setItem(upKey('spec-sheet'),'{}');
  vi.spyOn(Storage.prototype,'key').mockImplementation(()=>{throw Error('blocked');});
  await expect(svc.uploadProjectDocument(file(),'P','vendor-quote','alice')).rejects.toThrow(/recover|storage|saved/i);
  expect(h.uploadBytes).not.toHaveBeenCalled();expect(h.createUpload).not.toHaveBeenCalled();
 });
 it('a native failure is surfaced and never falls back to the SDK',async()=>{
  h.enabled.mockReturnValue(true);h.createUpload.mockReturnValue(uploadAttempt({run:vi.fn(async()=>{throw Error('unconfirmed');})}));
  await expect(svc.uploadProjectDocument(file(),'P','vendor-quote','alice')).rejects.toThrow('unconfirmed');
  expect(h.uploadBytes).not.toHaveBeenCalled();expect(h.addDoc).not.toHaveBeenCalled();
 });
});

describe('read dispatch',()=>{
 it('flag-on get uses the native read with the captured account and project guard',async()=>{
  h.enabled.mockReturnValue(true);let current=true;h.getNative.mockResolvedValue([nativeDoc('A','vendor-quote')]);
  const r=await svc.getProjectDocuments('P',{isCurrent:()=>current});
  expect(r).toEqual([nativeDoc('A','vendor-quote')]);expect(h.getDocs).not.toHaveBeenCalled();
  const [p,uid,cur]=h.getNative.mock.calls[0];expect([p,uid]).toEqual(['P','alice']);expect(cur()).toBe(true);current=false;expect(cur()).toBe(false);
 });
 it('flag-off get without pending work or native rows is the unchanged SDK read',async()=>{
  const when={toDate:()=>new Date(5)};h.getDocs.mockResolvedValue(snap([{id:'L',projectId:'P',name:'x',url:'u',type:'spec-sheet',uploadedAt:when,uploadedBy:'u',linkedBOMItems:['i'],fileSize:2}]));
  const r=await svc.getProjectDocuments('P');
  expect(r).toEqual([{id:'L',projectId:'P',name:'x',url:'u',type:'spec-sheet',uploadedAt:new Date(5),uploadedBy:'u',linkedBOMItems:['i'],fileSize:2}]);expect(h.getNative).not.toHaveBeenCalled();
 });
 it('any pending upload or deletion for this account and project reads native even with the flag off',async()=>{
  sessionStorage.setItem(upKey('spec-sheet'),'{}');h.getNative.mockResolvedValue([nativeDoc('A','vendor-quote')]);
  expect(await svc.getProjectDocuments('P')).toHaveLength(1);expect(h.getDocs).not.toHaveBeenCalled();
  sessionStorage.clear();sessionStorage.setItem(delKey('D'),'{}');
  expect(await svc.getProjectDocuments('P')).toHaveLength(1);expect(h.getDocs).not.toHaveBeenCalled();expect(h.getNative).toHaveBeenCalledTimes(2);
 });
 it('flag-off rows carrying the native marker are replaced by the hydrated native read',async()=>{
  const marker={operation_id:'o',path:'p',generation:'1'};
  h.getDocs.mockResolvedValue(snap([{id:'N',projectId:'P',name:'n',url:'tokenless',type:'vendor-quote',uploadedAt:{toDate:()=>new Date(1)},uploadedBy:'u',pulseNativeDocument:marker}]));
  h.getNative.mockResolvedValue([nativeDoc('N','vendor-quote')]);
  const r=await svc.getProjectDocuments('P');expect(r).toEqual([nativeDoc('N','vendor-quote')]);expect(r[0].url).not.toBe('tokenless');
 });
 it('getByType filters the same hydrated read per type and keeps the typed SDK query for pure legacy data',async()=>{
  h.enabled.mockReturnValue(true);h.getNative.mockResolvedValue([nativeDoc('A','vendor-quote'),nativeDoc('B','spec-sheet')]);
  expect((await svc.getProjectDocumentsByType('P','spec-sheet')).map(d=>d.id)).toEqual(['B']);expect(h.getDocs).not.toHaveBeenCalled();
  h.enabled.mockReturnValue(false);
  h.getDocs.mockResolvedValue(snap([{id:'N',projectId:'P',name:'n',url:'t',type:'spec-sheet',uploadedAt:{toDate:()=>new Date(1)},uploadedBy:'u',pulseNativeDocument:{operation_id:'o',path:'p',generation:'1'}}]));
  expect((await svc.getProjectDocumentsByType('P','spec-sheet')).map(d=>d.id)).toEqual(['B']);
  h.getDocs.mockResolvedValue(snap([{id:'L',projectId:'P',name:'n',url:'t',type:'spec-sheet',uploadedBy:'u'}]));h.getNative.mockClear();
  const legacy=await svc.getProjectDocumentsByType('P','spec-sheet');expect(legacy[0].id).toBe('L');expect(legacy[0].uploadedAt).toBeInstanceOf(Date);expect(h.getNative).not.toHaveBeenCalled();
  sessionStorage.setItem(delKey('D'),'{}');expect((await svc.getProjectDocumentsByType('P','vendor-quote')).map(d=>d.id)).toEqual(['A']);
 });
 it('native read failures never fall back, while flag-off reads tolerate unrelated damaged recovery metadata',async()=>{
  h.enabled.mockReturnValue(true);h.getNative.mockRejectedValue(Error('native down'));
  await expect(svc.getProjectDocuments('P')).rejects.toThrow('native down');await expect(svc.getProjectDocumentsByType('P','spec-sheet')).rejects.toThrow('native down');
  h.enabled.mockReturnValue(false);sessionStorage.setItem(delKey('a/b'),'{}');
  expect(await svc.getProjectDocuments('P')).toEqual([]);expect(h.getDocs).toHaveBeenCalledOnce();
 });
 it('flag-off reads remain available with unreadable sessionStorage and hydrate any native row through the API',async()=>{
  sessionStorage.setItem('unrelated','x');vi.spyOn(Storage.prototype,'key').mockImplementation(()=>{throw Error('storage blocked');});
  h.getDocs.mockResolvedValue(snap([{id:'L',projectId:'P',name:'x',url:'u',type:'spec-sheet',uploadedBy:'u'}]));expect((await svc.getProjectDocuments('P'))[0].id).toBe('L');expect((await svc.getProjectDocumentsByType('P','spec-sheet'))[0].id).toBe('L');
  h.getDocs.mockResolvedValue(snap([{id:'N',projectId:'P',type:'spec-sheet',pulseNativeDocument:{operation_id:'o'}}]));h.getNative.mockResolvedValue([nativeDoc('N','spec-sheet')]);expect((await svc.getProjectDocuments('P'))[0].id).toBe('N');expect(h.getNative).toHaveBeenCalledOnce();
 });
 it('an account or project change during a legacy read rejects the result',async()=>{
  h.getDocs.mockImplementation(async()=>{h.auth.currentUser={uid:'bob'};return snap([]);});
  await expect(svc.getProjectDocuments('P')).rejects.toThrow(/account|project/i);
  h.auth.currentUser={uid:'alice'};let current=true;h.getDocs.mockImplementation(async()=>{current=false;return snap([]);});
  await expect(svc.getProjectDocumentsByType('P','spec-sheet',{isCurrent:()=>current})).rejects.toThrow(/account|project/i);
 });
});

describe('delete dispatch',()=>{
 it('legacy unmarked flag-off delete keeps the old storage-then-record behaviour',async()=>{
  const url='https://firebasestorage.googleapis.com/v0/b/b/o/projects%2FP%2Fdocuments%2Fx.pdf?alt=media&token=t';
  await svc.deleteProjectDocument('L',url);await svc.deleteProjectDocument('L2',url,{id:'L2',projectId:'P'} as any);
  expect(h.deleteObject).toHaveBeenCalledTimes(2);expect(h.deleteDoc).toHaveBeenCalledTimes(2);expect(h.createDelete).not.toHaveBeenCalled();
 });
 it.each(['flag','opening','marker','url'])('%s routes to the exact native opening deletion with no rebase and no acknowledgement',async mode=>{
  const original:any={...nativeDoc('D','vendor-quote')};let url='https://x/plain';
  if(mode==='flag')h.enabled.mockReturnValue(true);
  if(mode==='marker')original.pulseNativeDocument={operation_id:'o',path:'p',generation:'1'};
  if(mode==='url')url='https://firebasestorage.googleapis.com/v0/b/b/o/'+encodeURIComponent('projects/P/documents/native/finalized/'+'a'.repeat(64)+'.bin')+'?alt=media';
  const a=deleteAttempt();h.createDelete.mockReturnValue(a);const isCurrent=()=>true;
  await svc.deleteProjectDocument('D',url,original,{isCurrent});
  expect(h.createDelete).toHaveBeenCalledWith({projectId:'P',documentId:'D',expectedActorUid:'alice',opening,isCurrent});
  expect(a.run).toHaveBeenCalledTimes(1);expect(a.acknowledge).not.toHaveBeenCalled();expect(h.getNative).not.toHaveBeenCalled();expect(h.getDocs).not.toHaveBeenCalled();
  expect(h.deleteObject).not.toHaveBeenCalled();expect(h.deleteDoc).not.toHaveBeenCalled();
 });
 it('native mode refuses to delete without the original project and displayed opening instead of using the SDK',async()=>{
  h.enabled.mockReturnValue(true);
  await expect(svc.deleteProjectDocument('D','https://x/y')).rejects.toThrow();
  await expect(svc.deleteProjectDocument('D','https://x/y',{id:'D',projectId:'P'} as any)).rejects.toThrow();
  h.enabled.mockReturnValue(false);
  await expect(svc.deleteProjectDocument('D','https://x/y',{id:'D',projectId:'P',pulseNativeDocument:{operation_id:'o',path:'p',generation:'1'}} as any)).rejects.toThrow();
  expect(h.createDelete).not.toHaveBeenCalled();expect(h.deleteObject).not.toHaveBeenCalled();expect(h.deleteDoc).not.toHaveBeenCalled();
 });
 it('native delete failures are surfaced and never fall back',async()=>{
  h.enabled.mockReturnValue(true);h.createDelete.mockReturnValue(deleteAttempt({run:vi.fn(async()=>{throw Error('unconfirmed');})}));
  await expect(svc.deleteProjectDocument('D','u',nativeDoc('D','vendor-quote') as any)).rejects.toThrow('unconfirmed');expect(h.deleteDoc).not.toHaveBeenCalled();expect(h.deleteObject).not.toHaveBeenCalled();
 });
});

describe('link',()=>{
 it('scoped reads refuse replacement link arrays even if material and document edit gates are off',async()=>{
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED','true');
  vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED','false');
  await expect(svc.linkDocumentToBOMItems('D',['i'])).rejects.toThrow(/BOM|native|versioned/i);
  expect(h.updateDoc).not.toHaveBeenCalled();
 });
 it('safe material mode refuses a legacy link even when native document upload mode is off',async()=>{
  vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED','true');
  await expect(svc.linkDocumentToBOMItems('D',['i'])).rejects.toThrow(/BOM|native|versioned/i);
  expect(h.updateDoc).not.toHaveBeenCalled();
 });
 it('is refused in native mode and unchanged for legacy',async()=>{
  vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED','false');
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED','false');
  await svc.linkDocumentToBOMItems('D',['i']);expect(h.updateDoc).toHaveBeenCalledTimes(1);
  h.enabled.mockReturnValue(true);await expect(svc.linkDocumentToBOMItems('D',['i'])).rejects.toThrow();expect(h.updateDoc).toHaveBeenCalledTimes(1);
 });
});

describe('pending operations and recovery',()=>{
 it('lists pending uploads and deletions strictly for the account and project, failing closed when storage is damaged',()=>{
  sessionStorage.setItem(upKey('vendor-quote'),'x');sessionStorage.setItem(upKey('spec-sheet','bob'),'x');sessionStorage.setItem(delKey('D'),'x');sessionStorage.setItem(delKey('E','alice','Q'),'x');
  expect(svc.getPendingProjectDocumentOperations('P','alice')).toEqual({uploads:['vendor-quote'],deletions:['D']});
  sessionStorage.setItem(delKey('a/b'),'x');expect(()=>svc.getPendingProjectDocumentOperations('P','alice')).toThrow();
  expect(sessionStorage.getItem(delKey('a/b'))).toBe('x');
 });
 it('recovers the same saved upload without a flag, requires a saved type and never acknowledges',async()=>{
  const f=file('reselect.pdf');await expect(svc.recoverProjectDocumentUpload('P','vendor-quote','alice',f)).rejects.toThrow(/saved|pending|no /i);expect(h.createUpload).not.toHaveBeenCalled();
  sessionStorage.setItem(upKey('vendor-quote'),'{}');const a=uploadAttempt();h.createUpload.mockReturnValue(a);const isCurrent=()=>true;
  const d=await svc.recoverProjectDocumentUpload('P','vendor-quote','alice',f,{isCurrent});
  expect(h.createUpload).toHaveBeenCalledWith({projectId:'P',documentType:'vendor-quote',expectedActorUid:'alice',file:f,isCurrent});
  expect(d.id).toBe('N');expect(a.acknowledge).not.toHaveBeenCalled();
  await svc.recoverProjectDocumentUpload('P','vendor-quote','alice');expect(h.createUpload.mock.calls[1][0].file).toBeUndefined();
 });
 it('cancels and acknowledges only an existing saved upload, passing committed results through',async()=>{
  await expect(svc.cancelProjectDocumentUpload('P','spec-sheet','alice')).rejects.toThrow();await expect(svc.acknowledgeProjectDocumentUpload('P','spec-sheet','alice')).rejects.toThrow();expect(h.createUpload).not.toHaveBeenCalled();
  sessionStorage.setItem(upKey('spec-sheet'),'{}');const doc=nativeDoc('N','spec-sheet');
  const a=uploadAttempt({cancel:vi.fn(async()=>({resolution:'committed',document:doc}))});h.createUpload.mockReturnValue(a);
  expect(await svc.cancelProjectDocumentUpload('P','spec-sheet','alice')).toEqual({resolution:'committed',document:doc});expect(a.acknowledge).not.toHaveBeenCalled();
  await svc.acknowledgeProjectDocumentUpload('P','spec-sheet','alice');expect(a.acknowledge).toHaveBeenCalledTimes(1);
 });
 it('recovers or resolves only an existing saved deletion using its saved opening',async()=>{
  await expect(svc.recoverProjectDocumentDeletion('P','D','alice',false)).rejects.toThrow();expect(h.createDelete).not.toHaveBeenCalled();
  sessionStorage.setItem(delKey('D'),'{}');const a=deleteAttempt();h.createDelete.mockReturnValue(a);const isCurrent=()=>true;
  expect(await svc.recoverProjectDocumentDeletion('P','D','alice',false,{isCurrent})).toBe('committed');
  expect(h.createDelete).toHaveBeenCalledWith({projectId:'P',documentId:'D',expectedActorUid:'alice',opening:undefined,isCurrent});
  expect(await svc.recoverProjectDocumentDeletion('P','D','alice',true)).toBe('cancelled');expect(a.run).toHaveBeenCalledTimes(1);expect(a.resolve).toHaveBeenCalledTimes(1);expect(a.acknowledge).not.toHaveBeenCalled();
  await expect(svc.recoverProjectDocumentDeletion('P','OTHER','alice',false)).rejects.toThrow();
  await svc.acknowledgeProjectDocumentDeletion('P','D','alice');expect(a.acknowledge).toHaveBeenCalledTimes(1);
  await expect(svc.acknowledgeProjectDocumentDeletion('P','OTHER','alice')).rejects.toThrow();
 });
});
