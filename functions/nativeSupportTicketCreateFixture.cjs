const assert = require('node:assert/strict');
const { createNativeSupportTicketCreate } = require('./nativeSupportTicketCreate.cjs');

function fixture({ uid = 'alice', enabled = true, project = { projectId: 'P', projectName: 'Project', memberIds: ['alice'] }, failPath, onRead } = {}) {
  const users = new Map([
    ['alice', { uid: 'alice', email: 'alice@example.com', displayName: 'Alice Auth', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } }],
    ['admin', { uid: 'admin', email: 'admin@example.com', displayName: 'Admin Auth', emailVerified: true, customClaims: { role: 'admin', status: 'approved' } }],
    ['outsider', { uid: 'outsider', email: 'outsider@example.com', displayName: 'Outsider', emailVerified: true, customClaims: { role: 'user', status: 'approved' } }],
    ['pending', { uid: 'pending', email: 'pending@example.com', displayName: 'Pending', emailVerified: true, customClaims: { role: 'user', status: 'pending' } }],
  ]);
  const docs = new Map(project === null ? [] : [['projects/P', project]]);
  const ref = path => ({ path, id: path.split('/').at(-1), doc: id => id === undefined ? ref(`${path}/auto-${++nextId}`) : ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`) });
  let nextId = 0, clock = 0;
  const snapshot = path => ({ exists: docs.has(path), id: path.split('/').at(-1), data: () => structuredClone(docs.get(path)), ref: ref(path) });
  const db = {
    collection: name => ref(name),
    runTransaction: async callback => {
      const staged = [];
      const result = await callback({
        get: async document => { assert.equal(staged.length, 0, 'transaction reads must precede writes'); await onRead?.(document.path, docs, users); return snapshot(document.path); },
        create: (document, data) => { staged.push({ kind: 'create', path: document.path, data: structuredClone(data) }); },
      });
      const seen = new Set();
      for (const write of staged) {
        if (write.kind === 'create' && (docs.has(write.path) || seen.has(write.path))) throw Object.assign(Error('already exists'), { code: 6 });
        seen.add(write.path);
        if (failPath?.(write.path)) throw Error('simulated transaction failure');
      }
      for (const write of staged) docs.set(write.path, write.data);
      clock++;
      return result;
    },
  };
  const auth = {
    verifyIdToken: async token => ({ uid, email: users.get(uid)?.email, auth_time: 1 }),
    getUser: async id => { if (!users.has(id)) throw Object.assign(Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(users.get(id)); },
  };
  const handler = createNativeSupportTicketCreate({ db, auth, enabled: () => enabled, now: () => new Date('2026-10-17T12:00:00.000Z'), getServerTimestamp: () => 'SERVER_TIME' });
  const call = (input = validInput, extra = {}) => handler({ auth: { uid }, rawRequest: { get: () => 'Bearer fixture' }, data: { project_id: 'P', operation_id: 'create-1', input, ...extra } });
  return { docs, users, call, handler, setEnabled(value) { enabled = value; }, setUid(value) { uid = value; }, setProject(value) { if (value === null) docs.delete('projects/P'); else docs.set('projects/P', value); }, getClock: () => clock };
}

const validInput = Object.freeze({
  projectId: 'P', projectName: 'Form project name', clientName: 'Customer', title: 'Camera offline', description: 'Camera stopped after restart.',
  category: 'camera-lens-lighting', priority: 'high', channel: 'email', reportedByName: 'Reporter', reportedByEmail: 'reporter@example.com',
  coverageType: 'undetermined', commercialStatus: 'assessment-required', siteVisitRequired: false, downtime: true, machineStopped: true,
});

module.exports = { fixture, validInput };
