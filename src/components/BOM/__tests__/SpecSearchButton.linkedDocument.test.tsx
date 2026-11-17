import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TooltipProvider} from '@/components/ui/tooltip';
const h=vi.hoisted(()=>({uid:'alice',auth:{currentUser:{uid:'alice'} as {uid:string}|null},documents:vi.fn(),toast:vi.fn(),legacy:vi.fn(),native:vi.fn()}));
vi.mock('@/firebase',()=>({auth:h.auth}));
vi.mock('@/utils/projectDocumentFirestore',()=>({getProjectDocumentsByType:h.documents}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.uid?{uid:h.uid}:null})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:h.toast})}));
vi.mock('@/utils/complianceService',()=>({triggerSpecSearch:h.legacy}));
import SpecSearchButton from '../SpecSearchButton';
const document={id:'manual-1',projectId:'P',type:'spec-sheet',url:'https://storage.example.test/manual.pdf'};
const view=(props:Record<string,unknown>={})=><TooltipProvider><SpecSearchButton itemId="motor" itemName="Motor" projectId="P" linkedSpecDocumentId="manual-1" {...props}/></TooltipProvider>;
const click=()=>fireEvent.click(screen.getByRole('button'));
let tab:any,open:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{
 h.uid='alice';h.auth.currentUser={uid:'alice'};h.documents.mockReset().mockResolvedValue([document]);h.toast.mockReset();h.legacy.mockReset();h.native.mockReset();
 tab={opener:{},closed:false,location:{replace:vi.fn()},close:vi.fn(()=>{tab.closed=true;})};open=vi.spyOn(window,'open').mockReturnValue(tab);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('opens the linked-only specification through the current document reader',async()=>{
 render(view());click();expect(h.documents).toHaveBeenCalledWith('P','spec-sheet',{isCurrent:expect.any(Function)});expect(open).toHaveBeenCalledWith('about:blank','_blank');expect(tab.opener).toBeNull();
 await waitFor(()=>expect(tab.location.replace).toHaveBeenCalledWith(document.url));expect(h.legacy).not.toHaveBeenCalled();expect(h.native).not.toHaveBeenCalled();expect(h.toast).not.toHaveBeenCalled();
});
it('prefers the manual sheet over a provider URL and leaves a completed tab open on unmount',async()=>{
 const r=render(view({specificationUrl:'https://provider.example.test/other.pdf'}));click();expect(h.documents).toHaveBeenCalledOnce();
 await waitFor(()=>expect(tab.location.replace).toHaveBeenCalledWith(document.url));r.unmount();expect(tab.close).not.toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);
});
it.each([['missing',[]],['different ID',[{...document,id:'other'}]],['different project',[{...document,projectId:'Q'}]],['different type',[{...document,type:'vendor-quote'}]],['duplicate identity',[document,{...document}]],['empty URL',[{...document,url:''}]],['unsafe URL',[{...document,url:'javascript:alert(1)'}]]])('refuses %s results without provider URL fallback',async(_label,rows)=>{
 h.documents.mockResolvedValue(rows);render(view({specificationUrl:'https://provider.example.test/other.pdf'}));click();expect(h.documents).toHaveBeenCalledOnce();
 await waitFor(()=>expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'})));expect(tab.close).toHaveBeenCalled();expect(tab.location.replace).not.toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);
});
it('closes the empty tab on denied reads without searching or fallback',async()=>{
 h.documents.mockRejectedValue(Error('Permission denied'));render(view({specificationUrl:'https://provider.example.test/other.pdf'}));click();expect(h.documents).toHaveBeenCalledOnce();
 await waitFor(()=>expect(tab.close).toHaveBeenCalled());expect(tab.location.replace).not.toHaveBeenCalled();expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'}));expect(h.legacy).not.toHaveBeenCalled();
});
it.each([{projectId:'Q'},{itemId:'other'},{linkedSpecDocumentId:'manual-2'}])('drops a late response after context change %j',async props=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const r=render(view());click();expect(h.documents).toHaveBeenCalledOnce();const current=h.documents.mock.calls[0][2].isCurrent;
 r.rerender(view(props));expect(current()).toBe(false);expect(tab.close).toHaveBeenCalled();await act(async()=>finish([document]));expect(tab.location.replace).not.toHaveBeenCalled();expect(h.toast).not.toHaveBeenCalled();
});
it('does not revive an old opening after switching projects away and back',async()=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const r=render(view());click();expect(h.documents).toHaveBeenCalledOnce();
 r.rerender(view({projectId:'Q'}));r.rerender(view());await act(async()=>finish([document]));expect(tab.close).toHaveBeenCalled();expect(tab.location.replace).not.toHaveBeenCalled();
});
it.each(['other-account','same-uid-new-session'])('rejects %s without a React auth rerender',async mode=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(view());click();expect(h.documents).toHaveBeenCalledOnce();
 h.auth.currentUser={uid:mode==='other-account'?'bob':'alice'};await act(async()=>finish([document]));expect(tab.close).toHaveBeenCalled();expect(tab.location.replace).not.toHaveBeenCalled();
});
it('closes an owned pending tab on unmount and ignores its late read',async()=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const r=render(view());click();expect(h.documents).toHaveBeenCalledOnce();r.unmount();expect(tab.close).toHaveBeenCalled();await act(async()=>finish([document]));expect(tab.location.replace).not.toHaveBeenCalled();expect(h.toast).not.toHaveBeenCalled();
});
it('does not start two reads or tabs on repeated clicks',async()=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(view());click();click();expect(h.documents).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledTimes(1);await act(async()=>finish([document]));expect(tab.location.replace).toHaveBeenCalledOnce();
});
it('reports a blocked popup before reading documents',()=>{
 open.mockReturnValue(null);render(view());click();expect(open).toHaveBeenCalledOnce();expect(h.documents).not.toHaveBeenCalled();expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'}));
});
it('requires the current signed-in account before opening a manual document',()=>{
 h.auth.currentUser=null;render(view());click();expect(h.documents).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'}));
});

it('does not reopen a pending popup that the user closed',async()=>{
 let finish!:(rows:any[])=>void;h.documents.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(view());click();expect(h.documents).toHaveBeenCalledOnce();tab.closed=true;
 await act(async()=>finish([document]));expect(tab.location.replace).not.toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);expect(h.toast).not.toHaveBeenCalled();
});

it('keeps direct URL opening synchronous when there is no manually linked document',()=>{
 render(view({linkedSpecDocumentId:undefined,specificationUrl:'https://provider.example.test/spec.pdf'}));click();expect(open).toHaveBeenCalledWith('https://provider.example.test/spec.pdf','_blank');expect(h.documents).not.toHaveBeenCalled();expect(h.legacy).not.toHaveBeenCalled();
});
