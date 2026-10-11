const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectReviewHandler } = require('./projectReview.cjs');
const users = [
  {uid:'alice',email:'alice@example.com',emailVerified:true,customClaims:{role:'user',status:'approved'}},
  {uid:'bob',email:'bob@example.com',emailVerified:true,customClaims:{role:'viewer',status:'approved'}},
  {uid:'admin',email:'admin@example.com',emailVerified:true,customClaims:{role:'admin',status:'approved'}}
];
const data = {
  'projects/A':{projectId:'A',projectName:'Alice machine',category:'customer',memberIds:['alice'],members:[{userId:'alice',categoryScope:['Mech']}],poValue:9999},
  'projects/B':{projectId:'B',projectName:'Bob machine',memberIds:['bob']},
  'projects/legacy':{projectName:'Unmigrated'},
  'projects/A/bom/data':{categories:[{name:'Mech',items:[{name:'motor',quantity:2,status:'received',price:400,vendors:[{price:500}]}]},{name:'Secret',items:[{name:'secret',quantity:4,status:'ordered',price:900}]}]}
};
function fixture(userOverrides={}, projectOverrides={}) {
  const projectData={...data,...projectOverrides};
  const currentUsers=users.map(user=>({...user,...(userOverrides[user.uid]||{})}));
  const snapshot = path => ({id:path.split('/').at(-1),exists:!!projectData[path],data:()=>projectData[path]});
  const ref = path => ({doc:id=>ref(`${path}/${id}`),collection:id=>ref(`${path}/${id}`),get:async()=> path==='projects' ? {docs:Object.keys(projectData).filter(k=>/^projects\/[^/]+$/.test(k)).map(snapshot)} : snapshot(path),where:(field,op,value)=>({get:async()=>({docs:Object.keys(projectData).filter(k=>/^projects\/[^/]+$/.test(k)&&projectData[k][field]?.includes(value)).map(snapshot)})})});
  const auth={getUserByEmail:async email=>{const user=currentUsers.find(u=>u.email===email);if(!user)throw Object.assign(Error('missing'),{code:'auth/user-not-found'});return user;},getUser:async uid=>currentUsers.find(u=>u.uid===uid),verifyIdToken:async token=> {if(token==='revoked')throw Object.assign(Error('revoked'),{code:'auth/id-token-revoked'});return {uid:token,email:`${token}@example.com`};}};
  return createProjectReviewHandler({db:{collection:name=>ref(name)},auth,getServiceKey:()=> 'trusted-key'});
}
async function call(handler,email,id,extra={}) {
  const headers={'x-project-review-key':'trusted-key','x-pulse-user-email':email,'x-pulse-authenticated-at':'1800000000000',...extra};
  const req={method:'GET',query:id?{project_id:id}:{},get:name=>headers[name.toLowerCase()]};
  let status=200,body;const res={status:code=>{status=code;return res;},json:value=>{body=value;return res;},set(){}};
  await handler(req,res);return {status,body};
}
test('two approved members get only their own Firebase uid projects',async()=>{
  const handler=fixture();
  assert.deepEqual((await call(handler,'alice@example.com')).body.projects.map(p=>p.source_id),['A']);
  assert.deepEqual((await call(handler,'bob@example.com')).body.projects.map(p=>p.source_id),['B']);
});
test('direct detail rechecks access; missing membership never opens legacy project',async()=>{
  assert.equal((await call(fixture(),'bob@example.com','A')).status,403);
  assert.equal((await call(fixture(),'bob@example.com','legacy')).status,403);
});
test('trusted credential never grants an unknown actor access',async()=>{
  assert.equal((await call(fixture(),'unknown@example.com')).status,403);
  assert.equal((await call(fixture(),'alice@example.com',null,{'x-project-review-key':'bad'})).status,401);
});
test('disabled, suspended, unverified, revoked and mismatched token actors denied',async()=>{
  for(const override of [{disabled:true},{emailVerified:false},{customClaims:{role:'user',status:'suspended'}},{tokensValidAfterTime:new Date(1900000000000).toISOString()}]) {
    assert.equal((await call(fixture({alice:override}),'alice@example.com')).status,403);
  }
  assert.equal((await call(fixture(),'alice@example.com',null,{authorization:'Bearer revoked'})).status,401);
  assert.equal((await call(fixture(),'alice@example.com',null,{authorization:'Bearer bob'})).status,403);
});
test('material summary respects member category scope and never exposes financial fields',async()=>{
  const result=await call(fixture(),'alice@example.com','A');
  assert.equal(result.status,200);assert.deepEqual(result.body.project.material_summary,{item_count:1,component_count:1,service_count:0,status_counts:{'not-ordered':0,ordered:0,received:1}});
  const serialized=JSON.stringify(result.body);
  for(const forbidden of ['price','poValue','vendor','secret','cost','rate']) assert.equal(serialized.includes(forbidden),false);
});
test('admin sees legacy unclassified projects with sanitized fields',async()=>{
  const result=await call(fixture(),'admin@example.com');
  assert.equal(result.body.projects.length,3);
  assert.equal(result.body.projects.find(p=>p.source_id==='legacy').category,null);
  assert.equal(result.body.projects.some(p=>p.poValue),false);
});
test('external member without assigned categories sees no material counts',async()=>{
  const handler=fixture({}, {'projects/A':{...data['projects/A'],members:[]}});
  const result=await call(handler,'alice@example.com','A');
  assert.equal(result.body.project.material_summary.item_count,0);
});
test('revocation requires a sufficiently recent trusted sign-in',async()=>{
  const handler=fixture({alice:{tokensValidAfterTime:new Date(1700000000000).toISOString()}});
  assert.equal((await call(handler,'alice@example.com')).status,200);
  assert.equal((await call(handler,'alice@example.com',null,{'x-pulse-authenticated-at':undefined})).status,403);
});
test('malformed direct ID is rejected and absent project is not found',async()=>{
  assert.equal((await call(fixture(),'alice@example.com','A/bom')).status,400);
  assert.equal((await call(fixture(),'alice@example.com','absent')).status,404);
});
async function session(handler,email,query={resource:'session'},extra={}) {
  const headers={'x-project-review-key':'trusted-key','x-pulse-user-email':email,'x-pulse-authenticated-at':'1800000000000',...extra};
  const req={method:'GET',query,get:name=>headers[name.toLowerCase()]};
  let status=200,body;const res={status:code=>{status=code;return res;},json:value=>{body=value;return res;},set(){}};
  await handler(req,res);return {status,body};
}
test('session resource describes the verified actor without uid, claims or project data',async()=>{
  const external=await session(fixture(),'alice@example.com');
  assert.equal(external.status,200);
  assert.deepEqual(external.body,{ok:true,session:{email:'alice@example.com',name:null,role:'user',bom_admin:false,internal:false,partner:true,capabilities:{communications:false}}});
  const admin=await session(fixture(),'admin@example.com');
  assert.deepEqual(admin.body.session,{email:'admin@example.com',name:null,role:'admin',bom_admin:true,internal:false,partner:false,capabilities:{communications:true}});
  const internal=await session(fixture({bob:{email:'bob@qualitastech.com'}}),'bob@qualitastech.com');
  assert.deepEqual(internal.body.session,{email:'bob@qualitastech.com',name:null,role:'viewer',bom_admin:false,internal:true,partner:false,capabilities:{communications:true}});
  for(const forbidden of ['uid','customClaims','memberIds','projects']) assert.equal(JSON.stringify(external.body).includes(forbidden),false);
});
test('session resource keeps the viewer label from restricting anything and never grants admin',async()=>{
  const result=await session(fixture(),'bob@example.com');
  assert.equal(result.body.session.role,'viewer');assert.equal(result.body.session.bom_admin,false);
});
test('session resource applies the same actor denials as every other resource',async()=>{
  assert.equal((await session(fixture(),'unknown@example.com')).status,403);
  assert.equal((await session(fixture(),'alice@example.com',undefined,{'x-project-review-key':'bad'})).status,401);
  for(const override of [{disabled:true},{emailVerified:false},{customClaims:{role:'user',status:'suspended'}},{tokensValidAfterTime:new Date(1900000000000).toISOString()}]) {
    assert.equal((await session(fixture({alice:override}),'alice@example.com')).status,403);
  }
  assert.equal((await session(fixture({alice:{tokensValidAfterTime:new Date(1700000000000).toISOString()}}),'alice@example.com',undefined,{'x-pulse-authenticated-at':undefined})).status,403);
});
test('session resource rejects project ids and unknown resources',async()=>{
  assert.equal((await session(fixture(),'alice@example.com',{resource:'session',project_id:'A'})).status,400);
  assert.equal((await session(fixture(),'alice@example.com',{resource:'sessions'})).status,400);
});
