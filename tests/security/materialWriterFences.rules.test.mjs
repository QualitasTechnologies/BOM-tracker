import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore'),{fixture}=require('./nativeMilestoneFixture.cjs');
const {createNativeMaterialOperations}=require('./nativeMaterialOperations.cjs'),{createProjectOperationsHandler}=require('./projectOperations.cjs');
const {createLegacySpecSearch}=require('./legacySpecSearch.cjs'),{createMcpMaterialWriter}=require('../mcp-server/src/mcpMaterialWriter.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
const marker={fence:'legacy_bom_data_writes',version:1};let env,db,f,call,http;
before(async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),rules=await readFile(resolve(root,process.env.FIRESTORE_RULES_PATH||'firestore.rules'),'utf8');
 env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules}});
 db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
async function seed(owner=marker){
 await env.clearFirestore();f=fixture();f.docs.delete('pulseRuntimeControl/cutover');
 f.docs.set('settings/bom',{categories:[{name:'Electrical',isActive:true}]});
 f.docs.set('projects/P/bom/data',{categories:[{name:'Electrical',items:[{id:'motor',name:'Original',quantity:1,itemType:'component'}]}]});
 const batch=db.batch();for(const[path,value]of f.docs)batch.set(db.doc(path),value);if(owner!==undefined)batch.set(db.doc('pulseMaterialCutovers/P'),owner);await batch.commit();
 const options={db,auth:f.auth,mutationsEnabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp()},native=createNativeMaterialOperations(options),legacy=createProjectOperationsHandler({...options,resolveActor:async()=>f.users.get('alice')});
 call=extra=>{const data={operation:'get',project_id:'P',...extra};if(data.operation!=='get')data.expected_actor_uid='alice';return native({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data});};
 http=async(method,body)=>{let result;await legacy({method,query:{project_id:'P'},body},{set(){},status(){return this;},json(v){result=v;return this;}});return result;};
}
beforeEach(()=>seed());
const client=(uid='alice')=>env.authenticatedContext(uid,{...f.users.get(uid).customClaims,email:f.users.get(uid).email,email_verified:true}).firestore();
const patch=async(id='native')=>{const opening=await call();return call({operation:'patch',item_id:'motor',expected_version:opening.version,operation_id:id,patch:{name:'Native changed'}});};
test('only canonical project marker fences SDK BOM writes; unrelated paths, permissions and reads stay unchanged',async()=>{
 for(const owner of [undefined,{}, {fence:marker.fence,version:'1'},marker]){
  await seed(owner);if(owner===undefined)await db.doc('pulseMaterialCutovers/P').delete();const sdk=client(),check=owner===marker?assertFails:assertSucceeds;
  await assertSucceeds(getDoc(doc(sdk,'projects/P/bom/data')));await check(updateDoc(doc(sdk,'projects/P/bom/data'),{note:'Cached SDK'}));await check(deleteDoc(doc(sdk,'projects/P/bom/data')));await check(setDoc(doc(sdk,'projects/P/bom/data'),{categories:[]}));
  await assertSucceeds(setDoc(doc(sdk,'projects/P/bom/metadata'),{kept:true}));await assertSucceeds(setDoc(doc(sdk,'projects/P/bom/data/history/row'),{kept:true}));
  await assertSucceeds(setDoc(doc(sdk,'projects/P/overheads/data'),{kept:true}));await assertFails(getDoc(doc(client('outsider'),'projects/P/bom/data')));
  await assertFails(setDoc(doc(client('admin'),'pulseMaterialCutovers/P'),marker));
  if(owner===marker)await assertFails(updateDoc(doc(client('admin'),'projects/P/bom/data'),{note:'Admin cache'}));
 }
});
test('real native transaction plus receipt survives rejected stale SDK and privileged legacy HTTP overwrites',async()=>{
 const ref=doc(client(),'projects/P/bom/data'),stale=(await getDoc(ref)).data(),legacyOpen=await http('GET');
 assert.equal((await patch()).ok,true);await assertFails(setDoc(ref,stale));
 assert.equal((await http('PATCH',{item_id:'motor',expected_version:legacyOpen.version,operation_id:'legacy',patch:{name:'Legacy changed'}})).ok,false);
 assert.equal((await db.doc('projects/P/bom/data').get()).data().categories[0].items[0].name,'Native changed');
 assert.equal((await db.doc('pulseProjectMaterialOperations/P/materialOperations/native').get()).exists,true);
});
test('new native project owns its BOM and completes original template continuation atomically',async()=>{
 const created=await call({operation:'create_project',project_id:'NEW',operation_id:'create',project:{projectName:'Original project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}});assert.equal(created.ok,true,JSON.stringify(created));
 assert.equal((await db.doc('pulseMaterialCutovers/NEW').get()).data().fence,marker.fence);
 const opening=await call({project_id:'NEW'}),command={operation:'command',project_id:'NEW',expected_version:opening.version,operation_id:'template',command:{kind:'add_items',initialize:true,items:[{category:'Electrical',id:'template',name:'Template item',description:'',itemType:'component',quantity:1}]}};
 assert.equal((await call(command)).ok,true);await assertFails(setDoc(doc(client(),'projects/NEW/bom/data'),{categories:[]}));
 assert.equal((await db.doc('projects/NEW/bom/data').get()).data().categories[0].items[0].name,'Template item');
});
test('ownership revoked after opening rejects edits while committed receipts remain recoverable',async()=>{
 const opening=await call(),payload={operation:'patch',item_id:'motor',expected_version:opening.version,operation_id:'revoked',patch:{name:'Native changed'}};
 await db.doc('pulseMaterialCutovers/P').delete();assert.equal((await call(payload)).ok,false);await db.doc('pulseMaterialCutovers/P').set(marker);
 const saved=await call(payload);assert.equal(saved.ok,true);await db.doc('pulseMaterialCutovers/P').delete();await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});
 assert.deepEqual(await call(payload),saved);assert.equal((await call({...payload,resolve_only:true})).resolution,'committed');
});
test('versioned MCP peer and native edits serialize without lost updates and both retain receipts',async()=>{
 const mcp=createMcpMaterialWriter({db,resolvePrincipal:async()=>({id:'synthetic-service'}),getServerTimestamp:()=>FieldValue.serverTimestamp()});
 const opening=await call(),input={project_id:'P',category:'Electrical',name:'MCP part',description:'Original MCP workflow',quantity:1,expected_version:opening.version,operation_id:'peer'};
 const nativePayload={operation:'patch',item_id:'motor',expected_version:opening.version,operation_id:'native-peer',patch:{name:'Native changed'}};
 const results=await Promise.allSettled([mcp.addItem(input),call(nativePayload)]);
 const mcpWon=results[0].status==='fulfilled';assert.equal(results[1].status,'fulfilled');assert.equal(results[1].value.ok,!mcpWon);
 if(mcpWon){assert.equal((await patch('native-retry')).ok,true);assert.equal((await mcp.addItem(input)).replayed,true);}
 else {assert.equal(results[0].reason.code,'stale_bom_version');assert.equal((await mcp.addItem({...input,expected_version:(await call()).version})).replayed,false);}
 const items=(await db.doc('projects/P/bom/data').get()).data().categories[0].items;assert.equal(items.length,2);assert.equal(items.find(i=>i.id==='motor').name,'Native changed');assert.equal(items.filter(i=>i.name==='MCP part').length,1);
 assert.equal((await db.doc('pulseMcpOperations/P/receipts/peer').get()).exists,true);
});
test('legacy specification callback cannot cross a live owner transfer or replace unrelated real concurrent data',async()=>{
 await db.doc('pulseMaterialCutovers/P').delete();let result;
 const legacy=createLegacySpecSearch({db,getServerTimestamp:()=>FieldValue.serverTimestamp(),fetch:async()=>{
  await db.doc('pulseMaterialCutovers/P').set(marker);assert.equal((await patch()).ok,true);
  return {ok:true,json:async()=>({success:true,specificationUrl:'https://example.test/spec.pdf'})};
 }});
 await legacy({method:'POST',body:{projectId:'P',bomItemId:'motor',itemName:'Original'}},{set(){},status(code){result=code;return this;},json(){}});
 assert.equal(result,503);const item=(await db.doc('projects/P/bom/data').get()).data().categories[0].items[0];assert.equal(item.name,'Native changed');assert.equal(item.specificationUrl,undefined);
});
