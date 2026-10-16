const assert = require('node:assert/strict');
const { createNativeProcurementOperations } = require('./nativeProcurementOperations.cjs');
function fixture(options = {}) {
  let time = 1000000, revision = 1, actorUid = 'admin';
  const docs = new Map([
    ['projects/P', { memberIds: ['admin'] }],
    ['projects/P/purchaseOrders/PO', { projectId: 'P', poNumber: 'PO-1', status: 'pending-approval', items: [{ bomItemId: 'bolt' }], totalAmount: 5 }],
    ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'bolt', itemType: 'component', name: 'Bolt', quantity: 1, status: 'not-ordered' }] }] }],
  ]);
  const ref = path => ({ path, doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`) });
  const versions = new Map([...docs.keys()].map(path => [path, 1]));
  const db = { collection: name => ref(name), runTransaction: async fn => {
    const writes = [];
    const result = await fn({ get: async r => { assert.equal(writes.length, 0); return { exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)), updateTime: { seconds: 10, nanoseconds: versions.get(r.path) || 1 } }; },
      create: (r, data) => { assert.equal(docs.has(r.path), false); writes.push([r.path, data]); },
      update: (r, data) => { assert.equal(docs.has(r.path), true); writes.push([r.path, { ...docs.get(r.path), ...data }]); } });
    if (options.failWrite?.(writes)) throw new Error("fixture commit failure"); if (writes.length) revision++; writes.forEach(([path, data]) => { docs.set(path, data); versions.set(path, revision); }); return result;
  } };
  const actor = { uid: 'admin', email: 'admin@qualitastech.com', emailVerified: true, customClaims: { role: 'admin', status: 'approved' } };
  const calls = [];
  let failProvider = false;
  const native = createNativeProcurementOperations({ db, auth: { verifyIdToken: async () => ({ uid: actorUid, email: actor.email }), getUser: async () => ({ ...actor, uid: actorUid }) }, enabled: true,
    now: () => time, getServerTimestamp: () => 'fixture-time', resolveBilling: async () => { if (options.billingFailure) throw new Error('Billing unavailable'); return { companyName: 'Company' }; },
    prepareArtifact: async () => { await options.prepare?.(actor); return { path: 'immutable/P/PO/a.pdf', generation: '1', sha256: 'a'.repeat(64), size: 10, url: 'https://example.test/proof.pdf' }; },
    sendEmail: async (frozen, key) => { calls.push({ frozen, key }); await options.provider?.(); if (failProvider) throw new Error('Timeout'); return { id: 'provider-id' }; } });
  const call = data => native({ data: { project_id: 'P', po_id: 'PO', expected_actor_uid: actorUid, ...data }, auth: { uid: actorUid }, rawRequest: { get: () => 'Bearer fixture' } });
  const send = async () => { const opening = await call({ operation: 'open' }); return call({ operation: 'send', attempt_id: 'attempt-1', expected_po_version: opening.po_version, expected_material_version: opening.material_version, mode: 'email', recipient_email: 'vendor@example.com', cc_emails: [] }); };
  return { call, send, docs, calls, switchActor: () => { actorUid = 'other'; }, timeout: value => { failProvider = value; }, advance: value => { time += value; }, changeMaterials: () => { versions.set('projects/P/bom/data', ++revision); }, revoke: () => { actor.customClaims.role = 'viewer'; } };
}
module.exports = { fixture };
