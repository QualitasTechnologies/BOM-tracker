const {createHash}=require('node:crypto');
const {assertDocumentBudget}=require('./materialCommands.cjs');
const PUBLIC=Symbol('project-document-fault');
const fault=(code,status=400)=>Object.assign(Error(code),{code,status,[PUBLIC]:true});
const isFault=error=>!!error?.[PUBLIC];
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const validId=value=>typeof value==='string'&&!!value.trim()&&value.length<=512&&!/[\/\x00-\x1f\x7f]/.test(value)&&!['.','..'].includes(value)&&!/^__.*__$/.test(value);
const version=snapshot=>snapshot.exists?`${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`:'missing';
const validVersion=value=>value==='missing'||typeof value==='string'&&/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value.split(':')[0]))&&Number(value.split(':')[1])<1e9;
const TYPES=['vendor-quote','vendor-po','customer-po','vendor-invoice','spec-sheet'];
const MAX_BYTES=10*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const typeAccess=(type,actor)=>{if(type==='customer-po'&&actor.customClaims.role!=='admin')throw fault('project_document_forbidden',403);};
const projectAccess=(project,actor,projectId)=>{
 if(project.projectId&&project.projectId!==projectId)throw fault('project_document_project_identity_conflict',409);
 if(actor.customClaims.role!=='admin'&&project.memberIds!=null&&(!Array.isArray(project.memberIds)||!project.memberIds.includes(actor.uid)))throw fault('project_document_forbidden',403);
};
function assertDeletion(document,bom,project,actor){
 typeAccess(document.type,actor);
 if(document.linkedBOMItems!==undefined&&(!Array.isArray(document.linkedBOMItems)||!document.linkedBOMItems.every(validId)))throw fault('invalid_project_document_state',409);
 const categories=bom?.categories??[];
 if(!Array.isArray(categories)||categories.some(category=>!plain(category)||typeof category.name!=='string'||!Array.isArray(category.items)||category.items.some(item=>!plain(item)||!validId(item.id))))throw fault('invalid_project_document_state',409);
 const ids=document.linkedBOMItems||[],items=categories.flatMap(category=>category.items.map(item=>({item,category:category.name})));
 const field={'vendor-quote':'linkedQuoteDocumentId','vendor-po':'linkedPODocumentId','vendor-invoice':'linkedInvoiceDocumentId'}[document.type];
 const linked=items.filter(({item})=>ids.includes(item.id)||field&&item[field]===document.id);
 if(actor.customClaims.role!=='admin'&&!actor.email.toLowerCase().endsWith('@qualitastech.com')){
  const member=(Array.isArray(project.members)?project.members:[]).find(row=>row.userId===actor.uid),scope=member?.categoryScope;
  if((linked.length||ids.length)&&(!Array.isArray(scope)||linked.some(row=>!scope.includes(row.category))||ids.some(id=>!items.some(row=>row.item.id===id))))throw fault('project_document_forbidden',403);
 }
 if(document.type==='vendor-po'&&linked.some(({item})=>item.status==='ordered')||document.type==='vendor-invoice'&&linked.some(({item})=>item.status==='received'))throw fault('project_document_delete_blocked',409);
}
function view(id,data){
 const output={id};
 // Never pass raw Firestore values to the callable encoder: references can
 // contain an SDK client and its credentials. Raw originals stay in archives.
 for(const key of ['projectId','name','url','type','uploadedBy','sourceUrl']){
  if(typeof data[key]==='string')output[key]=data[key];
  else if(data[key]!==undefined&&key!=='sourceUrl')throw fault('invalid_project_document_state',409);
 }
 if(data.linkedBOMItems!==undefined){
  if(!Array.isArray(data.linkedBOMItems)||!data.linkedBOMItems.every(validId))throw fault('invalid_project_document_state',409);
  output.linkedBOMItems=[...data.linkedBOMItems];
 }
 if(Number.isSafeInteger(data.fileSize)&&data.fileSize>=0)output.fileSize=data.fileSize;
 let at=data.uploadedAt;try{if(at&&typeof at.toDate==='function')at=at.toDate();output.uploadedAt=at instanceof Date?at.toISOString():typeof at==='string'&&Number.isFinite(Date.parse(at))?new Date(at).toISOString():null;}catch{output.uploadedAt=null;}
 if(data.pulseNativeDocument)output.pulseNativeDocument=Object.fromEntries(['operation_id','path','generation'].filter(key=>typeof data.pulseNativeDocument[key]==='string').map(key=>[key,data.pulseNativeDocument[key]]));
 return output;
}
const projectDocumentsEnabled=env=>['BOM_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_PROJECT_DOCUMENTS_ENABLED'].every(key=>env[key]==='true');
// Conservative size-only projections; archive writes retain the original SDK values.
const budgetValue=value=>{
 if(value?.constructor?.name==='DocumentReference'&&typeof value.path==='string')return `projects/${value.firestore?.projectId||'unknown-project'}/databases/(default)/documents/${value.path}`;
 if(value?.constructor?.name==='GeoPoint')return Buffer.alloc(16);
 if(value?.constructor?.name==='VectorValue'&&typeof value.toArray==='function')return Buffer.alloc(value.toArray().length*8+64);
 return Array.isArray(value)?value.map(budgetValue):plain(value)?Object.fromEntries(Object.entries(value).map(([key,row])=>[key,budgetValue(row)])):value;
};
const budget=documents=>assertDocumentBudget(documents.map(row=>({...row,data:budgetValue(row.data)})));
module.exports={fault,isFault,plain,validId,version,validVersion,TYPES,MAX_BYTES,hash,typeAccess,projectAccess,assertDeletion,view,projectDocumentsEnabled,budget};
