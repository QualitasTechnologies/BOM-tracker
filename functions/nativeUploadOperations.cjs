const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_MS = 15 * 60 * 1000;

// Same membership/category semantics as material fulfillment, including approved viewers.
function assertPhotoAccess(project, bom, actor, data) {
  if (project.projectId && project.projectId !== data.project_id) throw fault('project_identity_conflict', 409);
  if (actor.customClaims.role !== 'admin' && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid))) throw fault('project_forbidden', 403);
  const matches = (Array.isArray(bom?.categories) ? bom.categories : []).flatMap(category => (Array.isArray(category.items) ? category.items : []).filter(item => item?.id === data.item_id).map(item => ({ item, category })));
  if (matches.length !== 1) throw fault(matches.length ? 'duplicate_material_id' : 'material_not_found', matches.length ? 409 : 404);
  if (actor.customClaims.role !== 'admin' && !actor.email.trim().toLowerCase().endsWith('@qualitastech.com')) {
    const member = (Array.isArray(project.members) ? project.members : []).find(row => row.userId === actor.uid);
    if (!Array.isArray(member?.categoryScope) || !member.categoryScope.includes(matches[0].category.name)) throw fault('material_forbidden', 403);
  }
  return { category: matches[0].category.name, memberIndex: (Array.isArray(project.members) ? project.members : []).findIndex(row => row.userId === actor.uid) };
}
function assertControl(snapshot, replay = false) {
  if (!snapshot.exists) return;
  const mode = snapshot.data()?.mode;
  if (mode === 'read_only' && replay) return;
  if (mode === 'read_only') throw fault('native_uploads_read_only', 503);
  if (!['coexist', 'pulse_only'].includes(mode)) throw fault('native_upload_control_unavailable', 503);
}

function createNativeUploadOperations({ db, auth, bucket, enabled = false, getServerTimestamp, now = () => new Date() }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request), data = request.data;
      const keys = ['operation', 'project_id', 'item_id', 'operation_id', 'expected_actor_uid'];
      if (!plain(data) || !['reserve', 'finalize'].includes(data.operation)
        || Object.keys(data).some(key => ![...keys, ...(data.operation === 'reserve' ? ['content_type', 'byte_size', 'sha256'] : [])].includes(key))
        || !validId(data.project_id) || !validId(data.item_id) || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.operation_id || '')) throw fault('invalid_upload_request');
      if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
      if (!writesOn()) throw fault('native_uploads_disabled', 503);
      if (data.operation === 'reserve' && (data.content_type !== 'image/jpeg' || !Number.isSafeInteger(data.byte_size) || data.byte_size <= 0 || data.byte_size >= MAX_PHOTO_BYTES || !/^[a-f0-9]{64}$/.test(data.sha256 || ''))) throw fault('invalid_upload_request');
      const projectRef = db.collection('projects').doc(data.project_id), bomRef = projectRef.collection('bom').doc('data');
      const controlRef = db.collection('pulseRuntimeControl').doc('cutover');
      const op = db.collection('pulseNativeUploadOperations').doc(data.project_id);
      const receiptRef = op.collection('receipts').doc(data.operation_id);
      const reserveAuditRef = op.collection('audit').doc(`${data.operation_id}_reserve`);
      const finalAuditRef = op.collection('audit').doc(`${data.operation_id}_finalize`);
      const readAccess = async transaction => {
        const project = await transaction.get(projectRef), bom = await transaction.get(bomRef);
        const current = await currentNativeActor(auth, request);
        if (current.uid !== actor.uid || current.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) throw fault('actor_session_changed', 403);
        if (!project.exists) throw fault('project_not_found', 404);
        return assertPhotoAccess(project.data(), bom.data(), current, data);
      };
      const assertReceipt = old => {
        if (old.actor_uid !== actor.uid || old.actor_email !== actor.email.trim().toLowerCase() || old.item_id !== data.item_id) throw fault('operation_conflict', 409);
      };
      const payloadHash = data.operation === 'reserve' ? hash(JSON.stringify([data.project_id, data.item_id, data.content_type, data.byte_size, data.sha256])) : null;
      const opening = await db.runTransaction(async transaction => {
        const access = await readAccess(transaction), receipt = await transaction.get(receiptRef), control = await transaction.get(controlRef);
        if (receipt.exists) {
          const old = receipt.data(); assertReceipt(old);
          if (payloadHash && old.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          if (old.finalized) { assertControl(control, true); await readAccess(transaction); return data.operation === 'finalize' ? { result: old.finalized } : { result: old.reserved }; }
          assertControl(control);
          if (now().getTime() >= old.expires_at_ms) throw fault('upload_intent_expired', 409);
          await readAccess(transaction);
          return data.operation === 'reserve' ? { result: old.reserved } : { receipt: old };
        }
        assertControl(control);
        if (data.operation !== 'reserve') throw fault('upload_intent_not_found', 404);
        const fileName = `${randomBytes(32).toString('hex')}.jpg`, path = `projects/${data.project_id}/received-photos/native/${fileName}`;
        const expiresAtMs = now().getTime() + UPLOAD_TTL_MS;
        const reserved = { ok: true, path, operation_id: data.operation_id, expires_at: new Date(expiresAtMs).toISOString() };
        const intent = { actor_uid: actor.uid, actor_email: actor.email.trim().toLowerCase(), project_id: data.project_id, item_id: data.item_id, category: access.category, member_index: access.memberIndex,
          operation_id: data.operation_id, path, content_type: data.content_type, byte_size: data.byte_size, sha256: data.sha256,
          expires_at: new Date(expiresAtMs), expires_at_ms: expiresAtMs, state: 'reserved' };
        // Recheck account approval after the last Firestore await before staging a grant.
        const latestAccess = await readAccess(transaction);
        intent.category = latestAccess.category; intent.member_index = latestAccess.memberIndex;
        const record = { ...intent, payload_hash: payloadHash, file_name: fileName, download_token: randomUUID(), reserved };
        transaction.create(db.collection('pulseNativeUploadIntents').doc(fileName), intent);
        transaction.create(receiptRef, record);
        transaction.create(reserveAuditRef, { ...intent, event: 'receipt_photo_reserved', at: getServerTimestamp() });
        return { result: reserved };
      });
      if (opening.result) return opening.result;
      const old = opening.receipt;
      let metadata;
      try { [metadata] = await bucket.file(old.path).getMetadata(); }
      catch (error) { if (Number(error.code) === 404) throw fault('upload_not_found', 404); throw error; }
      const generation = String(metadata.generation || '');
      if (!/^[1-9]\d*$/.test(generation) || Number(metadata.size) !== old.byte_size || metadata.contentType !== 'image/jpeg') throw fault('upload_integrity_failed', 409);
      // Pin the download and metadata write to the generation that was inspected.
      const file = bucket.file(old.path, { generation });
      const stream = file.createReadStream({ validation: 'crc32c' });
      const chunks = []; let receivedBytes = 0;
      for await (const chunk of stream) {
        receivedBytes += chunk.length;
        if (receivedBytes > old.byte_size || receivedBytes >= MAX_PHOTO_BYTES) {
          stream.destroy(); throw fault('upload_integrity_failed', 409);
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, receivedBytes);
      if (bytes.length !== old.byte_size || hash(bytes) !== old.sha256 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw fault('upload_integrity_failed', 409);
      // Storage and Firestore are not atomic. Check access before creating the URL,
      // then again before committing the immutable final receipt. Failures can leave an orphan.
      await db.runTransaction(async transaction => { await readAccess(transaction); assertControl(await transaction.get(controlRef)); });
      await file.setMetadata({ metadata: { ...(metadata.metadata || {}), firebaseStorageDownloadTokens: old.download_token } }, { ifGenerationMatch: generation });
      const result = { ok: true, photo_url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(old.path)}?alt=media&token=${encodeURIComponent(old.download_token)}&generation=${generation}`, path: old.path, generation };
      return await db.runTransaction(async transaction => {
        await readAccess(transaction);
        const receipt = await transaction.get(receiptRef), control = await transaction.get(controlRef);
        if (!receipt.exists) throw fault('upload_intent_not_found', 404);
        const current = receipt.data(); assertReceipt(current);
        if (current.finalized) {
          assertControl(control, true);
          if (current.finalized.generation !== generation) throw fault('upload_generation_conflict', 409);
          await readAccess(transaction);
          return current.finalized;
        }
        assertControl(control);
        if (now().getTime() >= current.expires_at_ms) throw fault('upload_intent_expired', 409);
        if (current.payload_hash !== old.payload_hash || current.path !== old.path) throw fault('operation_conflict', 409);
        await readAccess(transaction);
        transaction.update(receiptRef, { finalized: result });
        transaction.update(db.collection('pulseNativeUploadIntents').doc(old.file_name), { state: 'finalized', generation });
        transaction.create(finalAuditRef, { event: 'receipt_photo_finalized', actor_uid: actor.uid, actor_email: current.actor_email, project_id: data.project_id, item_id: data.item_id, operation_id: data.operation_id, path: old.path, sha256: old.sha256, byte_size: old.byte_size, generation, at: getServerTimestamp() });
        return result;
      });
    } catch (error) { return { ok: false, error: error.status ? error.code : 'native_uploads_unavailable' }; }
  };
}
module.exports = { createNativeUploadOperations, MAX_PHOTO_BYTES, UPLOAD_TTL_MS };
