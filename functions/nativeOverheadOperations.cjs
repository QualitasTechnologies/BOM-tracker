const {createHash}=require('node:crypto');
const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {assertDocumentBudget,MAX_INPUT_BYTES}=require('./materialCommands.cjs');
const {applyOverheadCommand,validateOverheadCommand,isOverheadFault}=require('./overheadCommands.cjs');
const {createExpenseApprovalJob}=require('./expenseApprovalOutbox.cjs');
const PUBLIC=Symbol('overhead-operation');
const fault=(code,status=400)=>Object.assign(Error(code),{code,status,[PUBLIC]:true});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&!!value.trim()&&value.length<=512&&!/[\/\x00-\x1f\x7f]/.test(value)&&!['.','..'].includes(value)&&!/^__.*__$/.test(value);
const sort=value=>Array.isArray(value)?value.map(sort):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
const version=snapshot=>snapshot.exists?`${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`:'missing';
const validVersion=value=>typeof value==='string'&&/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value.split(':')[0]))&&Number(value.split(':')[1])<1e9;
const access=(project,actor)=>{if(actor.customClaims.role!=='admin'&&project.memberIds!=null&&(!Array.isArray(project.memberIds)||!project.memberIds.includes(actor.uid)))throw fault('overhead_forbidden',403);};
const overheadMutationsEnabled=env=>['BOM_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_OVERHEAD_MUTATIONS_ENABLED'].every(key=>env[key]==='true');
// Only transport output and size estimates are converted. All writes/archive originals retain SDK types.
const transport=value=>{
  if(value instanceof Date)return value.toISOString();
  if(value&&typeof value.toDate==='function')return value.toDate().toISOString();
  // Callable encoding enumerates class internals. Never return an SDK connection object.
  if(value?.constructor?.name==='DocumentReference'&&typeof value.path==='string')return{__type:'reference',path:value.path};
  if(value?.constructor?.name==='GeoPoint')return{latitude:value.latitude,longitude:value.longitude};
  if(value?.constructor?.name==='VectorValue'&&typeof value.toArray==='function')return value.toArray();
  if(Buffer.isBuffer(value)||value instanceof Uint8Array)return{__type:'bytes',base64:Buffer.from(value).toString('base64')};
  if(Array.isArray(value))return value.map(transport);
  if(plain(value))return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,transport(row)]));
  if(value&&typeof value==='object')throw fault('invalid_overhead_state',409);
  return value;
};
const budgetValue=value=>{
  if(value?.constructor?.name==='DocumentReference'&&typeof value.path==='string')return `projects/${value.firestore?.projectId||'unknown-project'}/databases/(default)/documents/${value.path}`;
  if(value?.constructor?.name==='GeoPoint')return Buffer.alloc(16);
  if(value?.constructor?.name==='VectorValue'&&typeof value.toArray==='function')return Buffer.alloc(value.toArray().length*8+64);
  return Array.isArray(value)?value.map(budgetValue):plain(value)?Object.fromEntries(Object.entries(value).map(([key,row])=>[key,budgetValue(row)])):value;
};
const budget=documents=>assertDocumentBudget(documents.map(row=>({...row,data:budgetValue(row.data)})));
function rowsOf(doc,key){const rows=doc[key]===undefined?[]:doc[key];if(!Array.isArray(rows)||rows.some(row=>!plain(row)||!id(row.id))||new Set(rows.map(row=>row.id)).size!==rows.length)throw fault('invalid_overhead_state',409);return rows;}
function createNativeOverheadOperations({db,auth,enabled=false,getServerTimestamp,now=()=>new Date()}){
  const on=()=>(typeof enabled==='function'?enabled():enabled)===true;
  async function actorOf(request){try{return await currentNativeActor(auth,request);}catch(error){const codes={actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503};if(Object.hasOwn(codes,error?.code)&&codes[error.code]===error.status)throw fault(error.code,error.status);throw error;}}
  return async request=>{
    try{
      const actor=await actorOf(request),data=request.data;
      if(!plain(data)||!['get','command'].includes(data.operation)||!id(data.project_id))throw fault('invalid_overhead_request');
      const writing=data.operation==='command',resolving=data.resolve_only===true;
      const keys=['operation','project_id','expected_actor_uid',...(writing?['expected_project_version','expected_version','operation_id','command','resolve_only']:[])];
      if(Object.keys(data).some(key=>!keys.includes(key))||Buffer.byteLength(JSON.stringify(data),'utf8')>MAX_INPUT_BYTES)throw fault('invalid_overhead_request');
      if(data.expected_actor_uid!==actor.uid)throw fault('actor_session_changed',403);
      if(writing&&(!validVersion(data.expected_project_version)||data.expected_version!=='missing'&&!validVersion(data.expected_version)||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)||Object.hasOwn(data,'resolve_only')&&!resolving))throw fault('invalid_overhead_request');
      if(writing)validateOverheadCommand(data.command);
      const projectRef=db.collection('projects').doc(data.project_id),overheadsRef=projectRef.collection('overheads').doc('data');
      const journal=db.collection('pulseOverheadOperations').doc(data.project_id),receiptRef=writing?journal.collection('receipts').doc(data.operation_id):null;
      const {resolve_only:_resolve,...hashBody}=data,payloadHash=hash(hashBody);
      return await db.runTransaction(async tx=>{
        const project=await tx.get(projectRef);if(!project.exists)throw fault('overhead_project_not_found',404);
        const projectData=project.data();if(projectData.projectId&&projectData.projectId!==data.project_id)throw fault('overhead_project_identity_conflict',409);access(projectData,actor);
        const receipt=receiptRef?await tx.get(receiptRef):null;
        const verified=async()=>{const current=await actorOf(request);if(current.uid!==actor.uid||current.email!==actor.email)throw fault('actor_session_changed',403);access(projectData,current);return current;};
        if(receipt?.exists){await verified();const old=receipt.data();if(old.actor_uid!==actor.uid||old.payload_hash!==payloadHash)throw fault('operation_conflict',409);if(resolving)return{...old.result,resolution:old.cancelled?'cancelled':'committed'};if(old.cancelled)throw fault('overhead_request_cancelled',409);return old.result;}
        if(resolving){
          const current=await verified(),result={ok:true,project_id:data.project_id,operation_id:data.operation_id,kind:data.command.kind,record_id:data.command.record_id};
          const stored={actor_uid:current.uid,payload_hash:payloadHash,cancelled:true,result,at:getServerTimestamp()},auditRef=journal.collection('audit').doc(data.operation_id),audit={phase:'cancelled',actor_uid:current.uid,actor_email:current.email,command_kind:data.command.kind,record_id:data.command.record_id,payload_hash:payloadHash,at:getServerTimestamp()};
          budget([{path:receiptRef.path,data:stored},{path:auditRef.path,data:audit}]);tx.create(receiptRef,stored);tx.create(auditRef,audit);return{...result,resolution:'cancelled'};
        }
        const overheads=await tx.get(overheadsRef),control=await tx.get(db.collection('pulseRuntimeControl').doc('cutover'));
        const raw=overheads.exists?overheads.data():{},travelVisits=rowsOf(raw,'travelVisits'),otherEntries=rowsOf(raw,'otherEntries');
        const current=await verified(),mode=control.exists?control.data()?.mode:'coexist',allowed=on()&&['coexist','pulse_only'].includes(mode);
        if(!writing)return{ok:true,project_id:data.project_id,project:{projectId:data.project_id,projectName:typeof projectData.projectName==='string'&&projectData.projectName?projectData.projectName:data.project_id},overheads:transport({travelVisits,otherEntries}),version:version(overheads),project_version:version(project),permissions:{edit:allowed,review:allowed&&current.customClaims.role==='admin'}};
        if(!allowed)throw fault(['coexist','pulse_only','read_only'].includes(mode)?'overhead_mutations_disabled':'overhead_control_unavailable',503);
        if(version(project)!==data.expected_project_version||version(overheads)!==data.expected_version)throw fault('overhead_version_conflict',409);
        if(data.command.kind==='review_visit'&&current.customClaims.role!=='admin')throw fault('overhead_review_forbidden',403);
        const type=data.command.kind.endsWith('_entry')?'entry':'visit',rows=type==='entry'?otherEntries:travelVisits,before=rows.find(row=>row.id===data.command.record_id)||null;
        if(['add_visit','edit_visit'].includes(data.command.kind)){
          const members=Array.isArray(projectData.memberIds)?projectData.memberIds:Array.isArray(projectData.members)?projectData.members.map(row=>row.userId):[current.uid];
          const previous=Array.isArray(before?.attendees)?before.attendees:[];
          // The original form preselects the current user, including an admin who
          // can open the project without a membership row.
          if(data.command.input.attendees.some(uid=>uid!==current.uid&&!members.includes(uid)&&!previous.includes(uid)))throw fault('overhead_attendee_forbidden',403);
        }
        const archiveRef=db.collection('pulseDeletedOverheads').doc(data.project_id).collection('records').doc(`${type}-${data.command.record_id}`);
        if(data.command.kind.startsWith('add_')||data.command.kind.startsWith('delete_'))if((await tx.get(archiveRef)).exists)throw fault('overhead_identity_used',409);
        const clock=now(),plan=applyOverheadCommand({project:{...projectData,projectId:data.project_id},overheads:raw,command:data.command,actor:{uid:current.uid,email:current.email,displayName:current.displayName},now:clock});
        const final=await verified();if(!on())throw fault('overhead_mutations_disabled',503);if(data.command.kind==='review_visit'&&final.customClaims.role!=='admin')throw fault('overhead_review_forbidden',403);
        const at=getServerTimestamp(),result={ok:true,project_id:data.project_id,operation_id:data.operation_id,...plan.result};
        const notification=plan.notification?createExpenseApprovalJob({projectId:data.project_id,visitId:data.command.record_id,operationId:data.operation_id,mode:plan.notification.mode,project:projectData,visit:plan.notification.visit,actor:final,at,createdMs:clock.getTime()}):null;
        if(notification){plan.overheads.travelVisits=plan.overheads.travelVisits.map(row=>row.id===data.command.record_id?{...row,nativeExpenseNotificationId:notification.id}:row);if(notification.record.state==='pending')result.notification_id=notification.id;}
        const notificationRef=notification?db.collection('pulseExpenseApprovalNotifications').doc(notification.id):null;
        const after=(type==='entry'?plan.overheads.otherEntries:plan.overheads.travelVisits).find(row=>row.id===data.command.record_id)||null;
        const stored={actor_uid:final.uid,payload_hash:payloadHash,result,at},auditRef=journal.collection('audit').doc(data.operation_id);
        const audit={phase:'committed',actor_uid:final.uid,actor_email:final.email,command_kind:data.command.kind,record_id:data.command.record_id,record_type:type,before,after,payload_hash:payloadHash,overhead_version:version(overheads),project_version:version(project),...(notification?{notification_job_id:notification.id,notification_state:notification.record.state}:{}),at};
        const archive=plan.removed?{project_id:data.project_id,record_type:type,record_id:data.command.record_id,operation_id:data.operation_id,actor_uid:final.uid,actor_email:final.email,record:before,at}:null;
        budget([{path:overheadsRef.path,data:plan.overheads},{path:receiptRef.path,data:stored},{path:auditRef.path,data:audit},...(archive?[{path:archiveRef.path,data:archive}]:[]),...(notification?[{path:notificationRef.path,data:notification.record}]:[])]);
        tx.set(overheadsRef,plan.overheads);if(archive)tx.create(archiveRef,archive);tx.create(receiptRef,stored);tx.create(auditRef,audit);if(notification)tx.create(notificationRef,notification.record);return result;
      },{readOnly:!writing});
    }catch(error){return{ok:false,error:error?.[PUBLIC]||isOverheadFault(error)?error.code:'overhead_service_unavailable',status:error?.[PUBLIC]||isOverheadFault(error)?error.status:503};}
  };
}
module.exports={createNativeOverheadOperations,overheadMutationsEnabled};
