const {createHash} = require('node:crypto');
const {currentNativeActor} = require('./nativeMaterialOperations.cjs');
const {assertDocumentBudget} = require('./materialCommands.cjs');
const {approvalFingerprint} = require('./poApprovalOutbox.cjs');
const {RETRY_WINDOW} = require('./poApprovalDispatcher.cjs');
const PUBLIC = Symbol('notification-operation');
const fault = (code,status=400) => Object.assign(new Error(code),{code,status,[PUBLIC]:true});
const plain = value => value && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const id = value => typeof value==='string' && value.length>0 && value.length<=512 && !/[\/\x00-\x1f]/.test(value) && !['.','..'].includes(value);
const hashId = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const sort = value => Array.isArray(value)?value.map(sort):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
const hash = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
const STATES = new Set(['pending','preparing','prepared','sending','uncertain','accepted','accepted_with_skips','skipped','blocked','needs_reconciliation']);
const PROBLEMS = new Set(['invalid_snapshot','project_missing','event_superseded','no_authorized_recipients','invalid_snapshot_or_workspace','recipient_capacity_exceeded','recipient_lookup_failed','notification_preparation_unavailable','provider_window_expired','recipient_access_changed','provider_rejected','provider_outcome_unconfirmed','invalid_frozen_message','no_current_recipients','no_submitter']);
function createPOApprovalNotificationOperations({db,auth,enabled=false,now=Date.now,getServerTimestamp}) {
  const on = () => (typeof enabled==='function'?enabled():enabled)===true;
  async function actorOf(request) {
    try { return await currentNativeActor(auth,request); }
    catch(error) {
      const known={actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503};
      if(Object.hasOwn(known,error?.code)&&known[error.code]===error.status)throw fault(error.code,error.status);
      throw error;
    }
  }
  return async request => {
    try {
      const actor=await actorOf(request),data=request.data;
      if(!plain(data)||!['status','retry'].includes(data.operation)||!id(data.project_id)||!id(data.po_id))throw fault('invalid_notification_request');
      const retry=data.operation==='retry',keys=['operation','project_id','po_id','expected_actor_uid',...(retry?['notification_id','expected_revision','operation_id','target_id']:[])];
      if(Object.keys(data).some(key=>!keys.includes(key)))throw fault('invalid_notification_request');
      if(data.expected_actor_uid!==actor.uid)throw fault('actor_session_changed',403);
      if(retry&&(!hashId(data.notification_id)||!hashId(data.expected_revision)||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)||Object.hasOwn(data,'target_id')&&!hashId(data.target_id)))throw fault('invalid_notification_request');
      const projectRef=db.collection('projects').doc(data.project_id),poRef=projectRef.collection('purchaseOrders').doc(data.po_id);
      const receiptRef=retry?db.collection('pulsePOApprovalNotificationOperations').doc(hash([actor.uid,data.project_id,data.operation_id])):null;
      const requestHash=hash(data);
      return await db.runTransaction(async tx=>{
        const project=await tx.get(projectRef),po=await tx.get(poRef),control=await tx.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const receipt=receiptRef?await tx.get(receiptRef):null;
        if(!project.exists||!po.exists)throw fault('notification_not_found',404);
        const pointer=po.data().nativeApprovalNotificationId;
        if(pointer!==undefined&&!hashId(pointer))throw fault('notification_record_unavailable',503);
        const parentRef=pointer?db.collection('pulsePOApprovalNotifications').doc(pointer):null;
        const parent=parentRef?await tx.get(parentRef):null;
        if(pointer&&(!parent.exists||parent.data().project_id!==data.project_id||parent.data().po_id!==data.po_id))throw fault('notification_record_unavailable',503);
        const parentData=parent?.data(),deliveryIds=parentData?.delivery_ids||[];
        if(!Array.isArray(deliveryIds)||deliveryIds.length>100||new Set(deliveryIds).size!==deliveryIds.length||deliveryIds.some(value=>!hashId(value)))throw fault('notification_record_unavailable',503);
        const deliveries=[];
        for(const childId of deliveryIds){
          const ref=db.collection('pulsePOApprovalNotificationDeliveries').doc(childId),snapshot=await tx.get(ref),record=snapshot.data();
          if(!snapshot.exists||record.parent_id!==pointer||record.project_id!==data.project_id||record.po_id!==data.po_id)throw fault('notification_record_unavailable',503);
          deliveries.push({id:childId,ref,snapshot,record});
        }
        const current=await actorOf(request);
        if(current.uid!==actor.uid)throw fault('actor_session_changed',403);
        const admin=current.customClaims.role==='admin';
        if(!admin&&(!Array.isArray(project.data().memberIds)||!project.data().memberIds.includes(current.uid)))throw fault('notification_forbidden',403);
        if(retry&&!admin)throw fault('notification_forbidden',403);
        if(receipt?.exists){if(receipt.data().request_hash!==requestHash)throw fault('notification_request_reused',409);return receipt.data().result;}
        const dispatch=on()&&(!control.exists||['coexist','pulse_only'].includes(control.data()?.mode));
        const fingerprintMatches=parentData?.schema===1&&['submit','request_changes'].includes(parentData.kind)&&parentData.event_fingerprint===approvalFingerprint(po.data())&&po.data().status===(parentData.kind==='submit'?'pending-approval':'draft');
        const free=record=>!(Number.isFinite(record.lease_until)&&record.lease_until>now());
        const canPrepare=admin&&dispatch&&fingerprintMatches&&!deliveryIds.length&&['pending','blocked'].includes(parentData?.state)&&free(parentData);
        const canDeliver=record=>admin&&dispatch&&fingerprintMatches&&['pending','uncertain'].includes(record.state)&&free(record)
          &&(record.first_dispatched_ms===undefined||Number.isFinite(record.first_dispatched_ms)&&now()>=record.first_dispatched_ms&&now()-record.first_dispatched_ms<RETRY_WINDOW);
        const version=snapshot=>snapshot?.exists?[snapshot.updateTime?.seconds,snapshot.updateTime?.nanoseconds,snapshot.data()]:null;
        const revision=hash([version(project),version(po),version(parent),...deliveries.map(row=>version(row.snapshot))]);
        const publicRow=(record,childId)=>({id:childId,state:STATES.has(record.state)?record.state:'blocked',recipient_count:Array.isArray(record.recipients)?Math.min(50,record.recipients.length):0,can_retry:!!canDeliver(record),...(PROBLEMS.has(record.problem)?{problem:record.problem}:{})});
        const result={ok:true,project_id:data.project_id,po_id:data.po_id,notification_id:pointer||null,revision,state:parentData?(STATES.has(parentData.state)?parentData.state:'blocked'):'none',dispatch_enabled:dispatch,can_retry_prepare:!!canPrepare,deliveries:deliveries.map(row=>publicRow(row.record,row.id))};
        if(!retry)return result;
        // Refusals compete on the same receipt as a successful retry. A cached browser
        // may discard a nonce only after this durable fence, never after a generic error.
        const refuse=code=>{
          const response={ok:false,error:code,status:409,request_finalized:true,project_id:data.project_id,po_id:data.po_id,notification_id:data.notification_id,operation_id:data.operation_id};
          const stored={actor_uid:current.uid,request_hash:requestHash,result:response,at:getServerTimestamp()};
          const ref=db.collection('pulsePOApprovalNotificationAudit').doc(data.notification_id).collection('events').doc(hash([actor.uid,data.operation_id,'operator_retry_cancelled']));
          const event={phase:'operator_retry_cancelled',actor_uid:current.uid,operation_id:data.operation_id,request_hash:requestHash,expected_revision:data.expected_revision,problem:code,at:getServerTimestamp()};
          assertDocumentBudget([{path:receiptRef.path,data:stored},{path:ref.path,data:event}]);
          tx.create(receiptRef,stored);tx.create(ref,event);return response;
        };
        if(!dispatch)return refuse('notification_dispatch_disabled');
        if(pointer!==data.notification_id||revision!==data.expected_revision)return refuse('notification_changed');
        const target=data.target_id?deliveries.find(row=>row.id===data.target_id):null;
        if(data.target_id?!target||!canDeliver(target.record):!canPrepare)return refuse('notification_retry_forbidden');
        const targetRef=target?target.ref:parentRef,original=target?target.record:parentData;
        const patch={state:target?original.state:'pending',next_attempt_ms:now(),lease_until:0};
        const auditRef=db.collection('pulsePOApprovalNotificationAudit').doc(pointer).collection('events').doc(hash([actor.uid,data.operation_id,'operator_retry']));
        const audit={phase:'operator_retry',actor_uid:current.uid,project_id:data.project_id,po_id:data.po_id,notification_id:pointer,target_id:target?.id||pointer,operation_id:data.operation_id,
          expected_revision:data.expected_revision,request_hash:requestHash,previous_state:original.state,previous_problem:PROBLEMS.has(original.problem)?original.problem:null,
          first_dispatched_ms:original.first_dispatched_ms??null,control_mode:control.exists?control.data().mode:'coexist',at_ms:now(),at:getServerTimestamp()};
        const response={...result,state:target?result.state:'pending',can_retry_prepare:false,deliveries:result.deliveries.map(row=>({...row,can_retry:false})),operation_id:data.operation_id};
        const stored={actor_uid:current.uid,request_hash:requestHash,result:response,at:getServerTimestamp()};
        assertDocumentBudget([{path:targetRef.path,data:{...original,...patch}},{path:auditRef.path,data:audit},{path:receiptRef.path,data:stored}]);
        tx.update(targetRef,patch);tx.create(auditRef,audit);tx.create(receiptRef,stored);
        return response;
      },{readOnly:!retry});
    }catch(error){return{ok:false,error:error?.[PUBLIC]?error.code:'notification_service_unavailable',status:error?.[PUBLIC]?error.status:503};}
  };
}
module.exports={createPOApprovalNotificationOperations};
