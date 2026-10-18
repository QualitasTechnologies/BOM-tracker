const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativePOAuthoringFixture.cjs');
const { authorizeLegacyPOSend } = require('./legacyPOSendGuard.cjs');

const request = uid => ({ auth: { uid }, rawRequest: { get: () => 'Bearer test' } });

test('legacy PO email requires a verified admin and returns the stored PO', async () => {
  const f = fixture({ uid: 'admin' });
  f.docs.get('projects/P/purchaseOrders/existing').status = 'pending-approval';
  const result = await authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' });
  assert.equal(result.actor.uid, 'admin');
  assert.equal(result.purchaseOrder.id, 'existing');
  assert.equal(result.purchaseOrder.projectId, 'P');
  assert.equal(result.purchaseOrder.poNumber, 'PO-EX');
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('alice'), projectId: 'P', poId: 'existing' }), /forbidden/i);
});

test('legacy PO email is denied once native procurement is enabled', async () => {
  const f = fixture({ uid: 'admin' });
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing', nativeEnabled: true }), /native procurement/i);
});

test('legacy PO email rejects unapproved, active-attempt, missing, and non-approved POs', async () => {
  const f = fixture({ uid: 'admin' });
  const po = f.docs.get('projects/P/purchaseOrders/existing');
  po.status = 'pending-approval';
  po.nativeSendAttemptId = 'active-attempt';
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }), /native PO send attempt/i);
  delete po.nativeSendAttemptId;
  po.status = 'sent';
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'existing' }), /approved Purchase Orders/i);
  await assert.rejects(authorizeLegacyPOSend({ db: f.db, auth: f.auth, request: request('admin'), projectId: 'P', poId: 'missing' }), /not found/i);
});
