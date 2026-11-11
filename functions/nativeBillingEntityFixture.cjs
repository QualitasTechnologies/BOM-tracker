const assert = require('node:assert/strict');
const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => value instanceof Date ? new Date(value) : Array.isArray(value) ? value.map(copy) : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, row]) => [key, copy(row)])) : value;
function fixture(options = {}) {
  const { createNativeBillingEntityOperations } = require('./nativeBillingEntityOperations.cjs');
  const domain = require('./billingEntityDomain.generated.cjs'), uid = options.uid || 'admin';
  const users = new Map(['admin', 'alice', 'partner'].map(id => [id, { uid: id, email: `${id}@${id === 'partner' ? 'partner.example' : 'qualitastech.com'}`, emailVerified: true, customClaims: { status: 'approved', role: id === 'admin' ? 'admin' : 'viewer' } }]));
  const input = { ...domain.emptyBillingEntity(), legalName: 'Legal Entity', displayName: 'Entity', companyAddress: 'Address', gstin: '29AAACQ1872F1ZE', stateCode: '29', stateName: 'Karnataka', pan: 'AAACQ1872F' };
  const docs = new Map([
    ['settings/company', { ...domain.defaultCompanySettings(), nextPoNumber: 7, legacy: { retained: true } }],
    ['billingEntities/B', { ...input, nextPoNumber: 10, legacy: { retained: true } }],
    ['billingEntities/D', { ...input, legalName: 'Datasensor', displayName: 'Datasensor', nextPoNumber: 20 }],
    ['pulseRuntimeControl/cutover', { mode: 'coexist', poClientWritesFenced: true, poCounterClientWritesFenced: true, billingEntityClientWritesFenced: true }],
  ]);
  const versions = new Map([...docs.keys()].map(path => [path, 1])); let clock = 1;
  const ref = path => ({ path, doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`), orderBy: () => query(path), limit: n => query(path, n) });
  const query = (path, limit = Infinity) => ({ path, query: true, limit, orderBy: () => query(path, limit) });
  const rows = q => [...docs.keys()].filter(path => path.startsWith(q.path + '/') && !path.slice(q.path.length + 1).includes('/')).sort().slice(0, q.limit);
  const snapshot = path => { const value = copy(docs.get(path)); return { id: path.split('/').at(-1), ref: ref(path), exists: docs.has(path), data: () => copy(value), updateTime: { seconds: 10, nanoseconds: versions.get(path) || 1 } }; };
  const db = { collection: ref, runTransaction: async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map(), queries = [], writes = [];
      const result = await fn({ get: async r => {
        assert.equal(writes.length, 0, 'all reads precede writes'); await options.onRead?.(r.path, users, docs);
        if (r.query) { const names = rows(r); queries.push([r, names.join('|')]); for (const path of names) reads.set(path, versions.get(path)); return { docs: names.map(snapshot), size: names.length }; }
        reads.set(r.path, versions.get(r.path)); return snapshot(r.path);
      }, create: (r, value) => writes.push(['create', r.path, copy(value)]), update: (r, value) => writes.push(['update', r.path, copy(value)]), delete: r => writes.push(['delete', r.path]) });
      if (options.beforeCommit) { const hook = options.beforeCommit; options.beforeCommit = null; await hook(docs, versions); }
      if ([...reads].some(([path, version]) => versions.get(path) !== version) || queries.some(([q, names]) => rows(q).join('|') !== names)) continue;
      for (const [kind, path] of writes) { if (options.failAudit && path.startsWith('pulseBillingEntityAudit/')) throw Error('private audit error'); assert.equal(docs.has(path), kind !== 'create'); }
      for (const [kind, path, value] of writes) { if (kind === 'delete') docs.delete(path); else docs.set(path, kind === 'update' ? { ...docs.get(path), ...value } : value); versions.set(path, ++clock); }
      if (options.loseReply && writes.length) { options.loseReply = false; throw Error('private committed reply lost'); }
      return result;
    }
    throw Error('contention');
  } };
  const token = { uid, email: users.get(uid).email };
  const auth = { verifyIdToken: async () => copy(token), getUser: async id => copy(users.get(id)) };
  const native = createNativeBillingEntityOperations({ db, auth, enabled: options.enabled ?? true, bucketName: 'demo-bom-native-security.appspot.com', getServerTimestamp: () => new Date('2026-11-11T00:00:00Z') });
  const call = data => native({ auth: { uid }, rawRequest: { get: () => 'Bearer synthetic' }, data: { expected_actor_uid: uid, ...data } });
  return { docs, versions, users, token, input, db, auth, call };
}
module.exports = { fixture, copy };
