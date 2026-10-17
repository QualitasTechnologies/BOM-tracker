const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacyPoAccess } = require('./legacyPoAccess.cjs');

const HttpsError = class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
};

function setup({ user, project, po, billingEntity, billingEntities = [], companySettings } = {}) {
  const calls = [];
  const values = { user, project, po, billingEntity, billingEntities, companySettings };
  const admin = {
    auth: () => ({ getUser: async (uid) => { calls.push(['getUser', uid]); return values.user; } }),
    firestore: () => ({
      collection: name => ({
        get: async () => {
          calls.push(['getCollection', name]);
          const docs = name === 'billingEntities'
            ? values.billingEntities.map(entity => ({ id: entity.id, data: () => entity }))
            : [];
          return { docs };
        },
        doc: id => ({
          get: async () => {
            calls.push(['get', name, id]);
            const value = name === 'projects'
              ? values.project
              : name === 'billingEntities'
                ? values.billingEntities.find(entity => entity.id === id) || (id === 'entity-1' ? values.billingEntity : undefined)
                : name === 'settings' && id === 'company'
                  ? values.companySettings
                  : undefined;
            return { exists: Boolean(value), data: () => value };
          },
          collection: child => ({
            doc: childId => ({
              get: async () => {
                calls.push(['get', name, id, child, childId]);
                return { exists: Boolean(values.po), id: childId, data: () => values.po };
              },
            }),
          }),
        }),
      }),
    }),
  };
  const access = createLegacyPoAccess({ admin, functions: { https: { HttpsError } } });
  return { access, calls, values };
}

const adminUser = { customClaims: { role: 'admin', status: 'approved' } };
const request = (uid, data = {}) => ({ auth: uid ? { uid, token: { role: 'admin', status: 'approved' } } : null, data });
const validData = { purchaseOrder: { projectId: 'project-1', id: 'po-1', poNumber: 'Caller PO', status: 'pending-approval' }, recipientEmail: 'override@example.com' };
const project = { name: 'Authoritative project', memberIds: ['member-1'], billingEntityId: 'entity-1' };
const po = { poNumber: 'PO-1', projectId: 'project-1', status: 'pending-approval', vendorEmail: 'vendor@example.com', items: [{ itemName: 'Stored item' }], billingEntityId: 'entity-1' };
const billingEntity = { legalName: 'Stored Company', companyAddress: 'Stored Address', gstin: 'GST-1', stateCode: '01', stateName: 'State', logoPath: 'logos/stored.png' };

test('send authorization requires a fresh approved global admin before reading or doing work', async () => {
  for (const [label, auth, user, expectedCode] of [
    ['anonymous', null, undefined, 'unauthenticated'],
    ['unapproved', request('u1'), { customClaims: { role: 'admin', status: 'pending' } }, 'permission-denied'],
    ['non-admin', request('u1'), { customClaims: { role: 'member', status: 'approved' } }, 'permission-denied'],
  ]) {
    const { access, calls } = setup({ user, project, po, billingEntity });
    await assert.rejects(access.prepareSend(auth ? { ...auth, data: validData } : request(null, validData)), error => error.code === expectedCode, label);
    assert.deepEqual(calls.filter(call => call[0] !== 'getUser'), [], `${label} must not read project or PO data`);
  }
});

test('send validation rejects missing project, missing PO, mismatched project, non-pending PO, and invalid recipient', async () => {
  for (const [changes, data, code] of [
    [{ project: undefined }, validData, 'not-found'],
    [{ po: undefined }, validData, 'not-found'],
    [{ po: { ...po, projectId: 'different-project' } }, validData, 'failed-precondition'],
    [{ po: { ...po, status: 'sent' } }, validData, 'failed-precondition'],
    [{}, { ...validData, recipientEmail: 'not-an-email' }, 'invalid-argument'],
  ]) {
    const { access } = setup({ user: adminUser, project, po, billingEntity, ...changes });
    await assert.rejects(access.prepareSend(request('admin-1', data)), error => error.code === code);
  }
});

test('send uses stored project, PO, and billing entity while retaining the callable recipient override', async () => {
  const { access, calls } = setup({ user: adminUser, project, po, billingEntity });
  const prepared = await access.prepareSend(request('admin-1', validData));
  assert.equal(prepared.projectId, 'project-1');
  assert.equal(prepared.po.id, 'po-1');
  assert.equal(prepared.po.projectId, 'project-1');
  assert.equal(prepared.po.poNumber, 'PO-1');
  assert.equal(prepared.companySettings.companyName, 'Stored Company');
  assert.equal(prepared.companyLogoPath, 'logos/stored.png');
  assert.equal(prepared.recipientEmail, 'override@example.com');
  assert.notEqual(prepared.po.poNumber, 'Caller PO');
  assert.ok(calls.some(call => call[0] === 'get' && call[1] === 'billingEntities' && call[2] === 'entity-1'));
});

test('primary company billing entity is loaded from settings/company', async () => {
  const companySettings = {
    companyName: 'Primary Company', companyAddress: 'Primary Address', gstin: 'GST-PRIMARY',
    stateCode: '29', stateName: 'Karnataka', logoPath: 'logos/primary.png',
  };
  const { access, calls } = setup({
    user: adminUser,
    project: { ...project, billingEntityId: 'company' },
    po: { ...po, billingEntityId: 'company' },
    companySettings,
  });
  const prepared = await access.prepareSend(request('admin-1', validData));
  assert.equal(prepared.companySettings.companyName, 'Primary Company');
  assert.equal(prepared.companyLogoPath, 'logos/primary.png');
  assert.ok(calls.some(call => call[0] === 'get' && call[1] === 'settings' && call[2] === 'company'));
});

test('send keeps valid caller-selected stakeholder CC recipients without an arbitrary low cap', async () => {
  const ccEmails = Array.from({ length: 21 }, (_, index) => `stakeholder${index}@example.com`);
  const { access } = setup({ user: adminUser, project, po, billingEntity });
  const prepared = await access.prepareSend(request('admin-1', { ...validData, ccEmails }));
  assert.equal(prepared.ccEmails.length, 21);
});

test('PDF preview requires approved project access while approved admins retain global access', async () => {
  const { access } = setup({
    user: { customClaims: { role: 'member', status: 'approved' } }, project, po, billingEntity,
  });
  await assert.rejects(access.preparePreview(request('outsider', validData)), error => error.code === 'permission-denied');

  const adminAccess = setup({ user: adminUser, project, po, billingEntity }).access;
  const preview = await adminAccess.preparePreview(request('admin-1', validData));
  assert.equal(preview.po.poNumber, 'PO-1');
  assert.equal(preview.companySettings.companyName, 'Stored Company');
});

test('approved project members retain fallback access only when memberIds is absent or null', async () => {
  for (const memberIds of [undefined, null]) {
    const storedProject = { ...project };
    if (memberIds !== undefined) storedProject.memberIds = memberIds;
    else delete storedProject.memberIds;
    const access = setup({
      user: { customClaims: { role: 'member', status: 'approved' } },
      project: storedProject, po, billingEntity,
    }).access;
    assert.equal((await access.preparePreview(request('legacy-user', validData))).po.poNumber, 'PO-1');
  }
});

test('approved project members are denied when non-null memberIds data is malformed', async () => {
  for (const memberIds of ['member-1', {}, 42]) {
    const access = setup({
      user: { customClaims: { role: 'member', status: 'approved' } },
      project: { ...project, memberIds }, po, billingEntity,
    }).access;
    await assert.rejects(access.preparePreview(request('member-1', validData)), error => error.code === 'permission-denied');
  }
});

test('legacy PO and project without billing entity ids use the primary company defaults when settings are absent', async () => {
  const access = setup({
    user: adminUser,
    project: { name: 'Legacy project', memberIds: ['member-1'] },
    po: { poNumber: 'PO-LEGACY', projectId: 'project-1', status: 'pending-approval', items: [] },
  }).access;
  const prepared = await access.prepareSend(request('admin-1', validData));
  assert.equal(prepared.companySettings.companyName, 'Qualitas Technologies Pvt Ltd');
  assert.equal(prepared.companySettings.gstin, '29AAACQ1872F1ZE');
  assert.equal(prepared.companyLogoPath, undefined);
});

test('legacy PO without an entity id uses the project entity, and otherwise honors the existing default-entity order', async () => {
  const projectEntity = { id: 'entity-project', legalName: 'Project Entity', companyAddress: 'Project Address' };
  const projectAccess = setup({
    user: adminUser,
    project: { ...project, billingEntityId: 'entity-project' },
    po: { ...po, billingEntityId: undefined },
    billingEntities: [projectEntity],
  }).access;
  assert.equal((await projectAccess.prepareSend(request('admin-1', validData))).companySettings.companyName, 'Project Entity');

  const defaultEntity = { id: 'entity-default', legalName: 'Default Entity', displayName: 'Default Entity', isDefault: true };
  const defaultAccess = setup({
    user: adminUser,
    project: { name: 'Legacy project', memberIds: ['member-1'] },
    po: { ...po, billingEntityId: undefined },
    billingEntities: [defaultEntity],
    companySettings: { companyName: 'Configured Primary' },
  }).access;
  assert.equal((await defaultAccess.prepareSend(request('admin-1', validData))).companySettings.companyName, 'Default Entity');
});
