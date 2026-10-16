const {createHash}=require('node:crypto');
const NEVER=Number.MAX_SAFE_INTEGER;
const fingerprintFault=()=>Error('expense_fingerprint_unavailable');
// Firestore maps are unordered. Encode values by their persisted meaning rather than
// enumerable SDK internals; tagged maps cannot collide with arrays or typed values.
function canonical(value,seen=new Set(),depth=0) {
 if(depth>64)throw fingerprintFault();
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:['number',String(value)];
 if(!value||typeof value!=='object'||seen.has(value))throw fingerprintFault();
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw fingerprintFault();const ms=value.getTime(),seconds=Math.floor(ms/1000);return ['timestamp',seconds,(ms-seconds*1000)*1000000];}
 if(value instanceof Uint8Array)return ['bytes',Buffer.from(value).toString('base64')];
 const proto=Object.getPrototypeOf(value);
 if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null){
  // Only nonplain SDK instances qualify; ordinary legacy maps keep every field.
  const type=value.constructor?.name;
  if(type==='Timestamp'&&Number.isSafeInteger(value.seconds)&&Number.isInteger(value.nanoseconds)&&typeof value.toDate==='function')return['timestamp',value.seconds,value.nanoseconds];
  if(type==='DocumentReference'&&typeof value.path==='string'&&value.firestore)return['reference',value.firestore.projectId,value.firestore.databaseId??'(default)',value.path];
  if(type==='GeoPoint'&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude))return['geopoint',value.latitude,value.longitude];
  if(type==='VectorValue'&&typeof value.toArray==='function')return['vector',canonical(value.toArray(),seen,depth+1)];
  throw fingerprintFault();
 }
 seen.add(value);
 try{return Array.isArray(value)?['array',value.map(row=>canonical(row,seen,depth+1))]:['map',Object.keys(value).sort().map(key=>[key,canonical(value[key],seen,depth+1)])];}finally{seen.delete(value);}
}
const expenseFingerprint=visit=>createHash('sha256').update(JSON.stringify(canonical([visit.startDate??visit.date??null,visit.endDate??visit.date??null,visit.attendees??null,visit.location??null,visit.purpose??null,visit.expenses??null,visit.totalCost??null,visit.createdBy??null]))).digest('hex');
// Mail labels are bounded single lines; the authoritative record/fingerprint retains all original text.
const label=(value,fallback='',max=500)=>{
 const clean=typeof value==='string'?value.replace(/[\x00-\x1f\x7f]+/g,' ').replace(/ +/g,' ').trim():'';
 return clean?clean.length>max?`${clean.slice(0,max-1)}…`:clean:fallback;
};
const fmtDate=iso=>new Date(iso+'T00:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
function visitDateRange(visit) {
 const start=visit.startDate??visit.date??'',end=visit.endDate??visit.date??'';
 if(!start)return '—';if(start===end)return fmtDate(start);
 const s=new Date(start+'T00:00:00Z'),e=new Date(end+'T00:00:00Z');
 if(s.getUTCMonth()===e.getUTCMonth()&&s.getUTCFullYear()===e.getUTCFullYear())return `${s.getUTCDate()}–${e.getUTCDate()} ${e.toLocaleDateString('en-IN',{month:'short',year:'numeric',timeZone:'UTC'})}`;
 return `${fmtDate(start)} – ${fmtDate(end)}`;
}
function expensePayload({projectId,visitId,mode,project,visit,actor}) {
 return {mode,projectId,projectName:label(project.projectName,projectId),visitId,visitDates:label(visitDateRange(visit)),visitLocation:label(visit.location),visitPurpose:label(visit.purpose),visitTotal:Number.isFinite(visit.totalCost)?visit.totalCost:null,actorName:label(actor.displayName||actor.email,'A team member',300),submitterUid:visit.createdBy||null};
}
function createExpenseApprovalJob({projectId,visitId,operationId,mode,project,visit,actor,at,createdMs}) {
 if(!['submitted','approved','rejected'].includes(mode))return null;
 const id=createHash('sha256').update(JSON.stringify([projectId,operationId,mode])).digest('hex'),skipped=mode!=='submitted'&&!visit.createdBy;
 return {id,record:{schema:1,project_id:projectId,visit_id:visitId,operation_id:operationId,kind:`expense_${mode}`,actor_uid:actor.uid,event_fingerprint:expenseFingerprint(visit),state:skipped?'skipped':'pending',...(skipped?{problem:'no_owner'}:{}),created_at:at,created_ms:createdMs,next_attempt_ms:skipped?NEVER:createdMs,payload:expensePayload({projectId,visitId,mode,project,visit,actor})}};
}
module.exports={createExpenseApprovalJob,expenseFingerprint,expensePayload,NEVER};
