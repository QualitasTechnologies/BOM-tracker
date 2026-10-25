const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeProjectReads, projectReadsEnabled } = require('./nativeProjectReads.cjs');

function fixture(options = {}) {
  const actor = { uid: 'alice', email: 'partner@example.com', emailVerified: true, disabled: false, customClaims: { role: 'viewer', status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const docs = new Map([
    ['projects/P', { projectId: 'P', projectName: 'Build', memberIds: ['alice'], members: [{ userId: 'alice', displayName: 'Alice', email: actor.email, categoryScope: ['Mech'] }], internalBudget: 100, bomSnapshot: [{ private: true }] }],
    ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'motor', itemType: 'component', status: 'received', receivedPhotoUrl: 'https://example.com/photo', linkedInvoiceDocumentId: 'invoice' }] }, { name: 'Secret', items: [{ id: 'secret', linkedInvoiceDocumentId: 'hidden-invoice', itemType: 'component', status: 'received' }] }] }],
    ['projectDocuments/a-hidden', { projectId: 'P', type: 'vendor-quote', linkedBOMItems: ['secret'], name: 'hidden' }],
    ['projectDocuments/b-mixed', { projectId: 'P', type: 'vendor-quote', linkedBOMItems: ['motor', 'secret'], name: 'mixed', private: { credentials: true } }],
    ['projectDocuments/c-customer', { projectId: 'P', type: 'customer-po', linkedBOMItems: ['motor'] }],
    ['projectDocuments/invoice', { projectId: 'P', type: 'vendor-invoice', linkedBOMItems: [], url: 'https://example.com/invoice' }],
    ['projectDocuments/hidden-invoice', { projectId: 'P', type: 'vendor-invoice', linkedBOMItems: [], url: 'https://example.com/secret' }],
  ]);
  const reads = [], queries = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 10, nanoseconds: 1 } });
  const query = (path, filters = [], start = null, max = Infinity) => ({ path, filters, start, max, query: true,
    where(field, op, value) { return query(path, [...filters, [field, op, value]], start, max); },
    orderBy(field) { assert.equal(field, '__name__'); return this; },
    startAfter(value) { return query(path, filters, value, max); },
    limit(value) { return query(path, filters, start, value); },
    doc(id) { return ref(`${path}/${id}`); } });
  const ref = path => ({ path, collection: name => query(`${path}/${name}`), doc: id => ref(`${path}/${id}`) });
  const db = { collection: path => query(path), runTransaction: async fn => fn({
    get: async target => {
      reads.push(target.path); options.onRead?.(target, actor, docs);
      if (!target.query) return snapshot(target.path);
      queries.push(target);
      const rows = [...docs.keys()].filter(path => path.startsWith(`${target.path}/`) && !path.slice(target.path.length + 1).includes('/'))
        .filter(path => !target.start || path.split('/').at(-1) > target.start)
        .filter(path => target.filters.every(([field, op, value]) => op === '==' ? docs.get(path)[field] === value : op === 'array-contains' && Array.isArray(docs.get(path)[field]) && docs.get(path)[field].includes(value)))
        .sort().slice(0, target.max);
      return { docs: rows.map(snapshot) };
    },
    update() { throw Error('read handler wrote data'); }, create() { throw Error('read handler wrote data'); }, delete() { throw Error('read handler wrote data'); },
  }) };
  let clock = 1800000000000;
  const auth = { verifyIdToken: async (_token, revoked) => { assert.equal(revoked, true); if (options.invalidToken) throw Error('private token diagnostic'); return { ...token }; }, getUser: async () => structuredClone(actor) };
  const handler = createNativeProjectReads({ db, auth, bucket: { name: 'test-bucket' }, enabled: options.enabled ?? true, getCursorKey: () => options.missingKey ? undefined : Buffer.alloc(32, 7), now: () => clock });
  const call = data => handler({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic' }, data });
  return { actor, token, docs, reads, queries, call, advance: ms => { clock += ms; } };
}

test('reads are default-off independently of mutation flags and never read data while disabled', async () => {
  assert.equal(projectReadsEnabled({}), false);
  assert.equal(projectReadsEnabled({ BOM_SCOPED_READS_ENABLED: 'true' }), true);
  assert.equal(projectReadsEnabled({ BOM_SCOPED_READS_ENABLED: 'TRUE', BOM_MATERIAL_MUTATIONS_ENABLED: 'true' }), false);
  const f = fixture({ enabled: false });
  assert.deepEqual(await f.call({ operation: 'get', project_id: 'P' }), { ok: false, error: 'project_reads_disabled', status: 503 });
  assert.equal(f.reads.length, 0);
});

test('get binds verified identity and exact version while projecting private fields', async () => {
  const f = fixture(), before = structuredClone(f.docs);
  const result = await f.call({ operation: 'get', project_id: 'P' });
  assert.equal(result.ok, true); assert.equal(result.actor_uid, 'alice'); assert.equal(result.version, '10:1');
  assert.equal(result.project.projectName, 'Build'); assert.equal(Object.hasOwn(result.project, 'bomSnapshot'), false);
  assert.equal(Object.hasOwn(result.project, 'internalBudget'), false); assert.deepEqual(f.docs, before);
});

test('root access preserves explicit null but denies missing and malformed membership', async () => {
  for (const [memberIds, allowed] of [[null, true], [undefined, false], [[], false], [{ alice: true }, false], [['bob'], false]]) {
    const f = fixture(); if (memberIds === undefined) delete f.docs.get('projects/P').memberIds; else f.docs.get('projects/P').memberIds = memberIds;
    const result = await f.call({ operation: 'get', project_id: 'P' });
    assert.equal(result.ok, allowed); if (!allowed) assert.equal(result.error, 'project_forbidden');
  }
});

test('admin and internal members retain historical JSON while internal outsiders remain denied', async () => {
  for (const admin of [true, false]) {
    const f = fixture(); if (admin) { f.actor.customClaims.role = 'admin'; delete f.docs.get('projects/P').memberIds; } else f.actor.email = f.token.email = 'alice@qualitastech.com';
    const result = await f.call({ operation: 'get', project_id: 'P' });
    assert.deepEqual(result.project.bomSnapshot, [{ private: true }]);
    if (!admin) { f.docs.get('projects/P').memberIds = []; assert.equal((await f.call({ operation: 'get', project_id: 'P' })).error, 'project_forbidden'); }
  }
});

test('fresh actor verification denies revoked, disabled, unapproved, unverified and mismatched identities without data reads', async () => {
  const cases = [f => { f.actor.disabled = true; }, f => { f.actor.emailVerified = false; }, f => { f.actor.customClaims.status = 'pending'; }, f => { f.actor.customClaims.role = 'owner'; }, f => { f.token.uid = 'bob'; }, f => { f.token.email = 'bob@example.com'; }, f => { f.actor.tokensValidAfterTime = new Date(1800000001000).toISOString(); }];
  for (const mutate of cases) { const f = fixture(); mutate(f); assert.equal((await f.call({ operation: 'get', project_id: 'P' })).ok, false); assert.equal(f.reads.length, 0); }
  const f = fixture({ invalidToken: true }); assert.equal((await f.call({ operation: 'get', project_id: 'P' })).error, 'actor_authentication_required'); assert.equal(f.reads.length, 0);
});

test('strict request, cursor-key and stored identity errors expose no diagnostics', async () => {
  const f = fixture();
  for (const data of [null, {}, { operation: 'get', project_id: '../P' }, { operation: 'get', project_id: 'P', role: 'admin' }, { operation: 'list', limit: 101 }, { operation: 'list', limit: 0 }, { operation: 'get', project_id: 'P', cursor: 'ignored' }]) assert.equal((await f.call(data)).error, 'invalid_project_read_request');
  f.docs.get('projects/P').projectId = 'wrong'; assert.equal((await f.call({ operation: 'get', project_id: 'P' })).error, 'project_identity_conflict');
  assert.equal((await fixture({ missingKey: true }).call({ operation: 'get', project_id: 'P' })).error, 'project_reads_unavailable');
});

test('list discovery uses explicit membership, bounded stable pagination and confidential actor-bound cursors', async () => {
  const f = fixture();
  f.docs.set('projects/Q', { projectId: 'Q', projectName: 'Next', memberIds: ['alice'] });
  f.docs.set('projects/R', { projectId: 'R', memberIds: null }); f.docs.set('projects/S', { projectId: 'S', memberIds: ['bob'] });
  const first = await f.call({ operation: 'list', limit: 1 });
  assert.deepEqual(first.projects.map(row => row.project_id), ['P']); assert.equal(typeof first.next_cursor, 'string');
  assert.equal(Buffer.from(first.next_cursor, 'base64url').toString().includes('alice'), false);
  assert.deepEqual(f.queries[0].filters, [['memberIds', 'array-contains', 'alice']]); assert.equal(f.queries[0].max, 2);
  const next = await f.call({ operation: 'list', limit: 1, cursor: first.next_cursor });
  assert.deepEqual(next.projects.map(row => row.project_id), ['Q']); assert.equal(next.next_cursor, null);
  f.actor.customClaims.role = 'admin'; assert.equal((await f.call({ operation: 'list', cursor: first.next_cursor })).error, 'invalid_project_read_cursor');
});

test('pagination revalidates current membership and rejects tampered, expired and cross-resource cursors', async () => {
  const f = fixture(); f.docs.set('projects/Q', { projectId: 'Q', memberIds: ['alice'] });
  const first = await f.call({ operation: 'list', limit: 1 });
  const tampered = first.next_cursor.slice(0, 8) + (first.next_cursor[8] === 'A' ? 'B' : 'A') + first.next_cursor.slice(9);
  assert.equal((await f.call({ operation: 'list', cursor: tampered })).error, 'invalid_project_read_cursor');
  assert.equal((await f.call({ operation: 'documents', project_id: 'P', cursor: first.next_cursor })).error, 'invalid_project_read_cursor');
  f.docs.get('projects/Q').memberIds = ['bob'];
  assert.deepEqual((await f.call({ operation: 'list', cursor: first.next_cursor })).projects, []);
  f.advance(301000); assert.equal((await f.call({ operation: 'list', cursor: first.next_cursor })).error, 'invalid_project_read_cursor');
});

test('role changes during a transaction cannot publish a broader opening projection', async () => {
  let changed = false;
  const f = fixture({ onRead: (_target, actor) => { if (!changed) { actor.customClaims.role = 'user'; changed = true; } } });
  f.actor.customClaims.role = 'admin';
  assert.equal((await f.call({ operation: 'get', project_id: 'P' })).error, 'actor_session_changed');
});

test('Documents keeps the any-visible-link rule, trims hidden IDs and hides customer POs from nonadmins', async () => {
  const f = fixture(); const result = await f.call({ operation: 'documents', project_id: 'P' });
  assert.equal(result.ok, true); assert.deepEqual(result.documents.map(row => row.id), ['b-mixed']);
  assert.deepEqual(result.documents[0].linkedBOMItems, ['motor']); assert.equal(Object.hasOwn(result.documents[0], 'private'), false);
  assert.equal(result.documents[0].nativeOpening.bom_version, '10:1');
  f.actor.email = f.token.email = 'alice@qualitastech.com';
  assert.equal((await f.call({ operation: 'documents', project_id: 'P' })).documents.some(row => row.type === 'customer-po'), false);
  f.actor.customClaims.role = 'admin'; assert.equal((await f.call({ operation: 'documents', project_id: 'P' })).documents.some(row => row.type === 'customer-po'), true);
});

test('empty scope and filtered pages remain explicit, pageable and free of raw hidden document IDs', async () => {
  const f = fixture();
  const first = await f.call({ operation: 'documents', project_id: 'P', limit: 1 });
  assert.deepEqual(first.documents, []); assert.equal(typeof first.next_cursor, 'string');
  assert.equal(Buffer.from(first.next_cursor, 'base64url').toString().includes('a-hidden'), false);
  assert.deepEqual((await f.call({ operation: 'documents', project_id: 'P', limit: 1, cursor: first.next_cursor })).documents.map(row => row.id), ['b-mixed']);
  f.docs.get('projects/P').members[0].categoryScope = [];
  assert.deepEqual((await f.call({ operation: 'documents', project_id: 'P' })).documents, []);
});

test('Gallery invoices use visible received-item reverse links even when document link arrays are empty', async () => {
  const f = fixture(), before = structuredClone(f.docs);
  const result = await f.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'motor' });
  assert.equal(result.ok, true); assert.equal(result.document.id, 'invoice'); assert.equal(result.document.url, 'https://example.com/invoice');
  assert.equal((await f.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'secret' })).error, 'material_forbidden');
  assert.deepEqual(f.docs, before);
  f.docs.get('projects/P/bom/data').categories[0].items[0].itemType = 'service';
  assert.equal((await f.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'motor' })).error, 'project_read_invoice_unavailable');
});

test('Gallery invoice metadata never exposes hidden material links from a mixed invoice', async () => {
  const f = fixture();
  f.docs.get('projectDocuments/invoice').linkedBOMItems = ['motor', 'secret'];
  assert.deepEqual((await f.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'motor' })).document.linkedBOMItems, ['motor']);
  f.actor.customClaims.role = 'admin';
  assert.deepEqual((await f.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'motor' })).document.linkedBOMItems, ['motor', 'secret']);
  assert.deepEqual(f.docs.get('projectDocuments/invoice').linkedBOMItems, ['motor', 'secret']);
});

test('malformed BOM identities and cross-project invoice references fail without disclosing raw records', async () => {
  const f = fixture(); f.docs.get('projects/P/bom/data').categories[1].items[0].id = 'motor';
  assert.equal((await f.call({ operation: 'documents', project_id: 'P' })).error, 'invalid_project_read_state');
  const g = fixture(); g.docs.get('projectDocuments/invoice').projectId = 'Q';
  assert.equal((await g.call({ operation: 'gallery_invoice', project_id: 'P', item_id: 'motor' })).error, 'project_read_invoice_unavailable');
});

test('native documents hydrate only authorized proofs and recheck identity after proof access', async () => {
  const f = fixture();
  const path = 'projects/P/documents/native/finalized/file.bin', generation = '7';
  const url = `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(path)}?alt=media&token=private-token&generation=${generation}`;
  const raw = f.docs.get('projectDocuments/b-mixed');
  raw.pulseNativeDocument = { operation_id: 'upload', path, generation };
  f.docs.set('pulseProjectDocumentUploads/P/receipts/upload', { project_id: 'P', document_id: 'b-mixed', final_path: path, download_token: 'private-token', finalized: { generation, document: { id: 'b-mixed', url } }, private: 'do not relay' });
  const result = await f.call({ operation: 'documents', project_id: 'P' });
  assert.equal(result.documents[0].url, url); assert.equal(JSON.stringify(result).includes('do not relay'), false);
  f.docs.get('pulseProjectDocumentUploads/P/receipts/upload').finalized.generation = '8';
  assert.equal((await f.call({ operation: 'documents', project_id: 'P' })).error, 'invalid_project_document_state');
  const g = fixture({ onRead: (target, actor) => { if (target.path.includes('/receipts/')) actor.disabled = true; } });
  Object.assign(g.docs.get('projectDocuments/b-mixed'), raw);
  g.docs.set('pulseProjectDocumentUploads/P/receipts/upload', f.docs.get('pulseProjectDocumentUploads/P/receipts/upload'));
  g.docs.get('pulseProjectDocumentUploads/P/receipts/upload').finalized.generation = generation;
  assert.equal((await g.call({ operation: 'documents', project_id: 'P' })).error, 'actor_forbidden');
  const h = fixture();
  h.docs.get('projectDocuments/a-hidden').pulseNativeDocument = { operation_id: 'hidden-proof', path, generation };
  assert.equal((await h.call({ operation: 'documents', project_id: 'P' })).ok, true);
  assert.equal(h.reads.some(value => value.includes('/receipts/hidden-proof')), false);
});

test('admin list retains all discovery while malformed state and source failures stay explicit', async () => {
  const f = fixture(); f.actor.customClaims.role = 'admin';
  f.docs.set('projects/Q', { projectId: 'Q', memberIds: null });
  f.docs.set('projects/R', { projectId: 'R' });
  assert.deepEqual((await f.call({ operation: 'list' })).projects.map(row => row.project_id), ['P', 'Q', 'R']);
  const g = fixture({ onRead: () => { throw Object.assign(Error('private database diagnostic'), { code: 'project_forbidden', status: 403 }); } });
  assert.deepEqual(await g.call({ operation: 'get', project_id: 'P' }), { ok: false, error: 'project_reads_unavailable', status: 503 });
  for (const raw of [{ categories: null }, { categories: 'bad' }, 'bad']) {
    const h = fixture(); h.docs.set('projects/P/bom/data', raw);
    assert.equal((await h.call({ operation: 'documents', project_id: 'P' })).error, 'invalid_project_read_state');
  }
});
