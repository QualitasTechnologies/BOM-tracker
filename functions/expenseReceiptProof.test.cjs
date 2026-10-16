const test=require('node:test'),assert=require('node:assert/strict');
const {assertExpenseReceiptAttachments}=require('./expenseReceiptProof.cjs');
const file='a'.repeat(64)+'.bin',path='projects/P/receipts/finalized/'+file,url='https://firebasestorage.googleapis.com/v0/b/visionbomtracker.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media&token=synthetic&generation=7';
const intent={state:'finalized',project_id:'P',visit_id:'trip',expense_id:'taxi',actor_uid:'alice',path:'projects/P/receipts/native/'+file,final_path:path,generation:'7',receipt_url:url};
function fixture(patch={}){
 let reads=0;const proof={...intent,...patch},db={collection:name=>({doc:id=>({path:name+'/'+id})})};
 const check=(command={kind:'edit_visit',record_id:'trip',input:{expenses:[{id:'taxi',receiptUrl:url}]}},old)=>assertExpenseReceiptAttachments({db,tx:{get:async ref=>{reads++;assert.equal(ref.path,'pulseExpenseReceiptIntents/'+file);return{exists:true,data:()=>proof};}},projectId:'P',actorUid:'alice',command,overheads:{travelVisits:old?[{id:'trip',expenses:old}]:[]}});
 return{check,reads:()=>reads};
}
test('a new attachment requires finalized project/visit/expense/actor/generation-bound server proof',async()=>{
 const f=fixture();await f.check();assert.equal(f.reads(),1);
 for(const patch of [{state:'reserved'},{project_id:'Q'},{visit_id:'other'},{expense_id:'other'},{actor_uid:'bob'},{generation:'8'},{final_path:'wrong'},{receipt_url:url+'wrong'}])await assert.rejects(fixture(patch).check(),/expense_receipt_proof_required/);
});
test('unchanged same-expense legacy URLs and removals need no new upload and are never deleted',async()=>{
 const f=fixture();await f.check({kind:'edit_visit',record_id:'trip',input:{expenses:[{id:'taxi',receiptUrl:'legacy://old'}]}},[{id:'taxi',receiptUrl:'legacy://old'}]);await f.check({kind:'edit_visit',record_id:'trip',input:{expenses:[{id:'taxi'}]}},[{id:'taxi',receiptUrl:'legacy://old'}]);assert.equal(f.reads(),0);
 await assert.rejects(f.check({kind:'edit_visit',record_id:'trip',input:{expenses:[{id:'different',receiptUrl:'legacy://old'}]}},[{id:'taxi',receiptUrl:'legacy://old'}]),/expense_receipt_proof_required/);
});
test('untrusted URL origins, cross-project paths, duplicate params and unproven legacy URLs cannot attach',async()=>{
 for(const receiptUrl of ['https://evil.test/file',url.replace('projects%2FP','projects%2FQ'),url.replace('finalized','native'),url+'&token=other',url+'#hash','https://example.test/old'])await assert.rejects(fixture().check({kind:'add_visit',record_id:'trip',input:{expenses:[{id:'taxi',receiptUrl}]}}),/expense_receipt_proof_required/);
});
