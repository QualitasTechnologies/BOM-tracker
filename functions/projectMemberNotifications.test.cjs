const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectMemberNotifications } = require('./projectMemberNotifications.cjs');

function fixture({ role = 'user', members = null } = {}) {
  const project = { projectId: 'P1', memberIds: ['alice', 'bob'], members: members || [
    { userId: 'alice', email: 'alice@example.com', notificationsEnabled: true },
    { userId: 'bob', email: 'bob@example.com', notificationsEnabled: true },
  ] };
  const docs = new Map([['projects/P1', project]]);
  const writes = [];
  const ref = path => ({ path, collection(name) { return ref(`${path}/${name}`); }, doc(id) { return ref(`${path}/${id}`); } });
  const db = {
    collection: name => ref(name),
    runTransaction: async callback => callback({
      get: async reference => ({ exists: docs.has(reference.path), data: () => docs.get(reference.path) }),
      update: (reference, value) => {
        writes.push({ kind: 'update', path: reference.path, value });
        docs.set(reference.path, { ...docs.get(reference.path), ...value });
      },
      create: (reference, value) => {
        if (docs.has(reference.path)) throw new Error('already exists');
        writes.push({ kind: 'create', path: reference.path, value });
        docs.set(reference.path, value);
      },
    }),
  };
  const auth = {
    verifyIdToken: async token => ({ uid: token, email: `${token}@example.com`, auth_time: 1 }),
    getUser: async uid => ({ uid, email: `${uid}@example.com`, emailVerified: true, tokensValidAfterTime: '', customClaims: { status: 'approved', role } }),
  };
  const handler = createProjectMemberNotifications({ db, auth, getServerTimestamp: () => 'server-time' });
  const request = (uid = 'alice', data = {}) => ({
    auth: { uid }, rawRequest: { get: name => name === 'Authorization' ? `Bearer ${uid}` : undefined },
    data: { project_id: 'P1', member_uid: 'alice', notifications_enabled: false, expected_actor_uid: uid, operation_id: 'op-1', ...data },
  });
  return { handler, request, docs, writes };
}

test('an approved project member can change only their own notification preference and the change is audited', async () => {
  const f = fixture();
  const result = await f.handler(f.request());
  assert.deepEqual(result, { ok: true, project_id: 'P1', member_uid: 'alice', notifications_enabled: false, changed: true });
  assert.equal(f.docs.get('projects/P1').members[0].notificationsEnabled, false);
  assert.equal(f.writes.filter(write => write.kind === 'update').length, 1);
  const audit = f.writes.find(write => write.kind === 'create');
  assert.match(audit.path, /^pulseProjectMemberNotificationOperations\/P1\/events\/op-1$/);
  assert.equal(audit.value.actor_uid, 'alice');
  assert.equal(audit.value.before, true);
  assert.equal(audit.value.after, false);
});

test('a non-admin member cannot change another member notification preference', async () => {
  const f = fixture();
  const result = await f.handler(f.request('alice', { member_uid: 'bob' }));
  assert.deepEqual(result, { ok: false, error: 'member_notification_forbidden', status: 403 });
  assert.equal(f.writes.length, 0);
});

test('an approved non-member cannot change a project notification preference', async () => {
  const f = fixture();
  const result = await f.handler(f.request('mallory'));
  assert.deepEqual(result, { ok: false, error: 'member_notification_forbidden', status: 403 });
  assert.equal(f.writes.length, 0);
});

test('an approved admin can change another project member notification preference', async () => {
  const f = fixture({ role: 'admin' });
  const result = await f.handler(f.request('alice', { member_uid: 'bob', expected_actor_uid: 'alice' }));
  assert.equal(result.ok, true);
  assert.equal(f.docs.get('projects/P1').members[1].notificationsEnabled, false);
});

test('retrying the same operation returns its receipt without applying or auditing twice', async () => {
  const f = fixture();
  const request = f.request();
  const first = await f.handler(request);
  const count = f.writes.length;
  const second = await f.handler(request);
  assert.deepEqual(second, first);
  assert.equal(f.writes.length, count);
});

test('an operation ID cannot be reused for a different notification value', async () => {
  const f = fixture();
  await f.handler(f.request());
  const result = await f.handler(f.request('alice', { notifications_enabled: true }));
  assert.deepEqual(result, { ok: false, error: 'member_notification_operation_conflict', status: 409 });
});

test('a mismatched asserted actor is rejected before any write', async () => {
  const f = fixture();
  const result = await f.handler(f.request('alice', { expected_actor_uid: 'bob' }));
  assert.deepEqual(result, { ok: false, error: 'invalid_member_notification_request', status: 400 });
  assert.equal(f.writes.length, 0);
});

test('a no-op preference request does not create an unbounded audit receipt', async () => {
  const f = fixture();
  const result = await f.handler(f.request('alice', { notifications_enabled: true }));
  assert.equal(result.changed, false);
  assert.equal(f.writes.length, 0);
});

test('missing projects and missing target members return explicit errors', async () => {
  const missingProject = fixture();
  missingProject.docs.delete('projects/P1');
  assert.deepEqual(await missingProject.handler(missingProject.request()), {
    ok: false, error: 'member_notification_project_not_found', status: 404,
  });

  const missingMember = fixture({ role: 'admin' });
  assert.deepEqual(await missingMember.handler(missingMember.request('alice', { member_uid: 'carol' })), {
    ok: false, error: 'member_notification_target_not_found', status: 404,
  });
});

test('project identity conflicts and unknown request keys are rejected', async () => {
  const mismatch = fixture();
  mismatch.docs.get('projects/P1').projectId = 'OTHER';
  assert.deepEqual(await mismatch.handler(mismatch.request()), {
    ok: false, error: 'member_notification_project_identity_conflict', status: 409,
  });
  const extra = fixture();
  assert.deepEqual(await extra.handler(extra.request('alice', { unexpected: true })), {
    ok: false, error: 'invalid_member_notification_request', status: 400,
  });
});

test('a retry after the caller is removed rechecks current project access', async () => {
  const f = fixture();
  const request = f.request();
  await f.handler(request);
  f.docs.get('projects/P1').members = f.docs.get('projects/P1').members.filter(member => member.userId !== 'alice');
  f.docs.get('projects/P1').memberIds = ['bob'];
  assert.deepEqual(await f.handler(request), {
    ok: false, error: 'member_notification_forbidden', status: 403,
  });
});
