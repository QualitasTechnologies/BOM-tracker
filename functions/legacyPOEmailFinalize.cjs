const { applyCommand, assertDocumentBudget } = require('./materialCommands.cjs');
const { purchaseOrderAcceptanceDate } = require('./purchaseOrderAcceptanceDate.cjs');
const { calendarDate } = require('./calendarDate.cjs');
const fault = (code, status = 409) => Object.assign(new Error(code), { code, status });

// Pure material preconditions shared by the send reservation and finalization, so a PO that
// cannot finalize is rejected before any provider call. Returns the unique linked BOM item IDs.
function legacyPOMaterialItemIds({ stored, categories }) {
  if (!Array.isArray(stored?.items) || !stored.items.length || !Array.isArray(categories)) throw fault('invalid_purchase_order');
  const ids = [...new Set(stored.items.map(item => item?.bomItemId))];
  if (ids.some(id => typeof id !== 'string' || !id.trim())) throw fault('invalid_purchase_order');
  return ids;
}

// Dry-run of the finalizer's material patch (status unless already received, plus PO number) through the shared engine:
// rejects missing items, duplicate IDs, malformed categories and received-quantity conflicts.
function assertLegacyPOMaterialSendable({ stored, categories }) {
  const ids = legacyPOMaterialItemIds({ stored, categories });
  const known = categories.flatMap(category => Array.isArray(category?.items) ? category.items : []);
  if (ids.some(id => !known.some(row => row?.id === id))) throw fault('material_state_conflict');
  // Mirrors finalization: an already received item keeps its status (received -> ordered is not a valid transition).
  applyCommand({ categories, scope: null, command: { kind: 'patch_items',
    updates: ids.map(item_id => ({ item_id, patch: {
      ...(known.find(row => row.id === item_id).status === 'received' ? {} : { status: 'ordered' }),
      poNumber: stored.poNumber || '' } })) } });
  return ids;
}

async function finalizeLegacyPOEmail({ db, projectId, poId, attemptId, actorUid, recipientEmail, acceptedMs,
  pdfUrl, fileSize, getServerTimestamp, documentId, providerId, assertActor }) {
  const projectRef = db.collection('projects').doc(projectId);
  const poRef = projectRef.collection('purchaseOrders').doc(poId);
  const bomRef = projectRef.collection('bom').doc('data');
  const cutoverRef = db.collection('pulseMaterialCutovers').doc(projectId);
  const documentRef = db.collection('projectDocuments').doc(documentId);
  const auditRef = db.collection('pulseProcurementOperations').doc(projectId).collection('audit').doc(`${attemptId}-legacy-email`);
  const acceptance = purchaseOrderAcceptanceDate(acceptedMs);

  return db.runTransaction(async transaction => {
    const project = await transaction.get(projectRef);
    const po = await transaction.get(poRef);
    const bom = await transaction.get(bomRef);
    const cutover = await transaction.get(cutoverRef);
    const document = await transaction.get(documentRef);
    const priorAudit = await transaction.get(auditRef);
    if (priorAudit.exists) return { ok: true, replayed: true, accepted_at: acceptance.acceptedAt };
    if (!project.exists || !po.exists || !bom.exists) throw fault('purchase_order_not_found', 404);
    const stored = po.data();
    if (stored.legacySendAttemptId !== attemptId || stored.status !== 'pending-approval') throw fault('purchase_order_attempt_active');
    if (typeof providerId !== 'string' || !providerId.trim()) throw fault('legacy_send_provider_evidence_missing');
    if (cutover.exists) throw fault('material_cutover_required');
    const ids = legacyPOMaterialItemIds({ stored, categories: bom.data()?.categories });
    const updates = ids.map(item_id => {
      const item = bom.data().categories.flatMap(category => Array.isArray(category.items) ? category.items : []).find(row => row.id === item_id);
      if (!item) throw fault('material_state_conflict');
      const itemPromise = stored.items.filter(row => row.bomItemId === item_id).map(row => calendarDate(row.dueDate)).find(Boolean);
      const promise = itemPromise || calendarDate(stored.expectedDeliveryDate);
      return { item_id, patch: { ...(item.status === 'received' ? {} : { status: 'ordered' }), poNumber: stored.poNumber || '',
        // Dates already entered on the item are kept; only absent ones are filled.
        ...(item.orderDate ? {} : { orderDate: acceptance.actualSentDate }),
        ...(promise && !item.expectedArrival ? { expectedArrival: promise } : {}) } };
    });
    const materialChange = applyCommand({ categories: bom.data().categories, command: { kind: 'patch_items', updates }, scope: null });
    const sentAt = new Date(acceptance.sentAtMillis);
    const poPatch = { status: 'sent', sentAt, acceptedAt: acceptance.acceptedAt, actualSentDate: acceptance.actualSentDate,
      sentBy: actorUid, sentToEmail: recipientEmail, pdfUrl, legacySendAttemptId: null, legacySendPhase: null,
      legacySendAcceptedAt: null, legacySendPreparingAt: null, legacySendDispatchStartedAt: null,
      legacySendProviderId: null, legacySendActorUid: null, legacySendRecipientEmail: null,
      legacySendPdfUrl: null, legacySendFileSize: null, legacySendDocumentId: null, legacySendRetryPayloadReady: null,
      updatedAt: getServerTimestamp() };
    await assertActor?.();
    const generatedDocument = { projectId, name: `${stored.poNumber || 'PO'}.pdf`, url: pdfUrl, type: 'vendor-po',
      uploadedAt: getServerTimestamp(), uploadedBy: actorUid, linkedBOMItems: ids, fileSize: Number.isSafeInteger(fileSize) && fileSize > 0 ? fileSize : 0 };
    if (document.exists && (document.data().projectId !== projectId || document.data().url !== pdfUrl)) throw fault('procurement_document_conflict');
    const audit = { operation: 'legacy_email_po_sent', attempt_id: attemptId, project_id: projectId, po_id: poId,
      actor_uid: actorUid, recipient_email: recipientEmail, provider_id: providerId, accepted_at: acceptance.acceptedAt,
      material_before: materialChange.before, material_after: materialChange.after, created_at: getServerTimestamp() };
    assertDocumentBudget([
      { path: poRef.path, data: { ...stored, ...poPatch } },
      { path: bomRef.path, data: { ...bom.data(), categories: materialChange.categories } },
      { path: documentRef.path, data: generatedDocument },
      { path: auditRef.path, data: audit },
    ]);
    transaction.update(poRef, poPatch);
    transaction.update(bomRef, { categories: materialChange.categories });
    if (!document.exists) transaction.create(documentRef, generatedDocument);
    transaction.create(auditRef, audit);
    return { ok: true, replayed: false, accepted_at: acceptance.acceptedAt, actual_sent_date: acceptance.actualSentDate };
  });
}

module.exports = { finalizeLegacyPOEmail, assertLegacyPOMaterialSendable };
