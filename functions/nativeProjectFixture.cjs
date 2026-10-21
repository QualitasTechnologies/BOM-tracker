const assert=require('node:assert/strict');
const { createNativeProjectOperations }=require('./nativeProjectOperations.cjs');
function fixture({ uid = 'admin', enabled = true, supportProfileEnabled = false, failAudit = false, onTargetLookup, onRead } = {}) {
  let revision = 1;
  const users = new Map(['admin', 'alice', 'partner', 'bob'].map(id => [id, { uid: id, email: `${id}@${['partner', 'bob'].includes(id) ? 'external.example' : 'qualitastech.com'}`, displayName: id, emailVerified: true,
    customClaims: { role: id === 'admin' ? 'admin' : id === 'alice' ? 'viewer' : 'user', status: 'approved' } }]));
  const docs = new Map([
    ['projects/P', { projectId: 'P', projectName: 'Project', status: 'Planning', deadline: '2026-11-01', pulseProjectId: 7, memberIds: ['admin', 'alice', 'partner'],
      members: ['admin', 'alice', 'partner'].map(userId => ({ userId, email: users.get(userId).email, displayName: userId, notificationsEnabled: false, addedBy: 'old', legacy: { retained: true } })), externalRecipients: [{ email: 'old@example.com', name: 'Old', notificationsEnabled: false, legacy: 'keep' }], supportProfile: { serial: 'unchanged' } }],
    ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'bolt', quantity: 1, legacy: 'keep' }] }] }],
    ['projectDocuments/customer', { projectId: 'P', type: 'customer-po' }],
    ['clients/C', { company: 'Acme' }], ['billingEntities/B', { legalName: 'Company', isActive: true }],
  ]);
  const versions = new Map([...docs.keys()].map(path => [path, 1]));
  const ref = (path, filters = []) => ({ path, doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`), where: (key, _op, value) => ref(path, [...filters, [key, value]]), limit: () => ref(path, filters), filters });
  const snapshot = path => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 10, nanoseconds: versions.get(path) || 1 } });
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const writes = [];
    const result = await fn({ get: async r => { assert.equal(writes.length, 0, 'all reads precede writes'); await onRead?.(r.path, users); return r.filters.length ? { docs: [...docs.keys()].filter(path => path.startsWith(`${r.path}/`) && r.filters.every(([key, value]) => docs.get(path)[key] === value)).map(snapshot) } : snapshot(r.path); },
      create: (r, data) => { assert.equal(docs.has(r.path), false); writes.push([r.path, data]); },
      update: (r, patch) => { assert.equal(docs.has(r.path), true); const data = { ...docs.get(r.path), ...patch }; for (const [key, value] of Object.entries(patch)) if (value?.__delete) delete data[key]; writes.push([r.path, data]); } });
    if (failAudit && writes.some(([path]) => path.includes('/audit/'))) throw Error('audit unavailable');
    if (writes.length) revision++; for (const [path, data] of writes) { docs.set(path, data); versions.set(path, revision); } return result;
  } };
  const auth = { verifyIdToken: async () => ({ uid, email: users.get(uid).email }), getUser: async id => { if (id !== uid) await onTargetLookup?.(users); if (!users.has(id)) throw Object.assign(Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(users.get(id)); } };
  const native = createNativeProjectOperations({ db, auth, enabled, supportProfileEnabled, getServerTimestamp: () => 'server-time', getDeleteField: () => ({ __delete: true }), now: () => new Date('2026-10-14T00:00:00Z') });
  const call = data => native({ auth: { uid }, rawRequest: { get: () => 'Bearer fixture' }, data: { project_id: 'P', expected_actor_uid: uid, ...data } });
  const command = async (command, extra = {}) => { const opening = await call({ operation: 'get' }); return call({ operation: 'command', expected_version: opening.version, operation_id: 'one', command, ...extra }); };
  return { docs, users, call, command, change: (patch) => { docs.set('projects/P', { ...docs.get('projects/P'), ...patch }); versions.set('projects/P', ++revision); } };
}
module.exports={ fixture };
