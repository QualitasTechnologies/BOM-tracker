const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativePOAuthoringFixture.cjs');
const {createExpenseApprovalJob}=require('./expenseApprovalOutbox.cjs');
const {createExpenseApprovalDispatcher}=require('./expenseApprovalAdapter.cjs');
const {LEASE,RETRY_WINDOW}=require('./poApprovalDispatcher.cjs');
const T0=Date.parse('2026-10-15T00:00:00Z');
function setup({mode='submitted',send,...options}={}) {
 const f=fixture(options);let clock=T0,on=true;const sent=[];
 const visit={id:'v',date:'2024-01-02',attendees:['alice'],location:'Delhi',purpose:'Install',expenses:[],totalCost:123,createdBy:'alice',reimbursementStatus:mode==='submitted'?'pending':mode};
 const job=createExpenseApprovalJob({projectId:'P',visitId:'v',operationId:'op',mode,project:f.docs.get('projects/P'),visit,actor:{uid:'admin',displayName:'Admin'},at:new Date(clock),createdMs:clock});
 visit.nativeExpenseNotificationId=job.id;f.docs.set('projects/P/overheads/data',{travelVisits:[visit],otherEntries:[]});f.docs.set(`pulseExpenseApprovalNotifications/${job.id}`,job.record);
 const auth={...f.auth,listUsers:async()=>({users:[...f.users.values()]})};
 const dispatcher=createExpenseApprovalDispatcher({db:f.db,auth,enabled:()=>on,now:()=>clock,getServerTimestamp:()=>new Date(clock),sendEmail:async(mail,settings)=>{sent.push({mail:structuredClone(mail),settings});return send?send(mail,settings):{id:'expense-accepted'};}});
 return {...f,auth,dispatcher,sent,visit,id:job.id,tick:ms=>{clock+=ms;},off:()=>{on=false;},options};
}
test('expense dispatcher is default-off and all three modes use isolated durable collections, tags and keys',async()=>{
 for(const mode of ['submitted','approved','rejected']){
 const f=setup({mode});assert.equal((await createExpenseApprovalDispatcher({db:f.db,auth:f.auth}).prepare(f.id)).state,'disabled');
 const p=await f.dispatcher.prepare(f.id);assert.equal(p.state,'prepared');const id=p.delivery_ids[0];assert.equal((await f.dispatcher.deliver(id)).state,'accepted');
 assert.deepEqual(f.sent[0].mail.to,[mode==='submitted'?'admin@qualitastech.com':'alice@qualitastech.com']);assert.equal(f.sent[0].settings.idempotencyKey,`expense-approval/${id}`);assert.deepEqual(f.sent[0].mail.tags,[{name:'pulse_expense_delivery',value:id}]);assert.match(f.sent[0].mail.html,/tab=costs/);assert.equal(f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`).state,'accepted');assert.ok([...f.docs.keys()].some(path=>path.startsWith('pulseExpenseApprovalNotificationAudit/')));
 assert.equal((await f.dispatcher.deliver(id)).state,'accepted');assert.equal(f.sent.length,1);
 }
});
test('changed visit fields, status, pointer, missing or duplicate visit, and forged payload suppress a stale expense',async()=>{
 const mutations=[f=>{f.visit.totalCost++;},f=>{f.visit.reimbursementStatus='approved';},f=>{f.visit.nativeExpenseNotificationId='0'.repeat(64);},f=>{f.docs.get('projects/P/overheads/data').travelVisits=[];},f=>{f.docs.get('projects/P/overheads/data').travelVisits.push({...f.visit});},f=>{f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`).payload.visitTotal=1;}];
 for(const mutate of mutations){const f=setup();const p=await f.dispatcher.prepare(f.id);mutate(f);const result=await f.dispatcher.deliver(p.delivery_ids[0]);assert.ok(['skipped','needs_reconciliation'].includes(result.state),result.state);assert.equal(f.sent.length,0);}
});
test('invalid expense job resource/schema is blocked before reading resource or creating deliveries',async()=>{
 for(const patch of [{visit_id:'../v'},{kind:'submit'},{payload:{mode:'submitted'}},{event_fingerprint:'bad'}]){const f=setup();Object.assign(f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`),patch);assert.equal((await f.dispatcher.prepare(f.id)).state,'blocked');assert.equal(f.sent.length,0);}
});
test('expense retries preserve immutable provider bytes/key and stop after the ambiguous 23 hour window',async()=>{
 const f=setup({send:()=>{throw Error('private provider detail');}});const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];assert.equal((await f.dispatcher.deliver(id)).state,'uncertain');f.tick(LEASE+1);assert.equal((await f.dispatcher.deliver(id)).state,'uncertain');assert.deepEqual(f.sent[0],f.sent[1]);f.tick(RETRY_WINDOW);assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,2);assert.doesNotMatch(JSON.stringify([...f.docs.values()]),/private provider detail/);
});
test('expense reviews recheck current original-owner access and legacy null membership fallback',async()=>{
 const f=setup({mode:'approved'}),p=await f.dispatcher.prepare(f.id);f.docs.get('projects/P').memberIds=[];assert.equal((await f.dispatcher.deliver(p.delivery_ids[0])).state,'skipped');assert.equal(f.sent.length,0);
 const g=setup({mode:'rejected'});g.docs.get('projects/P').memberIds=null;const q=await g.dispatcher.prepare(g.id);assert.equal((await g.dispatcher.deliver(q.delivery_ids[0])).state,'accepted');
});
test('expense fanout pages over 50 admins and rechecks recipients before first dispatch',async()=>{
 const f=setup();for(let i=0;i<51;i++)f.users.set(`a${i}`,{uid:`a${i}`,email:`a${i}@example.com`,emailVerified:true,customClaims:{role:'admin',status:'approved'}});
 let pages=0;f.auth.listUsers=async(_size,token)=>{pages++;return token?{users:[...f.users.values()].filter(u=>u.uid!=='admin')}:{users:[f.users.get('admin')],pageToken:'next'};};
 const p=await f.dispatcher.prepare(f.id);assert.equal(pages,2);assert.equal(p.delivery_ids.length,2);f.users.get('admin').disabled=true;for(const id of p.delivery_ids)await f.dispatcher.deliver(id);assert.equal(f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`).state,'accepted');assert.equal(f.sent.flatMap(x=>x.mail.to).length,51);
});
test('expense late provider acceptance survives flag-off and a newer lease',async()=>{
 let release;const f=setup({send:()=>new Promise(resolve=>{release=resolve;})}),p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0],first=f.dispatcher.deliver(id);while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.dispatcher.deliver(id)).state,'pending');f.off();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});release({id:'late'});assert.equal((await first).state,'accepted');assert.equal(f.sent.length,1);
});

test('malformed parent kind is permanently blocked and invalid legacy totals never dispatch',async()=>{
 const f=setup();f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`).kind=123;assert.equal((await f.dispatcher.prepare(f.id)).state,'blocked');
 const g=setup();g.docs.get(`pulseExpenseApprovalNotifications/${g.id}`).payload.visitTotal=null;assert.equal((await g.dispatcher.prepare(g.id)).state,'blocked');assert.equal(g.sent.length,0);
});

test('parent schema and operation identity tampering after preparation suppress frozen delivery',async()=>{
 for(const patch of [{schema:2},{created_ms:'invalid'},{operation_id:'another-operation'},{payload:{}}]){const f=setup(),p=await f.dispatcher.prepare(f.id);Object.assign(f.docs.get(`pulseExpenseApprovalNotifications/${f.id}`),patch);const result=await f.dispatcher.deliver(p.delivery_ids[0]);assert.ok(['skipped','needs_reconciliation'].includes(result.state),result.state);assert.equal(f.sent.length,0);}
});

test('editing an approved visit resubmits a multi-expense event that survives Firestore map-key ordering',async()=>{
 const {applyOverheadCommand}=require('./overheadCommands.cjs'),f=setup({mode:'approved'}),actor={uid:'admin',email:'admin@qualitastech.com',displayName:'Admin'};
 const plan=applyOverheadCommand({project:f.docs.get('projects/P'),overheads:f.docs.get('projects/P/overheads/data'),actor,now:new Date(T0),command:{kind:'edit_visit',record_id:'v',input:{startDate:'2026-10-15',endDate:'2026-10-16',attendees:['alice'],location:'Delhi',purpose:'Updated visit',expenses:[{id:'transport',category:'Transport',description:'Train',amount:50},{id:'food',category:'Food & Per Diem',description:'Meals',amount:73}]}}});
 const job=createExpenseApprovalJob({projectId:'P',visitId:'v',operationId:'approved-edit',mode:plan.notification.mode,project:f.docs.get('projects/P'),visit:plan.notification.visit,actor,at:new Date(T0),createdMs:T0});
 const stored=plan.overheads.travelVisits[0];stored.nativeExpenseNotificationId=job.id;stored.expenses=stored.expenses.map(row=>Object.fromEntries(Object.entries(row).reverse()));
 f.docs.set('projects/P/overheads/data',plan.overheads);f.docs.set(`pulseExpenseApprovalNotifications/${job.id}`,job.record);
 const parent=await f.dispatcher.prepare(job.id);assert.equal(parent.state,'prepared');assert.equal((await f.dispatcher.deliver(parent.delivery_ids[0])).state,'accepted');assert.equal(f.sent.length,1);
});
