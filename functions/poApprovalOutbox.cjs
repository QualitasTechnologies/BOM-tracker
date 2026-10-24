const {createHash}=require('node:crypto');
const NEVER=Number.MAX_SAFE_INTEGER;
const approvalFingerprint=po=>createHash('sha256').update(JSON.stringify([po.poNumber??null,po.vendorName??null,po.totalAmount??null,po.submittedBy??null,po.changesRequestedNote??null])).digest('hex');
const label=(value,fallback='',max=500)=>typeof value==='string'&&value ? value.length>max ? `${value.slice(0,max-1)}…` : value : fallback;
function createApprovalJob({projectId,poId,operationId,kind,project,po,actor,at,createdMs}) {
  if(!['submit','request_changes'].includes(kind)) return null;
  const id=createHash('sha256').update(JSON.stringify([projectId,operationId,kind])).digest('hex');
  const skipped=kind==='request_changes'&&!po.submittedBy;
  return {id,record:{schema:1,project_id:projectId,po_id:poId,operation_id:operationId,kind,actor_uid:actor.uid,event_fingerprint:approvalFingerprint(po),
    state:skipped?'skipped':'pending',...(skipped?{problem:'no_submitter'}:{}),created_at:at,created_ms:createdMs,next_attempt_ms:skipped?NEVER:createdMs,
    payload:{mode:kind==='submit'?'submitted':'changes-requested',projectId,projectName:label(project.projectName,projectId),poId,
      poNumber:label(po.poNumber,'Purchase Order'),vendorName:label(po.vendorName),totalAmount:Number.isFinite(po.totalAmount)?po.totalAmount:null,
      actorName:label(actor.displayName||actor.email,'A team member',300),submitterUid:kind==='submit'?actor.uid:po.submittedBy||null,
      ...(kind==='request_changes'&&po.changesRequestedNote?{note:label(po.changesRequestedNote,'',4000)}:{})}}};
}
module.exports={createApprovalJob,approvalFingerprint,NEVER};
