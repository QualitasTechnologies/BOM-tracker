const {createHash}=require('node:crypto');
const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {notificationSnapshotRevision}=require('./poApprovalNotificationOperations.cjs');
const {verifyPOApprovalEvidence,approvalMailHash}=require('./poApprovalEvidence.cjs');
const {assertDocumentBudget}=require('./materialCommands.cjs');
const {NEVER}=require('./poApprovalOutbox.cjs');
const PUBLIC=Symbol('reconciliation-fault');
const fail=(code,status=409)=>Object.assign(Error(code),{code,status,[PUBLIC]:true});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\/\x00-\x1f]/.test(value)&&!['.','..'].includes(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createPOApprovalReconciliation({db,auth,lookup,enabled=false,now=Date.now,getServerTimestamp}){
  const on=()=> (typeof enabled==='function'?enabled():enabled)===true;
  async function actorOf(request){
    try{const actor=await currentNativeActor(auth,request);if(actor.customClaims.role!=='admin')throw fail('notification_forbidden',403);return actor;}
    catch(error){const codes={actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503};if(Object.hasOwn(codes,error?.code)&&codes[error.code]===error.status)throw fail(error.code,error.status);throw error;}
  }
  return async request=>{
    try{
      const actor=await actorOf(request),data=request.data;
      const keys=['operation','project_id','po_id','notification_id','delivery_id','provider_id','expected_revision','operation_id','expected_actor_uid','resolve_only'];
      if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!keys.includes(key))||data.operation!=='reconcile'||!id(data.project_id)||!id(data.po_id)||!hex(data.notification_id)||!hex(data.delivery_id)||!uuid(data.provider_id)||!hex(data.expected_revision)||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)||Object.hasOwn(data,'resolve_only')&&data.resolve_only!==true)throw fail('invalid_notification_request',400);
      if(data.expected_actor_uid!==actor.uid)throw fail('actor_session_changed',403);
      const {resolve_only:_resolve,...body}=data;
      const requestHash=digest(keys.filter(key=>key!=='resolve_only').map(key=>body[key]??null));
      const receiptRef=db.collection('pulsePOApprovalNotificationReconciliations').doc(digest([actor.uid,data.project_id,data.operation_id]));
      const parentRef=db.collection('pulsePOApprovalNotifications').doc(data.notification_id),childRef=db.collection('pulsePOApprovalNotificationDeliveries').doc(data.delivery_id);
      async function read(tx){
        const receipt=await tx.get(receiptRef);
        if(receipt.exists){const current=await actorOf(request);if(current.uid!==actor.uid)throw fail('actor_session_changed',403);if(receipt.data().request_hash!==requestHash)throw fail('notification_request_reused');return{finished:receipt.data().result};}
        // A nonce fence has no business effect. It must remain possible after live
        // records are deleted or superseded, otherwise an old lookup can be stranded.
        if(data.resolve_only){const current=await actorOf(request);if(current.uid!==actor.uid)throw fail('actor_session_changed',403);return{cancel:true};}
        const project=await tx.get(db.collection('projects').doc(data.project_id)),po=await tx.get(db.collection('projects').doc(data.project_id).collection('purchaseOrders').doc(data.po_id));
        if(!project.exists||!po.exists)throw fail('notification_not_found',404);
        const parent=await tx.get(parentRef),control=await tx.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const children=parent.exists?parent.data().delivery_ids:null;
        if(po.data().nativeApprovalNotificationId!==data.notification_id||!parent.exists||parent.data().project_id!==data.project_id||parent.data().po_id!==data.po_id||!Array.isArray(children)||children.length>100||new Set(children).size!==children.length||!children.includes(data.delivery_id)||children.some(value=>!hex(value)))throw fail('notification_changed');
        const deliveries=[];
        for(const child of children){const snapshot=await tx.get(db.collection('pulsePOApprovalNotificationDeliveries').doc(child));if(!snapshot.exists||snapshot.data().parent_id!==data.notification_id||snapshot.data().project_id!==data.project_id||snapshot.data().po_id!==data.po_id)throw fail('notification_record_unavailable',503);deliveries.push({id:child,snapshot});}
        const current=await actorOf(request);if(current.uid!==actor.uid)throw fail('actor_session_changed',403);
        if(control.exists&&!['coexist','pulse_only','read_only'].includes(control.data()?.mode))throw fail('notification_control_unavailable',503);
        const job=deliveries.find(row=>row.id===data.delivery_id).snapshot.data();
        const revision=notificationSnapshotRevision([project,po,parent,...deliveries.map(row=>row.snapshot)]);
        return{job,deliveries,revision,parent:parent.data()};
      }
      function eligible(snapshot){
        const job=snapshot.job;
        if(snapshot.revision!==data.expected_revision)throw fail('notification_changed');
        if(!['pending','sending','uncertain','needs_reconciliation'].includes(job.state)||job.lease_until>now()||!Number.isFinite(job.first_dispatched_ms)||job.first_dispatched_ms<0||job.first_dispatched_ms>now()||job.mail_hash!==approvalMailHash(job.mail)||job.idempotency_key!==`po-approval/${data.delivery_id}`)throw fail('notification_reconciliation_forbidden');
      }
      const opening=await db.runTransaction(read,{readOnly:true});if(opening.finished)return opening.finished;
      if(data.resolve_only){
        return await db.runTransaction(async tx=>{
          const snapshot=await read(tx);if(snapshot.finished)return snapshot.finished;
          const result={ok:false,error:'notification_reconciliation_cancelled',status:409,request_finalized:true,project_id:data.project_id,po_id:data.po_id,notification_id:data.notification_id,delivery_id:data.delivery_id,operation_id:data.operation_id};
          const auditRef=db.collection('pulsePOApprovalNotificationAudit').doc(data.notification_id).collection('events').doc(digest([actor.uid,data.operation_id,'reconciliation_cancelled']));
          tx.create(receiptRef,{request_hash:requestHash,actor_uid:actor.uid,result,at:getServerTimestamp()});
          tx.create(auditRef,{phase:'reconciliation_cancelled',actor_uid:actor.uid,operation_id:data.operation_id,delivery_id:data.delivery_id,at:getServerTimestamp()});return result;
        });
      }
      if(!on())throw fail('notification_reconciliation_disabled');eligible(opening);
      const evidence=await lookup(data.provider_id);
      verifyPOApprovalEvidence({deliveryId:data.delivery_id,providerId:data.provider_id,job:opening.job,evidence,nowMs:now()});
      return await db.runTransaction(async tx=>{
        const snapshot=await read(tx);if(snapshot.finished)return snapshot.finished;eligible(snapshot);
        const proof=verifyPOApprovalEvidence({deliveryId:data.delivery_id,providerId:data.provider_id,job:snapshot.job,evidence,nowMs:now()});
        const patch={state:'accepted',problem:null,provider_id:proof.provider_id,provider_event:proof.provider_event,provider_created_ms:proof.provider_created_ms,evidence_hash:proof.evidence_hash,accepted_at:getServerTimestamp(),reconciled_at:getServerTimestamp(),lease_until:0,next_attempt_ms:NEVER};
        const states=snapshot.deliveries.map(row=>row.id===data.delivery_id?'accepted':row.snapshot.data().state);
        const state=states.every(value=>value==='accepted')?'accepted':states.every(value=>['accepted','skipped'].includes(value))?'accepted_with_skips':states.some(value=>['blocked','needs_reconciliation'].includes(value))?'needs_reconciliation':'prepared';
        const parentPatch={state,next_attempt_ms:NEVER,accepted_batch_count:states.filter(value=>value==='accepted').length,skipped_batch_count:states.filter(value=>value==='skipped').length,...(state==='accepted'?{accepted_at:getServerTimestamp()}:{})};
        const result={ok:true,project_id:data.project_id,po_id:data.po_id,notification_id:data.notification_id,delivery_id:data.delivery_id,operation_id:data.operation_id,state:'accepted',provider_event:proof.provider_event};
        const stored={request_hash:requestHash,actor_uid:actor.uid,result,at:getServerTimestamp()};
        const auditRef=db.collection('pulsePOApprovalNotificationAudit').doc(data.notification_id).collection('events').doc(digest([actor.uid,data.operation_id,'provider_evidence_verified']));
        const audit={phase:'provider_evidence_verified',actor_uid:actor.uid,delivery_id:data.delivery_id,operation_id:data.operation_id,expected_revision:data.expected_revision,previous_state:snapshot.job.state,first_dispatched_ms:snapshot.job.first_dispatched_ms,...proof,at:getServerTimestamp()};
        assertDocumentBudget([{path:childRef.path,data:{...snapshot.job,...patch}},{path:parentRef.path,data:{...snapshot.parent,...parentPatch}},{path:receiptRef.path,data:stored},{path:auditRef.path,data:audit}]);
        tx.update(childRef,patch);tx.update(parentRef,parentPatch);tx.create(auditRef,audit);tx.create(receiptRef,stored);return result;
      });
    }catch(error){return{ok:false,error:error?.[PUBLIC]?error.code:'notification_evidence_unconfirmed',status:error?.[PUBLIC]?error.status:503};}
  };
}
module.exports={createPOApprovalReconciliation};
