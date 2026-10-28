const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeProjectReads } = require('./nativeProjectReads.cjs');

const RAW = '<b>Weekly</b> sync — List<String> <john@acme.com>\r\n  indented  line\n\ttab & ampersand ' + '\u{1F600}';
function fixture(options = {}) {
  const actor = { uid: 'alice', email: options.email ?? 'alice@qualitastech.com', emailVerified: true, disabled: false, customClaims: { role: options.role ?? 'viewer', status: 'approved' } };
  const token = { uid: actor.uid, email: actor.email, auth_time: 1800000000 };
  const activity = (id, extra) => [`transcriptActivities/${id}`, { projectId: 'P', projectName: 'Build', type: 'progress', summary: `summary ${id}`, meetingDate: '2026-10-01', source: 'transcript', createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob', ...extra }];
  const docs = new Map([
    ['projects/P', { projectId: 'P', projectName: 'Build', memberIds: ['alice'] }],
    activity('a1', { transcriptId: 'T1', rawExcerpt: 'excerpt', speaker: 'Ann', timestamp: '00:03:50', internalNote: 'must not leak' }),
    activity('a2', { source: 'manual', type: 'note' }),
    activity('a3', { projectId: 'Q', projectName: 'Secret Rival Project', transcriptId: 'T1' }),
    activity('a4', { projectId: 'Q', projectName: 'Secret Rival Project', transcriptId: 'T2' }),
    activity('a5', { transcriptId: 'T4' }),
    ['transcripts/T1', { rawText: RAW, fileName: 'sync.txt', meetingDate: '2026-10-01', meetingTitle: 'Weekly', processed: true, processedAt: '2026-10-02T00:00:01.000Z', extractedProjectCount: 2, extractedActivityCount: 3, createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob', secretField: 'x' }],
    ['transcripts/T2', { rawText: 'other project only', meetingDate: '2026-10-01', processed: true, createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob' }],
    ['transcripts/T3', { rawText: 'orphan body', meetingDate: '2026-10-01', processed: false, createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob' }],
  ]);
  const reads = [];
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
      reads.push(target.path); options.onRead?.(target, docs);
      if (!target.query) return snapshot(target.path);
      const rows = [...docs.keys()].filter(path => path.startsWith(`${target.path}/`) && !path.slice(target.path.length + 1).includes('/'))
        .filter(path => !target.start || path.split('/').at(-1) > target.start)
        .filter(path => target.filters.every(([field, op, value]) => op === '==' ? docs.get(path)[field] === value : op === 'array-contains' && Array.isArray(docs.get(path)[field]) && docs.get(path)[field].includes(value)))
        .sort().slice(0, target.max);
      return { docs: rows.map(snapshot) };
    },
    update() { throw Error('read handler wrote data'); }, create() { throw Error('read handler wrote data'); }, delete() { throw Error('read handler wrote data'); }, set() { throw Error('read handler wrote data'); },
  }) };
  let clock = 1800000000000;
  const auth = { verifyIdToken: async () => ({ ...token }), getUser: async () => structuredClone(actor) };
  const handler = createNativeProjectReads({ db, auth, bucket: { name: 'b' }, enabled: options.enabled ?? true, getCursorKey: () => Buffer.alloc(32, 7), now: () => clock });
  const call = data => handler({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer synthetic' }, data });
  return { actor, docs, reads, call };
}
const manualReads = f => f.reads.filter(path => path.startsWith('transcript'));

test('activities page is a whitelisted, project-only, cursor-bound read-only projection', async () => {
  const f = fixture(), before = structuredClone(f.docs);
  const first = await f.call({ operation: 'activities', project_id: 'P', limit: 2 });
  assert.equal(first.ok, true); assert.equal(first.actor_uid, 'alice'); assert.equal(first.project_id, 'P'); assert.equal(first.project_version, '10:1');
  assert.deepEqual(first.activities.map(a => a.id), ['a1', 'a2']);
  assert.deepEqual(first.activities[0], { id: 'a1', projectId: 'P', projectName: 'Build', type: 'progress', summary: 'summary a1', rawExcerpt: 'excerpt', speaker: 'Ann', meetingDate: '2026-10-01', timestamp: '00:03:50', source: 'transcript', transcriptId: 'T1', createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob' });
  assert.equal(Object.hasOwn(first.activities[1], 'transcriptId'), false);
  assert.ok(first.next_cursor);
  const second = await f.call({ operation: 'activities', project_id: 'P', limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.activities.map(a => a.id), ['a5']); assert.equal(second.next_cursor, null);
  assert.equal(JSON.stringify([first, second]).includes('Secret Rival'), false);
  assert.equal(JSON.stringify([first, second]).includes('must not leak'), false);
  assert.deepEqual(f.docs, before);
  assert.equal((await f.call({ operation: 'activities', project_id: 'P', limit: 2, cursor: first.next_cursor.slice(0, -2) + 'AA' })).error, 'invalid_project_read_cursor');
});

test('cursors are bound to operation, project and actor', async () => {
  const f = fixture({ role: 'admin' }); f.docs.set('projects/R', { projectId: 'R', memberIds: null });
  const page = await f.call({ operation: 'activities', project_id: 'P', limit: 1 });
  assert.equal((await f.call({ operation: 'activities', project_id: 'R', limit: 1, cursor: page.next_cursor })).error, 'invalid_project_read_cursor');
  assert.equal((await f.call({ operation: 'documents', project_id: 'P', limit: 1, cursor: page.next_cursor })).error, 'invalid_project_read_cursor');
});

test('full transcript is returned verbatim only through an actual activity link, with a count not ids', async () => {
  const f = fixture();
  const result = await f.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T1' });
  assert.equal(result.ok, true); assert.equal(result.actor_uid, 'alice'); assert.equal(result.project_id, 'P');
  assert.equal(result.transcript.rawText, RAW); assert.equal(result.linked_project_count, 2);
  assert.deepEqual(result.transcript, { id: 'T1', rawText: RAW, fileName: 'sync.txt', meetingDate: '2026-10-01', meetingTitle: 'Weekly', processed: true, processedAt: '2026-10-02T00:00:01.000Z', extractedProjectCount: 2, extractedActivityCount: 3, createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob' });
  const text = JSON.stringify(result); assert.equal(text.includes('Secret Rival'), false); assert.equal(text.includes('"Q"'), false); assert.equal(text.includes('secretField'), false);
  assert.match(result.transcript_version, /^\d+:\d+$/);
});

test('unlinked, other-project, orphan and dangling transcripts return one indistinguishable not-found', async () => {
  const f = fixture();
  for (const id of ['T2', 'T3', 'missing']) assert.deepEqual(await f.call({ operation: 'transcript', project_id: 'P', transcript_id: id }), { ok: false, error: 'manual_transcript_unavailable', status: 404 });
  f.docs.delete('transcripts/T1'); // activity a1 still links it
  assert.equal((await f.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T1' })).error, 'manual_transcript_unavailable');
});

test('link evidence is the project field of real activities; a manual transcriptId on another project grants nothing', async () => {
  const f = fixture(); f.docs.get('transcriptActivities/a1').transcriptId = 'T3';
  assert.equal((await f.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T1' })).error, 'manual_transcript_unavailable');
  assert.equal((await f.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T3' })).ok, true);
});

test('capability: internal or admin plus current membership; externals refused before any manual data read', async () => {
  const external = fixture({ email: 'partner@example.com' });
  for (const data of [{ operation: 'activities', project_id: 'P' }, { operation: 'transcript', project_id: 'P', transcript_id: 'T1' }]) {
    assert.deepEqual(await external.call(data), { ok: false, error: 'manual_history_forbidden', status: 403 });
  }
  assert.deepEqual(manualReads(external), []);
  const outsider = fixture(); outsider.docs.get('projects/P').memberIds = ['bob'];
  assert.equal((await outsider.call({ operation: 'activities', project_id: 'P' })).error, 'project_forbidden'); assert.deepEqual(manualReads(outsider), []);
  const admin = fixture({ role: 'admin', email: 'boss@example.com' }); admin.docs.get('projects/P').memberIds = ['bob'];
  assert.equal((await admin.call({ operation: 'activities', project_id: 'P' })).ok, true);
  const open = fixture(); open.docs.get('projects/P').memberIds = null;
  assert.equal((await open.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T1' })).ok, true);
  const missing = fixture(); delete missing.docs.get('projects/P').memberIds;
  assert.equal((await missing.call({ operation: 'activities', project_id: 'P' })).error, 'project_forbidden');
});

test('disabled reads and failed actor verification touch no manual history', async () => {
  const off = fixture({ enabled: false });
  assert.equal((await off.call({ operation: 'transcript', project_id: 'P', transcript_id: 'T1' })).error, 'project_reads_disabled'); assert.equal(off.reads.length, 0);
  const revoked = fixture(); revoked.actor.disabled = true;
  assert.equal((await revoked.call({ operation: 'activities', project_id: 'P' })).ok, false); assert.equal(revoked.reads.length, 0);
});

test('malformed or oversized stored history fails explicitly and never returns a partial body', async () => {
  const bad = (mutate, request, code) => async () => { const f = fixture(); mutate(f.docs); const result = await f.call(request); assert.equal(result.ok, false); assert.equal(result.error, code); assert.equal(JSON.stringify(result).includes('rawText'), false); };
  const T = { operation: 'transcript', project_id: 'P', transcript_id: 'T1' }, A = { operation: 'activities', project_id: 'P' };
  await bad(d => { d.get('transcripts/T1').rawText = { text: RAW }; }, T, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcripts/T1').rawText = undefined; }, T, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcripts/T1').meetingDate = 7; }, T, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcripts/T1').createdBy = 7; }, T, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcripts/T1').rawText = 'x'.repeat(1048577); }, T, 'manual_transcript_too_large')();
  await bad(d => { d.get('transcripts/T1').rawText = '\u{1F600}'.repeat(262145); }, T, 'manual_transcript_too_large')();
  await bad(d => { d.get('transcriptActivities/a3').projectId = 7; }, T, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcriptActivities/a1').type = 'bogus'; }, A, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcriptActivities/a1').source = 'email'; }, A, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcriptActivities/a1').summary = null; }, A, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcriptActivities/a1').transcriptId = '../T1'; }, A, 'invalid_manual_history_state')();
  await bad(d => { d.get('transcriptActivities/a1').rawExcerpt = 5; }, A, 'invalid_manual_history_state')();
  const exact = fixture(); exact.docs.get('transcripts/T1').rawText = 'x'.repeat(1048576);
  assert.equal((await exact.call(T)).transcript.rawText.length, 1048576);
});

test('strict requests keep existing operations backward compatible', async () => {
  const f = fixture();
  for (const data of [
    { operation: 'transcript', project_id: 'P' }, { operation: 'transcript', project_id: 'P', transcript_id: '../T1' },
    { operation: 'transcript', project_id: 'P', transcript_id: 'T1', limit: 1 }, { operation: 'transcript', project_id: 'P', transcript_id: 'T1', cursor: null },
    { operation: 'activities' }, { operation: 'activities', project_id: 'P', transcript_id: 'T1' }, { operation: 'activities', project_id: 'P', limit: 101 },
    { operation: 'get', project_id: 'P', transcript_id: 'T1' }, { operation: 'documents', project_id: 'P', transcript_id: 'T1' },
  ]) assert.equal((await f.call(data)).error, 'invalid_project_read_request', JSON.stringify(data));
  assert.equal((await f.call({ operation: 'get', project_id: 'P' })).ok, true);
});
