import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {beforeEach,expect,it} from 'vitest';
import {createNativeProjectDocumentUploadAttempt} from '../nativeProjectDocumentUpload';
import {createNativeProjectDocumentDeleteAttempt,getNativeProjectDocuments} from '../nativeProjectDocumentOperations';
const require=createRequire(import.meta.url);
const {fixture}=require('../../../functions/nativeProjectDocumentFixture.cjs');
beforeEach(()=>sessionStorage.clear());
function setup(){
 const f=fixture(),bytes=f.bytes;let n=0,writes=0,loseUpload=true,loseDelete=true;
 const deps={currentUid:async()=>'alice',nonce:()=>`nonce-${++n}`,digest:async()=>createHash('sha256').update(bytes).digest('hex'),
  upload:async(path:string,_blob:Blob,_uid:string,_current:()=>boolean,type:string)=>{writes++;f.upload(path,bytes,type);},
  callable:async(body:Record<string,unknown>)=>{const data=await (body.operation==='get'?f.get(body):f.call(body));if(body.operation==='finalize'&&data.ok&&loseUpload){loseUpload=false;throw Error('lost upload reply');}if(body.operation==='delete'&&data.ok&&loseDelete){loseDelete=false;throw Error('lost delete reply');}return{data};}};
 const input={projectId:'P',documentType:'vendor-quote' as const,expectedActorUid:'alice',name:'quote.pdf',isCurrent:()=>true};
 return{f,bytes,deps,input,writes:()=>writes};
}
it('actual client and server recover upload then conditional delete after both acknowledgements are lost',async()=>{
 const {f,bytes,deps,input,writes}=setup();
 await expect(createNativeProjectDocumentUploadAttempt({...input,file:new Blob([bytes],{type:'application/pdf'})},deps).run()).rejects.toThrow();
 const upload=createNativeProjectDocumentUploadAttempt(input,deps),document=await upload.run();expect(writes()).toBe(1);expect(f.publications()).toBe(1);
 const rows=await getNativeProjectDocuments('P','alice',()=>true,deps);expect(rows[0].id).toBe(document.id);await upload.acknowledge();
 const deletion={projectId:'P',documentId:document.id,expectedActorUid:'alice',opening:rows[0].nativeOpening,isCurrent:()=>true};
 await expect(createNativeProjectDocumentDeleteAttempt(deletion,deps).run()).rejects.toThrow();
 f.off();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 const recovered=createNativeProjectDocumentDeleteAttempt({...deletion,opening:undefined},deps);expect(await recovered.resolve()).toBe('committed');await recovered.acknowledge();
 expect(f.docs.has('projectDocuments/'+document.id)).toBe(false);expect(f.docs.get('pulseDeletedProjectDocuments/P/documents/'+document.id).document.name).toBe('quote.pdf');expect(f.objects.size).toBe(2);expect(sessionStorage.length).toBe(0);
});
it('a stale displayed document cannot overwrite newer metadata and explicit resolution cancels only its original deletion',async()=>{
 const {f,bytes,deps,input}=setup();await expect(createNativeProjectDocumentUploadAttempt({...input,file:new Blob([bytes],{type:'application/pdf'})},deps).run()).rejects.toThrow();
 const document=await createNativeProjectDocumentUploadAttempt(input,deps).run();const [displayed]=await getNativeProjectDocuments('P','alice',()=>true,deps);
 f.docs.get('projectDocuments/'+document.id).name='newer.pdf';f.versions.set('projectDocuments/'+document.id,99);
 const deletion=createNativeProjectDocumentDeleteAttempt({projectId:'P',documentId:document.id,expectedActorUid:'alice',opening:displayed.nativeOpening,isCurrent:()=>true},deps);
 await expect(deletion.run()).rejects.toThrow();expect(await deletion.resolve()).toBe('cancelled');await expect(deletion.run()).rejects.toThrow(/cancelled/);expect(f.docs.get('projectDocuments/'+document.id).name).toBe('newer.pdf');
});
