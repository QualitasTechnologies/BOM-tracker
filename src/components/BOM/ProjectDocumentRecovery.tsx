import {useEffect,useRef,useState} from 'react';
import {auth} from '@/firebase';
import {Button} from '@/components/ui/button';
import type {DocumentType,ProjectDocument} from '@/types/projectDocument';
import {
  getPendingProjectDocumentOperations,recoverProjectDocumentUpload,cancelProjectDocumentUpload,
  acknowledgeProjectDocumentUpload,recoverProjectDocumentDeletion,acknowledgeProjectDocumentDeletion,
} from '@/utils/projectDocumentFirestore';

interface Props {
  projectId: string;
  types?: readonly DocumentType[];
  documents?: ProjectDocument[];
  refreshKey?: unknown;
  contextKey?: string;
  disabled?: boolean;
  includeDeletions?: boolean;
  isCurrent?: () => boolean;
  onRefresh?: () => void | Promise<void>;
  onUploadRecovered?: (document: ProjectDocument) => void | Promise<void>;
}
const LABELS: Record<DocumentType,string> = {'vendor-quote':'Vendor Quote','vendor-po':'Vendor PO','customer-po':'Customer PO','vendor-invoice':'Vendor Invoice','spec-sheet':'Spec Sheet'};
const ALL_TYPES = Object.keys(LABELS) as DocumentType[];
const EMPTY = {uploads:[] as DocumentType[],deletions:[] as string[]};

// Recovery is deliberately available with the write switch off. Requests retain
// their saved identities; refresh failures never acknowledge or start a new one.
export default function ProjectDocumentRecovery({projectId,types=ALL_TYPES,documents=[],refreshKey,contextKey,disabled=false,includeDeletions=true,isCurrent,onRefresh,onUploadRecovered}: Props) {
  const uid=auth.currentUser?.uid || '',scope=JSON.stringify([projectId,uid,contextKey]);
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const mounted=useRef(true),busyRef=useRef(false);
  const [pending,setPending]=useState(EMPTY),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const typeKey=types.join('|');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current && scopeRef.current===scope && auth.currentUser?.uid===uid && (!isCurrent || isCurrent());
  const scan=()=>{
    if(!uid || !projectId || !current())return;
    try {setPending(getPendingProjectDocumentOperations(projectId,uid));}
    catch(error){setMessage(error instanceof Error?error.message:'Saved document requests could not be read.');}
  };
  useEffect(()=>{setPending(EMPTY);setMessage('');busyRef.current=false;setBusy(false);scan();},[scope]);
  useEffect(()=>{scan();},[scope,refreshKey,typeKey]);
  const assertCurrent=()=>{if(!current())throw Error('The account or document context changed. Reopen the original project.');};
  const run=async(action:()=>Promise<void>)=>{
    if(busyRef.current || disabled || !current())return;
    busyRef.current=true;setBusy(true);setMessage('');
    try {await action();}
    catch(error){if(current())setMessage(error instanceof Error?error.message:'The saved document request remains unconfirmed.');}
    finally {if(current()){busyRef.current=false;setBusy(false);scan();}}
  };
  const finishUpload=async(type:DocumentType,document:ProjectDocument)=>{
    assertCurrent();
    try {await onUploadRecovered?.(document);assertCurrent();await onRefresh?.();assertCurrent();}
    catch(error){assertCurrent();throw Error('Document saved, but the view could not refresh. Retry the saved request to refresh it.');}
    await acknowledgeProjectDocumentUpload(projectId,type,uid,{isCurrent:current});assertCurrent();
  };
  const retryUpload=(type:DocumentType,file?:File)=>run(async()=>{
    const document=await recoverProjectDocumentUpload(projectId,type,uid,file,{isCurrent:current});
    await finishUpload(type,document);
  });
  const cancelUpload=(type:DocumentType)=>run(async()=>{
    const result=await cancelProjectDocumentUpload(projectId,type,uid,{isCurrent:current});assertCurrent();
    if(result.resolution==='committed'){
      if(!result.document)throw Error('The completed document could not be confirmed. Retry its saved upload.');
      await finishUpload(type,result.document);
    }
  });
  const recoverDeletion=(id:string,resolve:boolean)=>run(async()=>{
    await recoverProjectDocumentDeletion(projectId,id,uid,resolve,{isCurrent:current});assertCurrent();
    try {await onRefresh?.();assertCurrent();}
    catch(error){assertCurrent();throw Error('The deletion outcome is confirmed, but the view could not refresh. Retry the saved request to refresh it.');}
    await acknowledgeProjectDocumentDeletion(projectId,id,uid,{isCurrent:current});assertCurrent();
  });
  const uploads=pending.uploads.filter(type=>types.includes(type)),deletions=includeDeletions?pending.deletions:[];
  if(!uploads.length && !deletions.length && !message)return null;
  return <div className="my-3 space-y-3 rounded border border-amber-300 bg-amber-50 p-3" aria-label="Saved document requests">
    <p className="text-sm font-medium">Finish saved document requests</p>
    {message && <p role="alert" className="text-sm">{message}</p>}
    {uploads.map(type=><div key={type} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{LABELS[type]} upload pending.</span>
      <span className="basis-full text-xs text-gray-700">If the upload never started, select the original file. Checking a saved request will not upload the file twice. Cancel this request before selecting a new file.</span>
      <Button type="button" variant="outline" size="sm" disabled={busy||disabled} aria-label={`Check saved ${LABELS[type]} Upload`} onClick={()=>retryUpload(type)}>Check saved upload</Button>
      <label className="text-sm underline cursor-pointer">Select original file
        <input type="file" className="sr-only" disabled={busy||disabled} aria-label={`Select original ${LABELS[type]} File`} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void retryUpload(type,file);}}/>
      </label>
      <Button type="button" variant="outline" size="sm" disabled={busy||disabled} aria-label={`Cancel ${LABELS[type]} Upload`} onClick={()=>cancelUpload(type)}>Cancel upload</Button>
    </div>)}
    {deletions.map(id=>{const name=documents.find(document=>document.id===id)?.name || id;return <div key={id} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Deletion of {name} pending.</span>
      <Button type="button" variant="outline" size="sm" disabled={busy||disabled} aria-label={`Retry Deletion of ${name}`} onClick={()=>recoverDeletion(id,false)}>Retry deletion</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy||disabled} aria-label={`Resolve Deletion of ${name}`} onClick={()=>recoverDeletion(id,true)}>Resolve deletion</Button>
    </div>;})}
  </div>;
}
