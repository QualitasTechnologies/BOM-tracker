'use strict';

const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { projectReadView, isProjectReadStateError } = require('./projectReadView.cjs');
const { readProjectDocumentView } = require('./projectDocumentRead.cjs');
const { plain, validId, version, isFault: isDocumentFault } = require('./projectDocumentState.cjs');
const PUBLIC = Symbol('project-read-fault');
const fault = (code, status = 400) => Object.assign(Error(code), { code, status, [PUBLIC]: true });
const projectReadsEnabled = env => env.BOM_SCOPED_READS_ENABLED === 'true';
const fullAccess = actor => actor.customClaims.role === 'admin' || /@qualitastech\.com$/i.test(actor.email.trim());
const actorIdentity = actor => JSON.stringify([actor.uid, actor.email.trim().toLowerCase(), actor.customClaims.role]);
const AAD = Buffer.from('BOM-project-read:v1');
const CURSOR_TTL = 300000;

function requestData(data) {
  if (!plain(data)) throw fault('invalid_project_read_request');
  const fields = {
    get: ['operation', 'project_id'],
    list: ['operation', 'limit', 'cursor'],
    documents: ['operation', 'project_id', 'limit', 'cursor'],
    gallery_invoice: ['operation', 'project_id', 'item_id'],
  };
  if (!Object.hasOwn(fields, data.operation) || Object.keys(data).some(key => !fields[data.operation].includes(key))
    || data.operation !== 'list' && !validId(data.project_id)
    || data.operation === 'gallery_invoice' && !validId(data.item_id)
    || Object.hasOwn(data, 'limit') && (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100)
    || Object.hasOwn(data, 'cursor') && data.cursor !== null && (typeof data.cursor !== 'string' || !data.cursor || data.cursor.length > 4096)) {
    throw fault('invalid_project_read_request');
  }
  return data;
}

function authorize(raw, actor, id) {
  if (!plain(raw)) throw fault('invalid_project_read_state', 409);
  if (Object.hasOwn(raw, 'projectId') && raw.projectId !== id) throw fault('project_identity_conflict', 409);
  if (actor.customClaims.role !== 'admin' && (!Object.hasOwn(raw, 'memberIds')
    || raw.memberIds !== null && (!Array.isArray(raw.memberIds) || !raw.memberIds.includes(actor.uid)))) throw fault('project_forbidden', 403);
}

function visibleItems(raw, project, actor) {
  if (raw !== undefined && !plain(raw)) throw fault('invalid_project_read_state', 409);
  const categories = raw && Object.hasOwn(raw, 'categories') ? raw.categories : [];
  if (!Array.isArray(categories)) throw fault('invalid_project_read_state', 409);
  const scope = (Array.isArray(project.members) ? project.members : []).find(row => row?.userId === actor.uid)?.categoryScope;
  const all = new Map(), visible = new Map();
  for (const category of categories) {
    if (!plain(category) || typeof category.name !== 'string' || !Array.isArray(category.items)) throw fault('invalid_project_read_state', 409);
    for (const item of category.items) {
      if (!plain(item) || !validId(item.id) || all.has(item.id)) throw fault('invalid_project_read_state', 409);
      all.set(item.id, item);
      if (fullAccess(actor) || Array.isArray(scope) && scope.includes(category.name)) visible.set(item.id, item);
    }
  }
  return visible;
}

function cursorKey(value) {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)) value = Buffer.from(value, 'base64url');
  if (!Buffer.isBuffer(value) || value.length !== 32) throw fault('project_reads_unavailable', 503);
  return value;
}

function cursorCodec(key, actor, data, now) {
  const binding = [1, actorIdentity(actor), data.operation, data.project_id ?? null];
  return {
    encode(lastId) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(AAD);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify([...binding, lastId, now() + CURSOR_TTL])), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    },
    decode(token) {
      if (!token) return null;
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(token)) throw Error();
        const bytes = Buffer.from(token, 'base64url');
        if (bytes.length < 29 || bytes.toString('base64url') !== token) throw Error();
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(AAD); decipher.setAuthTag(bytes.subarray(12, 28));
        const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        if (!Array.isArray(payload) || payload.length !== 6 || binding.some((value, index) => payload[index] !== value)
          || !validId(payload[4]) || !Number.isSafeInteger(payload[5]) || payload[5] <= now() || payload[5] > now() + CURSOR_TTL) throw Error();
        return payload[4];
      } catch { throw fault('invalid_project_read_cursor'); }
    },
  };
}

function createNativeProjectReads({ db, auth, bucket, enabled = false, getCursorKey = () => undefined, now = () => Date.now() }) {
  return async request => {
    try {
      // Authentication faults are mapped separately; database errors cannot select public codes.
      const verifyActor = async () => {
        try { return await currentNativeActor(auth, request); }
        catch (error) {
          if (['actor_authentication_required', 'actor_forbidden', 'identity_provider_unavailable'].includes(error.code)) throw fault(error.code, error.status);
          throw fault('project_reads_unavailable', 503);
        }
      };
      const actor = await verifyActor(), data = requestData(request.data);
      if ((typeof enabled === 'function' ? enabled() : enabled) !== true) throw fault('project_reads_disabled', 503);
      const codec = cursorCodec(cursorKey(getCursorKey()), actor, data, now), start = codec.decode(data.cursor);
      const finish = async () => {
        if (actorIdentity(await verifyActor()) !== actorIdentity(actor)) throw fault('actor_session_changed', 403);
        if ((typeof enabled === 'function' ? enabled() : enabled) !== true) throw fault('project_reads_disabled', 503);
      };
      const limit = data.limit ?? 50;
      return await db.runTransaction(async transaction => {
        if (data.operation === 'list') {
          let query = db.collection('projects');
          if (actor.customClaims.role !== 'admin') query = query.where('memberIds', 'array-contains', actor.uid);
          query = query.orderBy('__name__');
          if (start) query = query.startAfter(start);
          const rows = await transaction.get(query.limit(limit + 1)), page = rows.docs.slice(0, limit), projects = [];
          for (const row of page) {
            const raw = row.data(); authorize(raw, actor, row.id);
            projects.push({ project_id: row.id, version: version(row), project: projectReadView(row.id, raw, actor) });
          }
          await finish();
          return { ok: true, actor_uid: actor.uid, projects, next_cursor: rows.docs.length > limit ? codec.encode(page.at(-1).id) : null };
        }
        const projectRef = db.collection('projects').doc(data.project_id), project = await transaction.get(projectRef);
        if (!project.exists) throw fault('project_not_found', 404);
        const raw = project.data(); authorize(raw, actor, data.project_id);
        const opening = { project_id: data.project_id, actor_uid: actor.uid, project_version: version(project) };
        if (data.operation === 'get') {
          const projected = projectReadView(data.project_id, raw, actor); await finish();
          return { ok: true, project_id: data.project_id, actor_uid: actor.uid, version: version(project), project: projected };
        }
        const bom = await transaction.get(projectRef.collection('bom').doc('data'));
        const visible = visibleItems(bom.exists ? bom.data() : undefined, raw, actor);
        const hydrate = async row => {
          const projected = await readProjectDocumentView({ transaction, db, bucket, projectId: data.project_id, id: row.id, raw: row.data() });
          if (!fullAccess(actor)) projected.linkedBOMItems = (projected.linkedBOMItems ?? []).filter(id => visible.has(id));
          return { ...projected, nativeOpening: { ...opening, bom_version: version(bom), document_version: version(row) } };
        };
        if (data.operation === 'gallery_invoice') {
          const item = visible.get(data.item_id);
          if (!item) throw fault('material_forbidden', 403);
          if (item.itemType === 'service' || item.status !== 'received' || !item.receivedPhotoUrl || !validId(item.linkedInvoiceDocumentId)) throw fault('project_read_invoice_unavailable', 404);
          const invoice = await transaction.get(db.collection('projectDocuments').doc(item.linkedInvoiceDocumentId));
          if (!invoice.exists || invoice.data().projectId !== data.project_id || invoice.data().type !== 'vendor-invoice') throw fault('project_read_invoice_unavailable', 404);
          const document = await hydrate(invoice); await finish();
          return { ok: true, ...opening, bom_version: version(bom), document };
        }
        let query = db.collection('projectDocuments').where('projectId', '==', data.project_id).orderBy('__name__');
        if (start) query = query.startAfter(start);
        const rows = await transaction.get(query.limit(limit + 1)), page = rows.docs.slice(0, limit), documents = [];
        for (const row of page) {
          const document = row.data();
          if (document.type === 'customer-po' && actor.customClaims.role !== 'admin') continue;
          if (document.linkedBOMItems !== undefined && (!Array.isArray(document.linkedBOMItems) || !document.linkedBOMItems.every(validId))) throw fault('invalid_project_read_state', 409);
          const links = document.linkedBOMItems ?? [];
          if (!fullAccess(actor) && !links.some(id => visible.has(id))) continue;
          const projected = await hydrate(row);
          documents.push(projected);
        }
        await finish();
        return { ok: true, ...opening, bom_version: version(bom), documents, next_cursor: rows.docs.length > limit ? codec.encode(page.at(-1).id) : null };
      });
    } catch (error) {
      if (error?.[PUBLIC] || isProjectReadStateError(error) || isDocumentFault(error)) return { ok: false, error: error.code, status: error.status };
      return { ok: false, error: 'project_reads_unavailable', status: 503 };
    }
  };
}

module.exports = { createNativeProjectReads, projectReadsEnabled };
