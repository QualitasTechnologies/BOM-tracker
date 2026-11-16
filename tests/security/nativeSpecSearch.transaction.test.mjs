import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore');
const {createNativeSpecSearchOperation}=require('./nativeSpecSearchOperations.cjs');
const {resolveSpecSearchActor}=require('./specSearchActor.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
const operation='550e8400-e29b-41d4-a716-446655440000',receiptKey=createHash('sha256').update(operation).digest('hex'),url='https://docs.example.test/spec.pdf';
let env,db,actor,auth;
before(async()=>{
 // Pin the policy actually published for this recovery stage, not the broader candidate.
 const rules=await readFile(new URL('../../firestore.project-fence.rules',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(rules.replace(/\r\n/g,'\n')).digest('hex'),'94f34bb7aab2cc48ffadc81f96bc833bf0fe93338991e412cc72fd1ff6dc1f36');
 env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules}});
 db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
async function seed(project={memberIds:['alice']}){
 await env.clearFirestore();actor={uid:'alice',email:'alice@qualitastech.com',emailVerified:false,disabled:false,customClaims:{status:'approved',role:'viewer'}};
 auth={verifyIdToken:async()=>({uid:'alice',email:'alice@qualitastech.com'}),getUser:async()=>structuredClone(actor)};
 const batch=db.batch();batch.set(db.doc('projects/P'),{projectId:'P',projectName:'Synthetic',...project});
 batch.set(db.doc('projects/P/bom/data'),{categories:[{name:'Parts',items:[{id:'motor',name:'Motor',make:'Original',quantity:1,specificationUrl:null}]}],unrelated:'keep'});
 batch.set(db.doc('pulseMaterialCutovers/P'),{fence:'legacy_bom_data_writes',version:1});await batch.commit();
}
beforeEach(()=>seed());
const client=(role='viewer')=>env.authenticatedContext('alice',{status:'approved',role,email:'alice@qualitastech.com'}).firestore();
function handler(fetch,database=db){return createNativeSpecSearchOperation({db:database,resolveActor:request=>resolveSpecSearchActor({request,auth}),enabled:()=>true,getServerTimestamp:()=>FieldValue.serverTimestamp(),fetch,webhookUrl:'https://provider.example.test/search'});}
const invoke=(fn,data={})=>fn({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{project_id:'P',item_id:'motor',expected_actor_uid:'alice',operation_id:operation,...data}});
const response=()=>({ok:true,json:async()=>({success:true,specificationUrl:url})});

test('real native merge preserves concurrent edits and published Rules reject stale browser overwrite and private journals',async()=>{
 const stale=(await getDoc(doc(client(),'projects/P/bom/data'))).data();let calls=0;
 const fn=handler(async()=>{calls++;const ref=db.doc('projects/P/bom/data'),latest=(await ref.get()).data();latest.categories[0].items[0].quantity=9;latest.categories[0].items.push({id:'other',name:'Other item'});await ref.update({categories:latest.categories,unrelated:'concurrent'});return response();});
 assert.equal((await invoke(fn)).state,'completed');assert.equal(calls,1);await assertFails(setDoc(doc(client(),'projects/P/bom/data'),stale));
 const saved=(await db.doc('projects/P/bom/data').get()).data();assert.equal(saved.categories[0].items[0].specificationUrl,url);assert.equal(saved.categories[0].items[0].quantity,9);assert.equal(saved.categories[0].items.length,2);assert.equal(saved.unrelated,'concurrent');
 const receipt=(await db.doc('pulseSpecSearchReceipts/'+receiptKey).get()).data();assert.equal(receipt.provider_specification_url,url);assert.equal(receipt.state,'completed');
 for(const role of ['viewer','admin'])for(const collection of ['pulseSpecSearchReceipts','pulseSpecSearchAudit','pulseSpecSearchLocks']){const ref=doc(client(role),collection+'/'+receiptKey);await assertFails(getDoc(ref));await assertFails(setDoc(ref,{synthetic:true}));}
 assert.equal((await invoke(fn)).state,'completed');assert.equal(calls,1);
});

test('real concurrent same-operation calls dispatch once and settle one audited result',async()=>{
 let calls=0;const fn=handler(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,40));return response();});const results=await Promise.all([invoke(fn),invoke(fn)]);
 assert.equal(calls,1);assert.ok(results.some(r=>r.state==='completed'));assert.ok(results.every(r=>['completed','outcome_unknown'].includes(r.state)));
 assert.equal((await db.doc('pulseSpecSearchReceipts/'+receiptKey).get()).data().state,'completed');assert.equal((await db.doc('pulseSpecSearchAudit/'+receiptKey).get()).exists,true);
});

test('owner, runtime pause, membership and live account revocation block real writes while accepted results remain durable',async()=>{
 for(const [change,state] of [[()=>db.doc('pulseMaterialCutovers/P').delete(),'outcome_unknown'],[()=>db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'}),'outcome_unknown'],[()=>db.doc('projects/P').update({memberIds:[]}),'outcome_unknown'],[async()=>{actor.disabled=true;},'outcome_unknown']]){
  await seed();let calls=0;const fn=handler(async()=>{calls++;await change();return response();});assert.equal((await invoke(fn)).state,state);
  assert.equal((await db.doc('projects/P/bom/data').get()).data().categories[0].items[0].specificationUrl,null);
  const receipt=(await db.doc('pulseSpecSearchReceipts/'+receiptKey).get()).data();assert.equal(receipt.provider_specification_url,url);assert.equal(receipt.provider_outcome,'completed');await invoke(fn);assert.equal(calls,1);
 }
});

test('native access matches published project reads for absent, explicit-null and listed membership; admin bypass survives',async()=>{
 for(const [project,allowed] of [[{},false],[{memberIds:null},true],[{memberIds:['alice']},true],[{memberIds:[]},false],[{memberIds:['other']},false]]){
  await seed(project);await (allowed?assertSucceeds:assertFails)(getDoc(doc(client(),'projects/P/bom/data')));let calls=0;const fn=handler(async()=>{calls++;return response();});const result=await invoke(fn);assert.equal(result.state==='completed',allowed);assert.equal(calls,allowed?1:0);
  await seed(project);actor.customClaims.role='admin';await assertSucceeds(getDoc(doc(client('admin'),'projects/P/bom/data')));assert.equal((await invoke(handler(async()=>response()))).state,'completed');
 }
});


test('real concurrent recovery preserves the original audit and latest item fields with one private reconciliation',async()=>{
 let calls=0;const fn=handler(async()=>{calls++;await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});return response();});assert.equal((await invoke(fn)).state,'outcome_unknown');
 const original=(await db.doc('pulseSpecSearchAudit/'+receiptKey).get()).data(),bomRef=db.doc('projects/P/bom/data'),latest=(await bomRef.get()).data();latest.categories[0].items[0].quantity=12;latest.categories[0].items[0].notes={preserved:true};await bomRef.update({categories:latest.categories,unrelated:'later edit'});await db.doc('pulseRuntimeControl/cutover').set({mode:'pulse_only'});
 const results=await Promise.all([invoke(fn),invoke(fn),invoke(fn)]);assert.ok(results.every(result=>result.state==='completed'),JSON.stringify(results));assert.equal(calls,1);
 const current=(await bomRef.get()).data();assert.equal(current.categories[0].items[0].quantity,12);assert.deepEqual(current.categories[0].items[0].notes,{preserved:true});assert.equal(current.unrelated,'later edit');assert.equal(current.categories[0].items[0].specificationUrl,url);
 assert.deepEqual((await db.doc('pulseSpecSearchAudit/'+receiptKey).get()).data(),original);const reconciliations=await db.collection('pulseSpecSearchAudit/'+receiptKey+'/reconciliations').get();assert.equal(reconciliations.size,1);assert.equal(reconciliations.docs[0].data().outcome,'completed');assert.equal((await db.collection('pulseSpecSearchLocks').get()).size,0);
 for(const role of ['viewer','admin']){const ref=doc(client(role),'pulseSpecSearchAudit/'+receiptKey+'/reconciliations/accepted_result');await assertFails(getDoc(ref));await assertFails(setDoc(ref,{outcome:'forged'}));}
});

test('real restored membership and a new browser adopt the original operation before settlement without another dispatch',async()=>{
 let calls=0;const fn=handler(async()=>{calls++;await db.doc('projects/P').update({memberIds:[]});return response();});assert.equal((await invoke(fn)).state,'outcome_unknown');assert.equal((await db.collection('pulseSpecSearchLocks').get()).size,1);await db.doc('projects/P').update({memberIds:['alice']});
 const adopted=await invoke(fn,{operation_id:'78d77e2d-24f8-4d16-918a-397eb24e5a85'});assert.equal(adopted.state,'outcome_unknown');assert.equal(adopted.reused_operation,true);assert.equal(adopted.operation_id,operation);assert.equal(calls,1);assert.equal((await db.doc('projects/P/bom/data').get()).data().categories[0].items[0].specificationUrl,null);
 assert.equal((await invoke(fn)).state,'completed');assert.equal(calls,1);assert.equal((await db.collection('pulseSpecSearchReceipts').get()).size,1);
});

test('real recovery rereads the current runtime after opening and cannot commit a paused accepted result',async()=>{
 let calls=0;const fn=handler(async()=>{calls++;await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});return response();});await invoke(fn);await db.doc('pulseRuntimeControl/cutover').set({mode:'coexist'});let armed=true;
 const racing={collection:db.collection.bind(db),runTransaction:callback=>db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){if(key==='get')return async ref=>{if(armed&&ref.path==='pulseRuntimeControl/cutover'){armed=false;await db.doc(ref.path).set({mode:'read_only'});}return target.get(ref);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}})))};
 const guarded=handler(async()=>{throw Error('provider must not be called during recovery');},racing);assert.equal((await invoke(guarded)).state,'outcome_unknown');assert.equal(armed,false);assert.equal(calls,1);assert.equal((await db.doc('projects/P/bom/data').get()).data().categories[0].items[0].specificationUrl,null);assert.equal((await db.collection('pulseSpecSearchAudit/'+receiptKey+'/reconciliations').get()).size,0);
 await db.doc('pulseRuntimeControl/cutover').set({mode:'coexist'});assert.equal((await invoke(fn)).state,'completed');assert.equal(calls,1);
});
