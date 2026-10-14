const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const mail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
const internal = actor => actor.email.trim().toLowerCase().endsWith('@qualitastech.com');
const freeze = value => value instanceof Date ? value.toISOString() : value && typeof value.toDate === 'function' ? value.toDate().toISOString()
  : Array.isArray(value) ? value.map(freeze) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, freeze(value[key])])) : value;
const revision = snapshot => `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const exact = (data, keys) => { if (!plain(data) || Object.keys(data).some(key => !keys.includes(key))) throw fault('invalid_project_command'); };
const text = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && (!nonempty || value.trim());
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const projectMutationsEnabled = env => ['BOM_NATIVE_PROJECT_MUTATIONS_ENABLED', 'BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED'].every(key => env[key] === 'true');
const assertAccess = (project, actor) => {
  if (actor.customClaims.role !== 'admin' && project.memberIds != null && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid))) throw fault('project_forbidden', 403);
};

function createNativeProjectOperations({ db, auth, enabled = false, getServerTimestamp, getDeleteField, now = () => new Date() }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request), data = request.data;
      exact(data, ['operation', 'project_id', 'expected_actor_uid', 'expected_version', 'operation_id', 'command']);
      if (!['get', 'command'].includes(data.operation) || !validId(data.project_id)) throw fault('invalid_project_request');
      if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
      const projectRef = db.collection('projects').doc(data.project_id);
      const read = async transaction => {
        const snapshot = await transaction.get(projectRef);
        if (!snapshot.exists) throw fault('project_not_found', 404);
        const project = snapshot.data();
        if (project.projectId && project.projectId !== data.project_id) throw fault('project_identity_conflict', 409);
        // Preserve the existing project-rule migration fallback for absent memberIds.
        assertAccess(project, actor);
        return { snapshot, project };
      };
      const canEdit = actor.customClaims.role === 'admin' || internal(actor);
      if (data.operation === 'get') {
        exact(data, ['operation', 'project_id', 'expected_actor_uid']);
        return await db.runTransaction(async transaction => {
          const { snapshot, project } = await read(transaction);
          return { ok: true, project_id: data.project_id, project: { ...freeze(project), projectId: data.project_id }, version: revision(snapshot),
            permissions: { edit: writesOn() && canEdit, manage_members: writesOn() && actor.customClaims.role === 'admin', notifications: writesOn() && canEdit } };
        });
      }
      if (!writesOn()) throw fault('project_mutations_disabled', 503);
      if (!validVersion(data.expected_version) || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.operation_id || '') || !plain(data.command)
        || Buffer.byteLength(JSON.stringify(data)) > MAX_INPUT_BYTES) throw fault('invalid_project_command');
      const command = data.command;
      const shapes = { metadata: ['kind', 'patch'], archive: ['kind'], member_add: ['kind', 'user_id', 'category_scope'], member_remove: ['kind', 'user_id'], member_scope: ['kind', 'user_id', 'category_scope'],
        member_notifications: ['kind', 'user_id', 'enabled'], recipient_add: ['kind', 'email', 'name'], recipient_remove: ['kind', 'email'], recipient_notifications: ['kind', 'email', 'enabled'] };
      if (!shapes[command.kind]) throw fault('invalid_project_command');
      exact(command, shapes[command.kind]);
      const manage = ['member_add', 'member_remove', 'member_scope', 'recipient_add', 'recipient_remove'].includes(command.kind);
      if (manage && actor.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
      if (!manage && !canEdit) throw fault('project_edit_forbidden', 403);
      if (command.kind.startsWith('member_') && (!validId(command.user_id) || command.user_id.length > 128)) throw fault('invalid_project_command');
      if (command.kind.endsWith('_notifications') && typeof command.enabled !== 'boolean') throw fault('invalid_project_command');
      if (command.kind.startsWith('recipient_') && !mail(normalizeEmail(command.email))) throw fault('invalid_project_command');
      let target;
      if (command.kind === 'member_add') {
        try { target = await auth.getUser(command.user_id); } catch { throw fault('target_user_unavailable', 409); }
        if (target.uid !== command.user_id || target.disabled || !target.emailVerified || target.customClaims?.status !== 'approved'
          || !['admin', 'user', 'viewer'].includes(target.customClaims.role) || !mail(normalizeEmail(target.email))) throw fault('target_user_unavailable', 409);
        // Looking up the target is an external await: don't grant access using an
        // admin role that was revoked while that lookup was in flight.
        const current = await currentNativeActor(auth, request);
        if (current.uid !== actor.uid || normalizeEmail(current.email) !== normalizeEmail(actor.email)) throw fault('actor_session_changed', 403);
        if (current.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
      }
      const receiptRef = db.collection('pulseProjectOperations').doc(data.project_id).collection('receipts').doc(data.operation_id);
      const auditRef = db.collection('pulseProjectOperations').doc(data.project_id).collection('audit').doc(data.operation_id);
      const payloadHash = createHash('sha256').update(JSON.stringify(freeze({ command, expected_version: data.expected_version }))).digest('hex');
      return await db.runTransaction(async transaction => {
        const { snapshot, project } = await read(transaction), receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const current = await currentNativeActor(auth, request);
          assertAccess(project, current);
          if (manage && current.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
          if (!manage && current.customClaims.role !== 'admin' && !internal(current)) throw fault('project_edit_forbidden', 403);
          const old = receipt.data();
          if (old.actor_uid !== actor.uid || old.actor_email !== normalizeEmail(actor.email) || old.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          return old.result;
        }
        if (revision(snapshot) !== data.expected_version) throw fault('project_version_conflict', 409);
        let patch = {}, removeFields = [];
        if (command.kind === 'metadata') {
          const value = command.patch;
          exact(value, ['projectName', 'clientName', 'clientId', 'billingEntityId', 'description', 'status', 'deadline', 'pulseProjectId']);
          if (!Object.keys(value).length) throw fault('invalid_project_command');
          const lengths = { projectName: 500, clientName: 500, clientId: 512, billingEntityId: 512, description: 4000, deadline: 32 };
          for (const [key, field] of Object.entries(value)) {
            if (lengths[key] && !text(field, lengths[key], key === 'projectName')) throw fault('invalid_project_command');
            if (['clientId', 'billingEntityId'].includes(key) && !validId(field)) throw fault('invalid_project_command');
            if (key === 'deadline' && (!/^\d{4}-\d{2}-\d{2}$/.test(field) || !Number.isFinite(Date.parse(field)) || new Date(field).toISOString().slice(0, 10) !== field)) throw fault('invalid_project_command');
            if (key === 'status' && !['Planning', 'Ongoing', 'Delayed', 'Completed', 'Archived'].includes(field)) throw fault('invalid_project_command');
            if (key === 'pulseProjectId' && field !== null && (!Number.isSafeInteger(field) || field <= 0)) throw fault('invalid_project_command');
          }
          patch = { ...value };
          if (value.pulseProjectId === null) { delete patch.pulseProjectId; removeFields.push('pulseProjectId'); }
          const clientId = value.clientId ?? project.clientId;
          if (clientId && (Object.hasOwn(value, 'clientId') && value.clientId !== project.clientId || Object.hasOwn(value, 'clientName') && value.clientName !== project.clientName)) {
            const client = await transaction.get(db.collection('clients').doc(clientId));
            if (!client.exists) throw fault('client_unavailable', 409);
            if (client.data().company !== (value.clientName ?? project.clientName)) throw fault('client_identity_conflict', 409);
          }
          if (value.billingEntityId && value.billingEntityId !== project.billingEntityId && value.billingEntityId !== 'company') {
            const billing = await transaction.get(db.collection('billingEntities').doc(value.billingEntityId));
            if (!billing.exists || billing.data().isActive === false) throw fault('billing_entity_unavailable', 409);
          }
          if (project.status === 'Planning' && value.status === 'Ongoing') {
            const documents = await transaction.get(db.collection('projectDocuments').where('projectId', '==', data.project_id).where('type', '==', 'customer-po').limit(1));
            if (!documents.docs.length) throw fault('customer_po_required', 409);
            const bom = await transaction.get(projectRef.collection('bom').doc('data'));
            const categories = bom.exists ? bom.data().categories : [];
            if (!Array.isArray(categories) || categories.some(row => !plain(row) || !Array.isArray(row.items))) throw fault('invalid_material_snapshot', 409);
            patch.bomSnapshot = categories.flatMap(category => category.items);
            patch.bomSnapshotDate = now().toISOString();
          }
        } else if (command.kind === 'archive') {
          patch = { status: 'Archived', archivedAt: now().toISOString() };
        } else if (command.kind.startsWith('member_')) {
          const members = project.members ?? [], ids = project.memberIds ?? [];
          if (['member_add', 'member_remove'].includes(command.kind) && project.memberIds == null) throw fault('legacy_membership_migration_required', 409);
          if (!Array.isArray(members) || members.length > 200 || members.some(row => !plain(row) || !validId(row.userId)) || new Set(members.map(row => row.userId)).size !== members.length
            || !Array.isArray(ids) || ids.some(value => !validId(value)) || new Set(ids).size !== ids.length) throw fault('invalid_project_members', 409);
          const existing = members.find(row => row.userId === command.user_id);
          const accessIds = [...new Set([...ids, ...members.map(row => row.userId)])];
          if (command.kind === 'member_add') {
            if (existing || ids.includes(command.user_id)) throw fault('project_member_exists', 409);
            if (members.length >= 200) throw fault('project_member_limit', 409);
            // Recheck after the transaction's business reads. Auth and Firestore
            // cannot share a transaction; future access also verifies the profile.
            try { target = await auth.getUser(command.user_id); } catch { throw fault('target_user_unavailable', 409); }
            if (target.uid !== command.user_id || target.disabled || !target.emailVerified || target.customClaims?.status !== 'approved'
              || !['admin', 'user', 'viewer'].includes(target.customClaims.role) || !mail(normalizeEmail(target.email))) throw fault('target_user_unavailable', 409);
          } else if (!existing) throw fault('project_member_not_found', 409);
          let scope;
          if (command.kind === 'member_scope' || command.kind === 'member_add' && !internal(target)) {
            scope = command.category_scope ?? [];
            const bom = await transaction.get(projectRef.collection('bom').doc('data'));
            const names = (bom.data()?.categories || []).map(row => row.name);
            if (!Array.isArray(scope) || scope.length > 200 || scope.some(name => !text(name, 500, true) || !names.includes(name)) || new Set(scope).size !== scope.length) throw fault('invalid_category_scope', 409);
          }
          if (command.kind === 'member_add') {
            const member = { userId: target.uid, email: normalizeEmail(target.email), displayName: target.displayName || target.email, addedBy: actor.uid,
              addedAt: now().toISOString().slice(0, 10), notificationsEnabled: true, ...(scope ? { categoryScope: scope } : {}) };
            patch = { members: [...members, member], memberIds: [...accessIds, target.uid] };
          } else if (command.kind === 'member_remove') {
            if (members.length <= 1) throw fault('last_project_member', 409);
            patch = { members: members.filter(row => row.userId !== command.user_id), memberIds: accessIds.filter(id => id !== command.user_id) };
          } else patch.members = members.map(row => row.userId !== command.user_id ? row : { ...row, ...(command.kind === 'member_scope' ? { categoryScope: scope } : { notificationsEnabled: command.enabled }) });
        } else {
          const recipients = project.externalRecipients ?? [], email = normalizeEmail(command.email);
          if (!Array.isArray(recipients) || recipients.length > 200 || recipients.some(row => !plain(row) || !mail(normalizeEmail(row.email)))) throw fault('invalid_project_recipients', 409);
          const existing = recipients.find(row => normalizeEmail(row.email) === email);
          if (command.kind === 'recipient_add') {
            if (!text(command.name, 500, true)) throw fault('invalid_project_command');
            if (existing) throw fault('project_recipient_exists', 409);
            if (recipients.length >= 200) throw fault('project_recipient_limit', 409);
            patch.externalRecipients = [...recipients, { email, name: command.name.trim(), notificationsEnabled: true }];
          } else {
            if (!existing) throw fault('project_recipient_not_found', 409);
            patch.externalRecipients = command.kind === 'recipient_remove' ? recipients.filter(row => normalizeEmail(row.email) !== email)
              : recipients.map(row => normalizeEmail(row.email) !== email ? row : { ...row, notificationsEnabled: command.enabled });
          }
        }
        const after = { ...project, ...patch }; removeFields.forEach(key => { delete after[key]; });
        const fields = [...Object.keys(patch), ...removeFields];
        const changes = Object.fromEntries(fields.map(key => [key, { before: Object.hasOwn(project, key) ? { present: true, value: project[key] } : { present: false },
          after: Object.hasOwn(after, key) ? { present: true, value: after[key] } : { present: false } }]));
        const result = { ok: true, project_id: data.project_id, operation_id: data.operation_id };
        const audit = { actor_uid: actor.uid, actor_email: normalizeEmail(actor.email), project_id: data.project_id, operation_id: data.operation_id, operation: command.kind, changes, created_at: getServerTimestamp() };
        const recorded = { actor_uid: actor.uid, actor_email: normalizeEmail(actor.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };
        assertDocumentBudget([{ path: projectRef.path, data: after }, { path: auditRef.path, data: audit }, { path: receiptRef.path, data: recorded }]);
        const current = await currentNativeActor(auth, request);
        assertAccess(project, current);
        if (manage && current.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
        if (!manage && current.customClaims.role !== 'admin' && !internal(current)) throw fault('project_edit_forbidden', 403);
        transaction.update(projectRef, { ...patch, ...Object.fromEntries(removeFields.map(key => [key, getDeleteField()])) });
        transaction.create(auditRef, audit); transaction.create(receiptRef, recorded);
        return result;
      });
    } catch (error) { return { ok: false, error: error.status ? error.code : 'project_operations_unavailable' }; }
  };
}
module.exports = { createNativeProjectOperations, projectMutationsEnabled };
