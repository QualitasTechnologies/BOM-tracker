import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore'),{createBackfillWorker}=require('./gmailScheduledWork.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');let env,db,clock,seen,hook,run;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080}});db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});});
after(async()=>{await db?.terminate();await env?.cleanup();});
beforeEach(async()=>{
 await env.clearFirestore();clock=0;seen=[];hook=null;
 const batch=db.batch();for(const[path,value]of Object.entries({
  'emailBackfillJobs/P':{status:'pending',contacts:['client@example.test'],completedContacts:[],requestedByUid:'user',sinceDate:new Date('2025-01-01'),processedCount:0,matchedCount:0},
  'gmailConnections/user':{status:'connected',refreshToken:'synthetic',email:'mailbox@example.test'},
  'stakeholderIndex/client@example.test':{projectIds:['P']},'projects/P':{projectId:'P'}
 }))batch.set(db.doc(path),value);await batch.commit();
 const worker=createBackfillWorker({db,now:()=>clock,getServerTimestamp:()=>FieldValue.serverTimestamp(),getDeleteField:()=>FieldValue.delete(),refreshAccessToken:async()=>({accessToken:'synthetic'}),searchGmailMessageIds:async()=>({messageIds:['a','b','c'],nextPageToken:null}),processGmailMessage:async({messageId})=>{seen.push(messageId);await hook?.();return true;}});
 run=()=>worker({projectId:'P',jobRef:db.doc('emailBackfillJobs/P'),clientId:'synthetic',clientSecret:'synthetic'});
});
test('competing real transactions acquire one owner and checkpoint one copy of each message',async()=>{
 const outcomes=await Promise.all([run(),run()]);assert.equal(outcomes.filter(r=>r.state==='completed').length,1);assert.equal(outcomes.filter(r=>r.state==='busy').length,1);assert.deepEqual(seen,['a','b','c']);
 const job=(await db.doc('emailBackfillJobs/P').get()).data();assert.equal(job.status,'completed');assert.equal(job.processedCount,3);assert.equal(job.backfillLeaseOwner,undefined);assert.equal(job.backfillPendingIds,undefined);
});
test('a real operator input change invalidates the old checkpoint and cannot be marked completed',async()=>{
 hook=async()=>{hook=null;await db.doc('emailBackfillJobs/P').update({contacts:['client@example.test','new@example.test'],status:'pending'});};
 assert.equal((await run()).state,'superseded');assert.equal((await db.doc('emailBackfillJobs/P').get()).data().status,'pending');assert.equal((await db.doc('projects/P').get()).data().backfilledContactEmails,undefined);
});
test('a real partial page keeps its remaining IDs and advances counters once when resumed',async()=>{
 hook=()=>{clock+=80000;hook=null;};assert.equal((await run()).state,'pending');assert.deepEqual((await db.doc('emailBackfillJobs/P').get()).data().backfillPendingIds,['b','c']);
 assert.equal((await run()).state,'completed');assert.deepEqual(seen,['a','b','c']);assert.equal((await db.doc('emailBackfillJobs/P').get()).data().matchedCount,3);
});
