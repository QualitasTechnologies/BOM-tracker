const test=require('node:test'),assert=require('node:assert/strict');
const {createBackfillWorker,createSyncWorker}=require('./gmailScheduledWork.cjs');
function fixture(options={}){
 let clock=0,failReply=false;const rows=new Map([
  ['emailBackfillJobs/P',{status:'pending',contacts:['client@example.test'],completedContacts:[],sinceDate:new Date('2025-01-01'),requestedByUid:'user',processedCount:0,matchedCount:0}],
  ['gmailConnections/user',{status:'connected',email:'mailbox@example.test',refreshToken:'synthetic',lastHistoryId:'10'}],
  ['stakeholderIndex/client@example.test',{projectIds:['P']}],['projects/P',{projectId:'P'}]
 ]),calls=[],pages=[];
 const ref=path=>({path,id:path.split('/').at(-1),doc:id=>ref(path+'/'+id),collection:name=>ref(path+'/'+name),get:async()=>snap(path)}),snap=path=>({exists:rows.has(path),data:()=>structuredClone(rows.get(path))});
 const db={collection:ref,runTransaction:async fn=>{const writes=[];const result=await fn({get:async r=>snap(r.path),update:(r,fields)=>writes.push([r.path,fields])});
  for(const[path,fields]of writes){const next={...rows.get(path),...structuredClone(fields)};for(const[k,v]of Object.entries(next))if(v==='DELETE')delete next[k];rows.set(path,next);}
  if(failReply&&writes.some(([,v])=>v.backfillPendingIds?.length===2)){failReply=false;throw Object.assign(Error('lost acknowledgement'),{code:14});}return result;
 }};
 const deps={db,now:()=>clock,getServerTimestamp:()=>new Date(clock),getDeleteField:()=> 'DELETE',logger:{info(){},warn(){}},
  refreshAccessToken:async()=>({accessToken:'synthetic'}),fetchImpl:async()=>({ok:true,json:async()=>({historyId:'30'})}),
  searchGmailMessageIds:async input=>{pages.push(input.pageToken||null);return options.search?options.search(input):{messageIds:['a','b','c'],nextPageToken:null};},
  listNewGmailMessageIds:async input=>{pages.push(input.pageToken||null);return options.history?options.history(input):{messageIds:['a','b','c'],newHistoryId:'20',historyExpired:false,nextPageToken:null};},
  processGmailMessage:async input=>{calls.push(input);await options.process?.({input,rows,advance:ms=>{clock+=ms;}});return true;},
 };
 const backfill=createBackfillWorker(deps),sync=createSyncWorker(deps);
 return{rows,calls,pages,db,options,advance:ms=>{clock+=ms;},loseCheckpointReply:()=>{failReply=true;},
  backfill:()=>backfill({projectId:'P',jobRef:ref('emailBackfillJobs/P'),clientId:'test',clientSecret:'test'}),
  sync:()=>sync({connectionRef:ref('gmailConnections/user'),clientId:'test',clientSecret:'test'})};
}
test('partial backfill pages checkpoint remaining IDs and resume without repeating provider work',async()=>{
 let slow=true;const f=fixture({process:({advance})=>{if(slow){advance(80000);slow=false;}}});
 assert.equal((await f.backfill()).state,'pending');assert.deepEqual(f.rows.get('emailBackfillJobs/P').backfillPendingIds,['b','c']);assert.equal(f.rows.get('emailBackfillJobs/P').processedCount,1);
 assert.equal((await f.backfill()).state,'completed');assert.deepEqual(f.calls.map(c=>c.messageId),['a','b','c']);assert.equal(f.pages.length,1);assert.equal(f.rows.get('emailBackfillJobs/P').matchedCount,3);assert.deepEqual(f.rows.get('projects/P').backfilledContactEmails,['client@example.test']);
});
test('a full page cursor advances only after every pending ID; empty pages still preserve the next cursor',async()=>{
 const f=fixture({search:({pageToken})=>pageToken?{messageIds:['last'],nextPageToken:null}:{messageIds:[],nextPageToken:'page-2'}});
 assert.equal((await f.backfill()).state,'running');assert.equal(f.rows.get('emailBackfillJobs/P').pageToken,'page-2');assert.equal((await f.backfill()).state,'completed');assert.deepEqual(f.pages,[null,'page-2']);
});
test('lost checkpoint acknowledgement and transient provider errors retain recoverable progress',async()=>{
 const f=fixture();f.loseCheckpointReply();assert.equal((await f.backfill()).state,'retry');assert.equal(f.rows.get('emailBackfillJobs/P').processedCount,1);assert.equal((await f.backfill()).state,'completed');assert.deepEqual(f.calls.map(c=>c.messageId),['a','b','c']);
 let fail=true;const g=fixture({process:()=>{if(fail){fail=false;throw Object.assign(Error('unavailable'),{status:503});}}});assert.equal((await g.backfill()).state,'retry');assert.equal(g.rows.get('emailBackfillJobs/P').status,'running');assert.deepEqual(g.rows.get('emailBackfillJobs/P').backfillPendingIds,['a','b','c']);assert.equal((await g.backfill()).state,'completed');
});
test('an operator changing queued contacts cannot receive an old completion or cursor',async()=>{
 let changed=false;const f=fixture({process:({rows})=>{if(!changed){rows.get('emailBackfillJobs/P').contacts.push('new@example.test');rows.get('emailBackfillJobs/P').status='pending';changed=true;}}});
 assert.equal((await f.backfill()).state,'superseded');assert.equal(f.rows.get('emailBackfillJobs/P').status,'pending');assert.equal(f.rows.get('projects/P').backfilledContactEmails,undefined);
});
test('concurrent invocations share one lease and never process the same page in parallel',async()=>{
 let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});const f=fixture({process:async()=>{entered();await gate;}});
 const first=f.backfill();await ready;assert.equal((await f.backfill()).state,'busy');release();assert.equal((await first).state,'completed');assert.equal(f.calls.length,3);
});
test('incremental sync retains original history across partial pages and commits the new cursor only after draining',async()=>{
 let slow=true;const f=fixture({process:({advance})=>{if(slow){advance(80000);slow=false;}},history:({pageToken})=>pageToken?{messageIds:['last'],newHistoryId:'25',nextPageToken:null}:{messageIds:['a','b','c'],newHistoryId:'20',nextPageToken:'page-2'}});
 assert.equal((await f.sync()).state,'pending');assert.equal(f.rows.get('gmailConnections/user').lastHistoryId,'10');assert.equal((await f.sync()).state,'running');assert.equal(f.rows.get('gmailConnections/user').lastHistoryId,'10');assert.equal((await f.sync()).state,'completed');assert.equal(f.rows.get('gmailConnections/user').lastHistoryId,'25');assert.deepEqual(f.calls.map(c=>c.messageId),['a','b','c','last']);
});
test('mailbox reconnect or disconnect supersedes a running incremental checkpoint',async()=>{
 const f=fixture({process:({rows})=>{rows.get('gmailConnections/user').status='disconnected';}});assert.equal((await f.sync()).state,'superseded');assert.equal(f.rows.get('gmailConnections/user').lastHistoryId,'10');
});
test('completion retains contacts already backfilled by another historical job',async()=>{
 const f=fixture();f.rows.get('projects/P').backfilledContactEmails=['older@example.test'];assert.equal((await f.backfill()).state,'completed');
 assert.deepEqual(f.rows.get('projects/P').backfilledContactEmails,['older@example.test','client@example.test']);
});
module.exports={fixture};
