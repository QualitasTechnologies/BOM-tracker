import {beforeEach,expect,it,vi} from 'vitest';
import * as service from '../nativeProjectDocumentOperations';
const opening={project_id:'P',actor_uid:'alice',project_version:'1:1',bom_version:'2:2',document_version:'3:3'};
const row={id:'D',projectId:'P',name:'a.pdf',url:'https://example.test/a',type:'vendor-quote',uploadedAt:'2026-10-16T00:00:00Z',uploadedBy:'alice',linkedBOMItems:[],fileSize:3,nativeOpening:opening};
beforeEach(()=>sessionStorage.clear());
function fixture(){let uid='alice',n=0;const callable=vi.fn(async(body:any)=>({data:body.operation==='get'?{ok:true,project_id:'P',documents:[row],next_cursor:null}:{ok:true,document_id:'D',operation_id:body.operation_id,resolution:body.operation==='delete'?'committed':'cancelled'}}));return{callable,deps:{currentUid:async()=>uid,nonce:()=>`n${++n}`,callable},switchUid:()=>{uid='bob';}};}
const create=(f:ReturnType<typeof fixture>,extra:Record<string,unknown>={})=>service.createNativeProjectDocumentDeleteAttempt({projectId:'P',documentId:'D',expectedActorUid:'alice',opening,isCurrent:()=>true,...extra} as any,f.deps as any);
it('reads all pages and converts dates while retaining the displayed deletion baseline',async()=>{
 const f=fixture();f.callable.mockResolvedValueOnce({data:{ok:true,project_id:'P',documents:[],next_cursor:'filtered'}} as any);
 const result=await service.getNativeProjectDocuments('P','alice',()=>true,f.deps as any);
 expect(result).toHaveLength(1);expect(result[0].uploadedAt).toBeInstanceOf(Date);expect(result[0].nativeOpening).toEqual(opening);
 expect(f.callable.mock.calls.map(c=>c[0])).toEqual([{operation:'get',project_id:'P',expected_actor_uid:'alice'},{operation:'get',project_id:'P',expected_actor_uid:'alice',cursor:'filtered'}]);
});
it('refuses malformed pages, duplicate identities, cursor loops and wrong account baselines',async()=>{
 const mutations=[(r:any)=>{r.documents[0].nativeOpening.actor_uid='bob';},(r:any)=>{r.documents[0].projectId='Q';},(r:any)=>{r.documents[0].nativeOpening.document_version='bad';},(r:any)=>{r.documents.push(r.documents[0]);},(r:any)=>{r.next_cursor='same';}];
 for(const mutate of mutations){const f=fixture();const response=structuredClone({ok:true,project_id:'P',documents:[row],next_cursor:null});mutate(response);f.callable.mockResolvedValue({data:response} as any);await expect(service.getNativeProjectDocuments('P','alice',()=>true,f.deps as any)).rejects.toThrow(/unexpected result/);expect(f.callable).toHaveBeenCalled();}
});
it('deletion persists the actual displayed versions and retries the identical nonce after a lost reply and reload',async()=>{
 const f=fixture();f.callable.mockRejectedValueOnce(Error('lost acknowledgement'));
 await expect(create(f).run()).rejects.toThrow();
 const edited={...opening,document_version:'99:99'};await expect(create(f,{opening:edited}).run()).rejects.toThrow(/saved|original|different/i);
 expect(f.callable).toHaveBeenCalledTimes(1);
 const resumed=create(f,{opening:undefined});expect(await resumed.run()).toBe('committed');expect(f.callable.mock.calls[0][0]).toEqual(f.callable.mock.calls[1][0]);
 expect(f.callable.mock.calls[1][0]).toMatchObject({expected_document_version:'3:3',expected_bom_version:'2:2',expected_project_version:'1:1',operation_id:'n1'});
 const count=f.callable.mock.calls.length;expect(await create(f,{opening:undefined}).run()).toBe('committed');expect(f.callable).toHaveBeenCalledTimes(count);
 await resumed.acknowledge();expect(sessionStorage.length).toBe(0);
});
it('explicit resolution uses saved versions and fences the original request without minting a replacement',async()=>{
 const f=fixture();f.callable.mockRejectedValueOnce(Error('lost'));await expect(create(f).run()).rejects.toThrow();
 const a=create(f,{opening:undefined});expect(await a.resolve()).toBe('cancelled');
 expect(f.callable.mock.calls.at(-1)?.[0]).toEqual({...f.callable.mock.calls[0][0],operation:'resolve_delete'});
 await expect(a.run()).rejects.toThrow(/cancelled/i);await a.acknowledge();await expect(create(f,{opening:undefined}).resolve()).rejects.toThrow(/saved/i);
});
it('corrupt recovery storage and concurrent replacement are preserved and never overwritten',async()=>{
 const f=fixture();sessionStorage.setItem('bom-project-document-delete:v1:alice:P:D','corrupt');await expect(create(f).run()).rejects.toThrow(/recover|storage/i);expect(f.callable).not.toHaveBeenCalled();expect(sessionStorage.getItem('bom-project-document-delete:v1:alice:P:D')).toBe('corrupt');
 sessionStorage.clear();f.callable.mockImplementationOnce(async(body:any)=>{sessionStorage.setItem('bom-project-document-delete:v1:alice:P:D','other');return{data:{ok:true,document_id:'D',operation_id:body.operation_id,resolution:'committed'}};});
 await expect(create(f).run()).rejects.toThrow(/recover|storage/i);expect(sessionStorage.getItem('bom-project-document-delete:v1:alice:P:D')).toBe('other');
});
it('current account and project checks win over late server responses and private errors',async()=>{
 const f=fixture();f.callable.mockImplementationOnce(async()=>{f.switchUid();throw Error('private detail');});await expect(create(f).run()).rejects.toThrow(/account changed/i);
 const g=fixture();let current=true;g.callable.mockImplementationOnce(async(body:any)=>{current=false;return{data:{ok:true,document_id:'D',operation_id:body.operation_id,resolution:'committed'}};});await expect(create(g,{isCurrent:()=>current}).run()).rejects.toThrow(/project changed/i);
});
it('forged deletion acknowledgements remain pending and cannot clear the saved request',async()=>{
 for(const field of ['operation_id','document_id','resolution']){sessionStorage.clear();const f=fixture();f.callable.mockImplementationOnce(async(body:any)=>({data:{ok:true,document_id:'D',operation_id:body.operation_id,resolution:'committed',[field]:'forged'}}));const a=create(f);await expect(a.run()).rejects.toThrow();await expect(a.acknowledge()).rejects.toThrow();expect(sessionStorage.length).toBe(1);}
});
it('equivalent opening map order does not replace or invalidate an existing saved deletion',async()=>{
 const f=fixture();f.callable.mockRejectedValueOnce(Error('lost'));await expect(create(f).run()).rejects.toThrow();
 const reversed=Object.fromEntries(Object.entries(opening).reverse());expect(await create(f,{opening:reversed}).run()).toBe('committed');expect(f.callable.mock.calls[1][0].operation_id).toBe('n1');
});
it('a previously loaded attempt cannot ignore another request replacing its recovery storage',async()=>{
 const f=fixture(),a=create(f);expect(await a.run()).toBe('committed');sessionStorage.setItem('bom-project-document-delete:v1:alice:P:D','other');
 await expect(a.run()).rejects.toThrow(/recover|saved/i);await expect(a.resolve()).rejects.toThrow(/recover|saved/i);expect(f.callable).toHaveBeenCalledTimes(1);
});
const dkey=(...p:string[])=>'bom-project-document-delete:v1:'+p.map(encodeURIComponent).join(':');
it('discovers pending deletion ids for exactly one account and project from metadata keys',()=>{
 sessionStorage.setItem(dkey('alice','P','D2'),'{}');sessionStorage.setItem(dkey('alice','P','D1'),'corrupt');
 sessionStorage.setItem(dkey('alice','Q','D3'),'{}');sessionStorage.setItem(dkey('bob','P','D4'),'{}');sessionStorage.setItem(dkey('alice','P:x','D5'),'{}');sessionStorage.setItem('unrelated','x');
 expect(service.getPendingNativeProjectDocumentDeletes('alice','P')).toEqual(['D1','D2']);
 expect(service.getPendingNativeProjectDocumentDeletes('alice','none')).toEqual([]);
 expect(sessionStorage.getItem(dkey('alice','P','D1'))).toBe('corrupt');
});
it('discovery fails closed on invalid encoded ids, unreadable storage and invalid arguments without erasing records',()=>{
 sessionStorage.setItem('bom-project-document-delete:v1:alice:P:%E0%A4%A','{}');
 expect(()=>service.getPendingNativeProjectDocumentDeletes('alice','P')).toThrow(/recover|storage|saved/i);
 sessionStorage.clear();sessionStorage.setItem(dkey('alice','P','a/b'),'{}');
 expect(()=>service.getPendingNativeProjectDocumentDeletes('alice','P')).toThrow(/recover|storage|saved/i);
 sessionStorage.clear();sessionStorage.setItem(dkey('alice','P','..'),'{}');
 expect(()=>service.getPendingNativeProjectDocumentDeletes('alice','P')).toThrow();
 expect(sessionStorage.length).toBe(1);
 sessionStorage.clear();sessionStorage.setItem(dkey('alice','P','D'),'{}');
 const spy=vi.spyOn(Storage.prototype,'key').mockImplementation(()=>{throw Error('blocked');});
 try{expect(()=>service.getPendingNativeProjectDocumentDeletes('alice','P')).toThrow(/recover|storage|saved/i);}finally{spy.mockRestore();}
 expect(()=>service.getPendingNativeProjectDocumentDeletes('','P')).toThrow();expect(()=>service.getPendingNativeProjectDocumentDeletes('alice','')).toThrow();
});
it('captures the displayed opening when the deletion attempt is created',async()=>{
 const f=fixture(),displayed={...opening},a=create(f,{opening:displayed});displayed.document_version='99:99';
 expect(await a.run()).toBe('committed');expect(f.callable.mock.calls[0][0].expected_document_version).toBe('3:3');
});
