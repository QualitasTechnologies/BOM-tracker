const {createHash}=require('node:crypto');
const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {assertDocumentBudget,MAX_INPUT_BYTES}=require('./materialCommands.cjs');
const {applyMilestoneCommand,isMilestoneFault,validateMilestoneCommand}=require('./milestoneCommands.cjs');
const PUBLIC=Symbol('milestone-operation');
const fault=(code,status=400)=>Object.assign(Error(code),{code,status,[PUBLIC]:true});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&!!value.trim()&&value.length<=512&&!/[\/\x00-\x1f]/.test(value)&&!['.','..'].includes(value)&&!/^__.*__$/.test(value);
const sort=value=>Array.isArray(value)?value.map(sort):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
const version=snapshot=>snapshot.exists?`${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`:'missing';
const validVersion=value=>typeof value==='string'&&/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value.split(':')[0]))&&Number(value.split(':')[1])<1e9;
const freeze=value=>value instanceof Date?value.toISOString():value&&typeof value.toDate==='function'?value.toDate().toISOString():Array.isArray(value)?value.map(freeze):plain(value)?Object.fromEntries(Object.entries(value).map(([key,row])=>[key,freeze(row)])):value;
const access=(project,actor,scoped)=>{
  if(actor.customClaims.role==='admin')return;
  if(scoped ? !Object.hasOwn(project,'memberIds') || project.memberIds!==null&&(!Array.isArray(project.memberIds)||!project.memberIds.includes(actor.uid))
    : project.memberIds!=null&&(!Array.isArray(project.memberIds)||!project.memberIds.includes(actor.uid)))throw fault('milestone_forbidden',403);
};
const milestoneMutationsEnabled=env=>['BOM_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MILESTONE_MUTATIONS_ENABLED'].every(key=>env[key]==='true');
const fieldsFor=command=>command.kind==='baseline_lock'?['originalPlannedEndDate','updatedAt']:command.kind==='reorder'?['order','updatedAt']:command.kind==='date'?['currentPlannedEndDate','updatedAt']:command.kind==='edit'?[...Object.keys(command.patch),'updatedAt']:command.kind==='status'?['status',...(command.status==='completed'?['actualEndDate']:[]),...(Object.hasOwn(command,'progress_note')?['lastProgressNote','lastProgressDate']:[]),'updatedAt']:[];
function createNativeMilestoneOperations({db,auth,enabled=false,scopedReadsEnabled=false,getServerTimestamp,now=()=>new Date()}){
  const on=()=>(typeof enabled==='function'?enabled():enabled)===true;
  const scopedOn=()=>(typeof scopedReadsEnabled==='function'?scopedReadsEnabled():scopedReadsEnabled)===true;
  async function actorOf(request){try{return await currentNativeActor(auth,request);}catch(error){const codes={actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503};if(Object.hasOwn(codes,error?.code)&&codes[error.code]===error.status)throw fault(error.code,error.status);throw error;}}
  return async request=>{
    try{
      const actor=await actorOf(request),data=request.data;
      if(!plain(data)||!['get','command'].includes(data.operation)||!id(data.project_id))throw fault('invalid_milestone_request');
      const keys=['operation','project_id','expected_actor_uid',...(data.operation==='command'?['expected_project_version','expected_schedule_version','operation_id','command','resolve_only']:[])];
      if(Object.keys(data).some(key=>!keys.includes(key))||Buffer.byteLength(JSON.stringify(data),'utf8')>MAX_INPUT_BYTES)throw fault('invalid_milestone_request');
      if(data.expected_actor_uid!==actor.uid)throw fault('actor_session_changed',403);
      const writing=data.operation==='command',resolving=data.resolve_only===true;
      if(writing&&(!validVersion(data.expected_project_version)||typeof data.expected_schedule_version!=='string'||!/^[a-f0-9]{64}$/.test(data.expected_schedule_version)||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)||!plain(data.command)||!['add','edit','status','date','delete','reorder','template','baseline_lock'].includes(data.command.kind)||Object.hasOwn(data,'resolve_only')&&!resolving))throw fault('invalid_milestone_request');
      if(writing)validateMilestoneCommand(data.command);
      const projectRef=db.collection('projects').doc(data.project_id),milestonesRef=projectRef.collection('milestones');
      const journal=db.collection('pulseMilestoneOperations').doc(data.project_id),stateRef=journal.collection('state').doc('revision');
      const receiptRef=writing?journal.collection('receipts').doc(data.operation_id):null;
      const {resolve_only:_resolve,...hashBody}=data,payloadHash=hash(hashBody);
      return await db.runTransaction(async tx=>{
        const project=await tx.get(projectRef);if(!project.exists)throw fault('milestone_project_not_found',404);
        if(project.data().projectId&&project.data().projectId!==data.project_id)throw fault('milestone_project_identity_conflict',409);
        access(project.data(),actor,scopedOn());
        const receipt=receiptRef?await tx.get(receiptRef):null;
        const verified=async()=>{const current=await actorOf(request);if(current.uid!==actor.uid||current.email!==actor.email)throw fault('actor_session_changed',403);access(project.data(),current,scopedOn());return current;};
        if(receipt?.exists){
          await verified();const old=receipt.data();if(old.actor_uid!==actor.uid||old.payload_hash!==payloadHash)throw fault('operation_conflict',409);
          if(resolving)return{...old.result,resolution:old.cancelled?'cancelled':'committed'};
          if(old.cancelled)throw fault('milestone_request_cancelled',409);return old.result;
        }
        if(resolving){
          const current=await verified(),result={ok:true,project_id:data.project_id,operation_id:data.operation_id,kind:data.command.kind,...(data.command.milestone_id?{milestone_id:data.command.milestone_id}:{})};
          const record={actor_uid:current.uid,payload_hash:payloadHash,cancelled:true,result,at:getServerTimestamp()};
          const auditRef=journal.collection('audit').doc(data.operation_id),audit={phase:'cancelled',actor_uid:current.uid,command_kind:data.command.kind,payload_hash:payloadHash,at:getServerTimestamp()};
          assertDocumentBudget([{path:receiptRef.path,data:record},{path:auditRef.path,data:audit}]);tx.create(receiptRef,record);tx.create(auditRef,audit);return{...result,resolution:'cancelled'};
        }
        const query=await tx.get(milestonesRef.limit(401)),state=await tx.get(stateRef),control=await tx.get(db.collection('pulseRuntimeControl').doc('cutover'));
        if(query.docs.length>400)throw fault('milestone_schedule_too_large',409);
        const rows=query.docs.map(snapshot=>({id:snapshot.id,data:snapshot.data(),snapshot})).sort((a,b)=>a.id.localeCompare(b.id));
        const scheduleVersion=hash([version(state),rows.map(row=>[row.id,version(row.snapshot)])]);
        const current=await verified(),mode=control.exists?control.data()?.mode:'coexist',allowed=on()&&['coexist','pulse_only'].includes(mode);
        if(!writing)return{ok:true,project_id:data.project_id,project:freeze({...Object.fromEntries(['projectName','deadline','originalDeadline','isBaselined','baselinedAt','baselinedBy','status'].filter(key=>Object.hasOwn(project.data(),key)).map(key=>[key,project.data()[key]])),projectId:data.project_id}),milestones:rows.map(row=>freeze({...row.data,id:row.id})),project_version:version(project),schedule_version:scheduleVersion,permissions:{edit:allowed}};
        if(!allowed)throw fault(['coexist','pulse_only','read_only'].includes(mode)?'milestone_mutations_disabled':'milestone_control_unavailable',503);
        if(version(project)!==data.expected_project_version||scheduleVersion!==data.expected_schedule_version)throw fault('milestone_version_conflict',409);
        const plan=applyMilestoneCommand({project:{...project.data(),projectId:data.project_id},milestones:rows.map(({id,data})=>({id,data})),command:data.command,actor:{uid:current.uid,email:current.email,displayName:current.displayName},now:now(),operationId:data.operation_id});
        const existing=new Map(rows.map(row=>[row.id,row.data]));
        for(const row of plan.upserts){if(!existing.has(row.id)){const archive=await tx.get(db.collection('pulseDeletedMilestones').doc(data.project_id).collection('milestones').doc(row.id));if(archive.exists)throw fault('milestone_identity_used',409);}}
        const archives=[];
        for(const row of plan.archives){const ref=db.collection('pulseDeletedMilestones').doc(data.project_id).collection('milestones').doc(row.id),before=await tx.get(ref);if(before.exists)throw fault('milestone_identity_used',409);archives.push({ref,data:{...row.data,record:existing.get(row.id)}});}
        const logs=[];
        for(const row of plan.delayLogs){const ref=projectRef.collection('delayLogs').doc(row.id);if((await tx.get(ref)).exists)throw fault('milestone_history_conflict',409);logs.push({ref,data:row.data});}
        const final=await verified();
        const updates=plan.upserts.map(row=>({id:row.id,ref:milestonesRef.doc(row.id),create:!existing.has(row.id),data:existing.has(row.id)?Object.fromEntries(fieldsFor(data.command).filter(key=>Object.hasOwn(row.data,key)).map(key=>[key,row.data[key]])):row.data}));
        const generation=state.exists?state.data().generation:0;if(!Number.isSafeInteger(generation)||generation<0||generation>=Number.MAX_SAFE_INTEGER)throw fault('milestone_state_unavailable',503);
        const statePatch={generation:generation+1,updated_at:getServerTimestamp()};
        const result={ok:true,project_id:data.project_id,operation_id:data.operation_id,...plan.result};
        const stored={actor_uid:final.uid,payload_hash:payloadHash,result,at:getServerTimestamp()};
        const auditRef=journal.collection('audit').doc(data.operation_id),audit={phase:'committed',actor_uid:final.uid,actor_email:final.email,command_kind:data.command.kind,
          project_before:Object.fromEntries(Object.keys(plan.projectPatch).map(key=>[key,project.data()[key]??null])),project_after:plan.projectPatch,
          changes:updates.map(row=>({milestone_id:row.id,before:row.create?null:Object.fromEntries(Object.keys(row.data).map(key=>[key,existing.get(row.id)[key]??null])),after:row.data})),
          deleted_ids:plan.deletes,delay_log_ids:logs.map(row=>row.ref.path.split('/').at(-1)),payload_hash:payloadHash,at:getServerTimestamp()};
        assertDocumentBudget([{path:projectRef.path,data:{...project.data(),...plan.projectPatch}},{path:stateRef.path,data:statePatch},{path:receiptRef.path,data:stored},{path:auditRef.path,data:audit},
          ...updates.map(row=>({path:row.ref.path,data:row.create?row.data:{...existing.get(row.id),...row.data}})),...archives.map(row=>({path:row.ref.path,data:row.data})),...logs.map(row=>({path:row.ref.path,data:row.data}))]);
        if(Object.keys(plan.projectPatch).length)tx.update(projectRef,plan.projectPatch);
        for(const row of updates)row.create?tx.create(row.ref,row.data):tx.update(row.ref,row.data);
        for(const row of archives)tx.create(row.ref,row.data);for(const row of logs)tx.create(row.ref,row.data);for(const row of plan.deletes)tx.delete(milestonesRef.doc(row));
        state.exists?tx.update(stateRef,statePatch):tx.create(stateRef,statePatch);tx.create(receiptRef,stored);tx.create(auditRef,audit);return result;
      },{readOnly:!writing});
    }catch(error){return{ok:false,error:error?.[PUBLIC]||isMilestoneFault(error)?error.code:'milestone_service_unavailable',status:error?.[PUBLIC]||isMilestoneFault(error)?error.status:503};}
  };
}
module.exports={createNativeMilestoneOperations,milestoneMutationsEnabled};
