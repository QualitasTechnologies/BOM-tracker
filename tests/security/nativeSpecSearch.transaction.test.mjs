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
 const rules=await readFile(new URL('../../firestore.material-fence.rules',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(rules.replace(/\r\n/g,'\n')).digest('hex'),'a02b48d3cd3a8e43880d40011e10e9f3856fc3db65c60bda0fa8c052ce18d909');
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
function handler(fetch){return createNativeSpecSearchOperation({db,resolveActor:request=>resolveSpecSearchActor({request,auth}),enabled:()=>true,getServerTimestamp:()=>FieldValue.serverTimestamp(),fetch,webhookUrl:'https://provider.example.test/search'});}
const invoke=fn=>fn({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{project_id:'P',item_id:'motor',expected_actor_uid:'alice',operation_id:operation}});
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
 for(const [change,state] of [[()=>db.doc('pulseMaterialCutovers/P').delete(),'outcome_unknown'],[()=>db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'}),'outcome_unknown'],[()=>db.doc('projects/P').update({memberIds:[]}),'failed'],[async()=>{actor.disabled=true;},'outcome_unknown']]){
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
