import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/firebase',()=>({auth:{currentUser:{uid:'alice'}},functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:vi.fn()}));
import {createServerPOCreator} from '../serverPOCreation';
const input:any={projectId:'P',createdBy:'alice',billingEntityId:'B',items:[{bomItemId:'bolt',slNo:1,quantity:2,rate:10}],paymentTerms:'Payment'};
const billing:any={companyName:'Company',companyAddress:'Address',gstin:'GST',stateCode:'29',stateName:'Karnataka'};
function setup(){
  let uid='alice',n=0;
  const storage=new Map<string,string>();
  const store={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>{storage.delete(key);}};
  const call=vi.fn(async(request:any)=>({data:request.operation==='open'?{ok:true,project_id:'P',material_version:'10:1',permissions:{create:true}}:{ok:true,project_id:'P',po_id:request.po_id,operation_id:request.operation_id,kind:'create'}}));
  const deps={uid:()=>uid,storage:()=>store,uuid:()=>String(++n),call};
  return{create:createServerPOCreator(deps),deps,call,storage,setUid:(value:string)=>{uid=value;}};
}
it('uses server creation without direct Firestore or master-data writes and strips caller serial numbers',async()=>{
  const f=setup();expect(await f.create(input,billing)).toBe('1');
  expect(f.call.mock.calls[1][0].input.items[0].slNo).toBeUndefined();
  expect(f.call.mock.calls[1][0].expected_actor_uid).toBe('alice');
  expect(f.storage.size).toBe(0);
});
it('lost replies and page reload reuse the identical durable request',async()=>{
  const f=setup();f.call.mockImplementationOnce(async()=>({data:{ok:true,project_id:'P',material_version:'10:1',permissions:{create:true}}})).mockRejectedValueOnce(new Error('lost reply'));
  await expect(f.create(input,billing)).rejects.toThrow(/unconfirmed/i);
  const original=f.call.mock.calls[1][0];
  expect(await createServerPOCreator(f.deps)(input,billing)).toBe('1');
  expect(f.call.mock.calls[2][0]).toEqual(original);
  expect(f.storage.size).toBe(0);
});
it('changed form values resolve the original saved request rather than silently creating a duplicate',async()=>{
  const f=setup();f.call.mockImplementationOnce(async()=>({data:{ok:true,project_id:'P',material_version:'10:1',permissions:{create:true}}})).mockRejectedValueOnce(new Error('lost'));
  await expect(f.create(input,billing)).rejects.toThrow();
  f.call.mockImplementationOnce(async(request:any)=>({data:{ok:true,project_id:'P',po_id:request.po_id,operation_id:request.operation_id,resolution:'committed'}}));
  await expect(f.create({...input,paymentTerms:'Changed'},billing)).rejects.toThrow(/earlier PO was saved/i);
  expect(f.call).toHaveBeenCalledTimes(3);
  expect(f.call.mock.calls[2][0].resolve_only).toBe(true);
});
it('does not write if durable request storage is unavailable',async()=>{
  const f=setup();f.deps.storage=()=>({getItem:()=>null,setItem:()=>{throw Error('storage blocked');},removeItem:()=>{}});
  await expect(createServerPOCreator(f.deps)(input,billing)).rejects.toThrow();
  expect(f.call).toHaveBeenCalledTimes(1);
});
it('rejects an account switch before or during an opening',async()=>{
  const f=setup();f.setUid('bob');await expect(f.create(input,billing)).rejects.toThrow(/account changed/i);
  expect(f.call).not.toHaveBeenCalled();
});
it('retains a malformed success reply for safe retry',async()=>{
  const f=setup();f.call.mockImplementationOnce(async()=>({data:{ok:true,project_id:'P',material_version:'10:1',permissions:{create:true}}})).mockResolvedValueOnce({data:{ok:true,project_id:'Q'}} as any);
  await expect(f.create(input,billing)).rejects.toThrow(/unconfirmed/i);expect(f.storage.size).toBe(1);
});
it('keeps a committed-but-unacknowledged request when later access denial prevents resolution',async()=>{
  const f=setup();f.call.mockImplementationOnce(async()=>({data:{ok:true,project_id:'P',material_version:'10:1',permissions:{create:true}}})).mockRejectedValueOnce(new Error('lost reply'));
  await expect(f.create(input,billing)).rejects.toThrow();
  const original=f.call.mock.calls[1][0];
  f.call.mockResolvedValueOnce({data:{ok:false,error:'actor_forbidden'}} as any).mockResolvedValueOnce({data:{ok:false,error:'actor_forbidden'}} as any);
  await expect(f.create(input,billing)).rejects.toThrow(/approved/i);
  expect(f.storage.size).toBe(1);
  expect(await f.create(input,billing)).toBe('1');
  expect(f.call.mock.calls.at(-1)?.[0]).toEqual(original);
});

