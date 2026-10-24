const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createNativeExpenseReceiptOperations}=require('./nativeExpenseReceiptOperations.cjs');
function fixture(options={}){
 const actor={uid:'alice',email:'alice@partner.example',emailVerified:true,customClaims:{role:'viewer',status:'approved'}};
 const bytes=Buffer.from('%PDF-1.7 synthetic receipt'),docs=new Map([['projects/P',{projectId:'P',memberIds:['alice']}]]);
 const ref=path=>({path,doc:id=>ref(`${path}/${id}`),collection:id=>ref(`${path}/${id}`)});
 const db={collection:ref,runTransaction:async fn=>{
  const writes=[],out=await fn({get:async r=>{assert.equal(writes.length,0);await options.onRead?.(r.path,{actor,docs});return{exists:docs.has(r.path),data:()=>docs.get(r.path)};},
   create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push([r.path,data]);},update:(r,data)=>writes.push([r.path,{...docs.get(r.path),...data}])});
  if(options.failAudit&&writes.some(([p])=>p.includes('/audit/')))throw Error('private journal fault');
  if(options.failFinalizeOnce&&writes.some(([p])=>p.endsWith('_finalize'))){options.failFinalizeOnce=false;throw Error('lost final journal');}
  for(const[path,data]of writes)docs.set(path,data);return out;
 }};
 const auth={verifyIdToken:async()=>({uid:actor.uid,email:actor.email}),getUser:async()=>actor};
 let blob,finalBlob,finalMetadata,clock=new Date('2026-10-16T00:00:00Z'),type='application/pdf',enabled=true,published=0;
 const bucket={name:'visionbomtracker.firebasestorage.app',file:(path,opts)=>{
  const final=path.includes('/finalized/');return{
   getMetadata:async()=>{const value=final?finalBlob:blob;if(!value)throw Object.assign(Error('missing'),{code:404});if(!final)await options.onMetadataRead?.({actor,docs});return[{generation:'7',size:String(value.length),contentType:type,...(final?finalMetadata:options.metadata)}];},
   createReadStream:()=>{assert.equal(opts.generation,'7');const value=final?finalBlob:blob;const stream=(async function*(){if(!final)await options.onDownload?.({actor,docs});yield value;})();stream.destroy=()=>{};return stream;},
   save:async(value,settings)=>{assert.equal(final,true);assert.equal(settings.preconditionOpts.ifGenerationMatch,0);assert.equal(settings.resumable,false);if(finalBlob)throw Object.assign(Error('exists'),{code:412});finalBlob=options.conflictingDestination?Buffer.alloc(value.length):Buffer.from(value);finalMetadata=settings.metadata;published++;await options.onMetadata?.({actor,docs});},
  };
 }};
 const handler=createNativeExpenseReceiptOperations({db,auth,bucket,enabled:()=>enabled,getServerTimestamp:()=>clock,now:()=>clock});
 const ids={project_id:'P',visit_id:'draft-trip',expense_id:'taxi',operation_id:'upload-1',expected_actor_uid:'alice'};
 const call=data=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{...ids,...data}});
 return{actor,docs,bytes,ids,call,off:()=>{enabled=false;},expire:()=>{clock=new Date('2026-10-17');},published:()=>published,finalBytes:()=>finalBlob,
  reserve:extra=>call({operation:'reserve',content_type:'application/pdf',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...extra}),
  finalize:extra=>call({operation:'finalize',...extra}),upload:(value=bytes,mime='application/pdf')=>{blob=value;type=mime;}};
}
module.exports={fixture};
