const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createNativeExpenseReceiptOperations}=require('./nativeExpenseReceiptOperations.cjs');
function fixture(options={}){
 const actor={uid:'alice',email:'alice@partner.example',emailVerified:true,customClaims:{role:'viewer',status:'approved'}};
 const bytes=Buffer.from('%PDF-1.7 synthetic receipt'),docs=new Map([['projects/P',{projectId:'P',memberIds:['alice']}]]);
 const ref=path=>({path,doc:id=>ref(`${path}/${id}`),collection:id=>ref(`${path}/${id}`)});
 const db={collection:ref,runTransaction:async fn=>{
  const writes=[],out=await fn({get:async r=>{assert.equal(writes.length,0);await options.onRead?.(r.path,{actor,docs});return{exists:docs.has(r.path),data:()=>docs.get(r.path)};},
   create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push([r.path,data]);},update:(r,data)=>writes.push([r.path,{...docs.get(r.path),...data}])});
  if(options.failAudit&&writes.some(([p])=>p.includes('/audit/')))throw Error('private journal fault');
  for(const[path,data]of writes)docs.set(path,data);return out;
 }};
 const auth={verifyIdToken:async()=>({uid:actor.uid,email:actor.email}),getUser:async()=>actor};
 let blob,clock=new Date('2026-10-16T00:00:00Z'),type='application/pdf',enabled=true,published=0;
 const bucket={name:'visionbomtracker.firebasestorage.app',file:(path,opts)=>({getMetadata:async()=>{if(!blob)throw Object.assign(Error('missing'),{code:404});await options.onMetadataRead?.({actor,docs});return[{generation:'7',size:String(blob.length),contentType:type,...options.metadata}];},
  createReadStream:()=>{assert.equal(opts.generation,'7');const stream=(async function*(){await options.onDownload?.({actor,docs});yield blob;})();stream.destroy=()=>{};return stream;},
  setMetadata:async(patch,condition)=>{assert.equal(condition.ifGenerationMatch,'7');assert.notEqual(patch.metadata.firebaseStorageDownloadTokens,'client-token');assert.deepEqual(Object.keys(patch.metadata),['firebaseStorageDownloadTokens']);published++;await options.onMetadata?.({actor,docs});}})};
 const handler=createNativeExpenseReceiptOperations({db,auth,bucket,enabled:()=>enabled,getServerTimestamp:()=>clock,now:()=>clock});
 const ids={project_id:'P',visit_id:'draft-trip',expense_id:'taxi',operation_id:'upload-1',expected_actor_uid:'alice'};
 const call=data=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{...ids,...data}});
 return{actor,docs,bytes,ids,call,off:()=>{enabled=false;},expire:()=>{clock=new Date('2026-10-17');},published:()=>published,
  reserve:extra=>call({operation:'reserve',content_type:'application/pdf',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...extra}),
  finalize:extra=>call({operation:'finalize',...extra}),upload:(value=bytes,mime='application/pdf')=>{blob=value;type=mime;}};
}
test('draft PDF receipts reserve, finalize and replay with generation-bound URL and atomic protected audit',async()=>{
 const f=fixture(),r=await f.reserve();assert.equal(r.ok,true);assert.match(r.path,/^projects\/P\/receipts\/native\/[a-f0-9]{64}\.bin$/);assert.deepEqual(await f.reserve(),r);
 f.upload();const done=await f.finalize();assert.equal(done.ok,true);assert.match(done.receipt_url,/generation=7/);assert.equal(done.generation,'7');assert.deepEqual(await f.finalize(),done);assert.equal(f.published(),1);
 assert.equal([...f.docs.keys()].filter(p=>p.includes('/audit/')).length,2);
});
test('all original image MIME families remain available without transcoding or file name authority',async()=>{
 for(const content_type of ['image/jpeg','image/png','image/webp','image/svg+xml','image/heic','image/tiff']){
  const f=fixture();assert.equal((await f.reserve({content_type})).ok,true);f.upload(f.bytes,content_type);assert.equal((await f.finalize()).ok,true);
 }
});
test('invalid IDs/types/sizes, forged URL/actor and changed nonce target are rejected',async()=>{
 for(const patch of [{byte_size:10485760},{byte_size:0},{content_type:'text/html'},{sha256:'bad'},{receipt_url:'https://forged'},{expected_actor_uid:'other'},{visit_id:'../trip'},{expense_id:'bad/path'}])assert.equal((await fixture().reserve(patch)).ok,false);
 const f=fixture();await f.reserve();assert.equal((await f.reserve({sha256:'a'.repeat(64)})).error,'operation_conflict');assert.equal((await f.finalize({expense_id:'another'})).error,'operation_conflict');
});
test('new grants require current original project access including legacy fallback and admins',async()=>{
 const f=fixture();f.docs.get('projects/P').memberIds=[];assert.equal((await f.reserve()).ok,false);delete f.docs.get('projects/P').memberIds;assert.equal((await f.reserve()).ok,true);
 const g=fixture();g.docs.get('projects/P').memberIds=[];g.actor.customClaims.role='admin';assert.equal((await g.reserve()).ok,true);
});
test('missing/changed bytes or MIME and revoked access cannot publish a finalized receipt',async()=>{
 const f=fixture();await f.reserve();assert.equal((await f.finalize()).error,'upload_not_found');f.upload(Buffer.alloc(f.bytes.length));assert.equal((await f.finalize()).error,'upload_integrity_failed');f.upload(f.bytes,'image/png');assert.equal((await f.finalize()).error,'upload_integrity_failed');
 const g=fixture({onDownload:({actor})=>{actor.disabled=true;}});await g.reserve();g.upload();assert.equal((await g.finalize()).ok,false);assert.equal(g.published(),0);
 const h=fixture({onMetadata:({docs})=>{docs.get('projects/P').memberIds=[];}});await h.reserve();h.upload();assert.equal((await h.finalize()).ok,false);assert.equal(h.docs.get('pulseExpenseReceiptUploads/P/receipts/upload-1').finalized,undefined);
});
test('finalized confirmation survives flags-off expiry/read-only but still checks identity and unknown cutover',async()=>{
 const f=fixture();await f.reserve();f.upload();const done=await f.finalize();f.off();f.expire();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.deepEqual(await f.finalize(),done);
 f.docs.set('pulseRuntimeControl/cutover',{mode:'unknown'});assert.equal((await f.finalize()).ok,false);
 f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});f.actor.disabled=true;assert.equal((await f.finalize()).ok,false);
});
test('new finalization is fenced after read-only/expiry and audit failure cannot leave a grant',async()=>{
 const f=fixture();await f.reserve();f.upload();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.equal((await f.finalize()).ok,false);
 const g=fixture();await g.reserve();g.upload();g.expire();assert.equal((await g.finalize()).error,'upload_intent_expired');
 const h=fixture({failAudit:true});assert.equal((await h.reserve()).error,'expense_receipt_service_unavailable');assert.equal([...h.docs.keys()].some(p=>p.startsWith('pulseExpenseReceiptIntents/')),false);
});
test('a deleted visit identity cannot reserve and provider tokens never determine finalized proof',async()=>{
 const f=fixture();f.docs.set('pulseDeletedOverheads/P/records/visit-draft-trip',{record:{id:'draft-trip'}});assert.equal((await f.reserve()).ok,false);
 const g=fixture({metadata:{metadata:{firebaseStorageDownloadTokens:'client-token'}}});await g.reserve();g.upload();const done=await g.finalize();assert.equal(done.ok,true);assert.doesNotMatch(done.receipt_url,/token=client-token/);assert.equal(g.published(),1);
 const h=fixture({onMetadataRead:({actor})=>{actor.disabled=true;}});await h.reserve();h.upload();assert.equal((await h.finalize()).ok,false);assert.equal(h.published(),0);
});
test('explicit cancellation with writes-off fences late finalization and never removes stored bytes',async()=>{
 const f=fixture();await f.reserve();f.upload();f.off();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 const cancelled=await f.call({operation:'cancel'});assert.equal(cancelled.ok,true);assert.equal(cancelled.resolution,'cancelled');
 assert.equal((await f.finalize()).error,'expense_receipt_cancelled');assert.deepEqual(await f.call({operation:'cancel'}),cancelled);assert.equal(f.published(),0);
});
module.exports={fixture};
