const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeMilestoneFixture.cjs'),{fixture:procurementFixture}=require('./nativeProcurementFixture.cjs');
const {createNativeMaterialOperations}=require('./nativeMaterialOperations.cjs'),{createProjectOperationsHandler}=require('./projectOperations.cjs');
const marker={fence:'legacy_bom_data_writes',version:1};
function harness(options={}){
 const f=fixture(options);let enabled=true;f.docs.set('settings/bom',{categories:[{name:'Electrical',isActive:true}]});f.docs.set('projects/P/bom/data',{categories:[{name:'Electrical',items:[{id:'motor',name:'Original',quantity:1,itemType:'component'}]}]});
 const db=options.failMaterialAudit?{...f.db,runTransaction:callback=>f.db.runTransaction(tx=>callback({...tx,create:(ref,data)=>{if(ref.path.includes('/materialAudit/'))throw Error('synthetic material audit failure');return tx.create(ref,data);}}))}:f.db;
 const native=createNativeMaterialOperations({db,auth:f.auth,mutationsEnabled:()=>enabled,getServerTimestamp:()=>new Date('2026-11-14T00:00:00Z')});
 const call=data=>native({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data});
 const legacy=createProjectOperationsHandler({db:f.db,auth:f.auth,resolveActor:async()=>f.users.get('alice'),mutationsEnabled:()=>enabled,getServerTimestamp:()=>new Date('2026-11-14T00:00:00Z')});
 const http=async(method,body)=>{let result;await legacy({method,query:{project_id:'P'},body},{set(){},status(){return this;},json(v){result=v;return this;}});return result;};
 const read=()=>call({operation:'get',project_id:'P'}),patch=async(id='edit')=>{const opening=await read();return call({operation:'patch',project_id:'P',expected_actor_uid:'alice',item_id:'motor',expected_version:opening.version,operation_id:id,patch:{name:'Native changed'}});};
 return{...f,call,http,read,patch,off:()=>{enabled=false;}};
}
test('existing native edits require canonical ownership; legacy HTTP owns only the absent-marker state',async()=>{
 for(const value of [undefined,{}, {fence:'other',version:1},{fence:marker.fence,version:'1'},{fence:marker.fence,version:2},marker]){
  const f=harness();if(value!==undefined)f.docs.set('pulseMaterialCutovers/P',structuredClone(value));const native=await f.read(),legacy=await f.http('GET');
  assert.equal(native.ok,true);assert.equal(legacy.ok,true);assert.equal(native.permissions.edit,value===marker);assert.equal(legacy.permissions.edit,value===undefined);
  const before=structuredClone([...f.docs]),result=await f.patch();assert.equal(result.ok,value===marker);if(value!==marker)assert.deepEqual([...f.docs],before);
  const opening=await f.http('GET'),old=await f.http('PATCH',{item_id:'motor',expected_version:opening.version,operation_id:'legacy',patch:{name:'Legacy changed'}});assert.equal(old.ok,value===undefined);
 }
});
test('native new project atomically owns materials, continues templates and replays without a marker overwrite',async()=>{
 const f=harness(),payload={operation:'create_project',project_id:'NEW',expected_actor_uid:'alice',operation_id:'create',project:{projectName:'Original screen project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}};
 const created=await f.call(payload);assert.equal(created.ok,true);const owner=f.docs.get('pulseMaterialCutovers/NEW');assert.equal(owner?.fence,marker.fence);assert.equal(owner?.version,1);
 const opening=await f.call({operation:'get',project_id:'NEW'}),command={operation:'command',project_id:'NEW',expected_actor_uid:'alice',expected_version:opening.version,operation_id:'template',command:{kind:'add_items',initialize:true,items:[{category:'Electrical',id:'template-row',name:'Preserved template row',description:'',itemType:'component',quantity:1}]}};
 const saved=await f.call(command);assert.equal(saved.ok,true,JSON.stringify(saved));f.docs.delete('pulseMaterialCutovers/NEW');f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.deepEqual(await f.call(payload),created);f.off();assert.equal((await f.call({...payload,resolve_only:true})).resolution,'committed');assert.equal((await f.call({...command,resolve_only:true})).resolution,'committed');assert.equal(f.docs.has('pulseMaterialCutovers/NEW'),false);
});
test('ownership change before commit stops native edits and cannot block authorized receipt settlement',async()=>{
 const f=harness();f.docs.set('pulseMaterialCutovers/P',structuredClone(marker));const prior=await f.read();f.options.beforeCommit=docs=>docs.delete('pulseMaterialCutovers/P');assert.equal((await f.call({operation:'patch',project_id:'P',expected_actor_uid:'alice',item_id:'motor',expected_version:prior.version,operation_id:'race',patch:{name:'Native changed'}})).ok,false);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].name,'Original');
 const g=harness();g.docs.set('pulseMaterialCutovers/P',structuredClone(marker));const opening=await g.read(),payload={operation:'patch',project_id:'P',expected_actor_uid:'alice',item_id:'motor',expected_version:opening.version,operation_id:'saved',patch:{name:'Native changed'}};
 const saved=await g.call(payload);assert.equal(saved.ok,true);g.docs.delete('pulseMaterialCutovers/P');assert.deepEqual(await g.call(payload),saved);g.off();assert.equal((await g.call({...payload,resolve_only:true})).resolution,'committed');assert.equal((await g.call({...payload,operation_id:'cancel',resolve_only:true})).resolution,'cancelled');
});
test('native creation cannot claim an existing ownership marker and requests cannot select a legacy channel',async()=>{
 const f=harness();f.docs.set('pulseMaterialCutovers/NEW',structuredClone(marker));const before=structuredClone([...f.docs]);
 const result=await f.call({operation:'create_project',project_id:'NEW',expected_actor_uid:'alice',operation_id:'create',project:{projectName:'Original screen project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}});assert.equal(result.ok,false);assert.deepEqual([...f.docs],before);
 assert.equal((await f.call({operation:'patch',project_id:'P',item_id:'motor',expected_version:'10:1',operation_id:'injected',patch:{name:'Injected'},materialChannel:'legacy'})).error,'invalid_material_request');
});
test('a failed creation audit cannot leave either a project or an ownership marker behind',async()=>{
 const f=harness({failMaterialAudit:true}),before=structuredClone([...f.docs]);const result=await f.call({operation:'create_project',project_id:'NEW',expected_actor_uid:'alice',operation_id:'create',project:{projectName:'Original screen project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}});
 assert.equal(result.ok,false);assert.deepEqual([...f.docs],before);assert.equal(f.docs.has('pulseMaterialCutovers/NEW'),false);
});
test('lost project-create acknowledgement resolves the same atomic owner and project receipt',async()=>{
 const f=harness({loseCommitReply:true}),payload={operation:'create_project',project_id:'NEW',expected_actor_uid:'alice',operation_id:'create-lost',project:{projectName:'Original screen project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}};
 assert.equal((await f.call(payload)).ok,false);assert.equal(f.docs.get('pulseMaterialCutovers/NEW').fence,marker.fence);f.off();assert.equal((await f.call({...payload,resolve_only:true})).resolution,'committed');assert.equal(f.docs.get('projects/NEW').projectName,payload.project.projectName);
});
test('ownership revoked during artifact preparation prevents dispatch and reuses the retained artifact on recovery',async()=>{
 let f,preparations=0;f=procurementFixture({prepare:()=>{preparations++;f.docs.delete('pulseMaterialCutovers/P');}});f.docs.set('pulseMaterialCutovers/P',structuredClone(marker));
 const prepared=await f.send();assert.notEqual(prepared.phase,'complete');assert.equal(f.calls.length,0);assert.equal(preparations,1);assert.ok(f.docs.get('pulseProcurementOperations/P/attempts/attempt-1').artifact);
 f.docs.set('pulseMaterialCutovers/P',structuredClone(marker));assert.equal((await f.call({operation:'recover',attempt_id:'attempt-1'})).phase,'complete');assert.equal(f.calls.length,1);assert.equal(preparations,1);
});
test('procurement refuses missing owner before artifact/provider work and preserves an accepted outcome after revocation',async()=>{
 const f=procurementFixture();f.docs.delete('pulseMaterialCutovers/P');assert.equal((await f.call({operation:'open'})).permissions.send,false);assert.equal((await f.send()).ok,false);assert.equal(f.calls.length,0);assert.equal(f.docs.get('projects/P/purchaseOrders/PO').nativeSendAttemptId,undefined);
 let g;g=procurementFixture({provider:()=>g.docs.delete('pulseMaterialCutovers/P')});g.docs.set('pulseMaterialCutovers/P',structuredClone(marker));const result=await g.send();assert.equal(g.calls.length,1);assert.notEqual(result.phase,'complete');assert.notEqual(g.docs.get('projects/P/purchaseOrders/PO').status,'sent');
 const attempt=g.docs.get('pulseProcurementOperations/P/attempts/attempt-1');assert.equal(attempt.provider_id,'provider-id');g.docs.set('pulseMaterialCutovers/P',structuredClone(marker));const recovered=await g.call({operation:'recover',attempt_id:'attempt-1'});assert.equal(recovered.phase,'complete');assert.equal(g.calls.length,1);
});
