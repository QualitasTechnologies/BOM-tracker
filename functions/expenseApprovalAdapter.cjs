const {createHash}=require('node:crypto');
const {createPOApprovalDispatcher}=require('./poApprovalDispatcher.cjs');
const {createPOApprovalSender}=require('./poApprovalProvider.cjs');
const {expenseFingerprint,expensePayload}=require('./expenseApprovalOutbox.cjs');
const {buildExpenseApprovalEmail}=require('./expenseApprovalEmail.cjs');
const modes=['submitted','approved','rejected'];
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\/\x00-\x1f\x7f]/.test(value);
const text=(value,max=500)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
function validJob(job) {
 const payload=job.payload,mode=typeof job.kind==='string'?job.kind.replace(/^expense_/,''):null;
 if(job.schema!==1||!Number.isFinite(job.created_ms)||!(/^[a-f0-9]{64}$/).test(job.event_fingerprint)||!modes.includes(mode)||job.kind!==`expense_${mode}`||!id(job.project_id)||!id(job.visit_id)||!id(job.actor_uid)||!id(job.operation_id)||!payload||typeof payload!=='object'||Array.isArray(payload))return false;
 const keys=['mode','projectId','projectName','visitId','visitDates','visitLocation','visitPurpose','visitTotal','actorName','submitterUid'];
 return Object.keys(payload).length===keys.length&&keys.every(key=>Object.hasOwn(payload,key))&&payload.mode===mode&&payload.projectId===job.project_id&&payload.visitId===job.visit_id&&text(payload.projectName)&&!!payload.projectName.trim()&&text(payload.visitDates)&&!!payload.visitDates.trim()&&text(payload.visitLocation)&&text(payload.visitPurpose)&&text(payload.actorName,300)&&!!payload.actorName.trim()&&Number.isFinite(payload.visitTotal)&&payload.visitTotal>=0&&(payload.submitterUid===null||id(payload.submitterUid));
}
function createExpenseApprovalDispatcher(options) {
 const {db}=options;
 return createPOApprovalDispatcher({...options,buildEmail:buildExpenseApprovalEmail,adapter:{
  parentCollection:'pulseExpenseApprovalNotifications',deliveryCollection:'pulseExpenseApprovalNotificationDeliveries',auditCollection:'pulseExpenseApprovalNotificationAudit',resourceField:'visit_id',keyPrefix:'expense-approval',tagName:'pulse_expense_delivery',systemActor:'expense-approval-dispatcher',
  validJob,isSubmission:job=>job.kind==='expense_submitted',
  hasAccess:(project,user)=>user.customClaims.role==='admin'||project.memberIds==null||Array.isArray(project.memberIds)&&project.memberIds.includes(user.uid),
  readResource:async(tx,job)=>{
   const snapshot=await tx.get(db.collection('projects').doc(job.project_id).collection('overheads').doc('data'));
   const visits=snapshot.exists?snapshot.data().travelVisits:null;
   const matches=Array.isArray(visits)?visits.filter(visit=>visit&&visit.id===job.visit_id):[];
   return {exists:matches.length===1,data:()=>matches[0]};
  },
  isCurrent:(resource,notificationId,job)=>{
   if(!validJob(job)||!resource.exists)return false;const visit=resource.data();
   if(createHash('sha256').update(JSON.stringify([job.project_id,job.operation_id,job.payload.mode])).digest('hex')!==notificationId)return false;
   if(visit.nativeExpenseNotificationId!==notificationId||visit.reimbursementStatus!==(job.payload.mode==='submitted'?'pending':job.payload.mode)||expenseFingerprint(visit)!==job.event_fingerprint)return false;
   const expected=expensePayload({projectId:job.project_id,visitId:job.visit_id,mode:job.payload.mode,project:{projectName:job.payload.projectName},visit,actor:{displayName:job.payload.actorName}});
   return Object.keys(expected).every(key=>expected[key]===job.payload[key]);
  },
 }});
}
module.exports={createExpenseApprovalDispatcher,createExpenseApprovalSender:createPOApprovalSender};
