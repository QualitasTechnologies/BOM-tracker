const {fault,plain,view}=require('./projectDocumentState.cjs');

// This helper only projects and hydrates data. Callers must authorize the actor,
// project, and document category before calling it.
async function readProjectDocumentView({transaction,db,bucket,projectId,id,raw}){
 if(raw.projectId!==projectId)throw fault('project_document_forbidden',403);
 const projected=view(id,raw),marker=raw.pulseNativeDocument;
 if(marker){
  if(!plain(marker)||typeof marker.operation_id!=='string'||!/^[-\w]{1,128}$/.test(marker.operation_id)||typeof marker.path!=='string'||typeof marker.generation!=='string')throw fault('invalid_project_document_state',409);
  const proofSnapshot=await transaction.get(db.collection('pulseProjectDocumentUploads').doc(projectId).collection('receipts').doc(marker.operation_id)),proof=proofSnapshot.data();
  if(!proofSnapshot.exists||proof.project_id!==projectId||proof.document_id!==id||proof.final_path!==marker.path||proof.finalized?.generation!==marker.generation||proof.finalized?.document?.id!==id||typeof proof.download_token!=='string'||!proof.download_token)throw fault('invalid_project_document_state',409);
  const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(marker.path)}?alt=media&token=${encodeURIComponent(proof.download_token)}&generation=${marker.generation}`;
  if(proof.finalized.document.url!==url)throw fault('invalid_project_document_state',409);
  projected.url=url;
 }
 return projected;
}
module.exports={readProjectDocumentView};
