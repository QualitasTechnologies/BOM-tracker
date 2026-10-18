const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createProjectOperationsHandler } = require('./projectOperations.cjs');

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test('real Firestore transactions chunk linked-document queries and enforce the write budget', {
  skip: !emulatorHost ? 'Set FIRESTORE_EMULATOR_HOST to an isolated Firestore emulator.' : false
}, async t => {
  assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/, 'This integration test must only use a local emulator.');
  const projectId = `emulator-delete-${randomUUID().replaceAll('-', '')}`;
  const app = initializeApp({ projectId: 'demo-bom-native-delete' }, `bom-delete-${projectId}`);
  const db = getFirestore(app);
  const actor = { uid: 'admin-user', email: 'admin@example.com', emailVerified: true, customClaims: { role: 'admin', status: 'approved' } };
  const projectIds = [projectId];
  const handler = createProjectOperationsHandler({
    db,
    auth: { getUserByEmail: async () => actor, getUser: async () => actor },
    getServiceKey: () => 'emulator-service-key',
    mutationsEnabled: true,
    getServerTimestamp: () => new Date()
  });
  const projectRef = db.collection('projects').doc(projectId);
  const operationsRef = db.collection('pulseProjectMaterialOperations').doc(projectId);

  t.after(async () => {
    for (const id of projectIds) {
      await db.recursiveDelete(db.collection('projects').doc(id));
      await db.recursiveDelete(db.collection('pulseProjectMaterialOperations').doc(id));
      const linkedDocs = await db.collection('projectDocuments').where('projectId', '==', id).get();
      if (!linkedDocs.empty) {
        const batch = db.batch();
        linkedDocs.docs.forEach(row => batch.delete(row.ref));
        await batch.commit();
      }
    }
    await deleteApp(app);
  });

  const seed = async ({ items, linkedDocuments }) => {
    await projectRef.set({ memberIds: [actor.uid], members: [] });
    await projectRef.collection('bom').doc('data').set({ categories: [{ name: 'Mech', items }] });
    await db.collection('settings').doc('bom').set({ categories: [{ name: 'Mech' }] });
    const batch = db.batch();
    for (const [id, linkedBOMItems] of linkedDocuments) {
      batch.set(db.collection('projectDocuments').doc(`${projectId}-${id}`), { projectId, type: 'vendor-quote', linkedBOMItems });
    }
    await batch.commit();
  };
  const command = async (itemIds, operationId) => {
    const bom = await projectRef.collection('bom').doc('data').get();
    const version = `${bom.updateTime.seconds}:${bom.updateTime.nanoseconds}`;
    const headers = {
      'x-project-operations-key': 'emulator-service-key',
      'x-pulse-user-email': actor.email,
      'x-pulse-authenticated-at': String(Date.now())
    };
    const req = {
      method: 'POST', query: { project_id: projectId, resource: 'commands' },
      body: { expected_version: version, operation_id: operationId, command: { kind: 'delete_items', item_ids: itemIds } },
      get: name => headers[name.toLowerCase()]
    };
    let status = 200, body;
    const res = { set() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await handler(req, res);
    return { status, body };
  };

  await t.test('splits 31 item IDs, deduplicates a document returned by both chunks, and commits', async () => {
    const itemIds = Array.from({ length: 31 }, (_, index) => `part-${index}`);
    const linkedDocuments = itemIds.map((id, index) => [`individual-${index}`, [id]]);
    linkedDocuments.push(['cross-chunk', ['part-0', 'part-30']]);
    await seed({ items: itemIds.map(id => ({ id, name: id, itemType: 'component', quantity: 1 })), linkedDocuments });

    const result = await command(itemIds, 'delete-chunks');

    assert.equal(result.status, 200, JSON.stringify(result.body));
    const audit = (await operationsRef.collection('materialAudit').doc('delete-chunks').get()).data();
    assert.equal(audit.before.documents.filter(row => row.document_id === `${projectId}-cross-chunk`).length, 1);
    const shared = await db.collection('projectDocuments').doc(`${projectId}-cross-chunk`).get();
    assert.deepEqual(shared.data().linkedBOMItems, []);
  });

  await t.test('accepts 400 unique documents and rejects 401 without partial writes', async () => {
    const item = { id: 'boundary', name: 'Boundary', itemType: 'component', quantity: 1 };
    await seed({
      items: [item],
      linkedDocuments: Array.from({ length: 400 }, (_, index) => [`at-limit-${index}`, ['boundary']])
    });
    const accepted = await command(['boundary'], 'delete-400');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal((await operationsRef.collection('materialAudit').doc('delete-400').get()).data().before.documents.length, 400);

    const secondProjectId = `${projectId}-over`;
    projectIds.push(secondProjectId);
    const secondProject = db.collection('projects').doc(secondProjectId);
    const secondOperations = db.collection('pulseProjectMaterialOperations').doc(secondProjectId);
    await secondProject.set({ memberIds: [actor.uid], members: [] });
    await secondProject.collection('bom').doc('data').set({ categories: [{ name: 'Mech', items: [item] }] });
    const batch = db.batch();
    for (let index = 0; index < 401; index++) batch.set(db.collection('projectDocuments').doc(`${secondProjectId}-linked-${index}`), { projectId: secondProjectId, type: 'vendor-quote', linkedBOMItems: ['boundary'] });
    await batch.commit();

    const overLimit = await runForProject(secondProjectId, secondOperations, item.id, handler, actor);
    assert.equal(overLimit.status, 413, JSON.stringify(overLimit.body));
    assert.equal(overLimit.body.error, 'material_command_too_large');
    assert.deepEqual((await secondProject.collection('bom').doc('data').get()).data().categories[0].items.map(row => row.id), ['boundary']);
    assert.equal((await db.collection('projectDocuments').doc(`${secondProjectId}-linked-0`).get()).data().linkedBOMItems[0], 'boundary');
    assert.equal((await secondOperations.collection('materialAudit').doc('delete-401').get()).exists, false);
  });

  async function runForProject(id, operations, itemId, operationHandler, currentActor) {
    const bom = await db.collection('projects').doc(id).collection('bom').doc('data').get();
    const headers = { 'x-project-operations-key': 'emulator-service-key', 'x-pulse-user-email': currentActor.email, 'x-pulse-authenticated-at': String(Date.now()) };
    const req = { method: 'POST', query: { project_id: id, resource: 'commands' }, body: { expected_version: `${bom.updateTime.seconds}:${bom.updateTime.nanoseconds}`, operation_id: 'delete-401', command: { kind: 'delete_items', item_ids: [itemId] } }, get: name => headers[name.toLowerCase()] };
    let status = 200, body;
    const res = { set() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await operationHandler(req, res);
    return { status, body };
  }
});
