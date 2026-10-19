const assert = require('node:assert/strict');
const { createNativeSupportTicketAssignment } = require('./nativeSupportTicketAssignment.cjs');

function fixture({ uid = 'alice', enabled = true, project = {
  projectId: 'P', memberIds: ['alice'], members: [
    { userId: 'alice', email: 'alice@example.com', displayName: 'Alice Roster' },
    { userId: 'engineer', email: 'engineer@example.com', displayName: 'Engineer Roster' },
  ],
}, ticket = {}, runtimeMode, failPath } = {}) {
  const users = new Map([
    ['alice', { uid: 'alice', email: 'alice@example.com', displayName: 'Alice Auth', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } }],
    ['outsider', { uid: 'outsider', email: 'outsider@example.com', displayName: 'Outsider', emailVerified: true, customClaims: { role: 'user', status: 'approved' } }],
    ['admin', { uid: 'admin', email: 'admin@example.com', displayName: 'Admin', emailVerified: true, customClaims: { role: 'admin', status: 'approved' } }],
    ['pending', { uid: 'pending', email: 'pending@example.com', displayName: 'Pending', emailVerified: true, customClaims: { role: 'user', status: 'pending' } }],
  ]);
  const docs = new Map([
    ['projects/P', project],
    ['projects/P/supportTickets/T', { projectId: 'P', ticketNumber: 'SUP-2026-ABC123', assignee: null, updatedAt: 'OLD_TIME', ...ticket }],
    ...(runtimeMode ? [['pulseRuntimeControl/cutover', { mode: runtimeMode }]] : []),
  ]);
  const versions = new Map([['projects/P/supportTickets/T', { seconds: 100, nanoseconds: 1 }]]);
  const refs = path => ({ path, id: path.split('/').at(-1), doc: id => refs(id === undefined ? `${path}/auto-${refs.next++}` : `${path}/${id}`), collection: name => refs(`${path}/${name}`) });
  refs.next = 1;
  const snapshot = path => ({ exists: docs.has(path), id: path.split('/').at(-1), data: () => structuredClone(docs.get(path)), updateTime: versions.get(path) });
  const db = {
    collection: name => refs(name),
    runTransaction: async callback => {
      const staged = [];
      const result = await callback({
        get: async document => { assert.equal(staged.length, 0, 'transaction reads must precede writes'); return snapshot(document.path); },
        create: (document, data) => staged.push({ kind: 'create', path: document.path, data: structuredClone(data) }),
        update: (document, data) => staged.push({ kind: 'update', path: document.path, data: structuredClone(data) }),
      });
      const seen = new Set();
      for (const write of staged) {
        if (write.kind === 'create' && (docs.has(write.path) || seen.has(write.path))) throw Object.assign(Error('already exists'), { code: 6 });
        if (write.kind === 'update' && !docs.has(write.path)) throw Error('missing document');
        seen.add(write.path);
        if (failPath?.(write.path)) throw Error('simulated transaction failure');
      }
      for (const write of staged) {
        if (write.kind === 'create') docs.set(write.path, write.data);
        else {
          docs.set(write.path, { ...docs.get(write.path), ...write.data });
          const old = versions.get(write.path) || { seconds: 100, nanoseconds: 1 };
          versions.set(write.path, { seconds: old.seconds, nanoseconds: old.nanoseconds + 1 });
        }
      }
      return result;
    },
  };
  const auth = {
    verifyIdToken: async () => ({ uid, email: users.get(uid)?.email, auth_time: 1 }),
    getUser: async id => { if (!users.has(id)) throw Object.assign(Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(users.get(id)); },
  };
  const handler = createNativeSupportTicketAssignment({ db, auth, enabled: () => enabled, getServerTimestamp: () => 'SERVER_TIME' });
  const call = (data = request({ expected_actor_uid: uid })) => handler({ auth: { uid }, rawRequest: { get: () => 'Bearer fixture' }, data });
  return {
    docs, call,
    setEnabled(value) { enabled = value; },
    setProject(value) { docs.set('projects/P', value); },
    setTicket(value) {
      docs.set('projects/P/supportTickets/T', value);
      const old = versions.get('projects/P/supportTickets/T');
      versions.set('projects/P/supportTickets/T', { seconds: old.seconds, nanoseconds: old.nanoseconds + 1 });
    },
  };
}

function request(overrides = {}) {
  return { operation: 'command', project_id: 'P', ticket_id: 'T', expected_actor_uid: 'alice', expected_version: '100:1', operation_id: 'assign-1',
    command: { kind: 'assignee_change', assignee_user_id: 'engineer' }, ...overrides };
}

module.exports = { fixture, request };
