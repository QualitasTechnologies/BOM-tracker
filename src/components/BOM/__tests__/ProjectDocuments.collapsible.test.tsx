import {act,fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ProjectDocuments from '../ProjectDocuments';
const m=vi.hoisted(()=>({mounts:0}));
vi.mock('@/firebase',()=>({auth:{currentUser:{uid:'alice'}}}));
vi.mock('@/utils/projectDocumentFirestore',()=>({getProjectDocuments:async()=>[],uploadProjectDocument:vi.fn(),deleteProjectDocument:vi.fn(),linkDocumentToBOMItems:vi.fn()}));
vi.mock('../ProjectDocumentRecovery',async()=>{const React=await import('react');return{default:()=>{React.useEffect(()=>{m.mounts++;},[]);return <span data-testid="recovery-strip"/>;}};});
it('keeps the recovery strip mounted when the collapsible document view rerenders',async()=>{
 const props={projectId:'P',bomItems:[],sections:[{type:'vendor-quote',label:'Vendor Quotes',description:''}]} as any;
 const view=render(<ProjectDocuments {...props}/>);await act(async()=>{await Promise.resolve();});fireEvent.click(screen.getByText('Show'));await screen.findByTestId('recovery-strip');const original=m.mounts;view.rerender(<ProjectDocuments {...props} bomItems={[]}/>);expect(m.mounts).toBe(original);
});
