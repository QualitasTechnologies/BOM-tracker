const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {assertDocumentBudget}=require('./materialCommands.cjs');
const PUBLIC=Symbol('expense-receipt-fault');
const fault=(code,status=400)=>Object.assign(Error(code),{code,status,[PUBLIC]:true});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const validId=value=>typeof value==='string'&&!!value.trim()&&value.length<=512&&!/[\/\x00-\x1f\x7f]/.test(value)&&!['.','..'].includes(value)&&!/^__.*__$/.test(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES=10*1024*1024,TTL=15*60*1000;
const contentType=value=>typeof value==='string'&&(value==='application/pdf'||/^image\/[a-z0-9][a-z0-9.+-]{0,100}$/.test(value));
const expenseReceiptsEnabled=env=>['BOM_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_EXPENSE_RECEIPTS_ENABLED'].every(key=>env[key]==='true');
function createNativeExpenseReceiptOperations({db,auth,bucket,enabled=false,getServerTimestamp,now=()=>new Date()}){
 const on=()=>(typeof enabled==='function'?enabled():enabled)===true;
 const control=(snapshot,replay=false)=>{
  const mode=snapshot.exists?snapshot.data()?.mode:'coexist';
  if(!['coexist','pulse_only','read_only'].includes(mode))throw fault('expense_receipt_control_unavailable',503);
  if(!replay&&(!on()||mode==='read_only'))throw fault('expense_receipt_writes_disabled',503);
 };
 const actorOf=async request=>{try{return await currentNativeActor(auth,request);}catch(error){if(['actor_authentication_required','actor_forbidden','identity_provider_unavailable'].includes(error?.code))throw fault(error.code,error.status);throw error;}};
 return async request=>{
  try{
   const actor=await actorOf(request),data=request.data;
   const ids=['project_id','visit_id','expense_id'],base=['operation',...ids,'operation_id','expected_actor_uid'];
   if(!plain(data)||!['reserve','finalize','cancel'].includes(data.operation)||ids.some(key=>!validId(data[key]))||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)
    ||Object.keys(data).some(key=>![...base,...(data.operation==='reserve'?['content_type','byte_size','sha256']:[])].includes(key)))throw fault('invalid_expense_receipt_request');
   if(data.expected_actor_uid!==actor.uid)throw fault('actor_session_changed',403);
   if(data.operation==='reserve'&&(!contentType(data.content_type)||!Number.isSafeInteger(data.byte_size)||data.byte_size<=0||data.byte_size>=MAX_BYTES||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)))throw fault('invalid_expense_receipt_request');
   const projectRef=db.collection('projects').doc(data.project_id),journal=db.collection('pulseExpenseReceiptUploads').doc(data.project_id),receiptRef=journal.collection('receipts').doc(data.operation_id),controlRef=db.collection('pulseRuntimeControl').doc('cutover');
   const readAccess=async tx=>{
    const project=await tx.get(projectRef),current=await actorOf(request);
    if(current.uid!==actor.uid||current.email.trim().toLowerCase()!==actor.email.trim().toLowerCase())throw fault('actor_session_changed',403);
    if(!project.exists)throw fault('expense_receipt_project_not_found',404);
    const value=project.data();if(value.projectId&&value.projectId!==data.project_id)throw fault('expense_receipt_project_identity_conflict',409);
    if(current.customClaims.role!=='admin'&&value.memberIds!=null&&(!Array.isArray(value.memberIds)||!value.memberIds.includes(current.uid)))throw fault('expense_receipt_forbidden',403);
    return current;
   };
   const assertReceipt=old=>{if(old.actor_uid!==actor.uid||old.actor_email!==actor.email.trim().toLowerCase()||ids.some(key=>old[key]!==data[key]))throw fault('operation_conflict',409);};
   const payloadHash=data.operation==='reserve'?hash(JSON.stringify(ids.map(key=>data[key]).concat([data.content_type,data.byte_size,data.sha256]))):null;
   const opening=await db.runTransaction(async tx=>{
    await readAccess(tx);const receipt=await tx.get(receiptRef),mode=await tx.get(controlRef);
    if(data.operation==='cancel'){
     control(mode,true);
     const old=receipt.exists?receipt.data():null;if(old)assertReceipt(old);
     if(old?.finalized){await readAccess(tx);return{result:{...old.finalized,resolution:'committed'}};}
     if(old?.cancelled){await readAccess(tx);return{result:old.cancelled};}
     const cancelled={ok:true,operation_id:data.operation_id,resolution:'cancelled'},auditRef=journal.collection('audit').doc(data.operation_id+'_cancel');
     const patch={cancelled,...(!old?{actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase(),project_id:data.project_id,visit_id:data.visit_id,expense_id:data.expense_id}:{}),at:getServerTimestamp()};
     const audit={...patch,event:'expense_receipt_cancelled',operation_id:data.operation_id};await readAccess(tx);
     assertDocumentBudget([{path:receiptRef.path,data:{...old,...patch}},{path:auditRef.path,data:audit}]);
     if(old){tx.update(receiptRef,patch);tx.update(db.collection('pulseExpenseReceiptIntents').doc(old.file_name),{state:'cancelled'});}else tx.create(receiptRef,patch);
     tx.create(auditRef,audit);return{result:cancelled};
    }
    if(receipt.exists){
     const old=receipt.data();assertReceipt(old);if(old.cancelled)throw fault('expense_receipt_cancelled',409);if(payloadHash&&old.payload_hash!==payloadHash)throw fault('operation_conflict',409);
     if(old.finalized){control(mode,true);await readAccess(tx);return{result:data.operation==='finalize'?old.finalized:old.reserved};}
     control(mode);if(now().getTime()>=old.expires_at_ms)throw fault('upload_intent_expired',409);await readAccess(tx);
     return data.operation==='reserve'?{result:old.reserved}:{receipt:old};
    }
    control(mode);if(data.operation!=='reserve')throw fault('upload_intent_not_found',404);
    if((await tx.get(db.collection('pulseDeletedOverheads').doc(data.project_id).collection('records').doc('visit-'+data.visit_id))).exists)throw fault('overhead_identity_used',409);
    const fileName=randomBytes(32).toString('hex')+'.bin',path=`projects/${data.project_id}/receipts/native/${fileName}`,expires=now().getTime()+TTL;
    const reserved={ok:true,operation_id:data.operation_id,path,expires_at:new Date(expires).toISOString()};
    const intent={actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase(),project_id:data.project_id,visit_id:data.visit_id,expense_id:data.expense_id,operation_id:data.operation_id,
     path,final_path:`projects/${data.project_id}/receipts/finalized/${fileName}`,content_type:data.content_type,byte_size:data.byte_size,sha256:data.sha256,state:'reserved',expires_at:new Date(expires),expires_at_ms:expires};
    const stored={...intent,file_name:fileName,payload_hash:payloadHash,download_token:randomUUID(),reserved},intentRef=db.collection('pulseExpenseReceiptIntents').doc(fileName),auditRef=journal.collection('audit').doc(data.operation_id+'_reserve');
    const audit={...intent,event:'expense_receipt_reserved',at:getServerTimestamp()};await readAccess(tx);
    assertDocumentBudget([{path:receiptRef.path,data:stored},{path:intentRef.path,data:intent},{path:auditRef.path,data:audit}]);
    tx.create(receiptRef,stored);tx.create(intentRef,intent);tx.create(auditRef,audit);return{result:reserved};
   });
   if(opening.result)return opening.result;const old=opening.receipt;
   // Rules check a staging upload before it finishes; concurrent admitted uploads
   // can both succeed. Only the server-created destination is expense proof.
   const finalPath=`projects/${data.project_id}/receipts/finalized/${old.file_name}`;
   if(old.final_path!==finalPath)throw fault('operation_conflict',409);
   const verifiedBytes=async(path,canonical=false)=>{
    let metadata;try{[metadata]=await bucket.file(path).getMetadata();}catch(error){if(Number(error.code)===404)return null;throw error;}
    const generation=String(metadata.generation||'');
    if(!/^[1-9]\d*$/.test(generation)||Number(metadata.size)!==old.byte_size||metadata.contentType!==old.content_type
     ||(canonical&&metadata.metadata?.firebaseStorageDownloadTokens!==old.download_token))throw fault('upload_integrity_failed',409);
    await db.runTransaction(async tx=>{await readAccess(tx);control(await tx.get(controlRef));await readAccess(tx);});
    const stream=bucket.file(path,{generation}).createReadStream({validation:'crc32c'}),chunks=[];let size=0;
    for await(const chunk of stream){size+=chunk.length;if(size>old.byte_size||size>=MAX_BYTES){stream.destroy();throw fault('upload_integrity_failed',409);}chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,size);if(size!==old.byte_size||hash(bytes)!==old.sha256)throw fault('upload_integrity_failed',409);
    return{generation,bytes};
   };
   let published=await verifiedBytes(finalPath,true);
   if(!published){
    const staged=await verifiedBytes(old.path);if(!staged)throw fault('upload_not_found',404);
    await db.runTransaction(async tx=>{await readAccess(tx);control(await tx.get(controlRef));await readAccess(tx);});
    try{
     await bucket.file(finalPath).save(staged.bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:old.content_type,metadata:{firebaseStorageDownloadTokens:old.download_token}}});
    }catch(error){if(Number(error.code)!==412)throw error;}
    published=await verifiedBytes(finalPath,true);if(!published)throw fault('upload_integrity_failed',409);
   }
   const generation=published.generation;
   const finalized={ok:true,operation_id:data.operation_id,path:old.path,generation,receipt_url:`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(finalPath)}?alt=media&token=${encodeURIComponent(old.download_token)}&generation=${generation}`};
   return await db.runTransaction(async tx=>{
    await readAccess(tx);const receipt=await tx.get(receiptRef),mode=await tx.get(controlRef);
    if(!receipt.exists)throw fault('upload_intent_not_found',404);const current=receipt.data();assertReceipt(current);
    if(current.cancelled)throw fault('expense_receipt_cancelled',409);
    if(current.finalized){control(mode,true);if(current.finalized.generation!==generation)throw fault('upload_generation_conflict',409);await readAccess(tx);return current.finalized;}
    control(mode);if(now().getTime()>=current.expires_at_ms)throw fault('upload_intent_expired',409);
    if(current.payload_hash!==old.payload_hash||current.path!==old.path||current.download_token!==old.download_token)throw fault('operation_conflict',409);
    const auditRef=journal.collection('audit').doc(data.operation_id+'_finalize'),audit={event:'expense_receipt_finalized',actor_uid:actor.uid,actor_email:current.actor_email,project_id:data.project_id,visit_id:data.visit_id,expense_id:data.expense_id,operation_id:data.operation_id,path:old.path,final_path:finalPath,sha256:old.sha256,byte_size:old.byte_size,content_type:old.content_type,generation,at:getServerTimestamp()};
    await readAccess(tx);assertDocumentBudget([{path:receiptRef.path,data:{...current,finalized}},{path:auditRef.path,data:audit}]);
    tx.update(receiptRef,{finalized});tx.update(db.collection('pulseExpenseReceiptIntents').doc(old.file_name),{state:'finalized',generation,receipt_url:finalized.receipt_url});tx.create(auditRef,audit);return finalized;
   });
  }catch(error){return{ok:false,error:error?.[PUBLIC]?error.code:'expense_receipt_service_unavailable',status:error?.[PUBLIC]?error.status:503};}
 };
}
module.exports={createNativeExpenseReceiptOperations,expenseReceiptsEnabled,MAX_BYTES,TTL};
