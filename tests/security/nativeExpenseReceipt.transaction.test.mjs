import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199');
const projectId='demo-bom-native-security',require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore');
const {createNativeExpenseReceiptOperations}=require('./nativeExpenseReceiptOperations.cjs');
const {createNativeOverheadOperations}=require('./nativeOverheadOperations.cjs');
const {fixture}=require('./nativeOverheadFixture.cjs');
let env,db,users,auth,receipt,cost,ids,bytes,clock,beforePublish,onProofRead;
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:18080}});db=new Firestore({projectId,host:'127.0.0.1:18080',ssl:false});});
beforeEach(async()=>{
 await env.clearFirestore();const data=fixture();users=data.users;const batch=db.batch();for(const[path,value]of data.docs)batch.set(db.doc(path),value);await batch.commit();
 class UserRecord{constructor(value){Object.assign(this,value);}}
 auth={verifyIdToken:async()=>({uid:'alice',email:users.get('alice').email}),getUser:async uid=>new UserRecord(users.get(uid))};clock=new Date();bytes=Buffer.from('%PDF-1.7 synthetic');beforePublish=null;onProofRead=null;
 let finalBytes,finalMetadata;
 const bucket={name:'visionbomtracker.firebasestorage.app',file:(path,options)=>({getMetadata:async()=>{const final=path.includes('/finalized/');if(final&&!finalBytes)throw Object.assign(Error('absent'),{code:404});return[{size:String((final?finalBytes:bytes).length),contentType:'application/pdf',generation:'7',...(final?finalMetadata:{})}];},createReadStream:()=>{assert.equal(options.generation,'7');return Readable.from([path.includes('/finalized/')?finalBytes:bytes]);},save:async(value,settings)=>{assert.equal(settings.preconditionOpts.ifGenerationMatch,0);if(finalBytes)throw Object.assign(Error('exists'),{code:412});finalBytes=Buffer.from(value);finalMetadata=settings.metadata;await beforePublish?.();}})};
 const handler=createNativeExpenseReceiptOperations({db,auth,bucket,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),now:()=>clock});
 ids={project_id:'P',visit_id:'trip',expense_id:'expense',operation_id:'receipt-1',expected_actor_uid:'alice'};
 receipt=extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data:{...ids,...extra}});
 const observedDb={collection:name=>db.collection(name),runTransaction:(fn,settings)=>db.runTransaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='get')return async ref=>{const snapshot=await target.get(ref);if(ref.path?.startsWith('pulseExpenseReceiptIntents/'))onProofRead?.();return snapshot;};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),settings)};
 const costs=createNativeOverheadOperations({db:observedDb,auth,enabled:true,requireReceiptProof:true,getServerTimestamp:()=>FieldValue.serverTimestamp()});
 cost=extra=>costs({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer demo'},data:{operation:'get',project_id:'P',expected_actor_uid:'alice',...extra}});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
const reserve=()=>receipt({operation:'reserve',content_type:'application/pdf',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const command=(opening,url)=>({operation:'command',expected_version:opening.version,expected_project_version:opening.project_version,operation_id:'attach',command:{kind:'edit_visit',record_id:'trip',input:{startDate:'2026-10-16',endDate:'2026-10-16',attendees:['alice'],expenses:[{id:'expense',category:'Transport',amount:150,receiptUrl:url,receiptName:'receipt.pdf'}]}}});
test('real cancellation during blob metadata publication fences late finalization without losing stored cost data',async()=>{
 assert.equal((await reserve()).ok,true);let entered,release;const waiting=new Promise(resolve=>{entered=resolve;});beforePublish=()=>{entered();return new Promise(resolve=>{release=resolve;});};
 const late=receipt({operation:'finalize'});await waiting;assert.equal((await receipt({operation:'cancel'})).resolution,'cancelled');release();assert.equal((await late).error,'expense_receipt_cancelled');
 const saved=(await db.doc('pulseExpenseReceiptUploads/P/receipts/receipt-1').get()).data();assert.equal(saved.finalized,undefined);assert.equal(saved.cancelled.resolution,'cancelled');
 assert.equal((await db.collection('pulseExpenseReceiptUploads/P/audit').get()).size,2);assert.equal((await db.doc('projects/P/overheads/data').get()).data().travelVisits[0].totalCost,100);
});
test('competing real finalizations have one immutable proof and the real cost transaction accepts it atomically',async()=>{
 const opening=await cost();assert.equal((await reserve()).ok,true);const [a,b]=await Promise.all([receipt({operation:'finalize'}),receipt({operation:'finalize'})]);assert.equal(a.ok,true);assert.deepEqual(a,b);
 assert.equal((await db.collection('pulseExpenseReceiptUploads/P/audit').get()).size,2);assert.equal((await cost(command(opening,a.receipt_url))).ok,true);
 const overhead=(await db.doc('projects/P/overheads/data').get()).data();assert.equal(overhead.travelVisits[0].expenses[0].receiptUrl,a.receipt_url);assert.equal((await db.collection('pulseOverheadOperations/P/audit').get()).size,1);
});
test('real proof reads precede final Auth revalidation and cannot partially save costs after revocation',async()=>{
 const opening=await cost();await reserve();const verified=await receipt({operation:'finalize'});assert.equal(verified.ok,true);
 onProofRead=()=>{users.get('alice').disabled=true;};const result=await cost(command(opening,verified.receipt_url));assert.equal(result.error,'actor_forbidden');
 assert.equal((await db.doc('projects/P/overheads/data').get()).data().travelVisits[0].totalCost,100);assert.equal((await db.collection('pulseOverheadOperations/P/audit').get()).size,0);
});
