import {beforeEach,expect,it,vi} from 'vitest';
import {createNativeProjectDocumentUploadAttempt,getPendingNativeProjectDocumentTypes} from '../nativeProjectDocumentUpload';
const hex='a'.repeat(64);
const staging=`projects/P/documents/native/staging/${hex}.bin`;
const finalPath=staging.replace('/staging/','/finalized/');
const urlFor=(p=finalPath,q='alt=media&token=synthetic&generation=7')=>`https://firebasestorage.googleapis.com/v0/b/visionbomtracker.firebasestorage.app/o/${encodeURIComponent(p)}?${q}`;
const key='bom-project-document:v1:alice:P:vendor-quote';
const file=(parts:BlobPart[]=['pdf'],type='application/pdf')=>new Blob(parts,{type});
const input=(extra:Record<string,unknown>={})=>({projectId:'P',documentType:'vendor-quote' as const,expectedActorUid:'alice',name:'quote.pdf',isCurrent:()=>true,...extra}) as any;
const mkDoc=(o:Record<string,unknown>={},size=3)=>({id:'n1',projectId:'P',name:'quote.pdf',type:'vendor-quote',url:urlFor(),uploadedAt:'2026-10-16T01:02:03.000Z',uploadedBy:'alice',linkedBOMItems:[],fileSize:size,
 pulseNativeDocument:{operation_id:'n2',path:finalPath,generation:'7'},...o});
const reserved=()=>({data:{ok:true,operation_id:'n2',path:staging,expires_at:'2026-10-16T01:00:00Z'}});
beforeEach(()=>sessionStorage.clear());
function setup(){
 let lost=true,uid='alice',n=0;const upload=vi.fn(async(..._a:any[])=>{});
 const callable=vi.fn(async(body:Record<string,unknown>,..._r:any[]):Promise<{data:unknown}>=>{
  const op=body.operation_id as string;
  if(body.operation==='reserve')return{data:{ok:true,operation_id:op,path:staging,expires_at:'2026-10-16T01:00:00Z'}};
  if(body.operation==='cancel')return{data:{ok:true,operation_id:op,resolution:'cancelled'}};
  if(lost){lost=false;throw Error('lost ack');}
  return{data:{ok:true,operation_id:op,path:staging,generation:'7',document:mkDoc({id:body.document_id,pulseNativeDocument:{operation_id:op,path:finalPath,generation:'7'}},Number(sessionStorage.getItem('size')??3))}};
 });
 const deps={nonce:()=>`n${++n}`,digest:async()=>hex,currentUid:async()=>uid,upload,callable} as any;
 return{deps,upload,callable,switchUid:()=>{uid='bob';},unlose:()=>{lost=false;}};
}
const ops=(f:ReturnType<typeof setup>)=>f.callable.mock.calls.map(c=>(c[0] as any).operation);
const make=(extra:Record<string,unknown>,f:ReturnType<typeof setup>)=>createNativeProjectDocumentUploadAttempt(input(extra),f.deps);

it('one Storage write survives a lost finalize ACK and reuses the same ids and fingerprint',async()=>{
 const f=setup(),a=make({file:file()},f);
 await expect(a.run()).rejects.toThrow();expect(a.needsRecovery).toBe(true);
 const doc=await a.run();
 expect(f.upload).toHaveBeenCalledOnce();expect(f.upload.mock.calls[0].slice(0,2)).toEqual([staging,expect.anything()]);expect(f.upload.mock.calls[0][4]).toBe('application/pdf');
 expect(doc.uploadedAt).toBeInstanceOf(Date);expect(doc).toMatchObject({id:'n1',projectId:'P',type:'vendor-quote',linkedBOMItems:[],fileSize:3});
 expect(doc.pulseNativeDocument).toEqual({operation_id:'n2',path:finalPath,generation:'7'});
 const bodies=f.callable.mock.calls.map(c=>c[0] as any);
 expect(bodies[0]).toEqual({operation:'reserve',project_id:'P',document_id:'n1',operation_id:'n2',expected_actor_uid:'alice',name:'quote.pdf',document_type:'vendor-quote',content_type:'application/pdf',byte_size:3,sha256:hex});
 expect(bodies.slice(1).map(b=>[b.operation,b.document_id,b.operation_id])).toEqual([['finalize','n1','n2'],['finalize','n1','n2']]);
 expect(await a.run()).toBe(doc);
});
it('finalizes after a reload without file bytes once the write started',async()=>{
 const f=setup();await expect(make({file:file()},f).run()).rejects.toThrow();
 const doc=await make({},f).run();
 expect(doc.id).toBe('n1');expect(f.upload).toHaveBeenCalledOnce();expect(ops(f)).toEqual(['reserve','finalize','finalize']);
});
it('an uncertain storage write is never repeated and is finalized or cancelled with the same ids',async()=>{
 const f=setup();f.upload.mockRejectedValue(Error('storage ack lost'));
 const a=make({file:file()},f);
 await expect(a.run()).rejects.toThrow();await expect(a.run()).rejects.toThrow();expect(f.upload).toHaveBeenCalledOnce();
 expect((await a.cancel()).resolution).toBe('cancelled');expect(f.callable.mock.calls.at(-1)?.[0]).toMatchObject({operation:'cancel',document_id:'n1',operation_id:'n2'});
});
it('an unstarted saved upload needs the original file (name, MIME, size and hash) and mints no new ids',async()=>{
 const f=setup();await make({file:file()},f).prepare();
 expect(f.callable).not.toHaveBeenCalled();expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual(['vendor-quote']);
 await expect(make({},f).run()).rejects.toThrow(/original/i);
 const otherHash=setup();otherHash.deps.digest=async()=> 'b'.repeat(64);
 await expect(make({file:file()},otherHash).run()).rejects.toThrow(/different|unconfirmed/i);
 await expect(make({file:file(['xyzw'])},f).run()).rejects.toThrow(/different|unconfirmed/i);
 await expect(make({file:file(),name:'other.pdf'},f).run()).rejects.toThrow(/different|unconfirmed/i);
 await expect(make({file:file(['pdf'],'image/png')},f).run()).rejects.toThrow(/different|unconfirmed/i);
 expect(f.callable).not.toHaveBeenCalled();f.unlose();
 const doc=await make({file:file()},f).run();expect(doc.id).toBe('n1');expect(f.upload).toHaveBeenCalledOnce();
});
it('preserves zero-byte files, empty MIME and Office/spreadsheet/image families without transcoding',async()=>{
 const types=['','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/svg+xml','text/csv; charset=utf-8','application/x-custom~type'];
 for(const t of types){
  sessionStorage.clear();const f=setup();f.unlose();const body=t===''?[]:['x'];
  sessionStorage.setItem('size',String(body.length));
  await make({file:file(body,t),name:'quote.pdf'},f).run();
  const want=t===''?'application/octet-stream':t;
  expect(f.callable.mock.calls[0][0]).toMatchObject({content_type:want,byte_size:body.length});
  expect(f.upload.mock.calls[0][4]).toBe(want);
 }
 sessionStorage.removeItem('size');
});
it('rejects invalid selections before any request',async()=>{
 const f=setup();const fake=(size:number,type:string)=>({size,type,arrayBuffer:async()=>new ArrayBuffer(0)}) as unknown as Blob;
 const bad:[Blob,string][]=[[fake(10485760,'application/pdf'),'a.pdf'],[fake(3,'a\nb'),'a.pdf'],[fake(3,'a\rb'),'a.pdf'],[fake(3,'x'.repeat(257)),'a.pdf'],[fake(3,'café/x'),'a.pdf'],[file(),''],[file(),'n'.repeat(4097)]];
 for(const [b,name] of bad)await expect(make({file:b,name},f).run()).rejects.toThrow();
 await expect(make({file:file(),documentType:'invoice'},f).run()).rejects.toThrow();
 expect(f.callable).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it('rejects a reserve path outside this project staging namespace before writing',async()=>{
 for(const p of [staging.replace('/P/','/Q/'),staging.replace('/staging/','/finalized/'),`projects/P/documents/native/staging/${hex}.pdf`,`projects/P/documents/vendor-quote/${hex}.bin`]){
  sessionStorage.clear();const f=setup();f.callable.mockResolvedValue({data:{ok:true,operation_id:'n2',path:p,expires_at:'2026-10-16T01:00:00Z'}} as any);
  await expect(make({file:file()},f).run()).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();
 }
});
it('rejects forged finalize destinations, queries and metadata and never persists them as done',async()=>{
 const other='projects/P/documents/native/finalized/'+'b'.repeat(64)+'.bin';
 const cases:Record<string,(r:any)=>void>={
  otherDocUrl:r=>{r.document.url=urlFor(other);},stagingUrl:r=>{r.document.url=urlFor(staging);},
  otherProject:r=>{r.document.url=urlFor(finalPath.replace('/P/','/Q/'));},badBucket:r=>{r.document.url=urlFor().replace('visionbomtracker.firebasestorage.app','evil');},
  badHost:r=>{r.document.url=urlFor().replace('firebasestorage.googleapis.com','evil.test');},noToken:r=>{r.document.url=urlFor(finalPath,'alt=media&generation=7');},
  emptyToken:r=>{r.document.url=urlFor(finalPath,'alt=media&token=&generation=7');},altJson:r=>{r.document.url=urlFor(finalPath,'alt=json&token=t&generation=7');},
  dupToken:r=>{r.document.url=urlFor(finalPath,'alt=media&token=t&token=u&generation=7');},extraQuery:r=>{r.document.url=urlFor(finalPath,'alt=media&token=t&generation=7&x=1');},
  urlGen:r=>{r.document.url=urlFor(finalPath,'alt=media&token=t&generation=8');},hash:r=>{r.document.url+='#x';},
  badGen:r=>{r.generation='0';},pulseGen:r=>{r.document.pulseNativeDocument.generation='8';},pulseStagingPath:r=>{r.document.pulseNativeDocument.path=staging;},
  pulseOp:r=>{r.document.pulseNativeDocument.operation_id='zz';},respPath:r=>{r.path=other;},respOp:r=>{r.operation_id='zz';},
  id:r=>{r.document.id='n9';},proj:r=>{r.document.projectId='Q';},name:r=>{r.document.name='evil.pdf';},type:r=>{r.document.type='vendor-po';},
  actor:r=>{r.document.uploadedBy='mallory';},size:r=>{r.document.fileSize=4;},linked:r=>{r.document.linkedBOMItems=['x'];},date:r=>{r.document.uploadedAt='nope';},extraField:r=>{r.document.sourceUrl='http://x';},noMarker:r=>{delete r.document.pulseNativeDocument;},
 };
 for(const [label,mutate] of Object.entries(cases)){
  sessionStorage.clear();const f=setup();f.unlose();const good=f.callable.getMockImplementation()!;
  f.callable.mockImplementation(async(b:any)=>{const r:any=await good(b);if(b.operation==='finalize')mutate(r.data);return r;});
  await expect(make({file:file()},f).run(),label).rejects.toThrow();
  expect(JSON.parse(sessionStorage.getItem(key)!).document,label).toBeUndefined();
 }
});
it('cancel replay: cancelled clears only its own metadata and blocks reuse; committed persists done until acknowledged',async()=>{
 const f=setup(),a=make({file:file()},f);
 await expect(a.run()).rejects.toThrow();
 expect((await a.cancel()).resolution).toBe('cancelled');expect(sessionStorage.getItem(key)).toBeNull();expect(a.needsRecovery).toBe(false);
 await expect(a.run()).rejects.toThrow(/cancel/i);
 const g=setup();await expect(make({file:file()},g).run()).rejects.toThrow();
 g.callable.mockImplementation(async()=>({data:{ok:true,operation_id:'n2',resolution:'committed',path:staging,generation:'7',document:mkDoc()}}));
 const c=make({},g),r=await c.cancel();
 expect(r.resolution).toBe('committed');expect(r.document?.uploadedAt).toBeInstanceOf(Date);expect(c.needsRecovery).toBe(true);
 expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual(['vendor-quote']);
 await c.acknowledge();expect(sessionStorage.getItem(key)).toBeNull();expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual([]);
 sessionStorage.setItem(key,'{"x":1}');await expect(make({},setup()).cancel()).rejects.toThrow();expect(sessionStorage.getItem(key)).toBe('{"x":1}');
});
it('a completed but unacknowledged upload is recovered without any request and prevents duplicates',async()=>{
 const f=setup();f.unlose();const a=make({file:file()},f),doc=await a.run();
 expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual(['vendor-quote']);expect(a.needsRecovery).toBe(true);
 f.callable.mockClear();
 const b=make({file:file()},f),again=await b.run();
 expect(again).toEqual(doc);expect(f.callable).not.toHaveBeenCalled();expect(f.upload).toHaveBeenCalledOnce();
 await expect(make({file:file(['other'])},setup()).run()).rejects.toThrow();
 await b.acknowledge();expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual([]);expect(await b.run()).toBe(again);
 const c=make({file:file()},f),next=await c.run();
 expect(next.id).toBe('n3');expect(f.upload).toHaveBeenCalledTimes(2);
});
it('acknowledge clears only the same saved record',async()=>{
 const f=setup();f.unlose();const a=make({file:file()},f);await a.run();
 sessionStorage.setItem(key,'{"someone":"else"}');
 await expect(a.acknowledge()).rejects.toThrow();expect(sessionStorage.getItem(key)).toBe('{"someone":"else"}');
});
it('corrupt or conflicting storage fails closed and is never replaced',async()=>{
 const f=setup();sessionStorage.setItem(key,'corrupt');
 const a=make({file:file()},f);
 await expect(a.run()).rejects.toThrow(/safely recover/);await expect(a.run()).rejects.toThrow(/safely recover/);
 expect(f.callable).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe('corrupt');expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual(['vendor-quote']);
 const base='{"v":1,"document_id":"n1","operation_id":"n2","name":"a","content_type":"x","byte_size":1,"sha256":"'+hex+'"';
 for(const bad of [base+',"document_type":"vendor-po","write_started":false}',base+',"document_type":"vendor-quote","write_started":true}']){
  sessionStorage.setItem(key,bad);await expect(make({file:file()},f).run()).rejects.toThrow(/safely recover/);
 }
 sessionStorage.clear();const b=make({file:file()},f);
 f.callable.mockImplementationOnce(async()=>{sessionStorage.setItem(key,'{"other":"tab"}');return reserved();});
 await expect(b.run()).rejects.toThrow(/safely recover/);expect(f.upload).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe('{"other":"tab"}');
});
it('account or project changes win over errors and results',async()=>{
 const f=setup();f.callable.mockImplementation(async()=>{f.switchUid();throw Error('private backend detail');});
 await expect(make({file:file()},f).run()).rejects.toThrow(/account changed/i);expect(f.upload).not.toHaveBeenCalled();
 sessionStorage.clear();const g=setup();g.unlose();let current=true;
 g.upload.mockImplementation(async()=>{current=false;});
 await expect(make({file:file(),isCurrent:()=>current},g).run()).rejects.toThrow(/project changed/i);
 expect(JSON.parse(sessionStorage.getItem(key)!).document).toBeUndefined();expect(ops(g)).toEqual(['reserve']);
 sessionStorage.clear();const h=setup();h.unlose();h.callable.mockImplementationOnce(async()=>{h.switchUid();return reserved();});
 await expect(make({file:file()},h).run()).rejects.toThrow(/account changed/i);expect(h.upload).not.toHaveBeenCalled();
});
it('discovery is scoped to the account and project',()=>{
 const raw='corrupt';
 sessionStorage.setItem('bom-project-document:v1:alice:P:spec-sheet',raw);sessionStorage.setItem('bom-project-document:v1:alice:Q:vendor-po',raw);
 sessionStorage.setItem('bom-project-document:v1:bob:P:customer-po',raw);sessionStorage.setItem('bom-project-document:v1:alice:P:bogus',raw);sessionStorage.setItem('bom-project-document:v1:alice:P:vendor-quote',raw);
 expect(getPendingNativeProjectDocumentTypes('alice','P')).toEqual(['vendor-quote','spec-sheet']);
});
it('discovery reports unreadable recovery storage instead of claiming no saved upload exists',()=>{
 const read=vi.spyOn(Storage.prototype,'key').mockImplementation(()=>{throw Error('storage blocked');});
 sessionStorage.setItem(key,'saved');
 try {
  expect(()=>getPendingNativeProjectDocumentTypes('alice','P')).toThrow(/recover|saved|storage/i);
  expect(sessionStorage.getItem(key)).toBe('saved');
 } finally {read.mockRestore();}
});
it('discovery does not hide a damaged encoded recovery key',()=>{
 sessionStorage.setItem('bom-project-document:v1:alice:P:%broken','saved');
 expect(()=>getPendingNativeProjectDocumentTypes('alice','P')).toThrow(/recover|saved|storage/i);
 expect(sessionStorage.length).toBe(1);
});
it('a loaded upload cannot ignore another request replacing its saved recovery record',async()=>{
 const f=setup();f.unlose();const a=make({file:file()},f);await a.run();sessionStorage.setItem(key,'other');
 await expect(a.run()).rejects.toThrow(/recover|saved/i);await expect(a.cancel()).rejects.toThrow(/recover|saved/i);expect(f.upload).toHaveBeenCalledOnce();
});
it('restoring the original recovery record after interference still reuses the old request',async()=>{
 const f=setup();await expect(make({file:file()},f).run()).rejects.toThrow();
 const a=make({file:file()},f);await a.prepare();const original=sessionStorage.getItem(key)!;
 sessionStorage.setItem(key,'other');await expect(a.run()).rejects.toThrow(/recover/);sessionStorage.setItem(key,original);
 expect((await a.run()).id).toBe('n1');expect(f.upload).toHaveBeenCalledOnce();expect(f.callable.mock.calls.at(-1)?.[0]).toMatchObject({operation_id:'n2',document_id:'n1'});
});
