const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ingestion = require('./emailIngestion');
const matching = require('./fathomMeeting');
const discovery = require('./contactDiscovery');
const scheduled = require('./gmailScheduledWork.cjs');

// Run the production ingestion functions with in-memory storage and HTTP.
// Loading index.js directly would initialize deployed Firebase handlers.
const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const sections = [
  ['async function processOneEmailBackfillJob(', '/**\n * Permanently remove'],
  ['async function syncOneGmailAccount(', '/** Move an unassigned email'],
];
const code = sections.map(([start, end]) => {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const normalized = source.slice(offset).replace(/\r\n/g, '\n');
  const endOffset = normalized.indexOf(end);
  assert.ok(endOffset >= 0, end);
  return normalized.slice(0, endOffset);
}).join('\n');

function fixture({ projectIds = ['project-1'], header = '<Raw.Case@provider.example>', mailbox = ' Connected@QualitasTech.com ', missingFirst = false } = {}) {
  const rows = new Map([
    ['stakeholderIndex/client@outside.example', { projectIds }],
    ['gmailConnections/user-1', { status: 'connected', email: mailbox, refreshToken: 'refresh-test' }],
    ['projects/project-1', { projectId: 'project-1' }],
    ['emailBackfillJobs/job-1', { status: 'pending', requestedByUid: 'user-1', contacts: ['client@outside.example'], sinceDate: new Date('2025-01-01') }],
  ]);
  const paths = new (require('@google-cloud/firestore').Firestore)({ projectId: 'offline-email-test' });
  const document = (collection, id) => { paths.collection(collection).doc(id); return ref(`${collection}/${id}`); };
  const ref = (key) => ({
    id: key.split('/').at(-1),
    collection: (name) => ({ doc: (id) => document(`${key}/${name}`, id) }),
    get: async () => ({ exists: rows.has(key), data: () => rows.get(key) }),
    set: async (data, options) => rows.set(key, options?.merge ? { ...rows.get(key), ...data } : data),
  });
  const db = { collection: (name) => ({ doc: (id) => document(name, id) }), runTransaction: async fn => {
    const writes = []; const result = await fn({get: r => r.get(), update: (r, fields) => writes.push(() => r.set(fields, {merge: true}))});
    for (const write of writes) await write(); return result;
  } };
  const resource = {
    id: 'gmail-1', threadId: 'thread-1', internalDate: '1735732800000',
    payload: {
      headers: [
        { name: 'From', value: 'client@outside.example' },
        { name: 'To', value: 'different-recipient@qualitastech.com' },
        ...(header === undefined || header === null ? [] : [{ name: 'mEsSaGe-ID', value: header }]),
      ],
      mimeType: 'text/plain', body: { data: Buffer.from('New message.').toString('base64url') },
    },
  };
  const fetch = async (url, options) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      assert.match(options.body, /refresh_token=refresh-test/);
      return { ok: true, json: async () => ({ access_token: 'access-test' }) };
    }
    assert.equal(options.headers.Authorization, 'Bearer access-test');
    if (String(url).includes('/messages/deleted?')) return { ok: false, status: 404 };
    if (String(url).includes('/messages/' + resource.id + '?')) return { ok: true, json: async () => resource };
    if (String(url).includes('/history?')) return { ok: true, json: async () => ({ historyId: '11', history: [{ messagesAdded: [...(missingFirst ? [{ message: { id: 'deleted' } }] : []), { message: { id: 'gmail-1' } }] }] }) };
    if (String(url).includes('/messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'gmail-1' }] }) };
    throw new Error(`Unexpected HTTP call: ${url}`);
  };
  const context = vm.createContext({
    ...ingestion, ...matching, ...discovery, ...scheduled, fetch,
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp', delete: () => null } } },
    logger: { info() {}, warn() {} }, BACKFILL_CONTACTS_PER_BATCH: 25,
  });
  vm.runInContext(code, context);
  const sync = () => context.syncOneGmailAccount({ db, connectionRef: ref('gmailConnections/user-1'), connection: { ...rows.get('gmailConnections/user-1'), lastHistoryId: '10' }, clientId: 'test', clientSecret: 'test' });
  const backfill = () => context.processOneEmailBackfillJob({ db, projectId: 'project-1', jobRef: ref('emailBackfillJobs/job-1'), job: { requestedByUid: 'user-1', contacts: ['client@outside.example'], sinceDate: { toDate: () => new Date('2025-01-01') } }, clientId: 'test', clientSecret: 'test' });
  return { rows, sync, backfill, process: async (messageId) => { resource.id = messageId; return context.processGmailMessage({ db, accessToken: 'access-test', messageId, mailboxEmail: mailbox }); } };
}

test('a missing history message does not pin the account cursor or permanently exclude later backfill', async () => {
  const { rows, sync } = fixture({ missingFirst: true });
  await sync();
  assert.equal(rows.get('gmailConnections/user-1').lastHistoryId, '11');
  assert.equal(rows.get('projects/project-1/emails/gmail-1').gmailMessageId, 'gmail-1');
  assert.equal(rows.has('gmailIngestedMessages/deleted'), false);
});

for (const projectIds of [['project-1'], []]) {
  test(`live ingestion preserves raw RFC id and connected mailbox on ${projectIds.length ? 'project' : 'triage'} email`, async () => {
    const { rows, sync } = fixture({ projectIds });
    await sync();
    const email = rows.get(projectIds.length ? 'projects/project-1/emails/gmail-1' : 'unassignedEmails/gmail-1');
    assert.equal(email.rfcMessageId, '<Raw.Case@provider.example>');
    assert.equal(email.mailboxEmail, 'connected@qualitastech.com');
    assert.equal(email.gmailMessageId, 'gmail-1');
    assert.equal(email.gmailThreadId, 'thread-1');
    assert.equal(email.body, 'New message.');
    assert.equal(rows.get('gmailIngestedMessageIds/Raw.Case@provider.example').gmailMessageId, 'gmail-1');
  });
}

test('backfill persists the same verified identity through the common ingestion path', async () => {
  const { rows, backfill } = fixture();
  await backfill();
  const email = rows.get('projects/project-1/emails/gmail-1');
  assert.equal(email.rfcMessageId, '<Raw.Case@provider.example>');
  assert.equal(email.mailboxEmail, 'connected@qualitastech.com');
});

test('missing RFC header does not invent an RFC id from the Gmail message or thread id', async () => {
  const { rows, sync } = fixture({ header: null });
  await sync();
  const email = rows.get('projects/project-1/emails/gmail-1');
  assert.equal(Object.hasOwn(email, 'rfcMessageId'), false);
  assert.equal(email.mailboxEmail, 'connected@qualitastech.com');
  assert.equal(rows.get('gmailIngestedMessageIds/gmail-1').gmailMessageId, 'gmail-1');
});

test('legacy connections without mailbox identity still capture without guessing from participants', async () => {
  const { rows, sync } = fixture({ mailbox: null });
  await sync();
  const email = rows.get('projects/project-1/emails/gmail-1');
  assert.equal(Object.hasOwn(email, 'mailboxEmail'), false);
  assert.equal(email.rfcMessageId, '<Raw.Case@provider.example>');
});

test('blank identity fields are omitted and reprocessing still respects existing ingestion markers', async () => {
  const { rows, sync } = fixture({ header: ' ', mailbox: ' ' });
  await sync();
  const email = rows.get('projects/project-1/emails/gmail-1');
  assert.equal(Object.hasOwn(email, 'rfcMessageId'), false);
  assert.equal(Object.hasOwn(email, 'mailboxEmail'), false);
  await sync();
  assert.equal(rows.get('projects/project-1/emails/gmail-1'), email);
});

for (const header of ['<part/with@provider.example>', '<a/b/c@provider.example>']) {
  test(`a slash-containing RFC id is captured once across mailboxes: ${header}`, async () => {
    const f = fixture({ header });
    await f.sync();
    assert.equal(f.rows.get('gmailConnections/user-1').lastHistoryId, '11');
    assert.equal(f.rows.get('projects/project-1/emails/gmail-1').rfcMessageId, header);
    assert.equal(await f.process('mailbox-two-id'), false);
    assert.equal(f.rows.has('projects/project-1/emails/mailbox-two-id'), false);
    assert.equal(f.rows.get('gmailIngestedMessages/mailbox-two-id').captured, false);
  });
}

test('a valid legacy nested RFC marker still suppresses cross-mailbox duplicates', async () => {
  const f = fixture({ header: '<a/b/c@provider.example>' });
  f.rows.set('gmailIngestedMessageIds/a/b/c@provider.example', { gmailMessageId: 'previous-mailbox-id' });
  await f.sync();
  assert.equal(f.rows.has('projects/project-1/emails/gmail-1'), false);
  assert.equal(f.rows.get('gmailIngestedMessages/gmail-1').captured, false);
  assert.equal(f.rows.get('gmailConnections/user-1').lastHistoryId, '11');
});

test('backfill shares path-safe deduplication without dropping the original RFC identity', async () => {
  const f = fixture({ header: '<part/with@provider.example>' });
  await f.backfill();
  assert.equal(f.rows.get('emailBackfillJobs/job-1').status, 'completed');
  assert.equal(f.rows.get('projects/project-1/emails/gmail-1').rfcMessageId, '<part/with@provider.example>');
  const hash = require('node:crypto').createHash('sha256').update('part/with@provider.example').digest('hex');
  assert.equal(f.rows.get(`gmailIngestedMessageIds/encoded-message-ids/entries/${hash}`).gmailMessageId, 'gmail-1');
  assert.equal(await f.process('other-mailbox-id'), false);
});

test('unsafe RFC markers cannot collide with a literal namespace root marker', async () => {
  const f = fixture({ header: '<part/with@provider.example>' });
  f.rows.set('gmailIngestedMessageIds/encoded-message-ids', { gmailMessageId: 'unrelated' });
  await f.sync();
  assert.equal(f.rows.get('projects/project-1/emails/gmail-1').gmailMessageId, 'gmail-1');
  assert.equal(f.rows.get('gmailIngestedMessageIds/encoded-message-ids').gmailMessageId, 'unrelated');
});

test('unsafe marker IDs remain bounded and distinct while ordinary legacy IDs are unchanged', () => {
  const db = new (require('@google-cloud/firestore').Firestore)({ projectId: 'offline-email-test' });
  for (const key of ['plain@provider.example', 'gmail-1']) {
    assert.deepEqual(ingestion.getGlobalMessageDedupRefs(db, key).map(ref => ref.path), [`gmailIngestedMessageIds/${key}`]);
  }
  const unsafe = ['.', '..', '__reserved__', 'x'.repeat(1501), '/leading@provider.example', 'a//b@provider.example', 'part/with@provider.example'];
  const paths = unsafe.map(key => ingestion.getGlobalMessageDedupRefs(db, key).map(ref => ref.path));
  for (const refs of paths) {
    assert.equal(refs.length, 1);
    assert.match(refs[0], /^gmailIngestedMessageIds\/encoded-message-ids\/entries\/[a-f0-9]{64}$/);
  }
  assert.equal(new Set(paths.map(refs => refs[0])).size, unsafe.length);
});
