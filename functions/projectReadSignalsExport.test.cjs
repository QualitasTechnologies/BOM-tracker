'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const MARKER = '// Content-free read notices';
const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');

function load(env = {}) {
  const start = source.indexOf(MARKER);
  assert.ok(start >= 0, 'read notice binding marker');
  const registrations = [];
  const committed = [];
  const db = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}`, get() { throw new Error('no reads'); } }) }),
    batch: () => { const ops = []; const batch = { set: (ref, data) => { ops.push({ path: ref.path, data }); return batch; }, commit: async () => { committed.push(...ops); } }; return batch; },
  };
  const fakeFirestoreModule = { onDocumentWritten: (options, handler) => { registrations.push({ options, handler }); return handler; } };
  const context = {
    exports: {}, process: { env }, console,
    require: id => id === 'firebase-functions/v2/firestore' ? fakeFirestoreModule
      : id === 'firebase-functions/logger' ? { error() {} } : require(id),
    admin: { firestore: () => db },
  };
  vm.runInNewContext(source.slice(start), context);
  return { context, registrations, committed };
}
const snap = data => ({ exists: data !== undefined, data: () => data });
const eventOf = (params, before, after) => ({ params, data: { before: snap(before), after: snap(after) } });

test('three real Firestore triggers bind the exact source paths with bounded retrying options', () => {
  const { context, registrations } = load();
  assert.deepEqual(registrations.map(entry => entry.options.document).sort(),
    ['projectDocuments/{documentId}', 'projects/{projectId}', 'projects/{projectId}/bom/data', 'transcriptActivities/{activityId}', 'transcripts/{transcriptId}']);
  for (const { options } of registrations) {
    assert.equal(options.region, 'us-central1'); assert.equal(options.retry, true);
    assert.ok(options.maxInstances > 0 && options.maxInstances <= 10); assert.ok(options.timeoutSeconds <= 120);
    assert.equal(options.secrets, undefined, 'notices need no secrets');
  }
  assert.deepEqual(Object.keys(context.exports).sort(), ['pulseReadSignalBom', 'pulseReadSignalDocument', 'pulseReadSignalProject', 'pulseReadSignalTranscript', 'pulseReadSignalTranscriptActivity']);
});

test('triggers are default-off under the exact server read gate and write only content-free notices', async () => {
  const off = load({});
  const byDocument = list => Object.fromEntries(list.registrations.map(entry => [entry.options.document, entry.handler]));
  const project = { projectName: 'Secret Project Name', memberIds: ['alice'] };
  assert.deepEqual(await byDocument(off)['projects/{projectId}'](eventOf({ projectId: 'P' }, undefined, project)), { skipped: 'disabled' });
  assert.equal(off.committed.length, 0);
  for (const value of ['1', 'TRUE', 'false']) {
    const wrong = load({ BOM_SCOPED_READS_ENABLED: value });
    await byDocument(wrong)['projects/{projectId}/bom/data'](eventOf({ projectId: 'P' }, project, project));
    assert.equal(wrong.committed.length, 0, value);
  }
  const on = load({ BOM_SCOPED_READS_ENABLED: 'true' });
  const handlers = byDocument(on);
  await handlers['projects/{projectId}'](eventOf({ projectId: 'P' }, undefined, project));
  await handlers['projects/{projectId}/bom/data'](eventOf({ projectId: 'P' }, { categories: [] }, { categories: [{ name: 'Mech' }] }));
  await handlers['projectDocuments/{documentId}'](eventOf({ documentId: 'd' }, { projectId: 'P' }, undefined));
  await handlers['transcriptActivities/{activityId}'](eventOf({ activityId: 'a' }, { projectId: 'OLD' }, { projectId: 'NEW' }));
  assert.deepEqual(on.committed.map(op => op.path).sort(), [
    'pulseReadCatalog/admin', 'pulseReadSignals/NEW', 'pulseReadSignals/OLD', 'pulseReadSignals/P', 'pulseReadSignals/P', 'pulseReadSignals/P', 'pulseUserReadSignals/alice',
  ]);
  const bytes = JSON.stringify(on.committed.map(op => op.data));
  assert.ok(!bytes.includes('Secret Project Name') && !bytes.includes('Mech'));
  for (const op of on.committed) assert.deepEqual(Object.keys(op.data), ['version', 'nonce']);
});

test('notice binding stays clear of every existing trigger and callable path (no recursion)', () => {
  const documents = [...source.matchAll(/document\s*:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(documents.includes('pulsePOApprovalNotifications/{jobId}'), 'existing triggers discovered');
  const matches = (pattern, path) => {
    const left = pattern.split('/'), right = path.split('/');
    return left.length === right.length && left.every((part, index) => part.startsWith('{') || part === right[index]);
  };
  for (const path of ['pulseReadSignals/P', 'pulseUserReadSignals/alice', 'pulseReadCatalog/admin']) {
    for (const pattern of documents) assert.equal(matches(pattern, path), false, `${path} would re-trigger ${pattern}`);
  }
  assert.ok(source.indexOf(MARKER) > source.indexOf('exports.nativeProjectReads'), 'appended after the existing read binding');
});
