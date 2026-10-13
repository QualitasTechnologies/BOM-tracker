const test = require('node:test');
const assert = require('node:assert/strict');
let createNativeMaterialOperations;
try { ({ createNativeMaterialOperations } = require('./nativeMaterialOperations.cjs')); } catch {}

function fixture({ enabled, tokenError = false } = {}) {
  const actor = { uid: 'native-uid', email: 'partner@example.com', emailVerified: true, disabled: false, customClaims: { role: 'viewer', status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const docs = new Map([
    ['projects/A', { memberIds: [actor.uid], members: [{ userId: actor.uid, categoryScope: ['Mech'] }] }],
    ['projects/A/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'motor', name: 'Original', quantity: 1 }] }, { name: 'Other', items: [{ id: 'hidden' }] }] }]
  ]);
  let tick = 1; const checks = [];
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`) });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const writes = [];
    const result = await fn({
      get: async row => ({ exists: docs.has(row.path), data: () => structuredClone(docs.get(row.path)), updateTime: { seconds: 10, nanoseconds: tick } }),
      update: (row, fields) => writes.push(() => docs.set(row.path, { ...docs.get(row.path), ...fields })),
      create: (row, data) => writes.push(() => docs.set(row.path, data))
    });
    writes.forEach(write => write()); if (writes.length) tick++;
    return result;
  } };
  const auth = { verifyIdToken: async (value, revoked) => { checks.push({ value, revoked }); if (tokenError) throw Error('private token diagnostic'); return token; }, getUser: async () => actor };
  const call = createNativeMaterialOperations({ db, auth, ...(enabled === undefined ? {} : { mutationsEnabled: enabled }), getServerTimestamp: () => 'server-time' });
  const request = { auth: { uid: actor.uid }, rawRequest: { get: name => name.toLowerCase() === 'authorization' ? 'Bearer actual-token' : undefined }, data: { operation: 'get', project_id: 'A' } };
  const invoke = data => call({ ...request, data: data || request.data });
  const patch = { operation: 'patch', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'stable-op', patch: { name: 'Changed' } };
  return { actor, token, docs, checks, request, call, invoke, patch };
}

test('native material transport reuses Firebase identity, scoped engine and displayed version', async () => {
  const f = fixture(); const result = await f.invoke();
  assert.equal(result.ok, true); assert.equal(result.version, '10:1');
  assert.deepEqual(result.categories.map(row => row.name), ['Mech']);
  assert.equal(result.permissions.edit, false);
  assert.deepEqual(f.checks, [{ value: 'actual-token', revoked: true }]);
});

test('native writes default off even with an approved Firebase viewer', async () => {
  const f = fixture(); assert.deepEqual(await f.invoke(f.patch), { ok: false, error: 'material_mutations_disabled' }); assert.equal(f.docs.size, 2);
});

test('native patch creates actual Firebase UID audit and idempotent receipt using the existing engine', async () => {
  const f = fixture({ enabled: true }); const first = await f.invoke(f.patch);
  assert.equal(first.ok, true); assert.deepEqual(await f.invoke(f.patch), first);
  const audit = f.docs.get('pulseProjectMaterialOperations/A/materialAudit/stable-op');
  assert.equal(audit.actor_uid, f.actor.uid); assert.equal(audit.actor_email, f.actor.email);
  assert.deepEqual(audit.before, { name: 'Original' }); assert.deepEqual(audit.after, { name: 'Changed' });
  assert.equal(f.docs.size, 4);
});

test('native token and callable identities must agree; request-selected actors are rejected', async () => {
  const f = fixture(); f.request.auth.uid = 'forged';
  assert.deepEqual(await f.invoke(), { ok: false, error: 'actor_forbidden' });
  f.request.auth.uid = f.actor.uid;
  assert.deepEqual(await f.invoke({ ...f.request.data, actor_uid: 'admin', email: 'admin@example.com' }), { ok: false, error: 'invalid_material_request' });
});

test('native revoked, anonymous and missing bearer requests fail without business writes or diagnostics', async () => {
  const f = fixture({ tokenError: true }); assert.deepEqual(await f.invoke(), { ok: false, error: 'actor_authentication_required' });
  for (const change of [r => { r.auth = null; }, r => { r.rawRequest = null; }]) {
    const g = fixture(); change(g.request); assert.deepEqual(await g.invoke(), { ok: false, error: 'actor_authentication_required' }); assert.equal(g.docs.size, 2);
  }
});

test('current approval, verification, disable and changed email override old Firebase claims', async () => {
  for (const change of [a => { a.disabled = true; }, a => { a.emailVerified = false; }, a => { a.customClaims.status = 'pending'; }, a => { a.email = 'changed@example.com'; }, a => { a.tokensValidAfterTime = new Date(1900000000000).toISOString(); }]) {
    const f = fixture(); change(f.actor); assert.deepEqual(await f.invoke(), { ok: false, error: 'actor_forbidden' });
  }
});

test('native BOM admin rights do not depend on Pulse directory or company domain', async () => {
  const f = fixture(); f.actor.customClaims.role = 'admin'; f.docs.get('projects/A').memberIds = [];
  assert.equal((await f.invoke()).categories.length, 2);
});

test('native patch preserves current membership/category, revision and operation collision safeguards', async () => {
  const f = fixture({ enabled: true });
  assert.deepEqual(await f.invoke({ ...f.patch, expected_version: '10:0' }), { ok: false, error: 'material_version_conflict' });
  assert.deepEqual(await f.invoke({ ...f.patch, item_id: 'hidden' }), { ok: false, error: 'material_forbidden' });
  assert.equal((await f.invoke(f.patch)).ok, true);
  assert.deepEqual(await f.invoke({ ...f.patch, patch: { name: 'Other' } }), { ok: false, error: 'operation_conflict' });
  f.docs.get('projects/A').memberIds = [];
  assert.deepEqual(await f.invoke(f.patch), { ok: false, error: 'project_forbidden' });
});

test('native request validation rejects extra resources and malformed operations', async () => {
  const f = fixture();
  for (const data of [null, [], { operation: 'delete', project_id: 'A' }, { operation: 'get', project_id: 'A', resource: 'procurement' }, { operation: 'get', project_id: '../A' }]) {
    assert.equal((await f.call({ ...f.request, data })).ok, false);
  }
});

test('native fulfill uses displayed revision, native actor and shared audit engine', async () => {
  const f = fixture({ enabled: true });
  f.docs.get('projects/A/bom/data').categories[0].items[0].itemType = 'service';
  const data = { operation: 'fulfill', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'fulfill-1', fulfillment: { kind: 'fulfillment', quantity: 1 } };
  const result = await f.invoke(data); assert.equal(result.ok, true); assert.equal(result.item.status, 'received');
  assert.deepEqual(await f.invoke(data), result);
  assert.equal(f.docs.get('pulseProjectMaterialOperations/A/materialAudit/fulfill-1').actor_uid, f.actor.uid);
  f.docs.get('projects/A').memberIds = []; assert.deepEqual(await f.invoke(data), { ok: false, error: 'project_forbidden' });
  const g = fixture(); assert.deepEqual(await g.invoke(data), { ok: false, error: 'material_mutations_disabled' });
});

test('fulfillment actor assertion rejects SDK account switches before business writes', async () => {
  const f = fixture({ enabled: true }); const openingUid = f.actor.uid;
  const data = { operation: 'fulfill', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'bound-op', expected_actor_uid: openingUid, fulfillment: { kind: 'fulfillment', quantity: 1 } };
  f.docs.get('projects/A/bom/data').categories[0].items[0].itemType = 'service';
  f.actor.uid = 'second-authorized-uid'; f.token.uid = f.actor.uid; f.request.auth.uid = f.actor.uid;
  f.docs.get('projects/A').memberIds.push(f.actor.uid); f.docs.get('projects/A').members.push({ userId: f.actor.uid, categoryScope: ['Mech'] });
  assert.deepEqual(await f.invoke(data), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.size, 2);
  const result = await f.invoke({ ...data, expected_actor_uid: f.actor.uid }); assert.equal(result.ok, true);
  assert.equal(f.docs.get('pulseProjectMaterialOperations/A/materialAudit/bound-op').actor_uid, f.actor.uid);
});
test('fulfillment actor assertion cannot select a forged actor or accept malformed identity', async () => {
  for (const expected_actor_uid of ['forged-admin', '', null, 1, {}, []]) {
    const f = fixture({ enabled: true });
    const data = { operation: 'fulfill', project_id: 'A', item_id: 'motor', expected_version: '10:1', operation_id: 'bound-op', expected_actor_uid, fulfillment: { kind: 'fulfillment', quantity: 1 } };
    assert.deepEqual(await f.invoke(data), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.size, 2);
  }
  const f = fixture({ enabled: true });
  assert.equal((await f.invoke({ ...f.patch, expected_actor_uid: f.actor.uid })).ok, true);
  assert.deepEqual(await f.invoke({ ...f.request.data, expected_actor_uid: f.actor.uid }), { ok: false, error: 'invalid_material_request' });
});

test('patch actor assertion rejects an authorized account switch and audits only matching verified actor', async () => {
  const f = fixture({ enabled: true }); const openingUid = f.actor.uid;
  f.actor.uid = 'second-authorized-uid'; f.token.uid = f.actor.uid; f.request.auth.uid = f.actor.uid;
  f.docs.get('projects/A').memberIds.push(f.actor.uid); f.docs.get('projects/A').members.push({ userId: f.actor.uid, categoryScope: ['Mech'] });
  assert.deepEqual(await f.invoke({ ...f.patch, expected_actor_uid: openingUid }), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.size, 2);
  assert.equal((await f.invoke({ ...f.patch, expected_actor_uid: f.actor.uid })).ok, true);
  assert.equal(f.docs.get('pulseProjectMaterialOperations/A/materialAudit/stable-op').actor_uid, f.actor.uid);
});
test('patch actor assertion rejects malformed and forged UIDs without selecting identity', async () => {
  for (const expected_actor_uid of ['forged-admin', '', null, 1, {}, []]) {
    const f = fixture({ enabled: true }); assert.deepEqual(await f.invoke({ ...f.patch, expected_actor_uid }), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.size, 2);
  }
});

test('native bounded command uses current verified identity, displayed revision and stable receipt', async () => {
  const f = fixture({ enabled: true });
  const data = { operation: 'command', project_id: 'A', expected_version: '10:1', operation_id: 'delete-command', expected_actor_uid: f.actor.uid, command: { kind: 'delete_items', item_ids: ['motor'] } };
  assert.deepEqual(await f.invoke({ ...data, expected_actor_uid: 'another' }), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.size, 2);
  const result = await f.invoke(data); assert.deepEqual(result, { ok: true, project_id: 'A', operation_id: 'delete-command', command_kind: 'delete_items' }); assert.deepEqual(await f.invoke(data), result);
  assert.equal(f.docs.get('pulseProjectMaterialOperations/A/materialAudit/delete-command').actor_uid, f.actor.uid);
  f.docs.get('projects/A').members = []; assert.deepEqual(await f.invoke(data), { ok: false, error: 'material_forbidden' });
  const g = fixture(); assert.deepEqual(await g.invoke({ ...data, expected_actor_uid: g.actor.uid }), { ok: false, error: 'material_mutations_disabled' });
});
