const { currentNativeActor } = require('./nativeMaterialOperations.cjs');

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
const fault = (code, message, status) => Object.assign(new Error(message), { code, status });

async function authorizeLegacyPOSend({ db, auth, request, projectId, poId, nativeEnabled = false }) {
  const actor = await currentNativeActor(auth, request);
  if (actor.customClaims.role !== 'admin') throw fault('actor_forbidden', 'Only a project administrator can send a Purchase Order.', 403);
  if (nativeEnabled) throw fault('native_procurement_required', 'Native procurement is enabled. Reopen this project in Pulse to send the Purchase Order.', 409);
  if (!id(projectId) || !id(poId)) throw fault('invalid_procurement_request', 'A valid project and Purchase Order are required.', 400);

  const purchaseOrder = await db.runTransaction(async transaction => {
    const projectRef = db.collection('projects').doc(projectId);
    const poRef = projectRef.collection('purchaseOrders').doc(poId);
    const project = await transaction.get(projectRef);
    const po = await transaction.get(poRef);
    if (!project.exists || !po.exists) throw fault('purchase_order_not_found', 'Purchase Order not found.', 404);
    const stored = po.data();
    if (stored.projectId && stored.projectId !== projectId) throw fault('actor_forbidden', 'Purchase Order does not belong to this project.', 403);
    if (stored.nativeSendAttemptId) throw fault('purchase_order_attempt_active', 'A native PO send attempt is already active.', 409);
    if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved', 'Only approved Purchase Orders can be sent.', 409);
    return { ...stored, id: poId, projectId };
  });

  return { actor, purchaseOrder };
}

module.exports = { authorizeLegacyPOSend };
