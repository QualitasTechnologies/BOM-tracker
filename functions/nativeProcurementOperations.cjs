const { createHash, randomUUID } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { applyCommand, assertDocumentBudget } = require('./materialCommands.cjs');
const { purchaseOrderAcceptanceDate } = require('./purchaseOrderAcceptanceDate.cjs');
const { calendarDate, isDateOnly } = require('./calendarDate.cjs');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const version = snapshot => snapshot.exists ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : 'missing';
const versionValid = value => value === 'missing' || typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const freeze = value => value instanceof Date ? value.toISOString() : value && typeof value.toDate === 'function' ? value.toDate().toISOString()
  : Array.isArray(value) ? value.map(freeze) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, freeze(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(freeze(value))).digest('hex');
const business = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['status', 'updatedAt', 'sentAt', 'acceptedAt', 'sentBy', 'sentToEmail', 'actualSentDate', 'pdfUrl', 'nativeSendAttemptId', 'nativeSendPhase', 'legacySendAttemptId', 'legacySendPhase', 'legacySendAcceptedAt', 'legacySendPreparingAt', 'legacySendDispatchStartedAt', 'legacySendProviderId', 'legacySendActorUid', 'legacySendRecipientEmail', 'legacySendPdfUrl', 'legacySendFileSize', 'legacySendDocumentId', 'legacySendRetryPayloadReady'].includes(key)));
const mail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
const RETRY_WINDOW = 23 * 60 * 60 * 1000;
const LEASE = 5 * 60 * 1000;

// The provider and artifact seams must be server-only and preserve immutable bytes.
function createNativeProcurementOperations({ db, auth, enabled = false, now = Date.now, timestampFromMillis = millis => new Date(millis), getServerTimestamp, resolveBilling, prepareArtifact, sendEmail }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      if (actor.customClaims.role !== 'admin') throw fault('procurement_forbidden', 403);
      const data = request.data;
      if (!plain(data) || !['open', 'send', 'recover', 'reconcile', 'cancel'].includes(data.operation) || !id(data.project_id) || !id(data.po_id)) throw fault('invalid_procurement_request');
      if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
      const shared = ['operation', 'project_id', 'po_id', 'expected_actor_uid'];
      const fields = data.operation === 'send' ? [...shared, 'attempt_id', 'expected_po_version', 'expected_material_version', 'mode', 'recipient_email', 'cc_emails', ...(data.mode === 'mark' ? ['actual_sent_date'] : [])]
        : data.operation === 'reconcile' ? [...shared, 'attempt_id', 'expected_material_version'] : ['recover', 'cancel'].includes(data.operation) ? [...shared, 'attempt_id'] : shared;
      if (Object.keys(data).some(key => !fields.includes(key))) throw fault('invalid_procurement_request');
      const projectRef = db.collection('projects').doc(data.project_id);
      const poRef = projectRef.collection('purchaseOrders').doc(data.po_id);
      const bomRef = projectRef.collection('bom').doc('data');
      const cutoverRef = db.collection('pulseMaterialCutovers').doc(data.project_id);
      const attempts = db.collection('pulseProcurementOperations').doc(data.project_id).collection('attempts');
      const audits = db.collection('pulseProcurementOperations').doc(data.project_id).collection('audit');
      const read = async transaction => {
        const project = await transaction.get(projectRef), po = await transaction.get(poRef), bom = await transaction.get(bomRef), cutover = await transaction.get(cutoverRef);
        if (!project.exists || !po.exists) throw fault('purchase_order_not_found', 404);
        if (po.data().projectId && po.data().projectId !== data.project_id) throw fault('procurement_forbidden', 403);
        return { project, po, bom, cutover };
      };
      const publicAttempt = attempt => ({ ok: true, project_id: data.project_id, po_id: data.po_id, attempt_id: attempt.attempt_id,
        phase: attempt.phase === 'dispatching' ? attempt.lease_until > now() ? 'pending' : 'uncertain' : attempt.phase,
        mode: attempt.mode, recipient_email: attempt.recipient_email, cc_emails: attempt.cc_emails,
        ...(attempt.problem ? { problem: attempt.problem } : {}) });
      if (data.operation === 'open') return await db.runTransaction(async transaction => {
        const state = await read(transaction);
        const attemptId = state.po.data().nativeSendAttemptId;
        const attempt = attemptId ? await transaction.get(attempts.doc(attemptId)) : null;
        return { ok: true, project_id: data.project_id, po_id: data.po_id, po_version: version(state.po), material_version: version(state.bom),
          purchase_order: { ...freeze(state.po.data()), id: data.po_id, projectId: data.project_id },
          material_items: (Array.isArray(state.bom.data()?.categories) ? state.bom.data().categories : []).flatMap(category => (Array.isArray(category.items) ? category.items : []).filter(item => state.po.data().items?.some(row => row.bomItemId === item.id)).map(item => ({ id: item.id, name: item.name ?? '', status: item.status ?? '', quantity: item.quantity ?? 0, category: category.name }))),
          permissions: { send: writesOn() && state.cutover.exists, legacy_send: !state.cutover.exists }, attempt: attempt?.exists ? publicAttempt(attempt.data()) : null };
      });
      if (!writesOn()) throw fault('procurement_mutations_disabled', 503);
      let attemptId = data.attempt_id;
      if (attemptId !== undefined && (typeof attemptId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId))) throw fault('invalid_procurement_request');
      if (data.operation === 'send') {
        if (!attemptId || !versionValid(data.expected_po_version) || !versionValid(data.expected_material_version)
          || !['email', 'mark'].includes(data.mode) || !mail(data.recipient_email) || !Array.isArray(data.cc_emails) || data.cc_emails.length > 100 || data.cc_emails.some(value => !mail(value))) throw fault('invalid_procurement_request');
        if (data.mode === 'mark' ? !isDateOnly(data.actual_sent_date) : Object.hasOwn(data, 'actual_sent_date')) throw fault('invalid_procurement_request');
        const intent = { po_id: data.po_id, expected_po_version: data.expected_po_version, expected_material_version: data.expected_material_version,
          mode: data.mode, ...(data.mode === 'mark' ? { actual_sent_date: data.actual_sent_date } : {}), recipient_email: data.recipient_email.trim().toLowerCase(), cc_emails: [...new Set([...data.cc_emails.map(value => value.trim().toLowerCase()), actor.email])].filter(value => value !== data.recipient_email.trim().toLowerCase()).sort() };
        await db.runTransaction(async transaction => {
          const state = await read(transaction), previous = await transaction.get(attempts.doc(attemptId));
          if (!state.cutover.exists) throw fault('material_cutover_required', 503);
          if (previous.exists) {
            const record = previous.data();
            if (record.po_id !== data.po_id || record.actor_uid !== actor.uid || record.intent_hash !== hash(intent)) throw fault('operation_conflict', 409);
            return;
          }
          if (state.po.data().nativeSendAttemptId || state.po.data().legacySendAttemptId) throw fault('purchase_order_attempt_active', 409);
          if (state.po.data().status !== 'pending-approval') throw fault('purchase_order_not_approved', 409);
          if (version(state.po) !== data.expected_po_version || version(state.bom) !== data.expected_material_version) throw fault('procurement_version_conflict', 409);
          const billing = data.mode === 'email' ? await resolveBilling(state.po.data(), state.project.data(), transaction) : {};
          if (data.mode === 'email' && (!plain(billing) || typeof billing.companyName !== 'string' || !billing.companyName)) throw fault('billing_entity_unavailable', 503);
          const po = freeze({ ...state.po.data(), id: data.po_id, projectId: data.project_id });
          if (!Array.isArray(po.items) || !po.items.length || po.items.length > 200 || po.items.some(item => !id(item.bomItemId))) throw fault('invalid_purchase_order');
          const record = { ...intent, attempt_id: attemptId, actor_uid: actor.uid, actor_email: actor.email, intent_hash: hash(intent), po_hash: hash(business(po)),
            po_snapshot: po, billing: freeze(billing), phase: 'prepared', created_ms: now(), artifact_key: randomUUID() + randomUUID() };
          const audit = { operation: 'prepare_po_send', project_id: data.project_id, po_id: data.po_id, actor_uid: actor.uid, intent, created_at: getServerTimestamp() };
          assertDocumentBudget([{ path: attempts.doc(attemptId).path, data: record }, { path: audits.doc(`${attemptId}-prepared`).path, data: audit }]);
          transaction.create(attempts.doc(attemptId), record); transaction.create(audits.doc(`${attemptId}-prepared`), audit);
          transaction.update(poRef, { nativeSendAttemptId: attemptId, nativeSendPhase: 'prepared' });
        });
      } else if (!attemptId) {
        attemptId = await db.runTransaction(async transaction => (await read(transaction)).po.data().nativeSendAttemptId);
      }
      if (!attemptId || !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId)) throw fault('procurement_attempt_not_found', 404);
      const attemptRef = attempts.doc(attemptId);
      if (data.operation === 'cancel') return await db.runTransaction(async transaction => {
        const state = await read(transaction), stored = await transaction.get(attemptRef);
        if (!state.cutover.exists) throw fault('material_cutover_required', 503);
        if (!stored.exists || stored.data().po_id !== data.po_id) throw fault('procurement_attempt_not_found', 404);
        const record = stored.data();
        if (record.phase === 'cancelled') return publicAttempt(record);
        if (state.po.data().nativeSendAttemptId !== attemptId || record.phase !== 'prepared' || record.dispatched_ms !== undefined || record.lease_until > now()) throw fault('send_cannot_be_cancelled', 409);
        transaction.update(attemptRef, { phase: 'cancelled', lease_until: 0 });
        transaction.update(poRef, { nativeSendAttemptId: null, nativeSendPhase: 'cancelled' });
        transaction.create(audits.doc(`${attemptId}-cancelled`), { operation: 'cancel_po_send', actor_uid: actor.uid, attempt_id: attemptId, project_id: data.project_id, po_id: data.po_id, created_at: getServerTimestamp() });
        return publicAttempt({ ...record, phase: 'cancelled' });
      });
      const claim = randomUUID();
      const attempt = await db.runTransaction(async transaction => {
        const state = await read(transaction), stored = await transaction.get(attemptRef);
        if (!state.cutover.exists) throw fault('material_cutover_required', 503);
        if (!stored.exists || stored.data().po_id !== data.po_id || state.po.data().nativeSendAttemptId !== attemptId) throw fault('procurement_attempt_not_found', 404);
        const record = stored.data();
        if (record.phase === 'complete') return record;
        if (!['accepted', 'material_pending', 'metadata_pending'].includes(record.phase) && record.actor_uid !== actor.uid) throw fault('procurement_attempt_owner_required', 403);
        if (record.lease_until > now()) return { ...record, pending: true };
        if (record.dispatched_ms !== undefined && !['accepted', 'material_pending', 'metadata_pending'].includes(record.phase) && now() - record.dispatched_ms >= RETRY_WINDOW) return { ...record, phase: 'needs_reconciliation' };
        if (data.operation === 'reconcile' && !['accepted', 'material_pending', 'metadata_pending'].includes(record.phase)) throw fault('send_outcome_unconfirmed', 409);
        if (hash(business({ ...state.po.data(), id: data.po_id, projectId: data.project_id })) !== record.po_hash) throw fault('purchase_order_changed', 409);
        if (!['pending-approval', 'sent'].includes(state.po.data().status)) throw fault('purchase_order_not_approved', 409);
        transaction.update(attemptRef, { lease_owner: claim, lease_until: now() + LEASE });
        return { ...record, lease_owner: claim };
      });
      if (attempt.pending) return { ...publicAttempt(attempt), phase: 'pending' };
      if (['complete', 'needs_reconciliation'].includes(attempt.phase)) return publicAttempt(attempt);
      const store = async (update, auditPhase) => db.runTransaction(async transaction => {
        const stored = await transaction.get(attemptRef);
        if (!stored.exists || stored.data().lease_owner !== claim) throw fault('procurement_lease_lost', 409);
        const auditRef = auditPhase ? audits.doc(`${attemptId}-${auditPhase}`) : null;
        const audit = auditRef ? await transaction.get(auditRef) : null;
        transaction.update(attemptRef, update);
        if (auditRef && !audit.exists) transaction.create(auditRef, { operation: `po_send_${auditPhase}`, actor_uid: actor.uid, sending_actor_uid: stored.data().actor_uid,
          project_id: data.project_id, po_id: data.po_id, attempt_id: attemptId, ...(update.provider_id ? { provider_id: update.provider_id } : {}), created_at: getServerTimestamp() });
      });
      try {
        if (!['accepted', 'material_pending', 'metadata_pending'].includes(attempt.phase)) {
          if (!attempt.artifact && attempt.mode === 'email') {
            await db.runTransaction(async transaction => {
              const state = await read(transaction), stored = await transaction.get(attemptRef);
              if (!state.cutover.exists) throw fault('material_cutover_required', 503);
              if (!stored.exists || stored.data().lease_owner !== claim) throw fault('procurement_lease_lost', 409);
            });
            const artifact = await prepareArtifact(attempt.po_snapshot, attempt.billing, { project_id: data.project_id, po_id: data.po_id, attempt_id: attemptId, payload_hash: attempt.intent_hash, artifact_key: attempt.artifact_key });
            if (!plain(artifact) || typeof artifact.path !== 'string' || typeof artifact.generation !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || typeof artifact.url !== 'string') throw fault('invalid_procurement_artifact', 503);
            await store({ artifact }); attempt.artifact = artifact;
          }
          // Revalidate approval/profile immediately before the irreversible effect.
          const dispatchActor = await currentNativeActor(auth, request);
          if (dispatchActor.customClaims.role !== 'admin') throw fault('procurement_forbidden', 403);
          await db.runTransaction(async transaction => {
            const state = await read(transaction), stored = await transaction.get(attemptRef);
            if (stored.data().lease_owner !== claim) throw fault('procurement_lease_lost', 409);
            if (state.po.data().status !== 'pending-approval' || hash(business({ ...state.po.data(), id: data.po_id, projectId: data.project_id })) !== attempt.po_hash) throw fault('purchase_order_changed', 409);
            if (!state.cutover.exists) throw fault('material_cutover_required', 503);
            const sendTimestampMs = attempt.send_timestamp_ms ?? now();
            transaction.update(attemptRef, { dispatched_ms: attempt.dispatched_ms ?? sendTimestampMs, send_timestamp_ms: sendTimestampMs, phase: 'dispatching' });
            attempt.send_timestamp_ms = sendTimestampMs;
          });
          let providerId = 'marked-by-admin';
          if (attempt.mode === 'email') {
            const provider = await sendEmail({ purchaseOrder: attempt.po_snapshot, companySettings: attempt.billing,
              recipientEmail: attempt.recipient_email, ccEmails: attempt.cc_emails, artifact: attempt.artifact }, `bom-po-${hash([data.project_id, data.po_id, attemptId])}`);
            if (!provider || typeof provider.id !== 'string' || !provider.id || provider.id.length > 512) throw fault('provider_outcome_unconfirmed', 503);
            providerId = provider.id;
          }
          const acceptedMs = now();
          await store({ phase: 'accepted', provider_id: providerId, accepted_ms: attempt.accepted_ms ?? acceptedMs }, 'accepted');
          attempt.accepted_ms ??= acceptedMs; attempt.phase = 'accepted';
        }
        const finalActor = await currentNativeActor(auth, request);
        if (finalActor.customClaims.role !== 'admin') throw fault('procurement_forbidden', 403);
        const result = await db.runTransaction(async transaction => {
          const state = await read(transaction), stored = await transaction.get(attemptRef);
          if (!stored.exists || stored.data().lease_owner !== claim || !['accepted', 'material_pending', 'metadata_pending'].includes(stored.data().phase)) throw fault('procurement_lease_lost', 409);
          const record = stored.data();
          if (!['pending-approval', 'sent'].includes(state.po.data().status) || hash(business({ ...state.po.data(), id: data.po_id, projectId: data.project_id })) !== record.po_hash) {
            transaction.update(attemptRef, { phase: 'metadata_pending', lease_until: 0, problem: 'purchase_order_changed' });
            return publicAttempt({ ...record, phase: 'metadata_pending', problem: 'purchase_order_changed' });
          }
          const docRef = db.collection('projectDocuments').doc(`native-po-${hash([data.project_id, data.po_id, attemptId])}`);
          const document = attempt.mode === 'email' ? await transaction.get(docRef) : null;
          const auditRef = audits.doc(`${attemptId}-finalized`), audit = await transaction.get(auditRef);
          const expected = data.operation === 'reconcile' ? data.expected_material_version : record.expected_material_version;
          if (data.operation === 'reconcile' && !versionValid(expected)) throw fault('invalid_procurement_request');
          let nextCategories = null, changes = null, problem = 'material_version_conflict';
          if (version(state.bom) === expected) {
            try {
              const categories = state.bom.data()?.categories;
              const ids = [...new Set(record.po_snapshot.items.map(item => item.bomItemId))];
              const orderDate = record.mode === 'mark' ? record.actual_sent_date : purchaseOrderAcceptanceDate(record.accepted_ms).actualSentDate;
              const updates = ids.map(item_id => {
                const item = categories.flatMap(category => category.items).find(item => item.id === item_id);
                const linePromise = record.po_snapshot.items.find(poItem => poItem.bomItemId === item_id)?.dueDate;
                const promise = calendarDate(linePromise) || calendarDate(record.po_snapshot.expectedDeliveryDate);
                return { item_id, patch: { ...(item?.status === 'received' ? {} : { status: 'ordered' }), poNumber: record.po_snapshot.poNumber || '', orderDate,
                  ...(promise ? { expectedArrival: promise } : {}) } };
              });
              changes = applyCommand({ categories, command: { kind: 'patch_items', updates }, scope: null }); nextCategories = changes.categories;
            } catch (error) { problem = error.code || 'material_state_conflict'; }
          }
          const phase = nextCategories ? 'complete' : 'material_pending';
          const actualSentDate = record.mode === 'mark' ? record.actual_sent_date : purchaseOrderAcceptanceDate(record.accepted_ms).actualSentDate;
          const sentAt = record.mode === 'email' ? { sentAt: timestampFromMillis(record.accepted_ms) } : {};
          const sentFields = { status: 'sent', sentBy: record.actor_uid, sentToEmail: record.recipient_email, actualSentDate, nativeSendPhase: phase, ...sentAt,
            ...(record.artifact ? { pdfUrl: record.artifact.url } : {}) };
          const generated = record.artifact ? { projectId: data.project_id, name: `${record.po_snapshot.poNumber || 'PO'}.pdf`, type: 'vendor-po', url: record.artifact.url,
            uploadedAt: getServerTimestamp(), uploadedBy: record.actor_uid, linkedBOMItems: [...new Set(record.po_snapshot.items.map(item => item.bomItemId))], fileSize: record.artifact.size } : null;
          if (document?.exists && (document.data().projectId !== data.project_id || document.data().url !== record.artifact.url)) throw fault('procurement_document_conflict', 409);
          const finalAudit = { operation: 'finalize_po_send', actor_uid: actor.uid, sending_actor_uid: record.actor_uid, project_id: data.project_id, po_id: data.po_id, attempt_id: attemptId,
            material_before: changes?.before ?? null, material_after: changes?.after ?? null, phase, created_at: getServerTimestamp() };
          if (!state.cutover.exists) throw fault('material_cutover_required', 503);
          assertDocumentBudget([{ path: poRef.path, data: { ...state.po.data(), ...sentFields } }, { path: auditRef.path, data: finalAudit },
            ...(generated ? [{ path: docRef.path, data: generated }] : []), ...(nextCategories ? [{ path: bomRef.path, data: { ...state.bom.data(), categories: nextCategories } }] : [])]);
          transaction.update(poRef, sentFields);
          if (generated && !document.exists) transaction.create(docRef, generated);
          if (!audit.exists) transaction.create(auditRef, finalAudit);
          if (nextCategories) {
            transaction.update(bomRef, { categories: nextCategories });
            const materialAuditRef = audits.doc(`${attemptId}-materials`);
            // A complete attempt is terminal, so this receipt can be created only once.
            transaction.create(materialAuditRef, { ...finalAudit, operation: 'reconcile_po_materials' });
          }
          transaction.update(attemptRef, { phase, lease_until: 0, problem: nextCategories ? null : problem });
          return publicAttempt({ ...record, phase, problem: nextCategories ? null : problem });
        });
        return result;
      } catch (error) {
        if (error.code === 'material_cutover_required') return { ok: false, error: error.code };
        // Never downgrade a persisted provider acknowledgment into a failed send.
        await db.runTransaction(async transaction => {
          const stored = await transaction.get(attemptRef);
          if (!stored.exists || stored.data().lease_owner !== claim) return;
          const phase = ['accepted', 'material_pending', 'metadata_pending'].includes(stored.data().phase) ? 'metadata_pending' : stored.data().dispatched_ms !== undefined ? 'uncertain' : 'prepared';
          transaction.update(attemptRef, { phase, lease_until: 0, problem: error.status ? error.code : 'procurement_outcome_unconfirmed' });
        });
        const stored = await db.runTransaction(transaction => transaction.get(attemptRef));
        return publicAttempt(stored.data());
      }
    } catch (error) { return { ok: false, error: error.status ? error.code : 'procurement_unavailable' }; }
  };
}
module.exports = { createNativeProcurementOperations, RETRY_WINDOW, LEASE };
