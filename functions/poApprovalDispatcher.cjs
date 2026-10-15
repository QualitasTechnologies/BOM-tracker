const {randomUUID,createHash}=require('node:crypto');
const {assertDocumentBudget}=require('./materialCommands.cjs');
const {NEVER,approvalFingerprint}=require('./poApprovalOutbox.cjs');
const {REJECTED}=require('./poApprovalProvider.cjs');
const LEASE=5*60*1000,RETRY_WINDOW=23*60*60*1000;
const terminal=new Set(['accepted','accepted_with_skips','skipped','blocked','needs_reconciliation']);
const digest=value=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const approved=user=>user&&!user.disabled&&user.emailVerified===true&&!user.tenantId&&user.customClaims?.status==='approved'&&['admin','user','viewer'].includes(user.customClaims.role)&&email(user.email);
const controlAllows=snapshot=>!snapshot.exists||['coexist','pulse_only'].includes(snapshot.data()?.mode);
const problem=code=>Object.assign(new Error(code),{problem:code});
const publicState=(record,id)=>({state:record.state,job_id:id,...(record.delivery_ids?{delivery_ids:record.delivery_ids}:{}),...(record.provider_id?{provider_id:record.provider_id}:{}),...(record.problem?{problem:record.problem}:{})});
function createPOApprovalDispatcher({db,auth,enabled=false,now=Date.now,getServerTimestamp,sendEmail,workspaceUrl='https://eagle-eye.qualitastech.com/pulse/bom',buildEmail=input=>require('./poApprovalEmail.cjs').buildPOApprovalEmail(input)}) {
  const on=()=> (typeof enabled==='function'?enabled():enabled)===true;
  const parentRef=id=>db.collection('pulsePOApprovalNotifications').doc(id);
  const deliveryRef=id=>db.collection('pulsePOApprovalNotificationDeliveries').doc(id);
  const controlRef=db.collection('pulseRuntimeControl').doc('cutover');
  const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
  const audit=(id,owner,phase,record)=>({ref:db.collection('pulsePOApprovalNotificationAudit').doc(id).collection('events').doc(digest([owner,phase,record.job_id])),
    data:{...record,phase,system_actor:'po-approval-dispatcher',at:getServerTimestamp()}});
  const delay=count=>Math.min(3600000,60000*2**Math.min(6,Math.max(0,(count||1)-1)));
  async function profilesFor(job,project) {
    let users=[];
    if(job.kind==='submit') {
      let token;const tokens=new Set();
      do {
        const page=await auth.listUsers(1000,token);users.push(...page.users.filter(user=>approved(user)&&user.customClaims.role==='admin'));
        token=page.pageToken;if(token&&tokens.has(token))throw problem('recipient_lookup_failed');if(token)tokens.add(token);
        if(tokens.size>100||users.length>5000)throw problem('recipient_capacity_exceeded');
      } while(token);
    } else {
      let user;
      try{user=await auth.getUser(job.payload.submitterUid);}catch(error){if(error.code==='auth/user-not-found')return[];throw error;}
      if(approved(user)&&(user.customClaims.role==='admin'||Array.isArray(project.memberIds)&&project.memberIds.includes(user.uid)))users=[user];
    }
    const unique=new Map();for(const user of users){const address=user.email.trim().toLowerCase();if(!unique.has(address))unique.set(address,{uid:user.uid,email:address});}
    return [...unique.values()].sort((a,b)=>a.email.localeCompare(b.email));
  }
  async function prepare(id) {
    if(!validId(id))return{state:'invalid_job'};if(!on())return{state:'disabled'};
    const ref=parentRef(id),owner=randomUUID();let job;
    try {
      const claim=await db.runTransaction(async tx=>{
        const snapshot=await tx.get(ref),control=await tx.get(controlRef);
        if(!snapshot.exists)return{state:'missing'};const current=snapshot.data();
        if(terminal.has(current.state)||current.state==='prepared')return publicState(current,id);
        if(!on()||!controlAllows(control))return{state:'paused'};
        if(current.lease_until>now())return{state:'pending'};
        const reject=(state,reason)=>{
          const event=audit(id,owner,state,{job_id:id,problem:reason});
          tx.update(ref,{state,problem:reason,lease_until:0,next_attempt_ms:NEVER});tx.create(event.ref,event.data);return{state,problem:reason,job_id:id};
        };
        if(current.schema!==1||!['submit','request_changes'].includes(current.kind)||!current.payload||!validId(current.event_fingerprint)||!Number.isFinite(current.created_ms)||typeof current.project_id!=='string'||!current.project_id||/[\/\x00-\x1f]/.test(current.project_id))return reject('blocked','invalid_snapshot');
        const project=await tx.get(db.collection('projects').doc(current.project_id));if(!project.exists)return reject('blocked','project_missing');
        const po=await tx.get(db.collection('projects').doc(current.project_id).collection('purchaseOrders').doc(current.po_id));
        if(!po.exists||po.data().nativeApprovalNotificationId!==id||po.data().status!==(current.kind==='submit'?'pending-approval':'draft')||approvalFingerprint(po.data())!==current.event_fingerprint)return reject('skipped','event_superseded');
        const patch={state:'preparing',lease_owner:owner,lease_until:now()+LEASE,next_attempt_ms:now()+LEASE};
        tx.update(ref,patch);return{claimed:true,job:current,project:project.data()};
      });
      if(!claim.claimed)return claim;job=claim.job;
      const recipients=await profilesFor(job,claim.project);if(!recipients.length)throw problem('no_authorized_recipients');
      let nativeUrl;try{nativeUrl=new URL(workspaceUrl);}catch{throw problem('invalid_snapshot_or_workspace');}
      if(nativeUrl.protocol!=='https:'||nativeUrl.username||nativeUrl.password||nativeUrl.search||nativeUrl.hash||!nativeUrl.pathname.replace(/\/+$/,'').endsWith('/bom'))throw problem('invalid_snapshot_or_workspace');
      // One provider request has at most 50 recipients. Each fixed batch has its own lease/key/receipt.
      const deliveries=[];
      for(let offset=0;offset<recipients.length;offset+=50) {
        const deliveryId=digest([id,offset/50]),batch=recipients.slice(offset,offset+50),{submitterUid:_submitter,...body}=job.payload;
        let mail;try {mail=buildEmail({...body,to:batch.map(row=>row.email),workspaceUrl,workspaceName:'Pulse'});}catch{throw problem('invalid_snapshot_or_workspace');}
        const record={schema:1,parent_id:id,project_id:job.project_id,po_id:job.po_id,kind:job.kind,actor_uid:job.actor_uid,state:'pending',
          recipients:batch,mail,mail_hash:digest(mail),idempotency_key:`po-approval/${deliveryId}`,created_ms:now(),next_attempt_ms:now()};
        deliveries.push({id:deliveryId,ref:deliveryRef(deliveryId),record});
      }
      return await db.runTransaction(async tx=>{
        const current=await tx.get(ref),control=await tx.get(controlRef),project=await tx.get(db.collection('projects').doc(job.project_id));
        if(!current.exists||current.data().lease_owner!==owner)return{state:'pending'};
        if(!on()||!controlAllows(control))throw problem('paused');if(!project.exists)throw problem('project_missing');
        const patch={state:'prepared',delivery_ids:deliveries.map(row=>row.id),recipient_count:recipients.length,lease_until:0,next_attempt_ms:NEVER};
        const event=audit(id,owner,'prepared',{job_id:id,requested_by:job.actor_uid,batch_count:deliveries.length,recipient_count:recipients.length});
        assertDocumentBudget([{path:ref.path,data:{...current.data(),...patch}},{path:event.ref.path,data:event.data},...deliveries.map(row=>({path:row.ref.path,data:row.record}))]);
        for(const row of deliveries)tx.create(row.ref,row.record);tx.update(ref,patch);tx.create(event.ref,event.data);return publicState({...current.data(),...patch},id);
      });
    } catch(error) {
      const reason=error.problem||'notification_preparation_unavailable',state=reason==='paused'||reason==='notification_preparation_unavailable'?'pending':'blocked';
      return await db.runTransaction(async tx=>{const current=await tx.get(ref);if(!current.exists)return{state:'missing'};
        if(current.data().lease_owner!==owner||terminal.has(current.data().state)||current.data().state==='prepared')return publicState(current.data(),id);
        const patch={state,problem:reason,lease_until:0,next_attempt_ms:state==='pending'?now()+60000:NEVER};tx.update(ref,patch);
        return publicState({...current.data(),...patch},id);
      }).catch(()=>({state:'uncertain',problem:'notification_preparation_unconfirmed'}));
    }
  }
  async function persist(id,owner,state,patch={},acceptedHash) {
    const ref=deliveryRef(id);
    return db.runTransaction(async tx=>{
      const snapshot=await tx.get(ref);if(!snapshot.exists)return{state:'missing'};const current=snapshot.data();
      if(current.state==='accepted')return publicState(current,id);
      if(acceptedHash?current.mail_hash!==acceptedHash||current.first_dispatched_ms===undefined:current.lease_owner!==owner)return publicState(current,id);
      const parent=await tx.get(parentRef(current.parent_id));if(!parent.exists)return{state:'needs_reconciliation',problem:'parent_missing'};
      const states=[];for(const otherId of parent.data().delivery_ids){if(otherId===id)states.push(state);else{const other=await tx.get(deliveryRef(otherId));states.push(other.exists?other.data().state:'blocked');}}
      const next={...patch,state,lease_until:0,next_attempt_ms:terminal.has(state)?NEVER:now()+delay(current.attempt_count)};
      const parentState=states.every(value=>value==='accepted')?'accepted':states.every(value=>value==='skipped')?'skipped':states.every(value=>['accepted','skipped'].includes(value))?'accepted_with_skips':states.some(value=>['blocked','needs_reconciliation'].includes(value))?'needs_reconciliation':'prepared';
      const event=audit(current.parent_id,owner,state,{job_id:id,requested_by:current.actor_uid,...(next.provider_id?{provider_id:next.provider_id}:{}),...(next.problem?{problem:next.problem}:{})});
      assertDocumentBudget([{path:ref.path,data:{...current,...next}},{path:event.ref.path,data:event.data}]);
      tx.update(ref,next);tx.update(parentRef(current.parent_id),{state:parentState,next_attempt_ms:NEVER,accepted_batch_count:states.filter(value=>value==='accepted').length,skipped_batch_count:states.filter(value=>value==='skipped').length,...(parentState==='accepted'?{accepted_at:getServerTimestamp()}:{})});
      tx.create(event.ref,event.data);return publicState({...current,...next},id);
    });
  }
  async function deliver(id) {
    if(!validId(id))return{state:'invalid_job'};if(!on())return{state:'disabled'};
    const ref=deliveryRef(id),owner=randomUUID();let job;
    try {
      const claim=await db.runTransaction(async tx=>{
        const snapshot=await tx.get(ref),control=await tx.get(controlRef);if(!snapshot.exists)return{state:'missing'};const current=snapshot.data();
        if(terminal.has(current.state))return publicState(current,id);if(!on()||!controlAllows(control))return{state:'paused'};
        if(current.lease_until>now()||current.next_attempt_ms>now())return{state:'pending'};
        const patch={lease_owner:owner,lease_until:now()+LEASE,next_attempt_ms:now()+LEASE,attempt_count:(current.attempt_count||0)+1};tx.update(ref,patch);
        return{claimed:true,job:{...current,...patch}};
      });
      if(!claim.claimed)return claim;job=claim.job;
      if(job.schema!==1||!validId(job.parent_id)||job.idempotency_key!==`po-approval/${id}`||digest(job.mail)!==job.mail_hash||!Array.isArray(job.recipients)||job.recipients.length>50||!job.recipients.length||!Array.isArray(job.mail.to)||job.mail.to.length!==job.recipients.length||job.mail.to.some((address,index)=>address!==job.recipients[index].email))return persist(id,owner,'needs_reconciliation',{problem:'invalid_frozen_message'});
      if(job.first_dispatched_ms!==undefined&&(!Number.isFinite(job.first_dispatched_ms)||now()<job.first_dispatched_ms||now()-job.first_dispatched_ms>=RETRY_WINDOW))return persist(id,owner,'needs_reconciliation',{problem:'provider_window_expired'});
      const profiles=[];for(const recipient of job.recipients){try{profiles.push(await auth.getUser(recipient.uid));}catch(error){if(error.code==='auth/user-not-found')profiles.push(null);else throw error;}}
      const authorized=await db.runTransaction(async tx=>{
        const current=await tx.get(ref),parent=await tx.get(parentRef(job.parent_id)),control=await tx.get(controlRef),project=await tx.get(db.collection('projects').doc(job.project_id)),po=await tx.get(db.collection('projects').doc(job.project_id).collection('purchaseOrders').doc(job.po_id));
        if(!current.exists)return{state:'missing'};
        if(terminal.has(current.data().state))return publicState(current.data(),id);
        if(current.data().lease_owner!==owner)return{state:'pending'};
        if(!on()||!controlAllows(control))return{state:'paused'};
        if(!parent.exists||!parent.data().delivery_ids?.includes(id)||parent.data().project_id!==job.project_id||parent.data().po_id!==job.po_id||parent.data().kind!==job.kind||!project.exists)return{state:'invalid_access'};
        const started=current.data().first_dispatched_ms!==undefined;
        if(started&&(now()<current.data().first_dispatched_ms||now()-current.data().first_dispatched_ms>=RETRY_WINDOW))return{state:'needs_reconciliation',problem:'provider_window_expired'};
        if(!po.exists||po.data().nativeApprovalNotificationId!==job.parent_id||po.data().status!==(job.kind==='submit'?'pending-approval':'draft')||approvalFingerprint(po.data())!==parent.data().event_fingerprint)return{state:started?'needs_reconciliation':'skipped',problem:'event_superseded'};
        const allowed=profiles.map((user,index)=>approved(user)&&user.uid===job.recipients[index].uid&&user.email.trim().toLowerCase()===job.recipients[index].email
          &&(job.kind==='submit'?user.customClaims.role==='admin':user.customClaims.role==='admin'||Array.isArray(project.data().memberIds)&&project.data().memberIds.includes(user.uid)));
        const eligible=profiles.map((user,index)=>approved(user)&&user.uid===job.recipients[index].uid&&(job.kind==='submit'?user.customClaims.role==='admin':user.customClaims.role==='admin'||Array.isArray(project.data().memberIds)&&project.data().memberIds.includes(user.uid)));
        if(started&&allowed.some(value=>!value))return{state:'invalid_access'};
        const recipients=started?job.recipients:[...new Map(profiles.filter((_user,index)=>eligible[index]).map(user=>[user.email.trim().toLowerCase(),{uid:user.uid,email:user.email.trim().toLowerCase()}])).values()];
        if(!recipients.length)return{state:'skipped',problem:'no_current_recipients'};
        const mail=started?job.mail:{...job.mail,to:recipients.map(row=>row.email)},mailHash=digest(mail);
        const patch={state:'sending',first_dispatched_ms:current.data().first_dispatched_ms??now(),...(!started?{recipients,mail,mail_hash:mailHash,removed_recipient_uids:job.recipients.filter((_row,index)=>!eligible[index]).map(row=>row.uid),updated_recipient_uids:job.recipients.filter((_row,index)=>eligible[index]&&!allowed[index]).map(row=>row.uid)}:{})};
        const event=audit(job.parent_id,owner,'dispatching',{job_id:id,requested_by:job.actor_uid,mail_hash:mailHash,idempotency_key:job.idempotency_key,recipient_count:recipients.length});
        assertDocumentBudget([{path:ref.path,data:{...current.data(),...patch}},{path:event.ref.path,data:event.data}]);
        tx.update(ref,patch);tx.create(event.ref,event.data);return{allowed:true,mail,mail_hash:mailHash};
      });
      if(!authorized.allowed){if(authorized.state==='invalid_access')return persist(id,owner,'needs_reconciliation',{problem:'recipient_access_changed'});if(['skipped','needs_reconciliation'].includes(authorized.state))return persist(id,owner,authorized.state,{problem:authorized.problem});return authorized;}
      job.mail=authorized.mail;job.mail_hash=authorized.mail_hash;
      // The flag is checked once more immediately before handing the immutable request to the provider.
      if(!on())return{state:'paused'};
      const accepted=await sendEmail(job.mail,{idempotencyKey:job.idempotency_key});
      if(!accepted||typeof accepted.id!=='string'||!accepted.id||accepted.id.length>512)throw Error('provider reply unconfirmed');
      return await persist(id,owner,'accepted',{provider_id:accepted.id,accepted_at:getServerTimestamp()},job.mail_hash);
    } catch(error) {
      if(!job)return{state:'uncertain',problem:'notification_dispatch_unavailable'};
      try{return await persist(id,owner,error?.[REJECTED]?'needs_reconciliation':'uncertain',{problem:error?.[REJECTED]?'provider_rejected':'provider_outcome_unconfirmed'});}catch{return{state:'uncertain',problem:'notification_record_unconfirmed'};}
    }
  }
  return{prepare,deliver};
}
module.exports={createPOApprovalDispatcher,LEASE,RETRY_WINDOW};
