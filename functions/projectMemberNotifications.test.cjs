const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectMemberNotifications } = require('./projectMemberNotifications.cjs');

function fixture({ role = 'user', members, memberIds = ['alice', 'bob'], mode, projectExists = true, failCommit = false, projectId = 'P1' } = {}) {
  const docs = new Map();
  const project = { projectId, memberIds, members: members ?? [
    { userId: 'alice', email: 'alice@example.com', notificationsEnabled: true, customField: 'keep' },
    { userId: 'bob', email: 'bob@example.com', notificationsEnabled: true },
  ] };
  if (memberIds === 'missing-field') delete project.memberIds;
  let revision = { seconds: 10, nanoseconds: 1 };
  const projectPath = `projects/${projectId}`;
  if (projectExists) docs.set(projectPath, project);
  if (mode !== undefined) docs.set('pulseRuntimeControl/cutover', { mode });
  const writes = [];
  const ref = path => ({ path, collection(name) { return ref(`${path}/${name}`); }, doc(id) { return ref(`${path}/${id}`); } });
  const db = {
    collection: name => ref(name),
    runTransaction: async callback => {
      const pending = [];
      let wrote = false;
      const tx = {
        get: async reference => {
          if (wrote) throw new Error('transaction read after write');
          const data = docs.get(reference.path);
          return { exists: docs.has(reference.path), data: () => data, updateTime: reference.path === projectPath ? revision : undefined };
        },
        update: (reference, value) => { wrote = true; pending.push({ kind: 'update', path: reference.path, value }); },
        create: (reference, value) => { wrote = true; pending.push({ kind: 'create', path: reference.path, value }); },
      };
      const result = await callback(tx);
      if (failCommit) throw new Error('transaction commit failed');
      const created = new Set();
      for (const item of pending.filter(write => write.kind === 'create')) {
        if (docs.has(item.path) || created.has(item.path)) throw new Error('already exists');
        created.add(item.path);
      }
      for (const item of pending) {
        writes.push(item);
        if (item.kind === 'update') {
          docs.set(item.path, { ...docs.get(item.path), ...item.value });
          if (item.path === projectPath) revision = { seconds: revision.seconds + 1, nanoseconds: revision.nanoseconds + 1 };
        } else docs.set(item.path, item.value);
      }
      return result;
    },
  };
  let currentRole = role;
  let afterUserLookup;
  let lookupCount = 0;
  const emails = new Map();
  const emailFor = uid => emails.get(uid) || `${uid}@example.com`;
  const auth = {
    verifyIdToken: async token => ({ uid: token, email: emailFor(token), auth_time: 1 }),
    getUser: async uid => {
      lookupCount++;
      if (afterUserLookup) await afterUserLookup(uid, lookupCount);
      return { uid, email: emailFor(uid), emailVerified: true, tokensValidAfterTime: '', customClaims: { status: 'approved', role: currentRole } };
    },
  };
  const handler = createProjectMemberNotifications({ db, auth, getServerTimestamp: () => 'server-time' });
  const request = (uid = 'alice', data = {}) => ({
    auth: { uid }, rawRequest: { get: name => name === 'Authorization' ? `Bearer ${uid}` : undefined },
    data: data.operation === 'get'
      ? { operation: 'get', project_id: projectId, expected_actor_uid: uid, ...data }
      : { operation: 'set', project_id: projectId, member_uid: 'alice', notifications_enabled: false, expected_actor_uid: uid, expected_version: '10:1', operation_id: 'op-1', ...data },
  });
  return { handler, request, docs, writes, get revision() { return `${revision.seconds}:${revision.nanoseconds}`; }, setRole: next => { currentRole = next; }, setEmail: (uid, email) => emails.set(uid, email), setAfterUserLookup: callback => { afterUserLookup = callback; } };
}

test('GET returns a versioned self-only projection and an admin projection', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler(f.request('alice', { operation: 'get' })), {
    ok: true, project_id: 'P1', version: '10:1', preferences: [{ member_uid: 'alice', notifications_enabled: true }],
  });
  f.setRole('admin');
  assert.deepEqual(await f.handler(f.request('alice', { operation: 'get' })), {
    ok: true, project_id: 'P1', version: '10:1', preferences: [
      { member_uid: 'alice', notifications_enabled: true }, { member_uid: 'bob', notifications_enabled: true },
    ],
  });
});

test('a new SET uses the displayed revision and atomically audits the preference update', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler(f.request()), {
    ok: true, project_id: 'P1', member_uid: 'alice', notifications_enabled: false, operation_id: 'op-1', changed: true, resolution: 'committed',
  });
  assert.equal(f.docs.get('projects/P1').members[0].notificationsEnabled, false);
  assert.equal(f.docs.get('projects/P1').members[0].customField, 'keep');
  assert.deepEqual(f.writes.map(write => write.kind).sort(), ['create', 'create', 'update']);
  assert.match(f.writes.find(write => write.path.includes('/events/')).path, /^pulseProjectMemberNotificationOperations\/P1\/events\/op-1$/);
});

test('stale updateTime revisions reject without project or audit writes', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler(f.request('alice', { expected_version: '10:2' })), { ok: false, error: 'project_version_conflict', status: 409 });
  assert.equal(f.writes.length, 0);
});

test('replay returns a receipt before version and read-only gates but still requires current access', async () => {
  const f = fixture(); const request = f.request();
  const committed = await f.handler(request); const count = f.writes.length;
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.deepEqual(await f.handler(request), { ...committed, resolution: 'committed' });
  assert.deepEqual(await f.handler({ ...request, data: { ...request.data, resolve_only: true } }), { ...committed, resolution: 'committed' });
  assert.equal(f.writes.length, count);
  f.docs.get('projects/P1').members = f.docs.get('projects/P1').members.filter(member => member.userId !== 'alice');
  assert.deepEqual(await f.handler(request), { ok: false, error: 'member_notification_forbidden', status: 403 });
});

test('resolve with no receipt creates an audited cancellation even while readonly and prevents a late SET', async () => {
  const f = fixture({ mode: 'read_only' });
  const request = f.request('alice', { resolve_only: true });
  assert.deepEqual(await f.handler(request), { ok: true, project_id: 'P1', member_uid: 'alice', notifications_enabled: false, operation_id: 'op-1', changed: false, resolution: 'cancelled' });
  assert.equal(f.docs.get('projects/P1').members[0].notificationsEnabled, true);
  assert.equal(f.writes.some(write => write.kind === 'update'), false);
  assert.deepEqual(await f.handler(request), { ok: true, project_id: 'P1', member_uid: 'alice', notifications_enabled: false, operation_id: 'op-1', changed: false, resolution: 'cancelled' });
  assert.deepEqual(await f.handler(f.request()), { ok: false, error: 'member_notification_request_cancelled', status: 409 });
});

test('a no-op is durably receipted so a delayed retry cannot become a later mutation', async () => {
  const f = fixture();
  const request = f.request('alice', { notifications_enabled: true });
  const result = await f.handler(request);
  assert.deepEqual(result, { ok: true, project_id: 'P1', member_uid: 'alice', notifications_enabled: true, operation_id: 'op-1', changed: false, resolution: 'committed' });
  assert.equal(f.writes.filter(write => write.kind === 'create').length, 2);
  f.docs.get('projects/P1').members[0].notificationsEnabled = false;
  assert.deepEqual(await f.handler(request), result);
  assert.equal(f.writes.filter(write => write.kind === 'create').length, 2);
});

test('the transaction fixture rolls back staged project, audit and receipt writes on commit failure', async () => {
  const f = fixture({ failCommit: true });
  const before = structuredClone([...f.docs]);
  assert.deepEqual(await f.handler(f.request()), { ok: false, error: 'member_notification_unavailable', status: 503 });
  assert.deepEqual([...f.docs], before);
  assert.equal(f.writes.length, 0);
});

test('an operation ID is bound to the immutable payload and revision', async () => {
  const f = fixture(); await f.handler(f.request());
  assert.deepEqual(await f.handler(f.request('alice', { notifications_enabled: true })), { ok: false, error: 'member_notification_operation_conflict', status: 409 });
});

test('strict membership requires a listed member and rejects missing, malformed and nonmatching memberIds', async () => {
  for (const memberIds of ['missing-field', 'alice', ['bob']]) {
    const f = fixture({ memberIds });
    const result = await f.handler(f.request());
    assert.equal(result.error, 'member_notification_forbidden');
    assert.equal(f.writes.length, 0);
  }
  const fallback = fixture({ memberIds: null });
  assert.equal((await fallback.handler(fallback.request())).ok, true);
});

test('a non-admin cannot edit another member and an admin cannot target a missing member', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request('alice', { member_uid: 'bob' }))).error, 'member_notification_forbidden');
  const admin = fixture({ role: 'admin' });
  assert.equal((await admin.handler(admin.request('alice', { member_uid: 'carol' }))).error, 'member_notification_target_not_found');
});

test('demoted admins cannot create or replay an administrator write', async () => {
  const f = fixture({ role: 'admin' });
  const request = f.request('alice', { member_uid: 'bob' });
  await f.handler(request); f.setRole('user');
  assert.equal((await f.handler(request)).error, 'member_notification_forbidden');
});

test('unknown runtime modes pause new writes while missing and coexist allow them', async () => {
  for (const mode of [undefined, 'coexist', 'pulse_only']) { const f = fixture({ mode }); assert.equal((await f.handler(f.request())).ok, true); }
  for (const mode of ['read_only', 'unexpected']) {
    const f = fixture({ mode });
    assert.deepEqual(await f.handler(f.request()), { ok: false, error: 'member_notifications_read_only', status: 503 });
  }
});

test('actor identity and current role are refreshed before returning an administrator receipt', async () => {
  const f = fixture({ role: 'admin' });
  const request = f.request('alice', { member_uid: 'bob' });
  f.setAfterUserLookup(async (_uid, count) => { if (count === 3) f.setRole('user'); });
  const result = await f.handler(request);
  assert.equal(result.error, 'member_notification_forbidden');
  assert.equal(f.writes.length, 0);
});

test('unknown request keys and missing projects return structured errors without writes', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request('alice', { extra: true }))).error, 'invalid_member_notification_request');
  const missing = fixture({ projectExists: false });
  assert.equal((await missing.handler(missing.request())).error, 'member_notification_project_not_found');
  assert.equal(f.writes.length + missing.writes.length, 0);
});

test('project IDs allow 512 characters while actor and member UIDs remain capped at 128', async () => {
  const projectId = 'p'.repeat(512);
  const longProject = fixture({ projectId });
  assert.deepEqual(await longProject.handler(longProject.request('alice', { operation: 'get' })), {
    ok: true, project_id: projectId, version: '10:1', preferences: [{ member_uid: 'alice', notifications_enabled: true }],
  });
  assert.equal((await longProject.handler(longProject.request('alice', { operation: 'get', project_id: `${projectId}p` }))).error, 'invalid_member_notification_request');
  const longUid = 'a'.repeat(129);
  assert.equal((await longProject.handler(longProject.request(longUid, { operation: 'get' }))).error, 'invalid_member_notification_request');
});

test('receipt replay is bound to the normalized actor email as well as UID', async () => {
  const f = fixture(); const request = f.request();
  const original = await f.handler(request);
  f.setEmail('alice', 'updated@example.com');
  assert.deepEqual(await f.handler(request), { ok: false, error: 'member_notification_operation_conflict', status: 409 });
  assert.equal(original.ok, true);
});

test('duplicate, oversized, and malformed member rows fail closed for reads and writes', async () => {
  const duplicate = fixture({ members: [
    { userId: 'alice', notificationsEnabled: true }, { userId: 'alice', notificationsEnabled: false },
  ] });
  assert.deepEqual(await duplicate.handler(duplicate.request()), { ok: false, error: 'invalid_project_members', status: 409 });
  assert.deepEqual(await duplicate.handler(duplicate.request('alice', { operation: 'get' })), { ok: false, error: 'invalid_project_members', status: 409 });
  const oversized = fixture({ members: Array.from({ length: 201 }, (_, index) => ({ userId: `u${index}` })) });
  assert.equal((await oversized.handler(oversized.request('alice', { operation: 'get' }))).error, 'invalid_project_members');
  const malformed = fixture({ members: [{ userId: 'alice' }, { userId: 42 }] });
  assert.deepEqual(await malformed.handler(malformed.request('alice', { operation: 'get' })), { ok: false, error: 'invalid_project_members', status: 409 });
});
