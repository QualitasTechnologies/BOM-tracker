const {randomBytes,randomUUID}=require('node:crypto');
const {currentNativeActor}=require('./nativeMaterialOperations.cjs');
const {fault,isFault,plain,validId,version,validVersion,TYPES,MAX_BYTES,hash,typeAccess,projectAccess,assertDeletion,view,projectDocumentsEnabled,budget:assertDocumentBudget}=require('./projectDocumentState.cjs');
const TTL=15*60*1000;
function createNativeProjectDocumentOperations({db,auth,bucket,enabled=false,getServerTimestamp,now=()=>new Date()}){
 const on=()=>(typeof enabled==='function'?enabled():enabled)===true;
 const control=(snapshot,replay=false)=>{
  const mode=snapshot.exists?snapshot.data()?.mode:'coexist';
  if(!['coexist','pulse_only','read_only'].includes(mode))throw fault('project_document_control_unavailable',503);
  if(!replay&&(!on()||mode==='read_only'))throw fault('project_document_writes_disabled',503);
  return mode;
 };
 return async request=>{
  try{
   const actor=await currentNativeActor(auth,request),data=request.data;
   const base=['operation','project_id','expected_actor_uid'],identity=['document_id','operation_id'],versions=['expected_project_version','expected_bom_version','expected_document_version'];
   if(!plain(data)||!['get','reserve','finalize','cancel','delete','resolve_delete'].includes(data.operation)||!validId(data.project_id))throw fault('invalid_project_document_request');
   const fields=data.operation==='get'?['cursor']:data.operation==='reserve'?[...identity,'name','document_type','content_type','byte_size','sha256']:['delete','resolve_delete'].includes(data.operation)?[...identity,...versions]:identity;
   if(Object.keys(data).some(key=>![...base,...fields].includes(key))||data.expected_actor_uid!==actor.uid)throw fault(data.expected_actor_uid!==actor.uid?'actor_session_changed':'invalid_project_document_request',data.expected_actor_uid!==actor.uid?403:400);
   if(data.operation==='get'&&data.cursor!==undefined&&!validId(data.cursor))throw fault('invalid_project_document_request');
   if(data.operation!=='get'&&(!validId(data.document_id)||typeof data.operation_id!=='string'||!/^[-\w]{1,128}$/.test(data.operation_id)))throw fault('invalid_project_document_request');
   if(['delete','resolve_delete'].includes(data.operation)&&versions.some(key=>!validVersion(data[key])))throw fault('invalid_project_document_request');
   if(data.operation==='reserve'&&(!TYPES.includes(data.document_type)||typeof data.name!=='string'||!data.name||data.name.length>4096||typeof data.content_type!=='string'||!/^[\x20-\x7e]{1,256}$/.test(data.content_type)||!Number.isSafeInteger(data.byte_size)||data.byte_size<0||data.byte_size>=MAX_BYTES||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)))throw fault('invalid_project_document_request');
   const projectRef=db.collection('projects').doc(data.project_id),bomRef=projectRef.collection('bom').doc('data'),controlRef=db.collection('pulseRuntimeControl').doc('cutover');
   const documentRef=data.document_id?db.collection('projectDocuments').doc(data.document_id):null;
   const archiveRef=data.document_id?db.collection('pulseDeletedProjectDocuments').doc(data.project_id).collection('documents').doc(data.document_id):null;
   const actorNow=async project=>{
    const current=await currentNativeActor(auth,request);
    if(current.uid!==actor.uid||current.email.trim().toLowerCase()!==actor.email.trim().toLowerCase())throw fault('actor_session_changed',403);
    projectAccess(project,current,data.project_id);return current;
   };
   const readProject=async tx=>{const snapshot=await tx.get(projectRef);if(!snapshot.exists)throw fault('project_document_project_not_found',404);const current=await actorNow(snapshot.data());return{snapshot,actor:current};};
   if(data.operation==='get')return await db.runTransaction(async tx=>{
    const project=await readProject(tx),bom=await tx.get(bomRef),mode=control(await tx.get(controlRef),true);
    let query=db.collection('projectDocuments').where('projectId','==',data.project_id).orderBy('__name__');if(data.cursor)query=query.startAfter(data.cursor);
    const rows=await tx.get(query.limit(101)),current=await actorNow(project.snapshot.data()),page=rows.docs.slice(0,100);
    const documents=[];
    for(const row of page){
     const raw=row.data();if(current.customClaims.role!=='admin'&&raw.type==='customer-po')continue;
     const projected=view(row.id,raw),marker=raw.pulseNativeDocument;
     if(marker){
      if(!plain(marker)||typeof marker.operation_id!=='string'||!/^[-\w]{1,128}$/.test(marker.operation_id)||typeof marker.path!=='string'||typeof marker.generation!=='string')throw fault('invalid_project_document_state',409);
      const proofSnapshot=await tx.get(db.collection('pulseProjectDocumentUploads').doc(data.project_id).collection('receipts').doc(marker.operation_id)),proof=proofSnapshot.data();
      if(!proofSnapshot.exists||proof.project_id!==data.project_id||proof.document_id!==row.id||proof.final_path!==marker.path||proof.finalized?.generation!==marker.generation||proof.finalized?.document?.id!==row.id||typeof proof.download_token!=='string'||!proof.download_token)throw fault('invalid_project_document_state',409);
      const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(marker.path)}?alt=media&token=${encodeURIComponent(proof.download_token)}&generation=${marker.generation}`;
      if(proof.finalized.document.url!==url)throw fault('invalid_project_document_state',409);
      projected.url=url;
     }
     documents.push({...projected,nativeOpening:{project_id:data.project_id,actor_uid:actor.uid,project_version:version(project.snapshot),bom_version:version(bom),document_version:version(row)}});
    }
    await actorNow(project.snapshot.data());
    return{ok:true,project_id:data.project_id,documents,next_cursor:rows.docs.length>100?page.at(-1).id:null,permissions:{write:on()&&mode!=='read_only'}};
   });
   if(['delete','resolve_delete'].includes(data.operation))return await db.runTransaction(async tx=>{
    const project=await readProject(tx),bom=await tx.get(bomRef),document=await tx.get(documentRef);
    const journal=db.collection('pulseProjectDocumentMutations').doc(data.project_id),receiptRef=journal.collection('receipts').doc(data.operation_id),receipt=await tx.get(receiptRef),mode=await tx.get(controlRef);
    const payloadHash=hash(JSON.stringify([data.project_id,data.document_id,...versions.map(key=>data[key])])),old=receipt.exists?receipt.data():null;
    if(old&&(old.actor_uid!==actor.uid||old.actor_email!==actor.email.trim().toLowerCase()||old.payload_hash!==payloadHash))throw fault('project_document_operation_conflict',409);
    if(old){control(mode,true);typeAccess(old.document_type,await actorNow(project.snapshot.data()));if(old.cancelled&&data.operation==='delete')throw fault('project_document_request_cancelled',409);return old.result;}
    const raw=document.exists?document.data():null;
    if(raw&&raw.projectId!==data.project_id)throw fault('project_document_forbidden',403);
    if(raw)typeAccess(raw.type,project.actor);
    const identityRecord={actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase(),document_id:data.document_id,project_id:data.project_id,document_type:raw?.type??null,payload_hash:payloadHash};
    if(data.operation==='resolve_delete'){
     control(mode,true);const result={ok:true,document_id:data.document_id,operation_id:data.operation_id,resolution:'cancelled'};
     typeAccess(raw?.type,await actorNow(project.snapshot.data()));
     tx.create(receiptRef,{...identityRecord,cancelled:true,result,at:getServerTimestamp()});tx.create(journal.collection('audit').doc(data.operation_id),{...identityRecord,event:'project_document_delete_cancelled',at:getServerTimestamp()});return result;
    }
    control(mode);if(!raw)throw fault('project_document_not_found',404);
    if(version(project.snapshot)!==data.expected_project_version||version(bom)!==data.expected_bom_version||version(document)!==data.expected_document_version)throw fault('project_document_version_conflict',409);
    if((await tx.get(archiveRef)).exists)throw fault('project_document_identity_used',409);
    assertDeletion({...raw,id:data.document_id},bom.data(),project.snapshot.data(),await actorNow(project.snapshot.data()));
    const result={ok:true,document_id:data.document_id,operation_id:data.operation_id,resolution:'committed'};
    const archive={...identityRecord,document:raw,document_version:version(document),bom_version:version(bom),project_version:version(project.snapshot),at:getServerTimestamp()};
    const receiptValue={...identityRecord,result,at:getServerTimestamp()},audit={...identityRecord,event:'project_document_deleted',archive_path:archiveRef.path,previous_version:version(document),at:getServerTimestamp()};
    assertDocumentBudget([{path:archiveRef.path,data:archive},{path:receiptRef.path,data:receiptValue},{path:journal.collection('audit').doc(data.operation_id).path,data:audit}]);
    tx.create(archiveRef,archive);tx.delete(documentRef);tx.create(receiptRef,receiptValue);tx.create(journal.collection('audit').doc(data.operation_id),audit);return result;
   });
   const journal=db.collection('pulseProjectDocumentUploads').doc(data.project_id),receiptRef=journal.collection('receipts').doc(data.operation_id);
   const same=old=>{if(old.actor_uid!==actor.uid||old.actor_email!==actor.email.trim().toLowerCase()||old.project_id!==data.project_id||old.document_id!==data.document_id)throw fault('project_document_operation_conflict',409);};
   const payloadHash=data.operation==='reserve'?hash(JSON.stringify([data.project_id,data.document_id,data.name,data.document_type,data.content_type,data.byte_size,data.sha256])):null;
   const opening=await db.runTransaction(async tx=>{
    const project=await readProject(tx),receipt=await tx.get(receiptRef),mode=await tx.get(controlRef),old=receipt.exists?receipt.data():null;
    if(old){same(old);typeAccess(old.document_type,project.actor);if(payloadHash&&old.payload_hash!==payloadHash)throw fault('project_document_operation_conflict',409);}
    if(data.operation==='cancel'){
     control(mode,true);typeAccess(old?.document_type,await actorNow(project.snapshot.data()));
     if(old?.finalized)return{result:{...old.finalized,resolution:'committed'}};if(old?.cancelled)return{result:old.cancelled};
     const cancelled={ok:true,operation_id:data.operation_id,resolution:'cancelled'},identityValue=old?{}:{project_id:data.project_id,document_id:data.document_id,actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase()};
     if(old){tx.update(receiptRef,{cancelled,at:getServerTimestamp()});tx.update(db.collection('pulseProjectDocumentUploadIntents').doc(old.file_name),{state:'cancelled'});}else tx.create(receiptRef,{...identityValue,cancelled,at:getServerTimestamp()});
     tx.create(journal.collection('audit').doc(data.operation_id+'_cancel'),{...identityValue,event:'project_document_upload_cancelled',operation_id:data.operation_id,actor_uid:actor.uid,at:getServerTimestamp()});return{result:cancelled};
    }
    if(old?.cancelled)throw fault('project_document_upload_cancelled',409);
    if(old?.finalized){control(mode,true);typeAccess(old.document_type,await actorNow(project.snapshot.data()));return{result:data.operation==='reserve'?old.reserved:old.finalized};}
    control(mode);
    if(old){if(now().getTime()>=old.expires_at_ms)throw fault('project_document_upload_expired',409);typeAccess(old.document_type,await actorNow(project.snapshot.data()));return data.operation==='reserve'?{result:old.reserved}:{receipt:old};}
    if(data.operation!=='reserve')throw fault('project_document_upload_not_found',404);
    typeAccess(data.document_type,project.actor);
    if((await tx.get(documentRef)).exists||(await tx.get(archiveRef)).exists)throw fault('project_document_identity_used',409);
    const fileName=randomBytes(32).toString('hex')+'.bin',path=`projects/${data.project_id}/documents/native/staging/${fileName}`,finalPath=`projects/${data.project_id}/documents/native/finalized/${fileName}`,expires=now().getTime()+TTL;
    const reserved={ok:true,operation_id:data.operation_id,path,expires_at:new Date(expires).toISOString()};
    const intent={actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase(),project_id:data.project_id,document_id:data.document_id,document_type:data.document_type,name:data.name,operation_id:data.operation_id,path,final_path:finalPath,content_type:data.content_type,byte_size:data.byte_size,sha256:data.sha256,state:'reserved',expires_at:new Date(expires),expires_at_ms:expires};
    const stored={...intent,file_name:fileName,payload_hash:payloadHash,download_token:randomUUID(),reserved},audit={...intent,event:'project_document_reserved',at:getServerTimestamp()};
    typeAccess(data.document_type,await actorNow(project.snapshot.data()));assertDocumentBudget([{path:receiptRef.path,data:stored},{path:journal.collection('audit').doc(data.operation_id+'_reserve').path,data:audit}]);
    tx.create(db.collection('pulseProjectDocumentUploadIntents').doc(fileName),intent);tx.create(receiptRef,stored);tx.create(journal.collection('audit').doc(data.operation_id+'_reserve'),audit);return{result:reserved};
   });
   if(opening.result)return opening.result;const old=opening.receipt;
   const recheck=()=>db.runTransaction(async tx=>{const project=await readProject(tx);control(await tx.get(controlRef));typeAccess(old.document_type,await actorNow(project.snapshot.data()));});
   const finalPath=`projects/${data.project_id}/documents/native/finalized/${old.file_name}`;if(old.final_path!==finalPath)throw fault('project_document_operation_conflict',409);
   const verify=async(path,canonical=false)=>{
    let metadata;try{[metadata]=await bucket.file(path).getMetadata();}catch(error){if(Number(error.code)===404)return null;throw error;}
    const generation=String(metadata.generation||'');if(!/^[1-9]\d*$/.test(generation)||Number(metadata.size)!==old.byte_size||metadata.contentType!==old.content_type||canonical&&metadata.metadata?.firebaseStorageDownloadTokens!==old.download_token)throw fault('project_document_integrity_failed',409);
    await recheck();const stream=bucket.file(path,{generation}).createReadStream({validation:'crc32c'}),chunks=[];let size=0;
    for await(const chunk of stream){size+=chunk.length;if(size>old.byte_size||size>=MAX_BYTES){stream.destroy();throw fault('project_document_integrity_failed',409);}chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,size);if(size!==old.byte_size||hash(bytes)!==old.sha256)throw fault('project_document_integrity_failed',409);return{generation,bytes};
   };
   let published=await verify(finalPath,true);
   if(!published){const staged=await verify(old.path);if(!staged)throw fault('project_document_upload_not_found',404);await recheck();try{await bucket.file(finalPath).save(staged.bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:old.content_type,metadata:{firebaseStorageDownloadTokens:old.download_token}}});}catch(error){if(Number(error.code)!==412)throw error;}published=await verify(finalPath,true);if(!published)throw fault('project_document_integrity_failed',409);}
   const generation=published.generation,url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(finalPath)}?alt=media&token=${encodeURIComponent(old.download_token)}&generation=${generation}`;
   return await db.runTransaction(async tx=>{
    const project=await readProject(tx),receipt=await tx.get(receiptRef),mode=await tx.get(controlRef);if(!receipt.exists)throw fault('project_document_upload_not_found',404);
    const current=receipt.data();same(current);if(current.cancelled)throw fault('project_document_upload_cancelled',409);
    if(current.finalized){control(mode,true);typeAccess(current.document_type,await actorNow(project.snapshot.data()));if(current.finalized.generation!==generation)throw fault('project_document_generation_conflict',409);return current.finalized;}
    control(mode);if(now().getTime()>=current.expires_at_ms)throw fault('project_document_upload_expired',409);
    if(current.payload_hash!==old.payload_hash||current.final_path!==finalPath||current.download_token!==old.download_token)throw fault('project_document_operation_conflict',409);
    if((await tx.get(documentRef)).exists||(await tx.get(archiveRef)).exists)throw fault('project_document_identity_used',409);
    // Original SDK readers share metadata across signed-in accounts. Never
    // store a bearer download token there; hydrate it from private proof on get.
    const publicUrl=new URL(url);publicUrl.searchParams.delete('token');
    const document={projectId:data.project_id,name:old.name,url:publicUrl.toString(),type:old.document_type,uploadedAt:getServerTimestamp(),uploadedBy:actor.uid,linkedBOMItems:[],fileSize:old.byte_size,pulseNativeDocument:{operation_id:data.operation_id,path:finalPath,generation}};
    const result={ok:true,operation_id:data.operation_id,path:old.path,generation,document:{...view(data.document_id,{...document,url,uploadedAt:now()} )}};
    const audit={actor_uid:actor.uid,actor_email:actor.email.trim().toLowerCase(),project_id:data.project_id,document_id:data.document_id,operation_id:data.operation_id,event:'project_document_finalized',path:old.path,final_path:finalPath,generation,sha256:old.sha256,byte_size:old.byte_size,at:getServerTimestamp()};
    typeAccess(old.document_type,await actorNow(project.snapshot.data()));assertDocumentBudget([{path:documentRef.path,data:document},{path:receiptRef.path,data:{...current,finalized:result}},{path:journal.collection('audit').doc(data.operation_id+'_finalize').path,data:audit}]);
    tx.create(documentRef,document);tx.update(receiptRef,{finalized:result});tx.update(db.collection('pulseProjectDocumentUploadIntents').doc(old.file_name),{state:'finalized',generation,url});tx.create(journal.collection('audit').doc(data.operation_id+'_finalize'),audit);return result;
   });
  }catch(error){const authFault=['actor_authentication_required','actor_forbidden','identity_provider_unavailable'].includes(error?.code);return{ok:false,error:isFault(error)||authFault?error.code:'project_document_service_unavailable',status:isFault(error)||authFault?error.status:503};}
 };
}
module.exports={createNativeProjectDocumentOperations,projectDocumentsEnabled};
