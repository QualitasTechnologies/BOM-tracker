const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
test('internal viewers create with an atomic legal-entity number, derived totals and immutable replay', async () => {
  const f = fixture(), result = await f.create(); assert.equal(result.ok, true);
  const po = f.docs.get('projects/P/purchaseOrders/created');
  assert.match(po.poNumber, /PO-\d{4}-007/); assert.equal(po.createdBy, 'alice'); assert.equal(po.status, 'draft'); assert.equal(po.totalAmount, 23.6);
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 8); assert.equal(f.docs.get('billingEntities/B').legacy, 'keep');
  assert.deepEqual(await f.create(), result); assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 8);
  assert.equal((await f.create({ input: { ...f.input, paymentTerms: 'Changed' } })).error, 'operation_conflict');
});
test('transaction retry allocates the next actual counter and never overwrites another PO', async () => {
  const f = fixture({ beforeCommit: (docs, versions) => { docs.get('billingEntities/B').nextPoNumber = 8; versions.set('billingEntities/B', 99); } });
  assert.equal((await f.create()).ok, true); assert.match(f.docs.get('projects/P/purchaseOrders/created').poNumber, /-008$/); assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 9);
});
test('legacy company counter uses the same atomic path and audit failure rolls everything back', async () => {
  const f = fixture(); assert.equal((await f.create({ input: { ...f.input, billingEntityId: 'company' } })).ok, true); assert.equal(f.docs.get('settings/company').nextPoNumber, 8);
  const g = fixture({ failAudit: true }); assert.equal((await g.create()).ok, false); assert.equal(g.docs.has('projects/P/purchaseOrders/created'), false); assert.equal(g.docs.get('billingEntities/B').nextPoNumber, 7);
});
test('creation rejects stale BOM, duplicate identity, changed masters and invalid selected items', async () => {
  const f = fixture(); assert.equal((await f.create({ expected_material_version: '10:2' })).error, 'material_version_conflict');
  assert.equal((await f.create({ po_id: 'existing' })).error, 'purchase_order_exists');
  f.docs.get('vendors/V').company = 'Changed'; assert.equal((await f.create()).error, 'vendor_version_conflict');
  const g = fixture(); g.docs.get('billingEntities/B').gstin = 'Changed'; assert.equal((await g.create()).error, 'billing_version_conflict');
  const h = fixture(); assert.equal((await h.create({ input: { ...h.input, items: [{ ...h.input.items[0], bomItemId: 'missing' }] } })).error, 'material_not_found');
});
test('members including partners edit/submit drafts, preserve history and clear an explicit date', async () => {
  const f = fixture({ uid: 'partner' });
  assert.equal((await f.command({ kind: 'edit', patch: { paymentTerms: 'New', expectedDeliveryDate: null } })).ok, true);
  const po = f.docs.get('projects/P/purchaseOrders/existing'); assert.equal(po.paymentTerms, 'New'); assert.equal(po.expectedDeliveryDate, null); assert.deepEqual(po.historical, { retained: true });
  assert.equal((await f.command({ kind: 'edit', patch: { items: [] } }, { operation_id: 'invalid' })).error, 'invalid_po_command');
  const g = fixture({ uid: 'partner' }); assert.equal((await g.command()).ok, true); assert.equal(g.docs.get('projects/P/purchaseOrders/existing').status, 'pending-approval');
});
test('only admins request changes and status/revision/send-attempt conflicts do not write', async () => {
  const f = fixture(); f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval'; assert.equal((await f.command({ kind: 'request_changes', note: 'Fix' })).error, 'procurement_forbidden');
  const g = fixture({ uid: 'admin' }); g.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval'; assert.equal((await g.command({ kind: 'request_changes', note: 'Fix' })).ok, true); assert.equal(g.docs.get('projects/P/purchaseOrders/existing').status, 'draft');
  const h = fixture(); assert.equal((await h.command(undefined, { expected_po_version: '10:9' })).error, 'po_version_conflict'); h.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId = 'active'; assert.equal((await h.command()).error, 'purchase_order_attempt_active');
  const s = fixture(); s.docs.get('projects/P/purchaseOrders/existing').status = 'sent'; assert.equal((await s.command()).error, 'purchase_order_state_conflict');
});
test('fresh actor/current access applies before writes and on replay, never a selected UID', async () => {
  const f = fixture({ uid: 'outsider' }); assert.equal((await f.command()).error, 'project_forbidden');
  const p = fixture({ uid: 'partner' }); assert.equal((await p.create()).error, 'procurement_forbidden');
  const g = fixture(); const first = await g.command(); assert.equal(first.ok, true); g.docs.get('projects/P').memberIds = []; assert.equal((await g.command()).error, 'project_forbidden');
  const h = fixture(); assert.equal((await h.command(undefined, { expected_actor_uid: 'admin' })).error, 'actor_session_changed');
  const j = fixture({ onRead: (path, users) => { if (path.includes('/receipts/')) users.get('alice').disabled = true; } }); assert.equal((await j.command()).error, 'actor_forbidden'); assert.equal(j.docs.get('projects/P/purchaseOrders/existing').status, 'draft');
});
test('default-off and read-only controls block mutations while authorized receipt replay is preserved', async () => {
  const f = fixture({ enabled: false }); assert.equal((await f.command()).error, 'po_authoring_disabled');
  const g = fixture(); g.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); assert.equal((await g.command()).error, 'po_authoring_read_only');
  const h = fixture(); const result = await h.command(); h.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); assert.deepEqual(await h.command(), result);
});
test('legacy POs without a duplicated projectId still use collection membership and expose canonical identity', async () => {
  const f = fixture(); delete f.docs.get('projects/P/purchaseOrders/existing').projectId;
  const opened = await f.call({ operation:'open',po_id:'existing' }); assert.equal(opened.ok,true); assert.equal(opened.purchase_order.projectId,'P');
  assert.equal((await f.command()).ok,true);
});
test('invalid calendar dates are rejected without modifying the draft', async () => {
  const f = fixture(); assert.equal((await f.command({ kind:'edit',patch:{expectedDeliveryDate:'2026-02-30'} })).error,'invalid_po_date');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').expectedDeliveryDate.toISOString(),'2026-11-01T00:00:00.000Z');
});
test('server numbering follows the Indian financial-year boundary with the original format', async () => {
  for (const [instant,year] of [['2025-03-31T18:00:00Z','24-25'],['2025-03-31T19:00:00Z','25-26']]) {
    const f = fixture({now:instant}); f.docs.get('billingEntities/B').poNumberFormat = 'financial-year';
    assert.equal((await f.create()).ok,true); assert.equal(f.docs.get('projects/P/purchaseOrders/created').poNumber,`PO/${year}/007`);
  }
});
test('creation only uses items assigned to the selected active vendor and original state-name fallback',async()=>{
  const f=fixture(); f.docs.get('projects/P/bom/data').categories[0].items[0].finalizedVendor.name='Other'; assert.equal((await f.create()).error,'vendor_item_conflict');
  const g=fixture(); g.docs.get('vendors/V').status='inactive'; assert.equal((await g.create()).error,'vendor_version_conflict');
  const h=fixture(); delete h.docs.get('vendors/V').stateName; assert.equal((await h.create()).ok,true);
});
test('creation opening returns the exact material snapshot for the displayed selection',async()=>{
  const f=fixture();const opened=await f.call({operation:'open'});assert.deepEqual(opened.categories,f.docs.get('projects/P/bom/data').categories);assert.equal(opened.material_version,'10:1');
});
test('lost commit acknowledgments preserve a recoverable receipt and do not consume another number',async()=>{
  const f=fixture({loseCommitReply:true});assert.equal((await f.create()).error,'po_authoring_unavailable');assert.equal(f.docs.has('projects/P/purchaseOrders/created'),true);
  assert.equal((await f.create()).ok,true);assert.equal(f.docs.get('billingEntities/B').nextPoNumber,8);
  const g=fixture({loseCommitReply:true});assert.equal((await g.command()).error,'po_authoring_unavailable');assert.equal((await g.command()).ok,true);
  assert.equal([...g.docs.keys()].filter(path=>path.includes('pulsePOAuthoringOperations/P/audit/')).length,1);
});

test('cancellation competes atomically with a staged delayed create and prevents its commit', async () => {
  let f;
  f = fixture({ beforeCommit: async () => {
    assert.equal((await f.create({ resolve_only: true })).resolution, 'cancelled');
  } });
  assert.equal((await f.create()).error, 'po_request_cancelled');
  assert.equal(f.docs.has('projects/P/purchaseOrders/created'), false);
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 7);
  assert.equal((await f.create({ resolve_only: true })).resolution, 'cancelled');
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});

test('if the original create wins, resolution confirms it rather than claiming cancellation', async () => {
  let f;
  f = fixture({ beforeCommit: async () => { assert.equal((await f.create()).ok, true); } });
  const resolved = await f.create({ resolve_only: true });
  assert.equal(resolved.ok, true); assert.equal(resolved.resolution, 'committed');
  assert.equal(resolved.po_id, 'created'); assert.equal(resolved.operation_id, 'create-1');
  assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 8);
  assert.equal([...f.docs.keys()].filter(path => path.includes('/audit/')).length, 1);
});

test('lost cancellation acknowledgment is replayable and cancellation audit failure rolls back', async () => {
  const f = fixture({ loseCommitReply: true });
  assert.equal((await f.command(undefined, { resolve_only: true })).error, 'po_authoring_unavailable');
  assert.equal((await f.command()).error, 'po_request_cancelled');
  assert.equal((await f.command(undefined, { resolve_only: true })).resolution, 'cancelled');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').status, 'draft');
  const g = fixture({ failAudit: true });
  assert.equal((await g.create({ resolve_only: true })).error, 'po_authoring_unavailable');
  assert.equal([...g.docs.keys()].filter(path => path.includes('/receipts/')).length, 0);
});

test('resolution allows recovery with writes off or read-only, but keeps current access and exact identity', async () => {
  let enabled = true; const f = fixture({ enabled: () => enabled });
  const saved = await f.create(); enabled = false;
  assert.deepEqual(await f.create(), saved);
  assert.equal((await f.create({ resolve_only: true })).resolution, 'committed');
  assert.equal((await f.create({ po_id: 'new', operation_id: 'new' })).error, 'po_authoring_disabled');
  const g = fixture({ enabled: false }); g.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await g.command(undefined, { resolve_only: true })).resolution, 'cancelled');
  assert.equal((await g.command({ kind: 'edit', patch: { paymentTerms: 'Other' } }, { resolve_only: true })).error, 'operation_conflict');
  g.docs.get('projects/P').memberIds = [];
  assert.equal((await g.command(undefined, { resolve_only: true })).error, 'project_forbidden');
  const h = fixture(); h.docs.set('pulseRuntimeControl/cutover', { mode: 'unknown' });
  assert.equal((await h.command(undefined, { resolve_only: true })).error, 'po_authoring_control_unavailable');
  assert.equal((await h.command(undefined, { resolve_only: false })).error, 'invalid_po_request');
  assert.equal((await h.call({ operation: 'open', resolve_only: true })).error, 'invalid_po_request');
});

test('provider-shaped commit errors remain sanitized and unconfirmed until receipt resolution', async () => {
  for (const code of ['private_provider_detail', 4]) {
    const f = fixture({ loseCommitReply: true, commitReplyError: Object.assign(new Error('private diagnostic'), { status:503,code }) });
    assert.deepEqual(await f.create(), {ok:false,error:'po_authoring_unavailable'});
    assert.equal((await f.create({resolve_only:true})).resolution, 'committed');
    assert.equal(f.docs.get('billingEntities/B').nextPoNumber, 8);
  }
});

test('original members including partners delete every PO status and preserve a protected complete record', async () => {
  for (const uid of ['alice','partner','admin']) for (const status of ['draft','pending-approval','sent','closed','cancelled']) {
    const f=fixture({uid}); f.docs.get('projects/P/purchaseOrders/existing').status=status;
    const before=structuredClone(f.docs.get('projects/P/purchaseOrders/existing'));
    assert.equal((await f.call({operation:'open',po_id:'existing'})).permissions.delete,true);
    const result=await f.command({kind:'delete'}); assert.equal(result.ok,true); assert.equal(result.kind,'delete');
    assert.equal(f.docs.has('projects/P/purchaseOrders/existing'),false);
    const archive=f.docs.get('pulseDeletedPurchaseOrders/P/purchaseOrders/existing');
    assert.deepEqual(archive.record,before);assert.equal(archive.actor_uid,uid);assert.equal(archive.po_id,'existing');assert.equal(archive.revision,'10:1');
    assert.deepEqual(await f.command({kind:'delete'}),result);
    assert.equal((await f.command({kind:'delete'},{resolve_only:true})).resolution,'committed');
    assert.equal(f.docs.get('billingEntities/B').nextPoNumber,7);assert.deepEqual(f.docs.get('projects/P/bom/data').categories[0].items[0].finalizedVendor,{name:'Vendor'});
  }
});

test('delete rejects stale revision, active send and archive identity reuse without removing anything', async () => {
  const f=fixture();assert.equal((await f.command({kind:'delete'},{expected_po_version:'10:9'})).error,'po_version_conflict');
  f.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId='sending';
  assert.equal((await f.command({kind:'delete'})).error,'purchase_order_attempt_active');
  assert.equal((await f.call({operation:'open',po_id:'existing'})).permissions.delete,false);
  const g=fixture();g.docs.set('pulseDeletedPurchaseOrders/P/purchaseOrders/existing',{record:{historical:'original'}});
  assert.equal((await g.command({kind:'delete'})).error,'purchase_order_identity_reused');
  assert.equal(g.docs.has('projects/P/purchaseOrders/existing'),true);assert.deepEqual(g.docs.get('pulseDeletedPurchaseOrders/P/purchaseOrders/existing').record,{historical:'original'});
  const h=fixture();h.docs.set('pulseDeletedPurchaseOrders/P/purchaseOrders/created',{record:{keep:true}});
  assert.equal((await h.create()).error,'purchase_order_deleted');
});

test('delete current access, disabled writes, audit rollback and lost ACK do not lose protected history', async () => {
  const outsider=fixture({uid:'outsider'});assert.equal((await outsider.command({kind:'delete'})).error,'project_forbidden');
  const off=fixture({enabled:false});assert.equal((await off.command({kind:'delete'})).error,'po_authoring_disabled');
  const rollback=fixture({failAudit:true});assert.equal((await rollback.command({kind:'delete'})).error,'po_authoring_unavailable');
  assert.equal(rollback.docs.has('projects/P/purchaseOrders/existing'),true);assert.equal(rollback.docs.has('pulseDeletedPurchaseOrders/P/purchaseOrders/existing'),false);
  let enabled=true;const lost=fixture({enabled:()=>enabled,loseCommitReply:true});assert.equal((await lost.command({kind:'delete'})).error,'po_authoring_unavailable');
  enabled=false;assert.equal((await lost.command({kind:'delete'},{resolve_only:true})).resolution,'committed');
  lost.docs.get('projects/P').memberIds=[];assert.equal((await lost.command({kind:'delete'},{resolve_only:true})).error,'project_forbidden');
  assert.equal(lost.docs.get('pulseDeletedPurchaseOrders/P/purchaseOrders/existing').record.historical.retained,true);
});

test('cancelling a staged delayed deletion fences it while a committed delete resolves once', async () => {
  let f;f=fixture({beforeCommit:async()=>{assert.equal((await f.command({kind:'delete'},{resolve_only:true})).resolution,'cancelled');}});
  assert.equal((await f.command({kind:'delete'})).error,'po_request_cancelled');assert.equal(f.docs.has('projects/P/purchaseOrders/existing'),true);assert.equal(f.docs.has('pulseDeletedPurchaseOrders/P/purchaseOrders/existing'),false);
  let g;g=fixture({beforeCommit:async()=>{assert.equal((await g.command({kind:'delete'})).ok,true);}});
  assert.equal((await g.command({kind:'delete'},{resolve_only:true})).resolution,'committed');assert.equal([...g.docs.keys()].filter(path=>path.includes('/audit/')).length,1);
});

test('completed sends retain their pointer for history but do not permanently block original deletion', async () => {
  const f=fixture();f.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId='done';
  f.docs.get('projects/P/purchaseOrders/existing').status='sent';
  f.docs.set('pulseProcurementOperations/P/attempts/done',{attempt_id:'done',po_id:'existing',phase:'complete',lease_until:0,dispatched_ms:1});
  assert.equal((await f.call({operation:'open',po_id:'existing'})).permissions.delete,true);
  assert.equal((await f.command({kind:'delete'})).ok,true);
  assert.equal(f.docs.get('pulseDeletedPurchaseOrders/P/purchaseOrders/existing').record.nativeSendAttemptId,'done');
  for (const patch of [{phase:'accepted'},{po_id:'different'},{lease_until:99},{phase:'cancelled',dispatched_ms:1}]) {
    const g=fixture();g.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId='done';
    g.docs.set('pulseProcurementOperations/P/attempts/done',{attempt_id:'done',po_id:'existing',phase:'complete',lease_until:0,...patch});
    assert.equal((await g.command({kind:'delete'})).error,'purchase_order_attempt_active');
  }
});

test('opening rechecks the current actor after reading the protected send journal', async () => {
  const f=fixture({onRead:(path,users)=>{if(path==='pulseProcurementOperations/P/attempts/done')users.get('alice').disabled=true;}});
  f.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId='done';
  f.docs.set('pulseProcurementOperations/P/attempts/done',{attempt_id:'done',po_id:'existing',phase:'complete',lease_until:0});
  assert.equal((await f.call({operation:'open',po_id:'existing'})).error,'actor_forbidden');
});

test('membership removed during archive reads prevents deletion and a newly active send overrides opening permission', async () => {
  const f=fixture({onRead:(path,users,docs)=>{if(path==='pulseDeletedPurchaseOrders/P/purchaseOrders/existing')docs.get('projects/P').memberIds=[];}});
  assert.equal((await f.command({kind:'delete'})).error,'project_forbidden');
  assert.equal(f.docs.has('projects/P/purchaseOrders/existing'),true);assert.equal(f.docs.has('pulseDeletedPurchaseOrders/P/purchaseOrders/existing'),false);
  const g=fixture();g.docs.get('projects/P/purchaseOrders/existing').nativeSendAttemptId='done';
  g.docs.set('pulseProcurementOperations/P/attempts/done',{attempt_id:'done',po_id:'existing',phase:'complete',lease_until:0});
  assert.equal((await g.call({operation:'open',po_id:'existing'})).permissions.delete,true);
  g.docs.get('pulseProcurementOperations/P/attempts/done').phase='dispatching';
  assert.equal((await g.command({kind:'delete'})).error,'purchase_order_attempt_active');
});

test('a legacy PO exceeding the archive safety budget stays intact with no partial delete or journal', async () => {
  const f=fixture();f.docs.get('projects/P/purchaseOrders/existing').legacyPayload='x'.repeat(940000);
  assert.equal((await f.command({kind:'delete'})).error,'po_authoring_unavailable');
  assert.equal(f.docs.get('projects/P/purchaseOrders/existing').legacyPayload.length,940000);
  assert.equal(f.docs.has('pulseDeletedPurchaseOrders/P/purchaseOrders/existing'),false);
  assert.equal([...f.docs.keys()].filter(path=>path.includes('/audit/')||path.includes('/receipts/')).length,0);
});
