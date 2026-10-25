import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ProjectDocumentRecovery from '../ProjectDocumentRecovery';
const m=vi.hoisted(()=>({uid:'alice',pending:{uploads:['vendor-invoice'] as string[],deletions:[] as string[]},scan:vi.fn(),upload:vi.fn(),cancel:vi.fn(),ackUpload:vi.fn(),deletion:vi.fn(),ackDelete:vi.fn()}));
vi.mock('@/firebase',()=>({auth:{get currentUser(){return{uid:m.uid};}}}));
vi.mock('@/utils/projectDocumentFirestore',()=>({getPendingProjectDocumentOperations:m.scan,recoverProjectDocumentUpload:m.upload,cancelProjectDocumentUpload:m.cancel,acknowledgeProjectDocumentUpload:m.ackUpload,recoverProjectDocumentDeletion:m.deletion,acknowledgeProjectDocumentDeletion:m.ackDelete}));
const doc={id:'D',projectId:'P',name:'invoice.pdf',type:'vendor-invoice',url:'https://example.test',uploadedAt:new Date(),uploadedBy:'alice',pulseNativeDocument:{operation_id:'o',path:'p',generation:'1'}};
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED','false');m.uid='alice';m.pending={uploads:['vendor-invoice'],deletions:[]};m.scan.mockImplementation(()=>m.pending);m.upload.mockResolvedValue(doc);m.cancel.mockResolvedValue({resolution:'cancelled'});m.ackUpload.mockImplementation(async()=>{m.pending.uploads=[];});m.deletion.mockResolvedValue('committed');m.ackDelete.mockImplementation(async()=>{m.pending.deletions=[];});});
it('keeps pending uploads reachable when the feature switch is off and acknowledges only after refresh',async()=>{
 const events:string[]=[],refresh=vi.fn(async()=>{events.push('refresh');});m.ackUpload.mockImplementation(async()=>{events.push('ack');m.pending.uploads=[];});
 render(<ProjectDocumentRecovery projectId="P" onRefresh={refresh}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Check saved Vendor Invoice Upload'}));
 await waitFor(()=>expect(events).toEqual(['refresh','ack']));expect(m.upload).toHaveBeenCalledWith('P','vendor-invoice','alice',undefined,expect.objectContaining({isCurrent:expect.any(Function)}));
});
it('a known saved upload whose refresh fails stays recoverable and never reports a fresh upload failure',async()=>{
 const refresh=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
 render(<ProjectDocumentRecovery projectId="P" onRefresh={refresh}/>);fireEvent.click(await screen.findByRole('button',{name:'Check saved Vendor Invoice Upload'}));
 expect(await screen.findByText(/saved.*refresh/i)).toBeInTheDocument();expect(m.ackUpload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Check saved Vendor Invoice Upload'}));await waitFor(()=>expect(m.ackUpload).toHaveBeenCalledOnce());expect(m.upload).toHaveBeenCalledTimes(2);
});
it('cancel can discover a committed upload and still refresh and acknowledge its existing document',async()=>{
 m.cancel.mockResolvedValue({resolution:'committed',document:doc});const recovered=vi.fn(),refresh=vi.fn();
 render(<ProjectDocumentRecovery projectId="P" onUploadRecovered={recovered} onRefresh={refresh}/>);fireEvent.click(await screen.findByRole('button',{name:'Cancel Vendor Invoice Upload'}));
 await waitFor(()=>expect(m.ackUpload).toHaveBeenCalledOnce());expect(recovered).toHaveBeenCalledWith(doc);expect(refresh).toHaveBeenCalledOnce();expect(m.upload).not.toHaveBeenCalled();
});
it('reselects the original file through the saved request rather than starting another upload',async()=>{
 render(<ProjectDocumentRecovery projectId="P"/>);const file=new File(['original'],'invoice.pdf',{type:'application/pdf'});
 fireEvent.change(await screen.findByLabelText('Select original Vendor Invoice File'),{target:{files:[file]}});
 await waitFor(()=>expect(m.ackUpload).toHaveBeenCalledOnce());expect(m.upload.mock.calls[0].slice(0,4)).toEqual(['P','vendor-invoice','alice',file]);
});
it('explains that recovery checks the saved attempt and cancel is needed to start over',async()=>{
 render(<ProjectDocumentRecovery projectId="P"/>);
 expect(await screen.findByText(/checking a saved request will not upload the file twice/i)).toBeInTheDocument();
 expect(screen.getByText(/cancel this request before selecting a new file/i)).toBeInTheDocument();
});
it('prevents duplicate actions and ignores results from a replaced account or project context',async()=>{
 const pending=deferred(),recovered=vi.fn();m.upload.mockReturnValue(pending.promise);
 const view=render(<ProjectDocumentRecovery projectId="P" onUploadRecovered={recovered}/>);const retry=await screen.findByRole('button',{name:'Check saved Vendor Invoice Upload'});fireEvent.click(retry);fireEvent.click(retry);expect(m.upload).toHaveBeenCalledOnce();
 m.uid='bob';view.rerender(<ProjectDocumentRecovery projectId="Q" onUploadRecovered={recovered}/>);await act(async()=>pending.resolve(doc));expect(recovered).not.toHaveBeenCalled();expect(m.ackUpload).not.toHaveBeenCalled();expect(m.upload.mock.calls[0][4].isCurrent()).toBe(false);
});
it('offers retry and resolution for the saved deletion and acknowledges only its resolved outcome',async()=>{
 m.pending={uploads:[],deletions:['D']};const refresh=vi.fn();render(<ProjectDocumentRecovery projectId="P" documents={[doc] as any} onRefresh={refresh}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Resolve Deletion of invoice.pdf'}));await waitFor(()=>expect(m.ackDelete).toHaveBeenCalledOnce());
 expect(m.deletion).toHaveBeenCalledWith('P','D','alice',true,expect.objectContaining({isCurrent:expect.any(Function)}));expect(refresh).toHaveBeenCalledOnce();
});
it('shows unreadable recovery storage without erasing it or attempting a write',async()=>{
 m.scan.mockImplementation(()=>{throw Error('Recovery storage is unreadable');});render(<ProjectDocumentRecovery projectId="P"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent(/storage.*unreadable/i);expect(m.upload).not.toHaveBeenCalled();expect(m.ackUpload).not.toHaveBeenCalled();
});
