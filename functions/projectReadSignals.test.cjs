'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIGNAL_VERSION, SIGNAL_COLLECTIONS, projectReadSignalsEnabled, validProjectSignalId, validUserSignalId,
  signalBody, planSignals, createProjectReadSignals,
} = require('./projectReadSignals.cjs');

// Synthetic sentinels: none of these may ever reach a notice body.
const SENTINELS = ['Secret Project Name', 'client@private.example', 'https://example.test/private.pdf', 'motor-item-77', '987654.32'];
const sourceRecord = extra => ({
  projectName: 'Secret Project Name', clientName: 'Secret Project Name', contactEmail: 'client@private.example',
  documentUrl: 'https://example.test/private.pdf', categories: [{ name: 'Mech', items: [{ id: 'motor-item-77', price: 987654.32 }] }],
  bomSnapshot: { total: 987654.32 }, updatedAt: new Date(0), ...extra,
});
const snap = data => ({ exists: data !== undefined, data: () => data });
const change = (before, after, params) => ({ params, data: { before: snap(before), after: snap(after) } });
const rootEvent = (before, after, projectId = 'P') => change(before, after, { projectId });
const documentEvent = (before, after, documentId = 'doc-1') => change(before, after, { documentId });

// Fake Admin Firestore: records only batched sets. Any read is a test failure.
function fakeDb({ failCommit = () => false } = {}) {
  const log = { batches: [], committed: [], reads: 0, directWrites: 0, state: new Map() };
  const db = {
    collection: collectionName => ({
      doc: id => ({ path: `${collectionName}/${id}`, get() { log.reads++; throw new Error('signals must never read source'); },
        set() { log.directWrites++; }, update() { log.directWrites++; } }),
      get() { log.reads++; throw new Error('signals must never query source'); },
      where() { log.reads++; throw new Error('signals must never query source'); },
    }),
    runTransaction() { log.reads++; throw new Error('signals must not use transactions'); },
    batch() {
      const operations = [];
      const batch = {
        set(ref, data, ...rest) { operations.push({ path: ref.path, data, extra: rest }); return batch; },
        update() { throw new Error('signals use whole-body set only'); },
        delete() { throw new Error('signals never delete'); },
        async commit() {
          log.batches.push(operations.length);
          if (failCommit(log.batches.length, operations)) throw Object.assign(new Error('synthetic commit failure'), { code: 'unavailable' });
          for (const operation of operations) { log.committed.push(operation); log.state.set(operation.path, operation.data); }
        },
      };
      return batch;
    },
  };
  return { db, log };
}
const makeSignals = (options = {}, extra = {}) => {
  const fake = fakeDb(options);
  const signals = createProjectReadSignals({ db: fake.db, enabled: () => true, ...extra });
  return { ...fake, signals };
};
const paths = log => log.committed.map(operation => operation.path).sort();

test('signal bodies are exactly the schema version and an opaque server nonce', () => {
  const body = signalBody();
  assert.equal(SIGNAL_VERSION, 1);
  assert.deepEqual(Object.keys(body), ['version', 'nonce']);
  assert.equal(body.version, 1);
  assert.match(body.nonce, /^[A-Za-z0-9_-]{22,64}$/);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 64, 'minimal payload bytes');
  assert.notEqual(signalBody().nonce, body.nonce, 'nonce is random per write');
  assert.deepEqual(SIGNAL_COLLECTIONS, { project: 'pulseReadSignals', user: 'pulseUserReadSignals', catalog: 'pulseReadCatalog' });
});

test('activation is default-off and requires the exact existing server read gate', () => {
  assert.equal(projectReadSignalsEnabled({}), false);
  for (const value of ['TRUE', '1', 'yes', ' true', true, 'false']) assert.equal(projectReadSignalsEnabled({ BOM_SCOPED_READS_ENABLED: value }), false);
  assert.equal(projectReadSignalsEnabled({ BOM_SCOPED_READS_ENABLED: 'true' }), true);
  // Write-side gates must not enable reads' notices.
  assert.equal(projectReadSignalsEnabled({ BOM_MATERIAL_MUTATIONS_ENABLED: 'true', BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' }), false);
});

test('project root, BOM data and document changes invalidate their project (create, update and delete)', () => {
  for (const [before, after] of [[sourceRecord(), sourceRecord({ projectName: 'x' })], [undefined, sourceRecord()], [sourceRecord(), undefined]]) {
    assert.deepEqual(planSignals('project', rootEvent(before, after, 'P1')).projects, ['P1']);
    assert.deepEqual(planSignals('bom', rootEvent(before, after, 'P1')).projects, ['P1']);
    assert.deepEqual(planSignals('document', documentEvent(before && { projectId: 'P1' }, after && { projectId: 'P1' })).projects, ['P1']);
  }
});

test('deleted, moved and unlinked documents invalidate old and new projects, native or legacy', () => {
  assert.deepEqual(planSignals('document', documentEvent({ projectId: 'OLD', type: 'invoice' }, undefined)).projects, ['OLD']);
  assert.deepEqual(planSignals('document', documentEvent(undefined, { projectId: 'NEW' })).projects, ['NEW']);
  assert.deepEqual(planSignals('document', documentEvent({ projectId: 'OLD', linkedBOMItems: ['a'] }, { projectId: 'NEW', linkedBOMItems: [] })).projects.sort(), ['NEW', 'OLD']);
  // Native rows carry the marker; same project unlinking still invalidates exactly that project once.
  assert.deepEqual(planSignals('document', documentEvent({ projectId: 'P', pulseNativeDocument: true, linkedBOMItems: ['a'] }, { projectId: 'P', pulseNativeDocument: true, linkedBOMItems: [] })).projects, ['P']);
  // A document without a usable project reference has nothing to invalidate and must not throw.
  for (const bad of [{}, { projectId: 7 }, { projectId: '' }, { projectId: 'a/b' }, null]) assert.deepEqual(planSignals('document', documentEvent(bad, bad)).projects, []);
});

test('activity create, move, project unlink and delete invalidate before and after project links', () => {
  assert.deepEqual(planSignals('transcriptActivity', rootEvent(undefined, { projectId: 'NEW' })).projects, ['NEW']);
  assert.deepEqual(planSignals('transcriptActivity', rootEvent({ projectId: 'OLD' }, { projectId: 'NEW' })).projects.sort(), ['NEW', 'OLD']);
  assert.deepEqual(planSignals('transcriptActivity', rootEvent({ projectId: 'OLD' }, undefined)).projects, ['OLD']);
  assert.deepEqual(planSignals('transcriptActivity', rootEvent({ projectId: 'P' }, { projectId: 'P', summary: 'changed' })).projects, ['P']);
  assert.deepEqual(planSignals('transcriptActivity', rootEvent({ projectId: 'bad/id' }, { projectId: 7 })).projects, []);
});

test('transcript writes page through every linked activity and bump only opaque project notices', async () => {
  let rows = Array.from({ length: 805 }, (_, i) => ({ id: `a${i}`, data: () => ({ projectId: i % 3 === 0 ? 'P1' : i % 3 === 1 ? 'P2' : 'P3' }) }));
  const queried = [];
  const fake = fakeDb();
  fake.db.collection = name => ({
    doc: id => ({ path: `${name}/${id}` }),
    where: (field, op, value) => ({ orderBy(fieldName) { assert.equal(fieldName, '__name__'); return this; }, limit(n) { this.n = n; return this; }, startAfter(cursor) { this.cursor = cursor; return this; }, async get() { queried.push({ field, op, value, cursor: this.cursor }); const index = this.cursor ? rows.indexOf(this.cursor) + 1 : 0; const docs = rows.slice(index, index + this.n); return { docs }; } }),
  });
  const signals = createProjectReadSignals({ db: fake.db, enabled: () => true, chunkSize: 2 });
  await signals.onTranscript({ params: { transcriptId: 'T1' } });
  assert.ok(queried.length >= 3, 'all bounded query pages are read');
  assert.deepEqual(paths(fake.log), ['pulseReadSignals/P1', 'pulseReadSignals/P2', 'pulseReadSignals/P3']);
  for (const item of fake.log.committed) assert.deepEqual(Object.keys(item.data), ['version', 'nonce']);
});

test('transcript paging fails closed when a cursor does not advance, even with fresh snapshot objects', async () => {
  const fake = fakeDb();
  let calls = 0;
  fake.db.collection = name => ({
    doc: id => ({ path: `${name}/${id}` }),
    where: () => ({ orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
      async get() { if (++calls > 5) throw new Error('runaway_paging'); return { docs: Array.from({ length: 400 }, (_, i) => ({ id: `a${i}`, data: () => ({ projectId: 'P1' }) })) }; } }),
  });
  const signals = createProjectReadSignals({ db: fake.db, enabled: () => true });
  await assert.rejects(signals.onTranscript({ params: { transcriptId: 'T1' } }), /signal_link_pagination_stalled/);
  assert.equal(fake.log.committed.length, 0, 'no notice is written from an incomplete scan');
});

test('transcript writes are inert when disabled and for invalid ids', async () => {
  const fake = fakeDb();
  fake.db.collection = () => { throw new Error('must not query'); };
  assert.deepEqual(await createProjectReadSignals({ db: fake.db, enabled: () => false }).onTranscript({ params: { transcriptId: 'T1' } }), { skipped: 'disabled' });
  const on = fakeDb();
  on.db.collection = name => ({ doc: id => ({ path: `${name}/${id}` }) });
  await createProjectReadSignals({ db: on.db, enabled: () => true }).onTranscript({ params: { transcriptId: 'a/b' } });
  assert.equal(on.log.committed.length, 0);
});

test('membership changes notify the union of old and new member UIDs, once each', () => {
  const plan = planSignals('project', rootEvent(
    sourceRecord({ memberIds: ['alice', 'bob'], members: [{ userId: 'alice' }, { userId: 'bob' }] }),
    sourceRecord({ memberIds: ['bob', 'carol'], members: [{ userId: 'bob' }, { userId: 'carol' }] })));
  assert.deepEqual(plan.users.sort(), ['alice', 'bob', 'carol']);
  assert.deepEqual(plan.projects, ['P']);
  assert.equal(plan.catalog, false);
  // Member removed from the roster list only (memberIds untouched) is still a membership change.
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ memberIds: ['a'], members: [{ userId: 'a' }, { userId: 'z' }] }),
    sourceRecord({ memberIds: ['a'], members: [{ userId: 'a' }] }))).users.sort(), ['a', 'z']);
  // Explicit-null legacy fallback to an explicit list notifies the new members.
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ memberIds: null }), sourceRecord({ memberIds: ['alice'] }))).users, ['alice']);
  // Same set in a different order, or an unrelated field edit, notifies no user.
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ memberIds: ['a', 'b'] }), sourceRecord({ memberIds: ['b', 'a'] }))).users, []);
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ memberIds: ['a'] }), sourceRecord({ memberIds: ['a'], status: 'archived' }))).users, []);
  // BOM data and documents never notify users.
  assert.deepEqual(planSignals('bom', rootEvent(sourceRecord({ memberIds: ['a'] }), sourceRecord({ memberIds: ['b'] }))).users, []);
});

test('a stale roster cannot mask memberIds revocation or a change to legacy null access', () => {
  const members = [{ userId: 'alice' }, { userId: 'bob' }];
  const before = sourceRecord({ memberIds: ['alice', 'bob'], members });
  const after = sourceRecord({ memberIds: ['bob'], members });
  assert.deepEqual(planSignals('project', rootEvent(before, after)).users.sort(), ['alice', 'bob']);
  const legacy = sourceRecord({ memberIds: null, members });
  assert.deepEqual(planSignals('project', rootEvent(after, legacy)).users.sort(), ['alice', 'bob']);
  assert.deepEqual(planSignals('project', rootEvent(legacy, after)).users.sort(), ['alice', 'bob']);
});

test('project create and delete notify the admin catalog and the affected members; updates do not', () => {
  const created = planSignals('project', rootEvent(undefined, sourceRecord({ memberIds: ['alice'] })));
  assert.equal(created.catalog, true); assert.deepEqual(created.users, ['alice']); assert.deepEqual(created.projects, ['P']);
  const deleted = planSignals('project', rootEvent(sourceRecord({ memberIds: ['alice', 'bob'] }), undefined));
  assert.equal(deleted.catalog, true); assert.deepEqual(deleted.users.sort(), ['alice', 'bob']); assert.deepEqual(deleted.projects, ['P']);
  assert.equal(planSignals('project', rootEvent(sourceRecord(), sourceRecord({ status: 'archived', archivedAt: 'x' }))).catalog, false);
  assert.equal(planSignals('bom', rootEvent(undefined, sourceRecord())).catalog, false);
  assert.equal(planSignals('document', documentEvent(undefined, { projectId: 'P' })).catalog, false);
});

test('unsafe or oversized IDs from events and source arrays are skipped, never turned into paths', () => {
  const hostile = ['', '   ', '.', '..', '__reserved__', 'a/b', 'bad\nid', 'bad\u0000id', 'x'.repeat(129), 7, null, {}, ['x'], 'ok-uid'];
  const plan = planSignals('project', rootEvent(sourceRecord({ memberIds: hostile }), sourceRecord({ memberIds: [] })));
  assert.deepEqual(plan.users, ['ok-uid']);
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ memberIds: 'alice' }), sourceRecord({ memberIds: { alice: true } }))).users, []);
  assert.deepEqual(planSignals('project', rootEvent(sourceRecord({ members: 'x' }), sourceRecord({ members: [null, 3, { userId: 9 }, { userId: 'good' }] }))).users, ['good']);
  for (const id of ['', 'a/b', '..', '__x__', 'x'.repeat(513), 3, null, undefined, 'a\nb']) {
    assert.equal(validProjectSignalId(id), false, String(id)); assert.deepEqual(planSignals('project', change(sourceRecord(), sourceRecord(), { projectId: id })).projects, []);
  }
  assert.equal(validProjectSignalId('x'.repeat(512)), true); assert.equal(validUserSignalId('x'.repeat(128)), true); assert.equal(validUserSignalId('x'.repeat(129)), false);
  assert.equal(validProjectSignalId('Project-1_a.b'), true);
});

test('a missing or empty event payload still plans safely from path IDs', () => {
  assert.deepEqual(planSignals('bom', { params: { projectId: 'P' } }).projects, ['P']);
  assert.deepEqual(planSignals('project', { params: { projectId: 'P' } }), { projects: ['P'], users: [], catalog: false });
  assert.deepEqual(planSignals('document', { params: { documentId: 'd' } }), { projects: [], users: [], catalog: false });
  assert.throws(() => planSignals('other', rootEvent(undefined, undefined)), /unknown_signal_kind/);
});

test('writes contain exactly {version, nonce}, go only to signal paths and never read or echo source', async () => {
  const { signals, log } = makeSignals();
  const before = sourceRecord({ memberIds: ['alice'] }), after = sourceRecord({ memberIds: ['bob'] });
  await signals.onProject(rootEvent(before, after, 'P'));
  await signals.onBom(rootEvent(before, after, 'P'));
  await signals.onDocument(documentEvent({ projectId: 'P', documentUrl: 'https://example.test/private.pdf' }, undefined));
  assert.equal(log.reads, 0); assert.equal(log.directWrites, 0);
  assert.equal(log.committed.length, 5); // project x3 plus two membership users
  for (const operation of log.committed) {
    assert.match(operation.path, /^(pulseReadSignals|pulseUserReadSignals|pulseReadCatalog)\/[^/]+$/);
    assert.deepEqual(Object.keys(operation.data), ['version', 'nonce']); assert.equal(operation.data.version, 1);
    assert.equal(operation.extra.length, 0, 'whole-body set, no merge option');
    assert.ok(Buffer.byteLength(JSON.stringify(operation.data)) <= 64);
  }
  const bytes = JSON.stringify(log.committed.map(operation => operation.data));
  for (const sentinel of SENTINELS) assert.ok(!bytes.includes(sentinel), `body leaked ${sentinel}`);
  assert.deepEqual(paths(log).filter(path => path.startsWith('pulseUserReadSignals/')), ['pulseUserReadSignals/alice', 'pulseUserReadSignals/bob']);
});

test('project create and delete write the admin catalog notice', async () => {
  const created = makeSignals();
  await created.signals.onProject(rootEvent(undefined, sourceRecord({ memberIds: ['alice'] })));
  assert.deepEqual(paths(created.log), ['pulseReadCatalog/admin', 'pulseReadSignals/P', 'pulseUserReadSignals/alice']);
  const deleted = makeSignals();
  await deleted.signals.onProject(rootEvent(sourceRecord({ memberIds: ['alice'] }), undefined));
  assert.deepEqual(paths(deleted.log), ['pulseReadCatalog/admin', 'pulseReadSignals/P', 'pulseUserReadSignals/alice']);
  const updated = makeSignals();
  await updated.signals.onProject(rootEvent(sourceRecord({ memberIds: ['alice'] }), sourceRecord({ memberIds: ['alice'], status: 'x' })));
  assert.deepEqual(paths(updated.log), ['pulseReadSignals/P']);
});

test('moved document writes both old and new project notices', async () => {
  const { signals, log } = makeSignals();
  await signals.onDocument(documentEvent({ projectId: 'OLD', linkedBOMItems: ['a'] }, { projectId: 'NEW', linkedBOMItems: [] }));
  assert.deepEqual(paths(log), ['pulseReadSignals/NEW', 'pulseReadSignals/OLD']);
});

test('disabled gate performs no database work at all', async () => {
  const fake = fakeDb();
  let touched = 0;
  const db = new Proxy(fake.db, { get(target, key) { touched++; return target[key]; } });
  const signals = createProjectReadSignals({ db, enabled: () => false });
  for (const result of [await signals.onProject(rootEvent(undefined, sourceRecord())), await signals.onBom(rootEvent(undefined, sourceRecord())), await signals.onDocument(documentEvent(undefined, { projectId: 'P' }))]) {
    assert.deepEqual(result, { skipped: 'disabled' });
  }
  assert.equal(touched, 0); assert.equal(fake.log.committed.length, 0);
});

test('writes are chunked within bound and every chunk is attempted', async () => {
  const members = Array.from({ length: 23 }, (_, index) => `user-${index}`);
  const { signals, log } = makeSignals({}, { chunkSize: 5 });
  await signals.onProject(rootEvent(undefined, sourceRecord({ memberIds: members })));
  assert.equal(log.committed.length, 23 + 1 + 1); // users + project + catalog
  assert.ok(log.batches.every(size => size <= 5)); assert.equal(log.batches.length, 5);
  assert.equal(new Set(paths(log)).size, 25);
  for (const bad of [0, -1, 1.5, 401, 'x', NaN]) assert.throws(() => createProjectReadSignals({ db: fakeDb().db, enabled: () => true, chunkSize: bad }), /invalid_signal_chunk_size/);
  assert.doesNotThrow(() => createProjectReadSignals({ db: fakeDb().db, enabled: () => true, chunkSize: 400 }));
});

test('a partially failed event keeps trying other chunks, fails visibly and a retry completes the rest', async () => {
  const members = Array.from({ length: 12 }, (_, index) => `user-${index}`);
  let failures = 1;
  const { signals, log } = makeSignals({ failCommit: batchNumber => batchNumber === 2 && failures-- > 0 }, { chunkSize: 5 });
  const event = rootEvent(undefined, sourceRecord({ memberIds: members }));
  await assert.rejects(signals.onProject(event), error => error.message === 'signal_write_incomplete' && error.failedChunks === 1);
  const afterFirst = new Set(paths(log));
  assert.equal(afterFirst.size, 9, 'chunks 1 and 3 applied (5 + 4); failed chunk 2 (5) not applied');
  // Delivery retry of the same event: replays only invalidations and completes everything.
  await signals.onProject(event);
  assert.equal(new Set(paths(log)).size, 14);
  assert.equal(log.reads, 0);
  const total = log.committed.length;
  // Duplicate delivery after success is just another harmless invalidation with fresh nonces.
  await signals.onProject(event);
  assert.ok(log.committed.length > total);
  for (const operation of log.committed) assert.deepEqual(Object.keys(operation.data), ['version', 'nonce']);
});

test('error output carries no source values or IDs', async () => {
  const { signals } = makeSignals({ failCommit: () => true });
  let caught;
  try { await signals.onProject(rootEvent(sourceRecord({ memberIds: ['alice'] }), sourceRecord(), 'P')); } catch (error) { caught = error; }
  assert.ok(caught);
  const text = `${caught.message} ${caught.code} ${caught.failedChunks}`;
  for (const sentinel of [...SENTINELS, 'alice']) assert.ok(!text.includes(sentinel));
});

test('duplicate and out-of-order events only invalidate and never apply source state', async () => {
  const older = sourceRecord({ memberIds: ['alice'], status: 'active' }), newer = sourceRecord({ memberIds: ['alice', 'bob'], status: 'archived' });
  const forward = makeSignals(), reversed = makeSignals(), duplicate = makeSignals();
  await forward.signals.onProject(rootEvent(older, newer));
  await reversed.signals.onProject(rootEvent(newer, older)); // late, stale delivery
  await duplicate.signals.onProject(rootEvent(older, newer)); await duplicate.signals.onProject(rootEvent(older, newer));
  assert.deepEqual(paths(forward.log), paths(reversed.log));
  assert.equal(new Set(paths(duplicate.log)).size, paths(forward.log).length);
  for (const { log } of [forward, reversed, duplicate]) {
    assert.equal(log.reads, 0);
    for (const operation of log.committed) assert.deepEqual(Object.keys(operation.data), ['version', 'nonce']);
  }
  // State differences cannot reach the body: reversed and forward use only random nonces.
  assert.notEqual(forward.log.state.get('pulseReadSignals/P').nonce, reversed.log.state.get('pulseReadSignals/P').nonce);
});

test('nonce comes from the injected server randomness with no source input', async () => {
  let calls = 0;
  const { signals, log } = makeSignals({}, { randomBytes: size => { calls++; assert.ok(size >= 16); return Buffer.alloc(size, calls); } });
  await signals.onBom(rootEvent(sourceRecord(), sourceRecord(), 'P'));
  assert.equal(calls, 1);
  assert.equal(log.committed[0].data.nonce, Buffer.alloc(16, 1).toString('base64url'));
  assert.throws(() => signalBody(() => Buffer.alloc(4)), /invalid_signal_nonce/);
});

test('large membership changes retain every valid old and new UID for chunked fan-out', async () => {
  const many = Array.from({ length: 6000 }, (_, index) => `u${index}`);
  const plan = planSignals('project', rootEvent(sourceRecord({ memberIds: many }), sourceRecord({ memberIds: [] })));
  assert.deepEqual(plan.users, many);
  const { signals, log } = makeSignals();
  await signals.onProject(rootEvent(sourceRecord({ memberIds: many }), sourceRecord({ memberIds: [] })));
  assert.equal(new Set(paths(log)).size, 6001);
  assert.ok(log.batches.every(size => size <= 200));
  assert.ok(log.state.has('pulseUserReadSignals/u5999'));
});

test('project notice IDs respect the Firestore UTF-8 byte limit', () => {
  const oversized = '\u0800'.repeat(501);
  assert.ok(oversized.length < 512);
  assert.equal(validProjectSignalId(oversized), false);
  assert.deepEqual(planSignals('document', documentEvent({ projectId: 'OLD' }, { projectId: oversized })).projects, ['OLD']);
});

test('signal paths cannot re-enter a source trigger path (no recursion)', () => {
  const sourceTriggerPatterns = ['projects/{projectId}', 'projects/{projectId}/bom/data', 'projectDocuments/{documentId}'];
  const matches = (pattern, path) => {
    const left = pattern.split('/'), right = path.split('/');
    return left.length === right.length && left.every((part, index) => part.startsWith('{') || part === right[index]);
  };
  for (const path of ['pulseReadSignals/P', 'pulseUserReadSignals/alice', 'pulseReadCatalog/admin']) {
    for (const pattern of sourceTriggerPatterns) assert.equal(matches(pattern, path), false, `${path} matches ${pattern}`);
  }
  for (const collection of Object.values(SIGNAL_COLLECTIONS)) assert.ok(!['projects', 'projectDocuments', 'clients'].includes(collection));
});
