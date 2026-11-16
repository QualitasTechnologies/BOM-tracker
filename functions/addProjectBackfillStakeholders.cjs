const {randomUUID}=require('node:crypto');
const {buildBackfillJobFields,buildBackfillSearchQuery}=require('./contactDiscovery.js');
const PUBLIC=Symbol('backfill-registration');
const normalized=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
const validId = value => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const dateOf=value=>value?.toDate?value.toDate():new Date(value);
function createAddProjectBackfillStakeholders({db,resolveActor,getServerTimestamp,getDeleteField,now=()=>new Date(),lookbackMs=365*24*60*60*1000,logger={info(){}},createError=(code,message)=>Object.assign(new Error(message),{code})}){
 const fail=(code,message)=>{const error=createError(code,message);error[PUBLIC]=true;throw error;};
 const actorOf=async request=>{
  let actor;try{actor=await resolveActor(request);}catch(error){if(error.code==='actor_authentication_required')fail('unauthenticated','Authentication required');if(error.code==='actor_forbidden')fail('permission-denied','Approved access is required');fail('unavailable','Account verification is unavailable');}
  if(!actor||actor.uid!==request.auth?.uid||actor.disabled||actor.customClaims?.status!=='approved'||!['admin','user','viewer'].includes(actor.customClaims?.role)||!validEmail(normalized(actor.email)))fail('permission-denied','Approved access is required');
  return actor;
 };
 const access=(project,actor)=>{if(actor.customClaims.role!=='admin'&&!(Object.hasOwn(project,'memberIds')&&project.memberIds===null)&&!(Array.isArray(project.memberIds)&&project.memberIds.includes(actor.uid)))fail('permission-denied','You are not a member of this project');};
 const batchQuery=job=>{
  const completed=new Set(job.completedContacts||[]),batch=(job.contacts||[]).filter(email=>!completed.has(email)).slice(0,25);if(!batch.length)return null;
  const since=dateOf(job.sinceDate);if(!Number.isFinite(since.getTime()))fail('failed-precondition','The existing backfill date needs review');return buildBackfillSearchQuery(batch,since);
 };
 return async request=>{
  try{
   const actor=await actorOf(request),{projectId,contacts}=request.data||{};
   if(!validId(projectId)||!Array.isArray(contacts)||!contacts.length)fail('invalid-argument','projectId and a non-empty contacts array are required');
   const unique=new Map();for(const contact of contacts){const email=normalized(contact?.email);if(!validEmail(email))fail('invalid-argument','Valid contact emails are required');if(!unique.has(email))unique.set(email,{email,name:typeof contact.name==='string'?contact.name.trim():''});}
   const selected=[...unique.values()],projectRef=db.collection('projects').doc(projectId),jobRef=db.collection('emailBackfillJobs').doc(projectId),controlRef=db.collection('pulseRuntimeControl').doc('cutover'),auditRef=db.collection('pulseProjectBackfillOperations').doc(randomUUID());
   const result=await db.runTransaction(async tx=>{
    const snapshot=await tx.get(projectRef),jobSnapshot=await tx.get(jobRef),control=await tx.get(controlRef);
    if(!snapshot.exists)fail('not-found','Project not found');const project=snapshot.data();
    if(project.projectId&&project.projectId!==projectId)fail('failed-precondition','The project identity needs review');
    const current=await actorOf(request);if(current.uid!==actor.uid||normalized(current.email)!==normalized(actor.email))fail('permission-denied','The signed-in account changed');access(project,current);
    const controlData=control.exists?control.data():{},mode=Object.hasOwn(controlData,'mode')?controlData.mode:'coexist';if(!['coexist','pulse_only'].includes(mode))fail('failed-precondition','Project communications are read-only');
    const recipients=project.externalRecipients??[],completed=project.backfilledContactEmails??[];
    if(!Array.isArray(recipients)||recipients.some(row=>!row||!validEmail(normalized(row.email)))||!Array.isArray(completed)||completed.some(email=>!validEmail(normalized(email))))fail('failed-precondition','The existing contact records need review');
    const existingEmails=new Set(recipients.map(row=>normalized(row.email))),addedRecipients=selected.filter(row=>!existingEmails.has(row.email)).map(row=>({...row,notificationsEnabled:false}));
    const completedEmails=new Set(completed.map(normalized)),pending=selected.filter(row=>!completedEmails.has(row.email)).map(row=>row.email),existing=jobSnapshot.exists?jobSnapshot.data():null;
    if(existing&&(!Array.isArray(existing.contacts)||existing.contacts.some(email=>!validEmail(normalized(email)))||!Array.isArray(existing.completedContacts)||existing.completedContacts.some(email=>!validEmail(normalized(email)))))fail('failed-precondition','The existing backfill work needs review');
    if(existing&&pending.length&&(!validId(existing.requestedByUid)||existing.sinceDate==null||!Number.isFinite(dateOf(existing.sinceDate).getTime())))fail('failed-precondition','The original backfill mailbox or date needs review');
    const queued=new Set((existing?.contacts||[]).map(normalized)),newContacts=pending.filter(email=>!queued.has(email)),jobChanged=pending.length>0&&(!existing||newContacts.length>0||!['pending','running'].includes(existing.status));
    let fields,queryChanged=false;
    if(jobChanged){
     fields=buildBackfillJobFields({existingJob:existing,pendingContactEmails:newContacts,requestedByUid:current.uid,defaultSinceDate:new Date(now().getTime()-lookbackMs)});
     if(existing){fields.requestedByUid=existing.requestedByUid;fields.sinceDate=existing.sinceDate;}
     queryChanged=!!existing&&batchQuery(existing)!==batchQuery(fields);if(queryChanged)fields.pageToken=getDeleteField();fields.updatedAt=getServerTimestamp();
    }
    // All project/job reads and identity checks precede any write. A concurrent
    // preference edit retries this merge against the latest entire recipient list.
    if(addedRecipients.length)tx.update(projectRef,{externalRecipients:[...recipients,...addedRecipients]});
    if(jobChanged)tx.set(jobRef,fields,{merge:true});
    if(addedRecipients.length||jobChanged)tx.create(auditRef,{actor_uid:current.uid,actor_email:normalized(current.email),project_id:projectId,operation:'backfill_stakeholders_registered',added_recipients:addedRecipients,queued_contacts:newContacts,requested_contacts:pending,job_owner_uid:fields?.requestedByUid||existing?.requestedByUid||current.uid,previous_job_status:existing?.status||null,query_cursor_invalidated:queryChanged,created_at:getServerTimestamp()});
    return{queuedContactCount:pending.length};
   });
   logger.info('addProjectBackfillStakeholders: queued',{projectId,queuedContactCount:result.queuedContactCount,by:actor.uid});return result;
  }catch(error){if(error?.[PUBLIC])throw error;throw createError('unavailable','Backfill registration could not be confirmed. Retry the same contacts.');}
 };
}
module.exports={createAddProjectBackfillStakeholders};
