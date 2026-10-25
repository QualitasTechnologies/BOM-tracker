import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ProjectDocuments from '../ProjectDocuments';
const m=vi.hoisted(()=>({uid:'alice',load:vi.fn(),upload:vi.fn(),remove:vi.fn(),ackUpload:vi.fn(),ackDelete:vi.fn(),toast:vi.fn(),pending:{uploads:[] as string[],deletions:[] as string[]}}));
vi.mock('@/firebase',()=>({auth:{get currentUser(){return{uid:m.uid};}}}));
vi.mock('@/components/ui/use-toast',()=>({useToast:()=>({toast:m.toast})}));
vi.mock('@/utils/projectDocumentFirestore',()=>({getProjectDocuments:m.load,uploadProjectDocument:m.upload,deleteProjectDocument:m.remove,acknowledgeProjectDocumentUpload:m.ackUpload,acknowledgeProjectDocumentDeletion:m.ackDelete,getPendingProjectDocumentOperations:()=>m.pending,linkDocumentToBOMItems:vi.fn()}));
const opening={project_id:'P',actor_uid:'alice',project_version:'1:1',bom_version:'2:2',document_version:'3:3'};
const doc={id:'D',projectId:'P',name:'quote.pdf',url:'https://example.test/quote',type:'vendor-quote',uploadedAt:new Date(),uploadedBy:'alice',nativeOpening:opening,pulseNativeDocument:{operation_id:'o',path:'p',generation:'1'}};
const props={projectId:'P',bomItems:[],fullPage:true,sections:[{type:'vendor-quote',label:'Vendor Quotes',description:''}]} as any;
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();m.uid='alice';m.pending={uploads:[],deletions:[]};vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED','true');vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED','true');vi.spyOn(window,'confirm').mockReturnValue(true);m.load.mockResolvedValue([doc]);m.upload.mockResolvedValue(doc);m.remove.mockResolvedValue(undefined);m.ackUpload.mockResolvedValue(undefined);m.ackDelete.mockResolvedValue(undefined);});
it('deletes against the actual displayed document and acknowledges after a successful refresh',async()=>{
 render(<ProjectDocuments {...props}/>);fireEvent.click(await screen.findByTitle('Delete document'));
 await waitFor(()=>expect(m.ackDelete).toHaveBeenCalledOnce());expect(m.remove).toHaveBeenCalledWith('D',doc.url,doc,expect.objectContaining({isCurrent:expect.any(Function)}));expect(m.load).toHaveBeenCalledTimes(2);expect(m.ackDelete).toHaveBeenCalledWith('P','D','alice',expect.anything());
});
it('keeps a committed upload recoverable when its list refresh fails',async()=>{
 m.load.mockResolvedValueOnce([doc]).mockRejectedValueOnce(Error('offline'));const view=render(<ProjectDocuments {...props}/>);await screen.findByText('quote.pdf');
 const input=view.container.querySelector('input[type=file]')!;fireEvent.change(input,{target:{files:[new File(['x'],'new.pdf',{type:'application/pdf'})]}});
 await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Document saved'})));expect(m.ackUpload).not.toHaveBeenCalled();expect(m.upload).toHaveBeenCalledWith(expect.any(File),'P','vendor-quote','alice',expect.objectContaining({isCurrent:expect.any(Function)}));
});
it('does not acknowledge a committed deletion if its refresh fails',async()=>{
 m.load.mockResolvedValueOnce([doc]).mockRejectedValueOnce(Error('offline'));render(<ProjectDocuments {...props}/>);fireEvent.click(await screen.findByTitle('Delete document'));
 await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Deletion saved'})));expect(m.ackDelete).not.toHaveBeenCalled();
});
it('ignores a stale document list and any late upload result after project replacement',async()=>{
 const old=deferred();m.load.mockReturnValueOnce(old.promise).mockResolvedValue([]);const view=render(<ProjectDocuments {...props}/>);view.rerender(<ProjectDocuments {...props} projectId="Q"/>);await act(async()=>old.resolve([doc]));expect(screen.queryByText('quote.pdf')).toBeNull();
 view.unmount();m.load.mockResolvedValue([doc]);const upload=deferred();m.upload.mockReturnValue(upload.promise);const second=render(<ProjectDocuments {...props}/>);await screen.findByText('quote.pdf');fireEvent.change(second.container.querySelector('input[type=file]')!,{target:{files:[new File(['x'],'new.pdf')]}});second.rerender(<ProjectDocuments {...props} projectId="Q"/>);await act(async()=>upload.resolve(doc));expect(m.ackUpload).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'Success'}));
});
it('does not send duplicate delete requests while the first is running',async()=>{
 const pending=deferred();m.remove.mockReturnValue(pending.promise);render(<ProjectDocuments {...props}/>);const button=await screen.findByTitle('Delete document');fireEvent.click(button);fireEvent.click(button);expect(m.remove).toHaveBeenCalledOnce();await act(async()=>pending.resolve(undefined));
});
