const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeOverheadFixture.cjs');
const file='a'.repeat(64)+'.bin',path='projects/P/receipts/finalized/'+file,url='https://firebasestorage.googleapis.com/v0/b/visionbomtracker.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media&token=synthetic&generation=7';
const input={startDate:'2026-10-15',endDate:'2026-10-15',attendees:['alice'],expenses:[{id:'expense',category:'Transport',amount:150,receiptUrl:url}]};
test('a cost save verifies new receipt proof in the same transaction and retains old values on failure',async()=>{
 const f=fixture({requireReceiptProof:true}),before=structuredClone(f.docs.get('projects/P/overheads/data'));
 assert.equal((await f.issue({kind:'edit_visit',record_id:'trip',input})).error,'expense_receipt_proof_required');assert.deepEqual(f.docs.get('projects/P/overheads/data'),before);
 f.docs.set('pulseExpenseReceiptIntents/'+file,{state:'finalized',actor_uid:'alice',project_id:'P',visit_id:'trip',expense_id:'expense',final_path:path,generation:'7',receipt_url:url});
 assert.equal((await f.issue({kind:'edit_visit',record_id:'trip',input})).ok,true);
});
test('proof reads happen before final actor verification and no partial expense/audit can commit after revocation',async()=>{
 let f;f=fixture({requireReceiptProof:true,onRead:path=>{if(path.startsWith('pulseExpenseReceiptIntents/'))f.users.get('alice').disabled=true;}});
 f.docs.set('pulseExpenseReceiptIntents/'+file,{state:'finalized',actor_uid:'alice',project_id:'P',visit_id:'trip',expense_id:'expense',final_path:path,generation:'7',receipt_url:url});
 const before=structuredClone([...f.docs]);assert.equal((await f.issue({kind:'edit_visit',record_id:'trip',input})).error,'actor_forbidden');assert.deepEqual([...f.docs],before);
});
