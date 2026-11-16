const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildBackfillJobFields}=require('./contactDiscovery.js');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const clone=v=>v===undefined?undefined:structuredClone(v);
function fixture(options={}){
 let clock=1,changed=false,actor={uid:'alice',email:'alice@qualitastech.com',disabled:false,customClaims:{status:'approved',role:'viewer'}};
 const docs=new Map([['projects/P',{projectId:'P',memberIds:['alice'],externalRecipients:[{email:'old@example.test',name:'Old',notificationsEnabled:true,unknown:'keep'}],backfilledContactEmails:[]}]]),versions=new Map([['projects/P',1]]),writes=[];
 const mutate=()=>{if(!options.concurrent||changed)return;changed=true;const row=docs.get('projects/P');row.externalRecipients[0].notificationsEnabled=false;row.externalRecipients.push({email:'concurrent@example.test',name:'Concurrent',notificationsEnabled:false});versions.set('projects/P',++clock);};
 const snapshot=path=>({exists:docs.has(path),data:()=>clone(docs.get(path))});
 const apply=(kind,path,fields)=>{if(kind==='create')assert.equal(docs.has(path),false);const next=kind==='update'||kind==='setMerge'?{...docs.get(path),...clone(fields)}:clone(fields);for(const key of Object.keys(next))if(next[key]==='DELETE')delete next[key];docs.set(path,next);versions.set(path,++clock);writes.push({kind,path});};
 const ref=path=>({path,id:path.split('/').at(-1),doc:id=>ref(path+'/'+id),collection:name=>ref(path+'/'+name),get:async()=>snapshot(path),set:async(fields,opts)=>{if(path==='projects/P')mutate();apply(opts?.merge?'setMerge':'set',path,fields);}});
 const db={collection:ref,runTransaction:async fn=>{for(let attempt=0;attempt<6;attempt++){
  const staged=[],reads=[];const result=await fn({get:async r=>{assert.equal(staged.length,0);const snap=snapshot(r.path);reads.push([r.path,versions.get(r.path)]);if(r.path==='projects/P'){mutate();options.onProjectRead?.(actor,docs);}return snap;},set:(r,v,o)=>staged.push([o?.merge?'setMerge':'set',r.path,v]),update:(r,v)=>staged.push(['update',r.path,v]),create:(r,v)=>staged.push(['create',r.path,v])});
  if(reads.some(([p,v])=>versions.get(p)!==v))continue;if(options.failCommit)throw Error('commit failed');for(const row of staged)apply(...row);
  if(options.loseReply&&staged.length){options.loseReply=false;throw Error('commit acknowledgement lost');}return result;
 }throw Error('contention');}};
 const source=fs.readFileSync(require.resolve('./index.js'),'utf8'),start=source.indexOf('exports.addProjectBackfillStakeholders = onCall('),end=source.indexOf('/** Advance every pending/running email backfill job',start);
 const firestore=Object.assign(()=>db,{FieldValue:{delete:()=> 'DELETE',serverTimestamp:()=> 'server-time'}}),context={exports:{},onCall:fn=>fn,admin:{firestore,auth:()=>({synthetic:true})},functions:{https:{HttpsError}},BACKFILL_LOOKBACK_MS:365*24*3600*1000,buildBackfillJobFields,resolveSpecSearchActor:async()=>clone(actor),logger:{info(){},error(){}},require:name=>require(name)};
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);
 const call=(contacts=[{email:'new@example.test',name:'New'}],projectId='P')=>context.exports.addProjectBackfillStakeholders({auth:{uid:'alice',token:{status:'approved',role:'viewer'}},data:{projectId,contacts},rawRequest:{get:()=> 'Bearer synthetic'}});
 return{docs,writes,call,setActor:value=>{actor=value;}};
}

test('actual callable appends contacts without reversing a concurrent recipient preference or append',async()=>{
 const f=fixture({concurrent:true});await f.call();const rows=f.docs.get('projects/P').externalRecipients;
 assert.equal(rows.find(r=>r.email==='old@example.test').notificationsEnabled,false);assert.equal(rows.find(r=>r.email==='old@example.test').unknown,'keep');assert.equal(rows.filter(r=>r.email==='concurrent@example.test').length,1);assert.equal(rows.filter(r=>r.email==='new@example.test').length,1);
});

test('duplicate active requests retain the exact running queue, cursor, pending IDs, lease and original mailbox/date',async()=>{
 const f=fixture();f.docs.get('projects/P').externalRecipients.push({email:'new@example.test',name:'New',notificationsEnabled:false});
 const job={status:'running',contacts:['new@example.test'],completedContacts:[],requestedByUid:'original-owner',sinceDate:new Date('2025-01-01'),processedCount:20,matchedCount:4,pageToken:'saved-page',backfillPendingIds:['saved-message'],backfillNextPageToken:'next-page',backfillQueryHash:'same-query',backfillLeaseOwner:'current-owner',backfillLeaseUntil:999999};f.docs.set('emailBackfillJobs/P',clone(job));
 assert.equal((await f.call()).queuedContactCount,1);assert.deepEqual(f.docs.get('emailBackfillJobs/P'),job);assert.equal(f.writes.length,0);
});

test('extending a later batch retains the active 25-contact search cursor and every saved counter',async()=>{
 const f=fixture(),contacts=Array.from({length:25},(_,i)=>`contact${i}@example.test`),job={status:'running',contacts,completedContacts:[],requestedByUid:'original-owner',sinceDate:new Date('2025-01-01'),processedCount:23,matchedCount:7,pageToken:'same-batch',backfillPendingIds:['pending'],backfillQueryHash:'current'};f.docs.set('emailBackfillJobs/P',job);
 await f.call();const next=f.docs.get('emailBackfillJobs/P');assert.equal(next.pageToken,'same-batch');assert.equal(next.processedCount,23);assert.equal(next.requestedByUid,'original-owner');assert.deepEqual(next.sinceDate,job.sinceDate);assert.deepEqual(next.backfillPendingIds,['pending']);assert.equal(next.contacts.length,26);
});

test('a changed active query invalidates its cursor while retaining original scope and pending work for worker query checks',async()=>{
 const f=fixture(),date=new Date('2025-01-01');f.docs.set('emailBackfillJobs/P',{status:'running',contacts:['old@example.test'],completedContacts:[],requestedByUid:'original-owner',sinceDate:date,processedCount:5,matchedCount:2,pageToken:'old-query',backfillPendingIds:['old-pending'],backfillQueryHash:'old-query-hash'});
 await f.call();const row=f.docs.get('emailBackfillJobs/P');assert.equal(row.pageToken,undefined);assert.deepEqual(row.contacts,['old@example.test','new@example.test']);assert.equal(row.requestedByUid,'original-owner');assert.deepEqual(row.sinceDate,date);assert.deepEqual(row.backfillPendingIds,['old-pending']);assert.equal(row.processedCount,5);
});

test('recipient registration and work queue changes commit atomically',async()=>{
 const f=fixture({failCommit:true}),before=clone([...f.docs]);await assert.rejects(f.call());assert.deepEqual([...f.docs],before);
});

test('a lost commit reply can be retried without restarting progress made meanwhile',async()=>{
 const f=fixture({loseReply:true});await assert.rejects(f.call());const job=f.docs.get('emailBackfillJobs/P');Object.assign(job,{status:'running',processedCount:30,pageToken:'after-commit-page',backfillPendingIds:['remaining']});const before=clone(job);
 await f.call();assert.deepEqual(f.docs.get('emailBackfillJobs/P'),before);assert.equal([...f.docs.keys()].filter(k=>k.startsWith('pulseProjectBackfillOperations/')).length,1);
});

test('current account revocation and read-only mode prevent new recipient or queue writes',async()=>{
 const f=fixture({onProjectRead:actor=>{actor.disabled=true;}});const before=clone([...f.docs]);await assert.rejects(f.call(),e=>e.code==='permission-denied');assert.deepEqual([...f.docs],before);
 const g=fixture();g.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});const initial=clone([...g.docs]);await assert.rejects(g.call(),e=>e.code==='failed-precondition');assert.deepEqual([...g.docs],initial);
});
module.exports={fixture};

test('malformed project paths are rejected before database work',async()=>{
 for(const id of ['P/x',String.fromCharCode(80,0,120),'..']){const f=fixture();await assert.rejects(f.call(undefined,id),e=>e.code==='invalid-argument');assert.equal(f.writes.length,0);}
});

test('a legal Firestore identifier containing a backslash retains the existing identifier contract',async()=>{
 const f=fixture(),id=String.fromCharCode(80,92,120),row=f.docs.get('projects/P');f.docs.delete('projects/P');f.docs.set('projects/'+id,{...row,projectId:id});
 assert.equal((await f.call(undefined,id)).queuedContactCount,1);assert.equal(f.docs.has('emailBackfillJobs/'+id),true);
});

test('an existing job with unknown original mailbox or date cannot be silently redirected or narrowed',async()=>{
 for(const patch of [{requestedByUid:''},{requestedByUid:undefined},{sinceDate:null}]){
  const f=fixture();f.docs.set('emailBackfillJobs/P',{status:'running',contacts:['old@example.test'],completedContacts:[],requestedByUid:'original-owner',sinceDate:new Date('2025-01-01'),processedCount:2,matchedCount:1,...patch});
  const before=clone([...f.docs]);await assert.rejects(f.call(),e=>e.code==='failed-precondition');assert.deepEqual([...f.docs],before);
 }
});
test('a valid original epoch date is retained instead of replaced by the default lookback',async()=>{
 const f=fixture();f.docs.set('emailBackfillJobs/P',{status:'running',contacts:['old@example.test'],completedContacts:[],requestedByUid:'original-owner',sinceDate:0,processedCount:2,matchedCount:1});await f.call();assert.equal(f.docs.get('emailBackfillJobs/P').sinceDate,0);
});


test('registration preserves exact-null, listed and admin access while missing membership and nonmembers stay denied',async()=>{
 for(const [membership,role,allowed] of [[null,'viewer',true],[['alice'],'viewer',true],[undefined,'viewer',false],[['other'],'viewer',false],[undefined,'admin',true]]){
  const f=fixture(),project=f.docs.get('projects/P');if(membership===undefined)delete project.memberIds;else project.memberIds=membership;
  f.setActor({uid:'alice',email:'alice@qualitastech.com',disabled:false,customClaims:{status:'approved',role}});const before=clone([...f.docs]);
  if(allowed)assert.equal((await f.call()).queuedContactCount,1);else{await assert.rejects(f.call(),e=>e.code==='permission-denied');assert.deepEqual([...f.docs],before);}
 }
});
