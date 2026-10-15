const assert = require('node:assert/strict');
function fixture(options = {}) {
  const { createNativePOAuthoringOperations } = require('./nativePOAuthoringOperations.cjs');
  const uid = options.uid || 'alice';
  const users = new Map(['admin', 'alice', 'partner', 'outsider'].map(id => [id, { uid: id, email: `${id}@${['partner','outsider'].includes(id) ? 'external.example' : 'qualitastech.com'}`, emailVerified: true, customClaims: { status: 'approved', role: id === 'admin' ? 'admin' : 'viewer' } }]));
  const billing = { legalName: 'Company', companyAddress: 'Address', gstin: 'GST', stateCode: '29', stateName: 'Karnataka', poNumberPrefix: 'PO', poNumberFormat: 'simple', nextPoNumber: 7, isActive: true, legacy: 'keep' };
  const docs = new Map([
    ['projects/P', { projectId: 'P', memberIds: ['alice','admin','partner'], projectName: 'Project' }],
    ['projects/P/bom/data', { categories: [{ name: 'Parts', items: [{ id: 'bolt', quantity: 2, name: 'Bolt', finalizedVendor:{name:'Vendor'} }] }] }],
    ['billingEntities/B', billing], ['settings/company', { ...billing, companyName: 'Company' }],
    ['vendors/V', { company: 'Vendor', address: 'Vendor address', gstNo: 'VGST', stateCode: '29', stateName: 'Karnataka', email: 'vendor@example.com', phone: '123',status:'active' }],
    ['projects/P/purchaseOrders/existing', { projectId: 'P', poNumber:'PO-EX',vendorName:'Vendor',totalAmount:100,status: 'draft', items: [{ bomItemId: 'bolt' }], paymentTerms: 'Old', expectedDeliveryDate: new Date('2026-11-01'), historical: { retained: true } }],
  ]);
  const versions = new Map([...docs.keys()].map(path => [path, 1])); let clock = 1;
  const ref = path => ({ path, doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`) });
  const snapshot = path => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 10, nanoseconds: versions.get(path) || 1 } });
  const db = { collection: ref, runTransaction: async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const writes = [], reads = new Map();
      const result = await fn({ get: async r => { assert.equal(writes.length, 0, 'reads precede writes'); await options.onRead?.(r.path, users, docs); reads.set(r.path, versions.get(r.path)); return snapshot(r.path); },
        create: (r, data) => { if (options.failAudit && r.path.includes('/audit/')) throw Error('audit'); if(options.failOutbox && r.path.startsWith('pulsePOApprovalNotifications/')) throw Error('outbox'); writes.push(['create', r.path, data]); },
        update: (r, patch) => writes.push(['update', r.path, patch]),
        delete: r => writes.push(['delete', r.path]),
      });
      if (options.beforeCommit) { const hook = options.beforeCommit; options.beforeCommit = null; await hook(docs, versions); }
      if ([...reads].some(([path, version]) => versions.get(path) !== version)) continue;
      for (const [kind, path] of writes) assert.equal(docs.has(path), kind !== 'create');
      for (const [kind, path, value] of writes) { if (kind === 'delete') docs.delete(path); else docs.set(path, structuredClone(kind === 'create' ? value : { ...docs.get(path), ...value })); versions.set(path, ++clock); }
      if(options.afterApply&&writes.length){const hook=options.afterApply;options.afterApply=null;await hook(writes,docs);}
      if (options.loseCommitReply && writes.length && (!options.loseCommitReplyWhen||options.loseCommitReplyWhen(writes))) { options.loseCommitReply = false; throw options.commitReplyError || Error('committed but reply lost'); }
      return result;
    }
    throw Error('contention');
  } };
  const auth = { verifyIdToken: async () => ({ uid, email: users.get(uid).email }), getUser: async id => structuredClone(users.get(id)) };
  const native = createNativePOAuthoringOperations({ db, auth, enabled: options.enabled ?? true, now: () => new Date(options.now || '2026-10-14T00:00:00Z'), getServerTimestamp: () => new Date(options.now || '2026-10-14T00:00:00Z') });
  const call = payload => native({ auth: { uid }, rawRequest: { get: () => 'Bearer test' }, data: { project_id: 'P', expected_actor_uid: uid, ...payload } });
  const input = { projectReference: 'Project', billingEntityId: 'B', vendorId: 'V', vendorName: 'Vendor', vendorAddress: 'Vendor address', vendorGstin: 'VGST', vendorStateCode: '29', vendorStateName: 'Karnataka', vendorEmail: 'vendor@example.com', vendorPhone: '123', items: [{ bomItemId: 'bolt', description: 'Bolt', uom: 'nos', quantity: 2, rate: 10, amount: 20 }], paymentTerms: 'Payment', deliveryTerms: 'Delivery', includeAnnexure: false };
  const billingSnapshot = { companyName: 'Company', companyAddress: 'Address', gstin: 'GST', stateCode: '29', stateName: 'Karnataka' };
  const create = extra => call({ operation: 'create', po_id: 'created', operation_id: 'create-1', expected_material_version: '10:1', input, billing_snapshot: billingSnapshot, ...extra });
  const command = (value = { kind: 'submit' }, extra = {}) => call({ operation: 'command', po_id: 'existing', operation_id: 'command-1', expected_po_version: '10:1', command: value, ...extra });
  return { docs, versions, users, input, billingSnapshot, call, create, command,db,auth };
}
module.exports = { fixture };
