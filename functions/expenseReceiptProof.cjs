const PUBLIC=Symbol('expense-receipt-proof');
const fault=()=>Object.assign(Error('expense_receipt_proof_required'),{code:'expense_receipt_proof_required',status:409,[PUBLIC]:true});
const isExpenseReceiptProofFault=error=>!!error?.[PUBLIC];
async function assertExpenseReceiptAttachments({db,tx,projectId,actorUid,command,overheads,bucketName='visionbomtracker.firebasestorage.app'}){
 if(!['add_visit','edit_visit'].includes(command.kind))return;
 const oldVisit=(overheads?.travelVisits??[]).find(row=>row.id===command.record_id),oldRows=Array.isArray(oldVisit?.expenses)?oldVisit.expenses:[];
 for(const expense of command.input.expenses){
  if(expense.receiptUrl===undefined)continue;
  const old=oldRows.find(row=>row.id===expense.id);if(old&&old.receiptUrl===expense.receiptUrl)continue;
  let url,path,fileName;
  try{
   url=new URL(expense.receiptUrl);
   if(url.origin!=='https://firebasestorage.googleapis.com'||url.username||url.password||url.hash)throw 0;
   const prefix=`/v0/b/${encodeURIComponent(bucketName)}/o/`;if(!url.pathname.startsWith(prefix))throw 0;
   path=decodeURIComponent(url.pathname.slice(prefix.length));
   const objectPrefix=`projects/${projectId}/receipts/native/`;if(!path.startsWith(objectPrefix))throw 0;
   fileName=path.slice(objectPrefix.length);if(!/^[a-f0-9]{64}\.bin$/.test(fileName)||url.pathname!==prefix+encodeURIComponent(path))throw 0;
   if([...url.searchParams.keys()].length!==3||['alt','token','generation'].some(key=>url.searchParams.getAll(key).length!==1)||url.searchParams.get('alt')!=='media'||!url.searchParams.get('token')||!/^[1-9]\d*$/.test(url.searchParams.get('generation')))throw 0;
  }catch{throw fault();}
  const snapshot=await tx.get(db.collection('pulseExpenseReceiptIntents').doc(fileName)),proof=snapshot.exists?snapshot.data():null;
  if(!proof||proof.state!=='finalized'||proof.project_id!==projectId||proof.visit_id!==command.record_id||proof.expense_id!==expense.id||proof.actor_uid!==actorUid||proof.path!==path||proof.generation!==url.searchParams.get('generation')||proof.receipt_url!==expense.receiptUrl)throw fault();
 }
}
module.exports={assertExpenseReceiptAttachments,isExpenseReceiptProofFault};
