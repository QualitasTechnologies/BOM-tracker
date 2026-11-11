const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { createNativePOAuthoringOperations } = require('./nativePOAuthoringOperations.cjs');
function setup(options = {}) {
  const f = fixture(options), uid = options.uid || 'alice';
  f.docs.delete('pulseRuntimeControl/cutover');
  const handler = createNativePOAuthoringOperations({db:f.db,auth:f.auth,enabled:true,legacyCreateOnly:true,getServerTimestamp:()=>new Date('2026-11-11T00:00:00Z')});
  const call = data => handler({auth:{uid},rawRequest:{get:()=> 'Bearer test'},data:{project_id:'P',expected_actor_uid:uid,...data}});
  const create = extra => call({operation:'create',po_id:'created',operation_id:'request-1',expected_material_version:'10:1',input:f.input,billing_snapshot:f.billingSnapshot,...extra});
  return {...f,call,create};
}
test('approved project member creates draft and advances protected counter atomically without admin privileges',async()=>{
  const f=setup(); const opening=await f.call({operation:'open'});
  assert.equal(opening.permissions.create,true);
  assert.equal((await f.create()).ok,true);
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber,8);
  assert.equal(f.docs.get('projects/P/purchaseOrders/created').createdBy,'alice');
  assert.equal(f.docs.get('projects/P/purchaseOrders/created').status,'draft');
  assert.equal(f.docs.get('billingEntities/B').legacy,'keep');
});
test('lost commit acknowledgement replays the same draft and consumes only one number',async()=>{
  const f=setup({loseCommitReply:true});
  assert.equal((await f.create()).error,'po_authoring_unavailable');
  assert.equal((await f.create()).ok,true);
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber,8);
  assert.equal([...f.docs.keys()].filter(p=>p.startsWith('projects/P/purchaseOrders/')).length,2);
});
test('a failed transaction saves neither draft nor counter',async()=>{
  const f=setup({failAudit:true});
  assert.equal((await f.create()).error,'po_authoring_unavailable');
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber,7);
  assert.equal(f.docs.has('projects/P/purchaseOrders/created'),false);
});
test('create-only service refuses unrelated project access, edits and cutover fences',async()=>{
  assert.equal((await setup({uid:'outsider'}).create()).error,'project_forbidden');
  const f=setup();
  assert.equal((await f.call({operation:'command',po_id:'existing',operation_id:'x',expected_po_version:'10:1',command:{kind:'delete'}})).error,'invalid_po_request');
  for(const control of [{mode:'read_only'},{mode:'pulse_only'},{mode:'coexist',poCounterClientWritesFenced:true},{mode:'legacy',billingEntityClientWritesFenced:true}]){
    f.docs.set('pulseRuntimeControl/cutover',control);
    assert.equal((await f.call({operation:'open'})).permissions.create,false);
    assert.equal((await f.create()).error,'legacy_po_creation_fenced');
  }
});
test('concurrent counter allocation retries with the latest number and preserves entity fields',async()=>{
  const options={}, f=setup(options);
  options.beforeCommit=(docs,versions)=>{docs.get('billingEntities/B').nextPoNumber=8;versions.set('billingEntities/B',2);};
  assert.equal((await f.create()).ok,true);
  assert.match(f.docs.get('projects/P/purchaseOrders/created').poNumber,/-008$/);
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber,9);
});
test('role revocation before commit denies create and receipt replay',async()=>{
  const options={}, f=setup(options);
  options.onRead=(path,users)=>{if(path==='billingEntities/B')users.get('alice').customClaims.status='rejected';};
  assert.equal((await f.create()).error,'actor_forbidden');
  assert.equal(f.docs.has('projects/P/purchaseOrders/created'),false);
});

