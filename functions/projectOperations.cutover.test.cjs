const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectOperationsHandler } = require('./projectOperations.cjs');

// Minimal transactional fake: optimistic read-set validation with retry, so a control-document change
// between a transaction's reads and its commit is observable exactly as in Firestore.
function fixture({ actor: actorOverrides, native = false, enabled = true, modes, recheck, beforeCommit } = {}) {
  const actor = { uid: 'alice', email: 'alice@qualitastech.com', emailVerified: true, customClaims: { role: 'user', status: 'approved' }, ...actorOverrides };
  const docs = new Map(Object.entries({
    'projects/A': { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: ['Mech'] }] },
    'projects/A/bom/data': { categories: [
      { name: 'Mech', items: [{ id: 'motor', name: 'Motor', quantity: 2, itemType: 'component' }, { id: 'svc', name: 'Svc', quantity: 3, itemType: 'service' }] },
      { name: 'Other', items: [{ id: 'hidden', name: 'Hidden', quantity: 1, itemType: 'component' }] }
    ] }
  }).map(([path, data]) => [path, { data, tick: 1 }]));
  let clock = 1;
  const stats = { reads: 0, commits: 0 };
  const hooks = { beforeCommit };
  const snap = path => { const row = docs.get(path); return { exists: !!row, data: () => structuredClone(row?.data), updateTime: row ? { seconds: 10, nanoseconds: row.tick } : undefined }; };
  const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`) });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const staged = [], reads = new Map();
      const result = await fn({
        get: async r => { stats.reads++; if (staged.length) throw Error('reads after writes'); reads.set(r.path, docs.get(r.path)?.tick); return snap(r.path); },
        update: (r, data) => staged.push(['update', r.path, data]),
        create: (r, data) => staged.push(['create', r.path, data])
      });
      if (hooks.beforeCommit) { const hook = hooks.beforeCommit; hooks.beforeCommit = null; hook(docs, () => ++clock); }
      if ([...reads].some(([path, tick]) => docs.get(path)?.tick !== tick)) continue;
      for (const [kind, path] of staged) if (kind === 'create' && docs.has(path)) throw Error('already exists');
      for (const [kind, path, data] of staged) docs.set(path, { data: kind === 'update' ? { ...docs.get(path).data, ...structuredClone(data) } : structuredClone(data), tick: ++clock });
      if (staged.length) stats.commits++;
      return result;
    }
    throw Error('transaction contention');
  } };
  const handler = createProjectOperationsHandler({ db, auth: {}, getServiceKey: () => 'k', resolveActor: async () => actor, mutationsEnabled: () => enabled,
    getServerTimestamp: () => 'server-time', ...(native ? { allowResolve: true, writeModes: modes || ['coexist', 'pulse_only'], ...(recheck ? { recheckActor: recheck } : {}) } : modes ? { writeModes: modes } : {}) });
  const call = async (method, query, body) => {
    let status = 200, result; const res = { set() {}, status(code) { status = code; return this; }, json(value) { result = value; return this; } };
    await handler({ method, query: { project_id: 'A', ...query }, body }, res); return { status, body: result };
  };
  const setMode = mode => docs.set('pulseRuntimeControl/cutover', { data: mode === undefined ? {} : { mode }, tick: ++clock });
  const writes = {
    patch: (extra = {}) => ({ call: body => call('PATCH', {}, body), body: { item_id: 'motor', expected_version: '10:1', operation_id: 'op-patch', patch: { name: 'Changed' }, ...extra } }),
    fulfill: (extra = {}) => ({ call: body => call('POST', { resource: 'fulfillment' }, body), body: { item_id: 'svc', expected_version: '10:1', operation_id: 'op-fulfill', fulfillment: { kind: 'fulfillment', quantity: 1 }, ...extra } }),
    command: (extra = {}) => ({ call: body => call('POST', { resource: 'commands' }, body), body: { expected_version: '10:1', operation_id: 'op-command', command: { kind: 'category_state', category: 'Mech', isExpanded: false }, ...extra } }),
    create: (extra = {}) => ({ call: body => call('POST', { project_id: 'NEW', resource: 'project_create' }, body), body: { operation_id: 'op-create', project: { projectName: 'N', clientName: 'C', description: '', status: 'Planning', deadline: '2030-01-01', poValue: 1 }, ...extra } })
  };
  return { call, docs, stats, actor, setMode, writes, hooks, bom: () => docs.get('projects/A/bom/data').data,
    receipts: () => [...docs.keys()].filter(path => path.includes('/materialOperations/')), audits: () => [...docs.keys()].filter(path => path.includes('/materialAudit/')) };
}
const KINDS = ['patch', 'fulfill', 'command', 'create'];
const projectOf = kind => kind === 'create' ? 'projects/NEW' : 'projects/A/bom/data';
const snapshotOf = (f, kind) => JSON.stringify(f.docs.get(projectOf(kind)));

test('legacy HTTP default honors global read_only and pulse_only, and coexist or a missing control still writes', async () => {
  for (const kind of KINDS) {
    for (const mode of ['read_only', 'pulse_only', 'bogus', 5, null]) {
      const f = fixture(); f.setMode(mode); const before = snapshotOf(f, kind); const w = f.writes[kind]();
      const r = await w.call(w.body); assert.deepEqual([kind, mode, r.status, r.body], [kind, mode, 503, { ok: false, error: 'material_read_only' }]);
      assert.equal(snapshotOf(f, kind), before); assert.equal(f.receipts().length, 0); assert.equal(f.audits().length, 0);
    }
    for (const mode of [undefined, 'coexist']) {
      const f = fixture(); if (mode !== undefined || kind === 'patch') f.setMode(mode); const w = f.writes[kind](); const r = await w.call(w.body);
      assert.equal(r.status, 200, `${kind}:${mode}`); assert.equal(f.receipts().length, 1);
    }
  }
});

test('legacy HTTP never accepts resolve_only: the channel is server-selected', async () => {
  for (const kind of KINDS) {
    const f = fixture(); const w = f.writes[kind]({ resolve_only: true }); const r = await w.call(w.body);
    assert.equal(r.status, 400); assert.equal(f.stats.commits, 0); assert.equal(f.receipts().length, 0);
  }
});

test('native allows coexist and pulse_only, blocks read_only and malformed modes, for all four writes', async () => {
  for (const kind of KINDS) {
    for (const mode of ['coexist', 'pulse_only']) { const f = fixture({ native: true }); f.setMode(mode); const w = f.writes[kind](); assert.equal((await w.call(w.body)).status, 200, `${kind}:${mode}`); }
    for (const mode of ['read_only', 'bogus', 7, null]) {
      const f = fixture({ native: true }); f.setMode(mode); const before = snapshotOf(f, kind); const w = f.writes[kind]();
      assert.deepEqual((await w.call(w.body)).body, { ok: false, error: 'material_read_only' }); assert.equal(snapshotOf(f, kind), before); assert.equal(f.receipts().length, 0);
    }
  }
});

test('read permissions read the cutover mode: legacy edits only in coexist, native also in pulse_only, resolve is native-only', async () => {
  const expected = { coexist: [true, true], pulse_only: [false, true], read_only: [false, false] };
  for (const [mode, [legacy, native]] of Object.entries(expected)) {
    const l = fixture(); l.setMode(mode); const lp = (await l.call('GET', {})).body.permissions;
    assert.deepEqual([lp.edit, lp.command, 'resolve' in lp], [legacy, legacy, false], `legacy ${mode}`);
    const n = fixture({ native: true }); n.setMode(mode); const np = (await n.call('GET', {})).body.permissions;
    assert.deepEqual([np.edit, np.command, np.resolve], [native, native, true], `native ${mode}`);
  }
  const closed = fixture({ native: true, enabled: false }); assert.deepEqual([(await closed.call('GET', {})).body.permissions.edit, (await closed.call('GET', {})).body.permissions.resolve], [false, true]);
});

test('cutover is read atomically with every write: a flip to read_only before commit prevents the write', async () => {
  for (const kind of KINDS) {
    for (const native of [false, true]) {
      const f = fixture({ native, modes: undefined }); const before = snapshotOf(f, kind);
      f.hooks.beforeCommit = (docs, tick) => docs.set('pulseRuntimeControl/cutover', { data: { mode: 'read_only' }, tick: tick() });
      const w = f.writes[kind](); const r = await w.call(w.body);
      assert.deepEqual([kind, native, r.status, r.body.error], [kind, native, 503, 'material_read_only']); assert.equal(snapshotOf(f, kind), before); assert.equal(f.receipts().length, 0);
    }
  }
});

test('ordinary native writes keep the early closed-env rejection with no Firestore access; resolve_only bypasses only that gate', async () => {
  for (const kind of KINDS) {
    const f = fixture({ native: true, enabled: false }); const w = f.writes[kind](); const r = await w.call(w.body);
    assert.deepEqual([r.status, r.body.error, f.stats.reads], [503, 'material_mutations_disabled', 0]);
    const g = fixture({ native: true, enabled: false }); g.setMode('read_only'); const x = g.writes[kind]({ resolve_only: true });
    const cancelled = await x.call(x.body); assert.equal(cancelled.status, 200, kind); assert.equal(cancelled.body.resolution, 'cancelled');
    assert.equal(g.receipts().length, 1); assert.equal(g.audits().length, 1); assert.equal(g.stats.commits, 1);
    if (kind !== 'create') assert.equal(JSON.stringify(g.bom()), JSON.stringify(fixture().bom()));
  }
});

test('a committed receipt replays and resolves while paused, with a payload that excludes resolve_only', async () => {
  for (const kind of KINDS) {
    const f = fixture({ native: true }); const w = f.writes[kind](); const first = await w.call(w.body); assert.equal(first.status, 200);
    f.setMode('read_only'); const replay = await w.call(w.body); assert.deepEqual(replay.body, first.body);
    const resolved = await w.call({ ...w.body, resolve_only: true }); assert.equal(resolved.status, 200); assert.equal(resolved.body.resolution, 'committed'); assert.equal(resolved.body.operation_id, w.body.operation_id);
    assert.equal(f.stats.commits, 1); assert.equal(f.receipts().length, 1);
  }
});

test('resolve of a committed patch or fulfillment does not need the item to still exist', async () => {
  for (const kind of ['patch', 'fulfill']) {
    const f = fixture({ native: true }); const w = f.writes[kind](); assert.equal((await w.call(w.body)).status, 200);
    const data = f.bom(); data.categories = data.categories.map(c => ({ ...c, items: c.items.filter(i => i.id !== w.body.item_id) })); f.docs.set('projects/A/bom/data', { data, tick: 99 });
    const r = await w.call({ ...w.body, resolve_only: true }); assert.deepEqual([r.status, r.body.resolution], [200, 'committed'], kind);
  }
});

test('cancellation settles the nonce forever: no BOM write, late original rejected, repeat is idempotent', async () => {
  for (const kind of KINDS) {
    const f = fixture({ native: true }); f.setMode('read_only'); const before = snapshotOf(f, kind); const w = f.writes[kind]();
    const cancelled = await w.call({ ...w.body, resolve_only: true }); assert.deepEqual([cancelled.status, cancelled.body.resolution, cancelled.body.operation_id], [200, 'cancelled', w.body.operation_id]);
    assert.equal(snapshotOf(f, kind), before); const receipt = [...f.docs].find(([p]) => p.includes('/materialOperations/'))[1].data;
    assert.deepEqual([receipt.cancelled, receipt.actor_uid, receipt.actor_email, /^[a-f0-9]{64}$/.test(receipt.payload_hash)], [true, 'alice', 'alice@qualitastech.com', true]);
    const audit = [...f.docs].find(([p]) => p.includes('/materialAudit/'))[1].data; assert.equal(audit.actor_uid, 'alice'); assert.match(audit.operation, /_cancelled$/); assert.equal(audit.payload_hash, receipt.payload_hash);
    assert.equal((await w.call({ ...w.body, resolve_only: true })).body.resolution, 'cancelled'); assert.equal(f.receipts().length, 1);
    for (const mode of ['read_only', 'coexist', 'pulse_only']) {
      f.setMode(mode); const late = await w.call(w.body); assert.deepEqual([kind, mode, late.status, late.body.error], [kind, mode, 409, 'material_request_cancelled']);
    }
    assert.equal(snapshotOf(f, kind), before); assert.equal(f.receipts().length, 1);
  }
});

test('receipts are bound to actor, email and exact payload; a different payload cannot cancel or replay', async () => {
  for (const kind of KINDS) {
    const f = fixture({ native: true }); const w = f.writes[kind](); await w.call(w.body);
    const other = f.writes[kind](kind === 'patch' ? { patch: { name: 'Other' } } : kind === 'fulfill' ? { fulfillment: { kind: 'fulfillment', quantity: 2 } } : kind === 'command' ? { command: { kind: 'category_state', category: 'Mech', isExpanded: true } } : { project: { ...w.body.project, projectName: 'Other' } });
    for (const resolve_only of [false, true]) { const r = await w.call({ ...other.body, ...(resolve_only ? { resolve_only } : {}) }); assert.deepEqual([r.status, r.body.error], [409, 'operation_conflict'], `${kind}:${resolve_only}`); }
    // Mallory is an authorized member of the project, so only the actor binding on the receipt can reject her.
    const project = f.docs.get('projects/A'); f.docs.set('projects/A', { data: { ...project.data, memberIds: ['alice', 'mallory'] }, tick: 77 });
    f.actor.uid = 'mallory'; for (const body of [w.body, { ...w.body, resolve_only: true }]) { const m = await w.call(body); assert.deepEqual([kind, m.status, m.body.error], [kind, 409, 'operation_conflict']); }
    f.actor.uid = 'alice'; f.actor.email = 'mallory@qualitastech.com'; const r = await w.call({ ...w.body, resolve_only: true }); assert.deepEqual([r.status, r.body.error], [409, 'operation_conflict']);
    f.actor.email = 'alice@qualitastech.com'; assert.equal((await w.call({ ...w.body, resolve_only: true })).body.resolution, 'committed');
  }
});

test('replay and cancel enforce current project and category authority', async () => {
  const scoped = { email: 'alice@example.com', customClaims: { role: 'viewer', status: 'approved' } };
  for (const kind of ['patch', 'fulfill', 'command']) {
    const f = fixture({ native: true, actor: scoped }); const w = f.writes[kind](); assert.equal((await w.call(w.body)).status, 200);
    const project = f.docs.get('projects/A'); f.docs.set('projects/A', { data: { ...project.data, members: [{ userId: 'alice', categoryScope: ['Other'] }] }, tick: 50 });
    for (const resolve_only of [false, true]) { const r = await w.call({ ...w.body, ...(resolve_only ? { resolve_only } : {}) }); assert.deepEqual([kind, r.status, r.body.error], [kind, 403, 'material_forbidden']); }
    f.docs.set('projects/A', { data: { ...project.data, memberIds: [] }, tick: 51 });
    assert.equal((await w.call({ ...w.body, resolve_only: true })).body.error, 'project_forbidden');
  }
  const f = fixture({ native: true, actor: scoped }); f.docs.set('projects/A', { data: { memberIds: ['alice'], members: [{ userId: 'alice', categoryScope: [] }] }, tick: 5 });
  for (const kind of ['patch', 'command']) { const w = f.writes[kind]({ operation_id: `cancel-${kind}` }); const r = await w.call({ ...w.body, resolve_only: true }); assert.deepEqual([r.status, r.body.error], [403, 'material_forbidden']); }
  const out = f.writes.patch({ item_id: 'hidden', operation_id: 'cancel-hidden' }); assert.equal((await out.call({ ...out.body, resolve_only: true })).body.error, 'material_forbidden');
  const outsider = fixture({ native: true, actor: { ...scoped, uid: 'zed' } }); const w = outsider.writes.patch(); assert.equal((await w.call({ ...w.body, resolve_only: true })).body.error, 'project_forbidden');
});

test('project creation cancel needs creation authority, not an existing project, and blocks a late create', async () => {
  const f = fixture({ native: true }); f.setMode('read_only'); const w = f.writes.create();
  assert.equal((await w.call({ ...w.body, resolve_only: true })).body.resolution, 'cancelled'); assert.equal(f.docs.has('projects/NEW'), false);
  assert.equal((await w.call({ ...w.body, resolve_only: true })).body.resolution, 'cancelled');
  f.setMode('coexist'); assert.equal((await w.call(w.body)).body.error, 'material_request_cancelled'); assert.equal(f.docs.has('projects/NEW'), false);
  const plain = fixture({ native: true, actor: { email: 'alice@example.com', customClaims: { role: 'viewer', status: 'approved' } } }); const x = plain.writes.create();
  assert.equal((await x.call({ ...x.body, resolve_only: true })).body.error, 'project_creation_forbidden'); assert.equal(plain.receipts().length, 0);
});

test('resolve_only must be exactly true and never changes the original payload hash', async () => {
  for (const kind of KINDS) for (const value of [false, 'true', 1, null]) {
    const f = fixture({ native: true }); const w = f.writes[kind]({ resolve_only: value }); const r = await w.call(w.body); assert.equal(r.status, 400, `${kind}:${String(value)}`); assert.equal(f.receipts().length, 0);
  }
});

test('the live actor is rechecked before replay, cancel and write through the server-only seam', async () => {
  for (const kind of KINDS) {
    const calls = []; const f = fixture({ native: true, recheck: async () => { calls.push(1); return { ...f.actor, uid: 'changed' }; } });
    const w = f.writes[kind](); for (const body of [w.body, { ...w.body, resolve_only: true }]) { const r = await w.call(body); assert.deepEqual([r.status, r.body.error], [403, 'actor_session_changed']); }
    assert.equal(f.receipts().length, 0); assert.equal(calls.length, 2);
  }
});

const receiptPath = id => `pulseProjectMaterialOperations/A/materialOperations/${id}`;
const setReceipt = (f, id, update) => { const row = f.docs.get(receiptPath(id)); f.docs.set(receiptPath(id), { data: { ...row.data, ...update }, tick: row.tick + 100 }); };
const dropReceiptField = (f, id, field) => { const row = f.docs.get(receiptPath(id)); const { [field]: _gone, ...rest } = row.data; f.docs.set(receiptPath(id), { data: rest, tick: row.tick + 100 }); };

test('create resolve and replay authorize against an existing target project before any tombstone or audit', async () => {
  const stranger = fixture({ native: true }); stranger.docs.set('projects/NEW', { data: { memberIds: ['bob'], members: [] }, tick: 3 });
  const w = stranger.writes.create(); const r = await w.call({ ...w.body, resolve_only: true });
  assert.deepEqual([r.status, r.body.error], [403, 'project_forbidden']); assert.equal(stranger.receipts().length, 0); assert.equal(stranger.audits().length, 0); assert.equal(stranger.stats.commits, 0);
  const member = fixture({ native: true }); member.docs.set('projects/NEW', { data: { memberIds: ['alice'], members: [] }, tick: 3 });
  const x = member.writes.create(); assert.equal((await x.call({ ...x.body, resolve_only: true })).body.resolution, 'cancelled'); assert.equal(member.audits().length, 1);
  // A cancelled receipt replays only while its actor still has authority over the project that now exists.
  member.docs.set('projects/NEW', { data: { memberIds: ['bob'], members: [] }, tick: 9 });
  for (const body of [x.body, { ...x.body, resolve_only: true }]) assert.equal((await x.call(body)).body.error, 'project_forbidden');
  const missing = fixture({ native: true }); const y = missing.writes.create(); assert.equal((await y.call({ ...y.body, resolve_only: true })).body.resolution, 'cancelled'); assert.equal(missing.docs.has('projects/NEW'), false);
});

test('fulfillment replay survives a deleted invoice but not a reassigned or retyped one', async () => {
  const invoiced = f => { f.docs.set('projectDocuments/inv', { data: { projectId: 'A', type: 'vendor-invoice' }, tick: 1 }); return f.writes.fulfill({ fulfillment: { kind: 'fulfillment', quantity: 1, invoiceDocId: 'inv' } }); };
  for (const resolve_only of [false, true]) {
    const f = fixture({ native: true }); const w = invoiced(f); assert.equal((await w.call(w.body)).status, 200); f.docs.delete('projectDocuments/inv');
    const r = await w.call({ ...w.body, ...(resolve_only ? { resolve_only } : {}) }); assert.equal(r.status, 200, String(resolve_only)); if (resolve_only) assert.equal(r.body.resolution, 'committed');
    for (const change of [{ projectId: 'B' }, { type: 'vendor-quote' }]) {
      const g = fixture({ native: true }); const x = invoiced(g); assert.equal((await x.call(x.body)).status, 200);
      g.docs.set('projectDocuments/inv', { data: { projectId: 'A', type: 'vendor-invoice', ...change }, tick: 40 });
      const denied = await x.call({ ...x.body, ...(resolve_only ? { resolve_only } : {}) }); assert.deepEqual([denied.status, denied.body.error], [403, 'invoice_forbidden']);
    }
  }
  const g = fixture({ native: true }); const x = invoiced(g); assert.equal((await x.call({ ...x.body, resolve_only: true })).body.resolution, 'cancelled');
  g.docs.set('projectDocuments/inv', { data: { projectId: 'B', type: 'vendor-invoice' }, tick: 40 }); assert.equal((await x.call({ ...x.body, resolve_only: true })).body.resolution, 'cancelled');
});

test('command replay survives a deleted document, but a recorded customer PO stays admin-only and a retyped document is refused', async () => {
  const link = f => { f.docs.set('projectDocuments/quote', { data: { projectId: 'A', type: 'vendor-quote', linkedBOMItems: [] }, tick: 1 }); return f.writes.command({ command: { kind: 'link_document_delta', document_id: 'quote', add_item_ids: ['svc'], remove_item_ids: [] } }); };
  for (const resolve_only of [false, true]) {
    const body = w => ({ ...w.body, ...(resolve_only ? { resolve_only } : {}) });
    const f = fixture({ native: true }); const w = link(f); assert.equal((await w.call(w.body)).status, 200); f.docs.delete('projectDocuments/quote');
    const ok = await w.call(body(w)); assert.equal(ok.status, 200); if (resolve_only) assert.equal(ok.body.resolution, 'committed');
    setReceipt(f, 'op-command', { document_types: { quote: 'customer-po' } });
    const denied = await w.call(body(w)); assert.deepEqual([denied.status, denied.body.error], [403, 'document_forbidden']);
    f.actor.customClaims = { ...f.actor.customClaims, role: 'admin' }; assert.equal((await w.call(body(w))).status, 200);
    const g = fixture({ native: true }); const x = link(g); assert.equal((await x.call(x.body)).status, 200);
    g.docs.set('projectDocuments/quote', { data: { projectId: 'A', type: 'vendor-po' }, tick: 40 }); assert.equal((await x.call(body(x))).body.error, 'document_forbidden');
    g.docs.set('projectDocuments/quote', { data: { projectId: 'B', type: 'vendor-quote' }, tick: 41 }); assert.equal((await x.call(body(x))).body.error, 'document_forbidden');
  }
});

test('the live actor recheck rejects a changed email or role as well as a changed uid, before replay, cancel and write', async () => {
  for (const change of [{ email: 'other@qualitastech.com' }, { customClaims: { role: 'viewer', status: 'approved' } }, { email: undefined }]) for (const kind of KINDS) {
    const f = fixture({ native: true, recheck: async () => ({ ...f.actor, ...change }) }); const w = f.writes[kind]();
    for (const body of [w.body, { ...w.body, resolve_only: true }]) { const r = await w.call(body); assert.deepEqual([kind, r.status, r.body.error], [kind, 403, 'actor_session_changed']); }
    assert.equal(f.receipts().length, 0); assert.equal(f.stats.commits, 0);
  }
  for (const kind of KINDS) {
    let live; const f = fixture({ native: true, recheck: async () => live ? { ...f.actor, ...live } : f.actor }); const w = f.writes[kind](); assert.equal((await w.call(w.body)).status, 200);
    live = { email: 'other@qualitastech.com' }; for (const body of [w.body, { ...w.body, resolve_only: true }]) assert.equal((await w.call(body)).body.error, 'actor_session_changed');
    live = { customClaims: { role: 'viewer', status: 'approved' } }; assert.equal((await w.call({ ...w.body, resolve_only: true })).body.error, 'actor_session_changed');
    const c = f.writes[kind]({ operation_id: 'late' }); assert.equal((await c.call({ ...c.body, resolve_only: true })).body.error, 'actor_session_changed');
  }
});

test('malformed cutover modes grant no edit or command permission on either channel', async () => {
  for (const mode of ['bogus', 5, null, '', ['coexist']]) {
    const l = fixture(); l.setMode(mode); const lp = (await l.call('GET', {})).body.permissions; assert.deepEqual([lp.edit, lp.command], [false, false], `legacy ${String(mode)}`);
    const n = fixture({ native: true }); n.setMode(mode); const np = (await n.call('GET', {})).body.permissions; assert.deepEqual([np.edit, np.command, np.resolve], [false, false, true], `native ${String(mode)}`);
  }
});

test('a legacy receipt with no recorded categories fails closed for scoped actors on replay and resolve, with no fallback', async () => {
  const scoped = { email: 'alice@example.com', customClaims: { role: 'viewer', status: 'approved' } };
  for (const kind of ['patch', 'fulfill']) {
    const f = fixture({ native: true, actor: scoped }); const w = f.writes[kind](); assert.equal((await w.call(w.body)).status, 200); dropReceiptField(f, w.body.operation_id, 'affected_categories');
    for (const resolve_only of [false, true]) { const r = await w.call({ ...w.body, ...(resolve_only ? { resolve_only } : {}) }); assert.deepEqual([kind, r.status, r.body.error], [kind, 403, 'material_forbidden']); }
    assert.equal(f.stats.commits, 1);
    const open = fixture({ native: true }); const x = open.writes[kind](); await x.call(x.body); dropReceiptField(open, x.body.operation_id, 'affected_categories');
    assert.equal((await x.call({ ...x.body, resolve_only: true })).body.resolution, 'committed');
  }
  const f = fixture({ native: true }); const w = f.writes.command(); await w.call(w.body); dropReceiptField(f, 'op-command', 'affected_categories');
  assert.equal((await w.call({ ...w.body, resolve_only: true })).body.error, 'material_forbidden');
});
