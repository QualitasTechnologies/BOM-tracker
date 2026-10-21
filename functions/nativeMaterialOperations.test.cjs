const test = require('node:test');
const assert = require('node:assert/strict');
let createNativeMaterialOperations;
try { ({ createNativeMaterialOperations } = require('./nativeMaterialOperations.cjs')); } catch {}

function fixture({ enabled, tokenError = false, onRead } = {}) {
  const actor = { uid: 'native-uid', email: 'partner@example.com', emailVerified: true, disabled: false, customClaims: { role: 'viewer', status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const docs = new Map([
    ['projects/A', { memberIds: [actor.uid], members: [{ userId: actor.uid, categoryScope: ['Mech'] }] }],
    ['projects/A/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'motor', name: 'Original', quantity: 1 }] }, { name: 'Other', items: [{ id: 'hidden' }] }] }]
  ]);
  let tick = 1; const checks = [];
  const query = (collection, filters = [], max = Infinity) => ({ collection, filters, max,
    where(field, op, value) { return query(collection, [...filters, [field, op, value]], max); },
    limit(value) { return query(collection, filters, value); } });
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`),
    where(field, op, value) { return query(path, [[field, op, value]]); }, limit(value) { return query(path, [], value); } });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const writes = [];
    const result = await fn({
      get: async row => { onRead?.(row, actor, token); return row.collection && row.filters
        ? { docs: [...docs].filter(([path, data]) => path.startsWith(`${row.collection}/`) && row.filters.every(([field, op, value]) => op === '==' ? data[field] === value : op === 'array-contains-any' ? Array.isArray(data[field]) && value.some(item => data[field].includes(item)) : false)).slice(0, row.max).map(([path, data]) => ({ id: path.slice(row.collection.length + 1), data: () => structuredClone(data) })) }
        : { exists: docs.has(row.path), data: () => structuredClone(docs.get(row.path)), updateTime: { seconds: 10, nanoseconds: tick } }; },
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
  assert.deepEqual(f.checks, [{ value: 'actual-token', revoked: true }, { value: 'actual-token', revoked: true }]);
});

test('material reads cannot publish an opening after actor approval or scope authority changes', async () => {
  const f = fixture({ onRead: (row, actor) => { if (row.path.endsWith('/bom/data')) actor.disabled = true; } });
  assert.deepEqual(await f.invoke(), { ok: false, error: 'actor_forbidden' });
  const g = fixture({ onRead: (row, actor) => { if (row.path.endsWith('/bom/data')) actor.customClaims.role = 'viewer'; } });
  g.actor.customClaims.role = 'admin';
  assert.deepEqual(await g.invoke(), { ok: false, error: 'actor_session_changed' });
});

test('explicit-null project membership preserves legacy material access with unchanged category scope and audited replay', async () => {
  for (const internal of [false, true]) {
    const f = fixture({ enabled: true });
    if (internal) f.actor.email = f.token.email = 'member@qualitastech.com';
    f.docs.get('projects/A').memberIds = null;
    const read = await f.invoke();
    assert.equal(read.ok, true);
    assert.deepEqual(read.categories.map(row => row.name), internal ? ['Mech', 'Other'] : ['Mech']);
    const saved = await f.invoke(f.patch);
    assert.equal(saved.ok, true);
    assert.deepEqual(await f.invoke(f.patch), saved);
    assert.equal(f.docs.size, 4);
    delete f.docs.get('projects/A').memberIds;
    const before = structuredClone(f.docs);
    assert.deepEqual(await f.invoke(), { ok: false, error: 'project_forbidden' });
    assert.deepEqual(await f.invoke(f.patch), { ok: false, error: 'project_forbidden' });
    assert.deepEqual(f.docs, before);
  }
});

test('explicit-null project access does not invent an external category grant', async () => {
  const f = fixture({ enabled: true });
  f.docs.get('projects/A').memberIds = null;
  f.docs.get('projects/A').members = [];
  const read = await f.invoke();
  assert.equal(read.ok, true);
  assert.deepEqual(read.categories, []);
  const before = structuredClone(f.docs);
  assert.deepEqual(await f.invoke(f.patch), { ok: false, error: 'material_forbidden' });
  assert.deepEqual(f.docs, before);
});

test('material GET scopes categories before safe serialization and rejects malformed visible state', async () => {
  const f = fixture();
  f.docs.get('projects/A/bom/data').categories = [
    f.docs.get('projects/A/bom/data').categories[0], null,
    { name: 1, items: [{ id: 'hidden' }] },
    { name: 'Other', items: [{ id: 'hidden' }], unsupported: Buffer.from([9]) }
  ];
  const scoped = await f.invoke();
  assert.equal(scoped.ok, true);
  assert.deepEqual(scoped.categories.map(category => category.name), ['Mech']);
  assert.equal(Object.hasOwn(scoped.categories[0], 'unsupported'), false);

  f.docs.get('projects/A/bom/data').categories[0].items[0].id = null;
  assert.deepEqual(await f.invoke(), { ok: false, error: 'materials_data_integrity' });
  f.docs.get('projects/A/bom/data').categories = null;
  assert.deepEqual(await f.invoke(), { ok: false, error: 'materials_data_integrity' });
  f.docs.get('projects/A/bom/data').categories = undefined;
  assert.deepEqual((await f.invoke()).categories, []);
  f.docs.delete('projects/A/bom/data');
  const absent = await f.invoke();
  assert.deepEqual(absent.categories, []);
  assert.equal(absent.version, 'missing');

  const admin = fixture();
  admin.actor.customClaims.role = 'admin';
  admin.docs.get('projects/A/bom/data').categories[1] = null;
  assert.deepEqual(await admin.invoke(), { ok: false, error: 'materials_data_integrity' });
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

test('native conditional project creation verifies the opening account and fresh current profile before writes', async () => {
  const f = fixture({ enabled: true }); f.actor.customClaims.role = 'admin'; f.actor.displayName = 'Fresh Display';
  const data = { operation: 'create_project', project_id: 'NEW', operation_id: 'create-1', expected_actor_uid: f.actor.uid, project: { projectName: 'New', clientName: 'Customer', description: '', status: 'Planning', deadline: '2026-12-01', poValue: 0 } };
  assert.deepEqual(await f.invoke({ ...data, expected_actor_uid: 'opening-account' }), { ok: false, error: 'actor_session_changed' }); assert.equal(f.docs.has('projects/NEW'), false);
  assert.deepEqual(await f.invoke(data), { ok: true, project_id: 'NEW', operation_id: 'create-1' }); assert.deepEqual(await f.invoke(data), { ok: true, project_id: 'NEW', operation_id: 'create-1' });
  assert.equal(f.docs.get('projects/NEW').members[0].displayName, 'Fresh Display'); assert.equal(f.docs.get('projects/NEW').members[0].userId, f.actor.uid);
  f.actor.disabled = true; assert.deepEqual(await f.invoke(data), { ok: false, error: 'actor_forbidden' });
  const g = fixture(); g.actor.customClaims.role = 'admin'; assert.deepEqual(await g.invoke({ ...data, expected_actor_uid: g.actor.uid }), { ok: false, error: 'material_mutations_disabled' });
});
