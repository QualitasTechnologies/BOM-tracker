const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativePOAuthoringFixture.cjs');
const {createPOApprovalDispatcher,RETRY_WINDOW,LEASE}=require('./poApprovalDispatcher.cjs');
const T0=Date.parse('2026-10-14T00:00:00Z');
async function setup(options={}) {
  const settings=options.fixture||{},f=fixture(settings);const result=await f.command();assert.equal(result.ok,true);
  let clock=T0,on=true;const sent=[];
  const auth={...f.auth,listUsers:async()=>({users:[...f.users.values()]})};
  const dispatcher=createPOApprovalDispatcher({db:f.db,auth,enabled:()=>on,now:()=>clock,getServerTimestamp:()=>new Date(clock),
    sendEmail:async(mail,settings)=>{sent.push({mail:structuredClone(mail),settings});return options.send?options.send(mail,settings):{id:'provider-1'};}});
  return {...f,settings,auth,dispatcher,sent,id:result.notification_id,tick:ms=>{clock+=ms;},off:()=>{on=false;}};
}
test('preparation is default-off, leases once and freezes an original Pulse email for current admins',async()=>{
  const f=await setup();const disabled=createPOApprovalDispatcher({db:f.db,auth:f.auth,sendEmail:()=>assert.fail('disabled')});
  assert.equal((await disabled.prepare(f.id)).state,'disabled');
  const prepared=await f.dispatcher.prepare(f.id);assert.equal(prepared.state,'prepared');assert.equal(prepared.delivery_ids.length,1);
  assert.deepEqual((await f.dispatcher.prepare(f.id)).delivery_ids,prepared.delivery_ids);
  const delivery=f.docs.get(`pulsePOApprovalNotificationDeliveries/${prepared.delivery_ids[0]}`);
  assert.deepEqual(delivery.mail.tags,[{name:'pulse_po_delivery',value:prepared.delivery_ids[0]}]);
  assert.deepEqual(delivery.mail.to,['admin@qualitastech.com']);assert.match(delivery.mail.html,/eagle-eye\.qualitastech\.com\/pulse\/bom\/project\/P\/bom/);
  assert.equal(f.sent.length,0);assert.equal((await f.dispatcher.deliver(prepared.delivery_ids[0])).state,'accepted');
  assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'accepted');assert.equal(f.sent.length,1);
  assert.equal((await f.dispatcher.deliver(prepared.delivery_ids[0])).state,'accepted');assert.equal(f.sent.length,1);
});
test('all admin pages are inspected and groups above the provider limit have independent deliveries',async()=>{
  const f=await setup();let pages=0;const admins=[];
  for(let i=0;i<51;i++){const uid=`a${i}`,user={uid,email:`a${i}@qualitastech.com`,emailVerified:true,customClaims:{role:'admin',status:'approved'}};f.users.set(uid,user);admins.push(user);}
  f.auth.listUsers=async(_max,token)=>{pages++;return token?{users:admins}:{users:[f.users.get('alice')],pageToken:'next'};};
  const parent=await f.dispatcher.prepare(f.id);assert.equal(pages,2);assert.equal(parent.delivery_ids.length,2);
  const sizes=parent.delivery_ids.map(id=>f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).mail.to.length);assert.deepEqual(sizes,[50,1]);
  await f.dispatcher.deliver(parent.delivery_ids[0]);assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'prepared');
  await f.dispatcher.deliver(parent.delivery_ids[1]);assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'accepted');
  assert.notEqual(f.sent[0].settings.idempotencyKey,f.sent[1].settings.idempotencyKey);
});
test('a competing delivery lease cannot send twice and a lost provider reply retries identical bytes/key',async()=>{
  let release;const f=await setup({send:()=>new Promise(resolve=>{release=resolve;})});const parent=await f.dispatcher.prepare(f.id),id=parent.delivery_ids[0];
  const running=f.dispatcher.deliver(id);while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.dispatcher.deliver(id)).state,'pending');assert.equal(f.sent.length,1);release({id:'provider-1'});await running;
  let count=0;const g=await setup({send:()=>{if(++count===1)throw Error('lost provider reply');return{id:'provider-2'};}});
  const p=await g.dispatcher.prepare(g.id),d=p.delivery_ids[0];assert.equal((await g.dispatcher.deliver(d)).state,'uncertain');g.tick(LEASE+1);
  assert.equal((await g.dispatcher.deliver(d)).state,'accepted');assert.deepEqual(g.sent[0],g.sent[1]);
});
test('expired ambiguous delivery and changed recipient access never dispatch with a new key',async()=>{
  const f=await setup({send:()=>{throw Error('ambiguous');}});const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];
  await f.dispatcher.deliver(id);f.tick(RETRY_WINDOW+1);assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,1);
  const g=await setup();const q=await g.dispatcher.prepare(g.id);g.users.get('admin').disabled=true;
  assert.equal((await g.dispatcher.deliver(q.delivery_ids[0])).state,'skipped');assert.equal(g.sent.length,0);
});
test('read-only/unknown control pauses new mail but an already accepted response is durably recorded after flags switch off',async()=>{
  const f=await setup();const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];
  f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.equal((await f.dispatcher.deliver(id)).state,'paused');assert.equal(f.sent.length,0);
  f.docs.set('pulseRuntimeControl/cutover',{mode:'unknown'});assert.equal((await f.dispatcher.deliver(id)).state,'paused');
  let g;g=await setup({send:()=>{g.off();g.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});return{id:'accepted-after-off'};}});
  const q=await g.dispatcher.prepare(g.id);assert.equal((await g.dispatcher.deliver(q.delivery_ids[0])).state,'accepted');assert.equal(g.sent.length,1);
});
test('changes-requested deliveries are limited to the current authorized originating submitter',async()=>{
  const f=fixture({uid:'admin'});Object.assign(f.docs.get('projects/P/purchaseOrders/existing'),{status:'pending-approval',submittedBy:'partner'});
  const result=await f.command({kind:'request_changes',note:'Correct quote'}),sent=[];
  const dispatcher=createPOApprovalDispatcher({db:f.db,auth:f.auth,enabled:true,now:()=>T0,getServerTimestamp:()=>new Date(T0),sendEmail:async(mail)=>{sent.push(mail);return{id:'changes'};}});
  const p=await dispatcher.prepare(result.notification_id);assert.equal((await dispatcher.deliver(p.delivery_ids[0])).state,'accepted');assert.deepEqual(sent[0].to,['partner@external.example']);
  const record=f.docs.get(`pulsePOApprovalNotificationDeliveries/${p.delivery_ids[0]}`);assert.match(record.mail.html,/Correct quote/);
});
test('corrupted frozen bytes and invalid native link configuration fail closed',async()=>{
  const f=await setup();const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).mail.html='tampered';
  assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,0);
  const g=await setup();const invalid=createPOApprovalDispatcher({db:g.db,auth:g.auth,enabled:true,now:()=>T0,getServerTimestamp:()=>new Date(T0),workspaceUrl:'http://bad.example/bom',sendEmail:()=>assert.fail('invalid URL')});
  assert.equal((await invalid.prepare(g.id)).state,'blocked');
});
test('lost final metadata acknowledgment never downgrades provider acceptance or resends',async()=>{
  const f=await setup(),p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];
  f.settings.loseCommitReply=true;f.settings.loseCommitReplyWhen=writes=>writes.some(([_kind,path,value])=>path.startsWith('pulsePOApprovalNotificationDeliveries/')&&value?.state==='accepted');
  assert.equal((await f.dispatcher.deliver(id)).state,'accepted');f.tick(LEASE+1);
  assert.equal((await f.dispatcher.deliver(id)).state,'accepted');assert.equal(f.sent.length,1);
  assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'accepted');
});
test('a lost fanout reply cannot overwrite a notification already accepted by its delivery trigger',async()=>{
  const f=await setup();
  const hook=async writes=>{
    if(!writes.some(([_kind,path,value])=>path===`pulsePOApprovalNotifications/${f.id}`&&value?.state==='prepared')){f.settings.afterApply=hook;return;}
    for(const id of f.docs.get(`pulsePOApprovalNotifications/${f.id}`).delivery_ids)await f.dispatcher.deliver(id);
  };
  f.settings.afterApply=hook;f.settings.loseCommitReply=true;
  f.settings.loseCommitReplyWhen=writes=>writes.some(([_kind,path,value])=>path===`pulsePOApprovalNotifications/${f.id}`&&value?.state==='prepared');
  assert.equal((await f.dispatcher.prepare(f.id)).state,'accepted');assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'accepted');assert.equal(f.sent.length,1);
});
test('permanent preparation failures leave the due queue while delayed still-current approvals remain recoverable',async()=>{
  const f=await setup();f.docs.delete('projects/P');assert.equal((await f.dispatcher.prepare(f.id)).state,'blocked');
  assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).next_attempt_ms,Number.MAX_SAFE_INTEGER);
  const g=await setup();g.tick(25*60*60*1000);const p=await g.dispatcher.prepare(g.id);assert.equal(p.state,'prepared');assert.equal((await g.dispatcher.deliver(p.delivery_ids[0])).state,'accepted');assert.equal(g.sent.length,1);
});
test('before first dispatch a revoked recipient is removed without blocking still-authorized recipients',async()=>{
  const f=await setup();f.users.set('other',{uid:'other',email:'other@example.com',emailVerified:true,customClaims:{role:'admin',status:'approved'}});
  const prepared=await f.dispatcher.prepare(f.id),id=prepared.delivery_ids[0];f.users.get('admin').disabled=true;
  assert.equal((await f.dispatcher.deliver(id)).state,'accepted');assert.deepEqual(f.sent[0].mail.to,['other@example.com']);
  assert.deepEqual(f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).removed_recipient_uids,['admin']);
  const dispatch=[...f.docs.values()].find(record=>record.phase==='dispatching');assert.equal(dispatch.mail_hash,f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).mail_hash);
});
test('a changed recipient after an ambiguous provider attempt never changes the frozen payload',async()=>{
  const f=await setup({send:()=>{throw Error('uncertain');}}),prepared=await f.dispatcher.prepare(f.id),id=prepared.delivery_ids[0];
  await f.dispatcher.deliver(id);const frozen=structuredClone(f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).mail);
  f.users.get('admin').disabled=true;f.tick(LEASE+1);assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,1);
  assert.deepEqual(f.docs.get(`pulsePOApprovalNotificationDeliveries/${id}`).mail,frozen);
});
test('notifications superseded before first dispatch are skipped rather than inviting action on stale POs',async()=>{
  const f=await setup(),p=await f.dispatcher.prepare(f.id);f.docs.get('projects/P/purchaseOrders/existing').status='sent';
  assert.equal((await f.dispatcher.deliver(p.delivery_ids[0])).state,'skipped');assert.equal(f.sent.length,0);
  const g=await setup(),q=await g.dispatcher.prepare(g.id);g.tick(25*60*60*1000);
  assert.equal((await g.dispatcher.deliver(q.delivery_ids[0])).state,'accepted');assert.equal(g.sent.length,1);
});
test('changed approval details supersede the event and a changed verified address is refreshed only before a first attempt',async()=>{
  const f=await setup(),p=await f.dispatcher.prepare(f.id);f.docs.get('projects/P/purchaseOrders/existing').totalAmount=200;
  assert.equal((await f.dispatcher.deliver(p.delivery_ids[0])).state,'skipped');assert.equal(f.sent.length,0);
  const g=await setup(),q=await g.dispatcher.prepare(g.id);g.users.get('admin').email='new@example.com';
  assert.equal((await g.dispatcher.deliver(q.delivery_ids[0])).state,'accepted');assert.deepEqual(g.sent[0].mail.to,['new@example.com']);
});
test('known provider rejection is surfaced for reconciliation without another key or automatic resend',async()=>{
  const {REJECTED}=require('./poApprovalProvider.cjs'),f=await setup({send:()=>{throw Object.assign(Error('private'),{[REJECTED]:true});}});
  const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');
  f.tick(LEASE+1);assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,1);
});
test('a deleted recipient does not strand still-authorized recipients before a first attempt',async()=>{
  const f=await setup();f.users.set('other',{uid:'other',email:'other@example.com',emailVerified:true,customClaims:{role:'admin',status:'approved'}});
  const p=await f.dispatcher.prepare(f.id);f.users.delete('admin');
  f.auth.getUser=async uid=>{if(!f.users.has(uid))throw Object.assign(Error('removed'),{code:'auth/user-not-found'});return structuredClone(f.users.get(uid));};
  assert.equal((await f.dispatcher.deliver(p.delivery_ids[0])).state,'accepted');assert.deepEqual(f.sent[0].mail.to,['other@example.com']);
});
test('a late provider acknowledgment cannot be downgraded by a newer lease still checking recipients',async()=>{
  let releaseProvider,calls=0;
  const f=await setup({send:()=>{if(++calls===1)return new Promise(resolve=>{releaseProvider=resolve;});throw Error('must not call again');}});
  const p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0],first=f.dispatcher.deliver(id);
  while(!releaseProvider)await new Promise(resolve=>setImmediate(resolve));
  const get=f.auth.getUser;let releaseProfile;f.auth.getUser=async uid=>{const profile=await get(uid);return new Promise(resolve=>{releaseProfile=()=>resolve(profile);});};
  f.tick(LEASE+1);const second=f.dispatcher.deliver(id);while(!releaseProfile)await new Promise(resolve=>setImmediate(resolve));
  releaseProvider({id:'accepted-late'});assert.equal((await first).state,'accepted');releaseProfile();
  assert.equal((await second).state,'accepted');assert.equal(f.sent.length,1);assert.equal(f.docs.get(`pulsePOApprovalNotifications/${f.id}`).state,'accepted');
});
test('the retry window is rechecked after slow recipient lookup before another provider request',async()=>{
  const f=await setup({send:()=>{throw Error('ambiguous');}}),p=await f.dispatcher.prepare(f.id),id=p.delivery_ids[0];
  await f.dispatcher.deliver(id);f.tick(RETRY_WINDOW-10);const get=f.auth.getUser;
  f.auth.getUser=async uid=>{f.tick(20);return get(uid);};
  assert.equal((await f.dispatcher.deliver(id)).state,'needs_reconciliation');assert.equal(f.sent.length,1);
});
