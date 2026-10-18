const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { applyCommand, assertDocumentBudget } = require('./materialCommands.cjs');
const { calendarDate, isDateOnly } = require('./calendarDate.cjs');

const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const email = value => typeof value === 'string' && value.length <= 254
  && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createLegacyPOMarkOperation({ db, auth, getServerTimestamp }) {
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      if (actor.customClaims.role !== 'admin') throw fault('procurement_forbidden', 403);
      const data = request.data;
      const fields = ['project_id', 'po_id', 'operation_id', 'expected_actor_uid', 'actual_sent_date', 'sent_to_email'];
      if (!plain(data) || Object.keys(data).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(data, key))
        || !validId(data.project_id) || !validId(data.po_id) || typeof data.operation_id !== 'string'
        || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.operation_id) || data.expected_actor_uid !== actor.uid
        || !isDateOnly(data.actual_sent_date) || !email(data.sent_to_email)) throw fault('invalid_procurement_request');
      const projectRef = db.collection('projects').doc(data.project_id);
      const poRef = projectRef.collection('purchaseOrders').doc(data.po_id);
      const bomRef = projectRef.collection('bom').doc('data');
      const cutoverRef = db.collection('pulseMaterialCutovers').doc(data.project_id);
      const operationRef = db.collection('pulseProcurementOperations').doc(data.project_id)
        .collection('legacyMarks').doc(data.operation_id);
      const auditRef = db.collection('pulseProcurementOperations').doc(data.project_id)
        .collection('audit').doc(`${data.operation_id}-legacy-mark`);
      const intent = { project_id: data.project_id, po_id: data.po_id, actual_sent_date: data.actual_sent_date,
        sent_to_email: data.sent_to_email.trim().toLowerCase() };
      const intentHash = hash(intent);

      return await db.runTransaction(async transaction => {
        const project = await transaction.get(projectRef);
        const po = await transaction.get(poRef);
        const bom = await transaction.get(bomRef);
        const cutover = await transaction.get(cutoverRef);
        const previous = await transaction.get(operationRef);
        if (!project.exists || !po.exists) throw fault('purchase_order_not_found', 404);
        if (po.data().projectId && po.data().projectId !== data.project_id) throw fault('procurement_forbidden', 403);
        if (previous.exists) {
          const record = previous.data();
          if (record.actor_uid !== actor.uid || record.intent_hash !== intentHash || record.po_id !== data.po_id) throw fault('operation_conflict', 409);
          return { ok: true, project_id: data.project_id, po_id: data.po_id, operation_id: data.operation_id, replayed: true };
        }
        if (cutover.exists) throw fault('material_cutover_required', 409);
        const stored = po.data();
        if (stored.nativeSendAttemptId || stored.legacySendAttemptId) throw fault('purchase_order_attempt_active', 409);
        if (stored.status !== 'pending-approval') throw fault('purchase_order_not_approved', 409);
        if (!bom.exists || !Array.isArray(bom.data()?.categories) || !Array.isArray(stored.items)
          || !stored.items.length || stored.items.length > 200) throw fault('invalid_purchase_order', 409);

        const linked = new Set();
        const updates = stored.items.map(line => {
          const itemId = line?.bomItemId;
          if (!validId(itemId) || linked.has(itemId)) throw fault('invalid_purchase_order', 409);
          linked.add(itemId);
          const item = bom.data().categories.flatMap(category => Array.isArray(category.items) ? category.items : [])
            .find(row => row.id === itemId);
          if (!item) throw fault('material_state_conflict', 409);
          const promise = calendarDate(line.dueDate) || calendarDate(stored.expectedDeliveryDate);
          return { item_id: itemId, patch: {
            ...(item.status === 'received' ? {} : { status: 'ordered' }),
            poNumber: typeof stored.poNumber === 'string' ? stored.poNumber : '',
            orderDate: data.actual_sent_date,
            ...(promise ? { expectedArrival: promise } : {}),
          } };
        });
        const materialChange = applyCommand({ categories: bom.data().categories,
          command: { kind: 'patch_items', updates }, scope: null });
        const poPatch = { status: 'sent', actualSentDate: data.actual_sent_date,
          sentBy: actor.uid, sentToEmail: intent.sent_to_email, updatedAt: getServerTimestamp() };
        const receipt = { operation: 'legacy_manual_mark_sent', project_id: data.project_id, po_id: data.po_id,
          operation_id: data.operation_id, actor_uid: actor.uid, intent_hash: intentHash,
          actual_sent_date: data.actual_sent_date, sent_to_email: intent.sent_to_email,
          phase: 'complete', created_at: getServerTimestamp() };
        const audit = { operation: 'legacy_manual_mark_sent', project_id: data.project_id, po_id: data.po_id,
          operation_id: data.operation_id, actor_uid: actor.uid, intent, material_before: materialChange.before,
          material_after: materialChange.after, created_at: getServerTimestamp() };
        assertDocumentBudget([
          { path: poRef.path, data: { ...stored, ...poPatch } },
          { path: bomRef.path, data: { ...bom.data(), categories: materialChange.categories } },
          { path: operationRef.path, data: receipt }, { path: auditRef.path, data: audit },
        ]);
        transaction.update(poRef, poPatch);
        transaction.update(bomRef, { categories: materialChange.categories });
        transaction.create(operationRef, receipt);
        transaction.create(auditRef, audit);
        return { ok: true, project_id: data.project_id, po_id: data.po_id, operation_id: data.operation_id, replayed: false };
      });
    } catch (error) {
      return { ok: false, error: error.status ? error.code : 'procurement_unavailable' };
    }
  };
}

module.exports = { createLegacyPOMarkOperation };
