const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {approvalFingerprint}=require('./poApprovalOutbox.cjs');
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\/\x00-\x1f]/.test(value)&&!['.','..'].includes(value);
const timeKey=value=>value instanceof Date?`${Math.floor(value.getTime()/1000)}:${value.getMilliseconds()*1000000}`
  :value&&Number.isSafeInteger(value.seconds)&&Number.isInteger(value.nanoseconds)?`${value.seconds}:${value.nanoseconds}`:null;
async function managedApprovalNotification({db,auth,request,data}) {
  if(!id(data?.projectId)||!id(data?.poId)||!['submitted','changes-requested'].includes(data.mode))return null;
  return db.runTransaction(async tx=>{
    const projectRef=db.collection('projects').doc(data.projectId),po=await tx.get(projectRef.collection('purchaseOrders').doc(data.poId));
    if(!po.exists||!po.data().nativeApprovalNotificationId)return null;
    const pointer=po.data().nativeApprovalNotificationId;if(typeof pointer!=='string'||!/^[a-f0-9]{64}$/.test(pointer))throw Error('Native notification event changed; reopen in Pulse');
    const job=await tx.get(db.collection('pulsePOApprovalNotifications').doc(pointer)),project=await tx.get(projectRef),actor=await currentNativeActor(auth,request);
    if(!project.exists||actor.customClaims.role!=='admin'&&(!Array.isArray(project.data().memberIds)||!project.data().memberIds.includes(actor.uid)))throw Error('Project forbidden');
    const eventAt=data.mode==='submitted'?po.data().submittedForApprovalAt:po.data().changesRequestedAt;
    if(!job.exists||job.data().project_id!==data.projectId||job.data().po_id!==data.poId||job.data().actor_uid!==actor.uid||job.data().payload.mode!==data.mode
      ||!timeKey(eventAt)||timeKey(eventAt)!==timeKey(job.data().created_at)||approvalFingerprint(po.data())!==job.data().event_fingerprint)throw Error('Native notification event changed; reopen in Pulse');
    return{success:true,queued:true,notificationId:pointer};
  });
}
async function legacyApprovalSendingAllowed(db) {
  return db.runTransaction(async tx=>{const control=await tx.get(db.collection('pulseRuntimeControl').doc('cutover'));return !control.exists||control.data()?.mode==='coexist';});
}
module.exports={managedApprovalNotification,legacyApprovalSendingAllowed};
