const crypto = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const domain = require('./billingEntityDomain.generated.cjs');
const { createFreeze } = require('./nativePoSerialization.cjs');
const { assertDocumentBudget } = require('./materialCommands.cjs');
const fault = code => Object.assign(new Error(code), { billingCode: code });
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const freeze = createFreeze(code => fault(code));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(freeze(value))).digest('hex');
const version = snap => snap.exists ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : 'missing';
const fields = Object.keys(domain.emptyBillingEntity());
const identity = actor => JSON.stringify([actor.uid, actor.email, actor.customClaims.role]);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const project = (snap, id) => {
  const source = id === 'company' ? domain.companyAsBillingEntity(snap.exists ? snap.data() : domain.defaultCompanySettings()) : snap.data();
  return freeze({ ...Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]])), id });
};

// All metadata, audit and recovery writes share one transaction. This factory is
// callable and its original Settings client both remain independently default-off.
function createNativeBillingEntityOperations({ db, auth, enabled = false, bucketName, getServerTimestamp }) {
  const ref = id => db.collection(id === 'company' ? 'settings' : 'billingEntities').doc(id);
  const gate = control => {
    if (!['coexist', 'pulse_only', 'read_only'].includes(control.mode)) return 'billing_entity_read_only';
    if (control.mode === 'read_only') return 'billing_entity_read_only';
    if ((typeof enabled === 'function' ? enabled() : enabled) !== true) return 'billing_entity_mutations_disabled';
    if (['poClientWritesFenced', 'poCounterClientWritesFenced', 'billingEntityClientWritesFenced'].some(key => control[key] !== true)) return 'billing_entity_mutations_disabled';
    return null;
  };
  const permitted = (actor, id, operation) => actor.customClaims.role === 'admin' || (id === 'company' && operation === 'update');
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request), initialIdentity = identity(actor), data = request.data;
      if (!plain(data) || data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed');
      const { operation, entity_id: id, operation_id: nonce } = data;
      if (!['catalog', 'get', 'create', 'update', 'delete', 'set_default'].includes(operation)) throw fault('invalid_billing_entity_request');
      const reading = ['catalog', 'get'].includes(operation);
      const allowed = ['operation', 'expected_actor_uid', ...(operation === 'catalog' ? [] : ['entity_id']), ...(reading ? [] : ['operation_id', 'resolve_only']), ...(['create', 'update', 'delete'].includes(operation) ? ['expected_version'] : []), ...(operation === 'create' ? ['entity'] : operation === 'update' ? ['patch'] : operation === 'set_default' ? ['expected_catalog_version'] : [])];
      if (Object.keys(data).some(key => !allowed.includes(key)) || (operation !== 'catalog' && !validId(id)) || (!reading && (!validId(nonce) || (data.resolve_only !== undefined && typeof data.resolve_only !== 'boolean')))) throw fault('invalid_billing_entity_request');
      const payload = { ...data }; delete payload.resolve_only;
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 256 * 1024) throw fault('invalid_billing_entity_request');
      const hash = digest(payload);
      const recheck = async () => {
        if (identity(await currentNativeActor(auth, request)) !== initialIdentity) throw fault('actor_session_changed');
      };
      return await db.runTransaction(async tx => {
        const control = (await tx.get(db.collection('pulseRuntimeControl').doc('cutover'))).data() || {};
        const fresh = await currentNativeActor(auth, request);
        if (identity(fresh) !== initialIdentity) throw fault('actor_session_changed');
        const blocked = gate(control);
        if (!reading && !['coexist', 'pulse_only', 'read_only'].includes(control.mode)) throw fault('billing_entity_read_only');
        if (!reading && !permitted(fresh, id, operation)) throw fault('billing_entity_forbidden');
        let receiptRef;
        if (!reading) {
          receiptRef = db.collection('pulseBillingEntityOperations').doc(nonce);
          const receipt = await tx.get(receiptRef);
          if (receipt.exists) {
            await recheck();
            const saved = receipt.data();
            if (saved.actor_uid !== actor.uid || saved.hash !== hash) throw fault('billing_entity_operation_conflict');
            if (saved.cancelled) { if (data.resolve_only) return { ok: true, resolution: 'cancelled' }; throw fault('billing_entity_request_cancelled'); }
            return data.resolve_only ? { ...saved.result, resolution: 'committed' } : saved.result;
          }
          if (data.resolve_only) {
            if (!['coexist', 'pulse_only', 'read_only'].includes(control.mode)) throw fault('billing_entity_read_only');
            await recheck();
            tx.create(receiptRef, { actor_uid: actor.uid, hash, cancelled: true, createdAt: getServerTimestamp() });
            return { ok: true, resolution: 'cancelled' };
          }
          if (blocked) throw fault(blocked);
        }
        let snapshots, catalogVersion;
        if (['catalog', 'set_default'].includes(operation)) {
          const page = await tx.get(db.collection('billingEntities').limit(301));
          if (page.size > 300) throw fault('billing_entity_catalog_too_large');
          const primary = await tx.get(ref('company'));
          snapshots = [...page.docs.filter(row => row.id !== 'company'), primary];
          catalogVersion = digest(snapshots.map(row => [row.ref.path, version(row)]).sort((a, b) => a[0].localeCompare(b[0])));
          if (operation === 'catalog') {
            await recheck();
            return { ok: true, entities: domain.sortBillingEntities(snapshots.filter(row => row.id === 'company' || row.data().isActive !== false).map(row => project(row, row.id))), catalog_version: catalogVersion,
              permissions: { create: !blocked && fresh.customClaims.role === 'admin', set_default: !blocked && fresh.customClaims.role === 'admin' } };
          }
          if (data.expected_catalog_version !== catalogVersion) throw fault('billing_entity_catalog_conflict');
          if (!snapshots.some(row => row.id === id && (id === 'company' || row.data().isActive !== false))) throw fault('billing_entity_not_found');
        }
        const snap = snapshots?.find(row => row.id === id) || await tx.get(ref(id));
        if (operation === 'get') {
          if (!snap.exists && id !== 'company') throw fault('billing_entity_not_found');
          await recheck();
          return { ok: true, entity: project(snap, id), entity_version: version(snap), permissions: { edit: !blocked && permitted(fresh, id, 'update'), delete: !blocked && id !== 'company' && fresh.customClaims.role === 'admin' } };
        }
        if (operation === 'delete' && id === 'company') throw fault('primary_company_delete_forbidden');
        const archiveRef = db.collection('pulseDeletedBillingEntities').doc(id);
        const archive = ['create', 'delete'].includes(operation) ? await tx.get(archiveRef) : null;
        if (operation === 'create' && (id === 'company' || archive.exists)) throw fault('billing_entity_deleted');
        if (operation !== 'set_default' && data.expected_version !== version(snap)) throw fault('billing_entity_version_conflict');
        if (operation === 'create' ? snap.exists : !snap.exists && id !== 'company') throw fault('billing_entity_not_found');
        let patch;
        if (['create', 'update'].includes(operation)) {
          patch = operation === 'create' ? data.entity : data.patch;
          if (!plain(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !fields.includes(key))) throw fault('invalid_billing_entity_patch');
          for (const [key, value] of Object.entries(patch)) {
            const template = domain.emptyBillingEntity()[key];
            if (typeof value !== typeof template || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) || (typeof value === 'string' && value.length > 20000)) throw fault('invalid_billing_entity_patch');
          }
          const previous = snap.exists ? project(snap, id) : {}, merged = { ...domain.emptyBillingEntity(), ...previous, ...patch };
          if (!merged.legalName.trim() || !merged.companyAddress.trim() || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(merged.gstin)) throw fault('invalid_billing_entity_patch');
          if ((merged.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(merged.pan.trim().toUpperCase())) || (merged.cin && !/^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(merged.cin.trim().toUpperCase())) || !['simple', 'financial-year'].includes(merged.poNumberFormat)) throw fault('invalid_billing_entity_patch');
          if (['logo', 'logoPath'].some(key => Object.hasOwn(patch, key) && patch[key] !== previous[key]) && (merged.logo || merged.logoPath)) {
            let url; try { url = new URL(merged.logo); } catch { throw fault('invalid_billing_entity_logo'); }
            if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.pathname !== `/v0/b/${bucketName}/o/${encodeURIComponent(merged.logoPath)}` || !merged.logoPath.startsWith('company-logos/')) throw fault('invalid_billing_entity_logo');
          }
          if (id === 'company') {
            const before = domain.billingEntityPatchToCompanySettings({ ...domain.emptyBillingEntity(), ...previous });
            const after = domain.billingEntityPatchToCompanySettings(merged);
            patch = Object.fromEntries(Object.entries(after).filter(([key, value]) => value !== undefined && (value !== before[key] || !snap.exists)));
          }
          else if (operation === 'create') patch = merged;
        }
        const stamp = getServerTimestamp(), result = { ok: true, operation_id: nonce, entity_id: id, kind: operation };
        const writes = [];
        const queue = (kind, target, value) => writes.push({ kind, target, value });
        if (operation === 'set_default') for (const row of snapshots) {
          const value = { isDefault: row.id === id, updatedAt: stamp };
          queue(row.exists ? 'update' : 'create', row.ref, row.exists ? value : { ...domain.defaultCompanySettings(), ...value });
        }
        else if (operation === 'delete') { queue('create', archiveRef, { entity: snap.data(), deletedAt: stamp, actor_uid: actor.uid, operation_id: nonce }); queue('delete', ref(id)); }
        else queue(snap.exists ? 'update' : 'create', ref(id), { ...(!snap.exists && id === 'company' ? domain.defaultCompanySettings() : {}), ...patch, updatedAt: stamp });
        const changes = Object.fromEntries(Object.entries(patch || {}).filter(([key, value]) => value !== snap.data()?.[key]).map(([key, value]) => [key, { before: snap.data()?.[key] ?? null, after: value }]));
        queue('create', db.collection('pulseBillingEntityAudit').doc(nonce), { actor_uid: actor.uid, entity_id: id, kind: operation, at: stamp, before_version: version(snap), changes,
          ...(operation === 'set_default' ? { default_changes: snapshots.map(row => ({ entity_id: row.id, before: row.data()?.isDefault ?? false, after: row.id === id, before_version: version(row) })) } : {}) });
        queue('create', receiptRef, { actor_uid: actor.uid, hash, result, createdAt: stamp });
        const originals = new Map((snapshots || [snap]).map(row => [row.ref.path, row.data()]));
        assertDocumentBudget(writes.filter(row => row.value).map(row => ({ path: row.target.path, data: row.kind === 'update' ? { ...originals.get(row.target.path), ...row.value } : row.value })));
        await recheck();
        for (const row of writes) row.kind === 'delete' ? tx.delete(row.target) : tx[row.kind](row.target, row.value);
        return result;
      });
    } catch (error) { return { ok: false, error: error.billingCode || (error.status ? error.code : 'billing_entity_operations_unavailable') }; }
  };
}
module.exports = { createNativeBillingEntityOperations };
