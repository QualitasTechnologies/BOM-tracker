const assert=require('node:assert/strict'),{Readable}=require('node:stream'),{createHash}=require('node:crypto');
const clone=value=>value instanceof Date?new Date(value):Array.isArray(value)?value.map(clone):value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))?Object.fromEntries(Object.entries(value).map(([key,row])=>[key,clone(row)])):value;
function fixture(options={}){
 let factory;try{factory=require('./nativeProjectDocumentOperations.cjs').createNativeProjectDocumentOperations;}catch(error){if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'./nativeProjectDocumentOperations.cjs'"))throw error;}
 assert.equal(typeof factory,'function','native project document factory must exist');
 const actor={uid:'alice',email:'alice@qualitastech.com',emailVerified:true,customClaims:{role:'viewer',status:'approved'}};
 const docs=new Map([['projects/P',{projectId:'P',memberIds:['alice'],members:[]}],['projects/P/bom/data',{categories:[{name:'Parts',items:[{id:'bolt',name:'Bolt',status:'not-ordered'}]}]}]]),versions=new Map([...docs.keys()].map(path=>[path,1]));let clock=1;
 const ref=(path,settings={})=>({path,...settings,doc:id=>ref(`${path}/${id}`),collection:name=>ref(`${path}/${name}`),where:(key,op,value)=>{assert.equal(op,'==');return ref(path,{...settings,filter:[key,value],query:true});},orderBy:key=>{assert.equal(key,'__name__');return ref(path,{...settings,query:true});},limit:n=>ref(path,{...settings,max:n,query:true}),startAfter:cursor=>ref(path,{...settings,cursor,query:true})});
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:docs.has(path),data:()=>clone(docs.get(path)),updateTime:{seconds:10,nanoseconds:versions.get(path)||1}});
 const rows=r=>[...docs.keys()].filter(path=>path.startsWith(r.path+'/')&&!path.slice(r.path.length+1).includes('/')&&(!r.filter||docs.get(path)?.[r.filter[0]]===r.filter[1])&&(!r.cursor||path.split('/').at(-1)>r.cursor)).sort();
 const stamp=r=>JSON.stringify(r.query?rows(r).map(path=>[path,versions.get(path)]):[docs.has(r.path),versions.get(r.path)]);
 const db={collection:ref,runTransaction:async fn=>{
  for(let attempt=0;attempt<8;attempt++){
   const writes=[],reads=[];const out=await fn({get:async r=>{assert.equal(writes.length,0,'read before writes');await options.onRead?.(r.path,{actor,docs,versions});reads.push([r,stamp(r)]);return r.query?{docs:rows(r).slice(0,r.max??Infinity).map(snap)}:snap(r.path);},create:(r,data)=>writes.push(['create',r.path,data]),update:(r,data)=>writes.push(['update',r.path,data]),delete:r=>writes.push(['delete',r.path])});
   if(options.beforeCommit){const hook=options.beforeCommit;options.beforeCommit=null;await hook({actor,docs,versions});}
   if(reads.some(([r,old])=>old!==stamp(r)))continue;
   if(options.failAudit&&writes.some(([,path])=>path.includes('/audit/')))throw Error('synthetic audit failure');
   if(options.failArchive&&writes.some(([,path])=>path.startsWith('pulseDeletedProjectDocuments/')))throw Error('synthetic archive failure');
   for(const[kind,path]of writes)if(kind==='create'&&docs.has(path))throw Error('already exists');
   for(const[kind,path,data]of writes){if(kind==='delete')docs.delete(path);else docs.set(path,clone(kind==='update'?{...docs.get(path),...data}:data));versions.set(path,++clock);}
   if(options.loseFinalReply&&writes.some(([,path,data])=>path.includes('/receipts/')&&data?.finalized)){options.loseFinalReply=false;throw Error('lost final ack');}
   return out;
  }throw Error('contention');
 }};
 const objects=new Map(),history=new Map();let generation=100,publications=0,enabled=options.enabled!==false,time=new Date('2026-10-16T00:00:00Z');
 const put=(path,bytes,type,metadata={})=>{const object={bytes:Buffer.from(bytes),metadata:{generation:String(++generation),size:String(bytes.length),contentType:type,...metadata}};objects.set(path,object);history.set(`${path}#${generation}`,object);return object;};
 const bucket={name:'visionbomtracker.firebasestorage.app',file:(path,settings)=>({getMetadata:async()=>{const value=objects.get(path);if(!value)throw Object.assign(Error('absent'),{code:404});return[clone(value.metadata)];},createReadStream:()=>{const value=history.get(`${path}#${settings.generation}`);if(!value)throw Object.assign(Error('missing generation'),{code:404});return Readable.from([value.bytes]);},save:async(bytes,settings)=>{assert.equal(settings.preconditionOpts.ifGenerationMatch,0);assert.equal(settings.resumable,false);if(objects.has(path))throw Object.assign(Error('exists'),{code:412});put(path,bytes,settings.metadata.contentType,settings.metadata);publications++;await options.onPublish?.({actor,docs,versions});}})};
 const auth={verifyIdToken:async()=>({uid:actor.uid,email:actor.email}),getUser:async()=>clone(actor)};
 const handler=factory({db,auth,bucket,enabled:()=>enabled,getServerTimestamp:()=>time,now:()=>time});
 const base={project_id:'P',document_id:'document-1',operation_id:'upload-1',expected_actor_uid:'alice'};
 const call=data=>{const payload={...base,...data};if(['get','list_deleted'].includes(payload.operation))delete payload.document_id;if(payload.operation==='list_deleted')delete payload.operation_id;if(payload.operation==='restore')delete payload.document_id;return handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:payload});};
 const bytes=Buffer.from('%PDF synthetic document');
 return{docs,versions,actor,options,objects,bytes,call,db,auth,bucket,off:()=>{enabled=false;},expire:()=>{time=new Date('2026-10-17');},publications:()=>publications,
  reserve:extra=>call({operation:'reserve',name:'quote.pdf',document_type:'vendor-quote',content_type:'application/pdf',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...extra}),
  upload:(path,value=bytes,type='application/pdf',metadata={})=>put(path,value,type,metadata),finalize:()=>call({operation:'finalize'}),get:extra=>handler({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'get',project_id:'P',expected_actor_uid:'alice',...extra}}),
 };
}
module.exports={fixture};
