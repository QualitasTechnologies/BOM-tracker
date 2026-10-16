const assert=require('node:assert/strict');
const clone=value=>value instanceof Date?new Date(value):Array.isArray(value)?value.map(clone):value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))?Object.fromEntries(Object.entries(value).map(([key,row])=>[key,clone(row)])):value;
function fixture(options={}){
  const {createNativeOverheadOperations}=require('./nativeOverheadOperations.cjs');
  const users=new Map(['alice','admin','partner','outsider'].map(uid=>[uid,{uid,email:`${uid}@${['partner','outsider'].includes(uid)?'external.example':'qualitastech.com'}`,displayName:uid,emailVerified:true,customClaims:{status:'approved',role:uid==='admin'?'admin':'viewer'}}]));
  const uid=options.uid||'alice';
  const docs=new Map([
    ['projects/P',{projectId:'P',projectName:'Project',deadline:'2026-12-31',memberIds:['alice','partner','admin']}],
    ['projects/P/overheads/data',{travelVisits:[{id:'trip',date:'2026-10-01',attendees:['alice'],expenses:[{id:'expense',category:'Transport',amount:100}],totalCost:100,reimbursementStatus:'draft',createdAt:'old',createdBy:'alice',legacy:{keep:true}}],otherEntries:[{id:'entry',date:'2026-10-01',category:'Other',description:'Permit',amount:20,createdBy:'legacy',createdAt:'old'}],legacy:{keep:true}}],
  ]);
  const versions=new Map([...docs.keys()].map(path=>[path,1]));let clock=1;
  const ref=path=>({path,doc:id=>ref(`${path}/${id}`),collection:name=>ref(`${path}/${name}`),limit:limit=>({path,limit,query:true})});
  const snap=path=>({exists:docs.has(path),id:path.split('/').at(-1),ref:ref(path),data:()=>clone(docs.get(path)),updateTime:{seconds:10,nanoseconds:versions.get(path)||1}});
  const rows=path=>[...docs.keys()].filter(key=>key.startsWith(path+'/')&&key.slice(path.length+1).indexOf('/')<0).sort();
  const stamp=(path,query)=>JSON.stringify(query?rows(path).map(key=>[key,versions.get(key),docs.get(key)]):[versions.get(path),docs.get(path)]);
  const db={collection:ref,runTransaction:async(fn,_settings)=>{
    for(let attempt=0;attempt<8;attempt++){
      const writes=[],reads=[];
      const result=await fn({get:async r=>{assert.equal(writes.length,0,'all reads before writes');await options.onRead?.(r.path,users,docs,versions);reads.push([r.path,!!r.query,stamp(r.path,r.query)]);return r.query?{docs:rows(r.path).slice(0,r.limit).map(snap)}:snap(r.path);},
        create:(r,value)=>{if(options.failAudit&&r.path.includes('/audit/'))throw Error('audit failed');if(options.failArchive&&r.path.startsWith('pulseDeletedOverheads/'))throw Error('archive failed');if(options.failOutbox&&r.path.startsWith('pulseExpenseApprovalNotifications/'))throw Error('outbox failed');writes.push(['create',r.path,value]);},
        set:(r,value)=>writes.push(['set',r.path,value]),update:(r,value)=>writes.push(['update',r.path,value]),delete:r=>writes.push(['delete',r.path])});
      if(options.beforeCommit){const hook=options.beforeCommit;options.beforeCommit=null;await hook(docs,versions);}
      if(reads.some(([path,query,value])=>stamp(path,query)!==value))continue;
      for(const[kind,path]of writes)if(kind!=='set')assert.equal(docs.has(path),kind==='update'||kind==='delete');
      for(const[kind,path,value]of writes){if(kind==='delete')docs.delete(path);else docs.set(path,clone(kind==='create'||kind==='set'?value:{...docs.get(path),...value}));versions.set(path,++clock);}
      if(options.afterApply&&writes.length){const hook=options.afterApply;options.afterApply=null;await hook(writes,docs,versions);}
      if(options.loseCommitReply&&writes.length){options.loseCommitReply=false;throw options.commitReplyError||Error('lost reply');}
      return result;
    }
    throw Error('contention');
  }};
  const auth={verifyIdToken:async()=>({uid,email:users.get(uid)?.email}),getUser:async id=>clone(users.get(id))};
  const handler=createNativeOverheadOperations({db,auth,enabled:()=>options.enabled!==false,now:()=>new Date('2026-10-15T00:00:00Z'),getServerTimestamp:()=>new Date('2026-10-15T00:00:00Z')});
  const call=extra=>handler({auth:{uid},rawRequest:{get:()=> 'Bearer fake'},data:{operation:'get',project_id:'P',expected_actor_uid:uid,...extra}});
  const issue=async(command,extra={})=>{const opening=await call();return call({operation:'command',expected_project_version:opening.project_version,expected_version:opening.version,operation_id:'operation-1',command,...extra});};
  return{docs,versions,users,auth,db,call,issue,options};
}
module.exports={fixture};
