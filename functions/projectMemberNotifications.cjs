const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget } = require('./materialCommands.cjs');

const PUBLIC = Symbol('project-member-notification');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status, [PUBLIC]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validProjectId = value => typeof value === 'string' && !!value.trim() && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const validUid = value => typeof value === 'string' && !!value.trim() && value.length <= 128
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const validVersion = value => typeof value === 'string'
  && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1_000_000_000;
const revision = snapshot => {
  const updateTime = snapshot.updateTime;
  if (!Number.isSafeInteger(updateTime?.seconds) || !Number.isInteger(updateTime?.nanoseconds)
    || updateTime.nanoseconds < 0 || updateTime.nanoseconds >= 1_000_000_000) throw fault('project_revision_unavailable', 503);
  return `${updateTime.seconds}:${updateTime.nanoseconds}`;
};
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const emailOf = actor => typeof actor?.email === 'string' ? actor.email.trim().toLowerCase() : '';
const sameActor = (left, right) => left.uid === right.uid && emailOf(left) === emailOf(right);
const assertProjectAccess = (project, actor) => {
  if (actor.customClaims.role === 'admin') return;
  if (!Object.hasOwn(project, 'memberIds') || (project.memberIds !== null
    && (!Array.isArray(project.memberIds) || project.memberIds.some(uid => !validUid(uid))
      || new Set(project.memberIds).size !== project.memberIds.length || !project.memberIds.includes(actor.uid)))) throw fault('member_notification_forbidden', 403);
};
const memberRows = project => {
  const rows = project.members ?? [];
  if (!Array.isArray(rows) || rows.length > 200 || rows.some(row => !plain(row) || !validUid(row.userId))
    || new Set(rows.map(row => row.userId)).size !== rows.length) throw fault('invalid_project_members', 409);
  return rows;
};
const assertPreferenceAccess = (project, actor, memberUid) => {
  if (actor.customClaims.role !== 'admin'
    && (!memberRows(project).some(row => row.userId === actor.uid) || memberUid !== actor.uid)) throw fault('member_notification_forbidden', 403);
};
const preference = member => ({ member_uid: member.userId, notifications_enabled: member.notificationsEnabled !== false });

function createProjectMemberNotifications({ db, auth, getServerTimestamp }) {
  async function actorOf(request) {
    try { return await currentNativeActor(auth, request); }
    catch (error) {
      const codes = { actor_authentication_required: 401, actor_forbidden: 403, identity_provider_unavailable: 503 };
      if (Object.hasOwn(codes, error?.code) && codes[error.code] === error.status) throw fault(error.code, error.status);
      throw error;
    }
  }
  const assertCurrentActor = async (request, original, project) => {
    const current = await actorOf(request);
    if (!sameActor(original, current)) throw fault('actor_session_changed', 403);
    assertProjectAccess(project, current);
    return current;
  };
  const fail = error => ({ ok: false, error: error?.[PUBLIC] ? error.code : 'member_notification_unavailable', status: error?.[PUBLIC] ? error.status : 503 });

  return async request => {
    try {
      const actor = await actorOf(request), data = request.data;
      if (!plain(data) || !['get', 'set'].includes(data.operation)) throw fault('invalid_member_notification_request');
      const allowed = data.operation === 'get'
        ? ['operation', 'project_id', 'expected_actor_uid']
        : ['operation', 'project_id', 'member_uid', 'notifications_enabled', 'expected_actor_uid', 'expected_version', 'operation_id', 'resolve_only'];
      if (Object.keys(data).some(key => !allowed.includes(key)) || !validProjectId(data.project_id)
        || !validUid(data.expected_actor_uid) || data.expected_actor_uid !== actor.uid) throw fault('invalid_member_notification_request');
      if (data.operation === 'get') {
        if (Object.keys(data).length !== 3) throw fault('invalid_member_notification_request');
      } else if (!validUid(data.member_uid) || typeof data.notifications_enabled !== 'boolean'
        || !validVersion(data.expected_version) || !/^[\w-]{1,128}$/.test(data.operation_id || '')
        || (Object.hasOwn(data, 'resolve_only') && data.resolve_only !== true)) throw fault('invalid_member_notification_request');

      const projectRef = db.collection('projects').doc(data.project_id);
      return await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(projectRef);
        if (!snapshot.exists) throw fault('member_notification_project_not_found', 404);
        const project = snapshot.data();
        if (!plain(project)) throw fault('member_notification_project_unavailable', 503);
        if (project.projectId && project.projectId !== data.project_id) throw fault('member_notification_project_identity_conflict', 409);
        if (data.operation === 'get') {
          const current = await assertCurrentActor(request, actor, project);
          const rows = memberRows(project);
          assertPreferenceAccess(project, current, current.uid);
          const ownRow = rows.find(row => row.userId === current.uid);
          if (current.customClaims.role !== 'admin' && !ownRow) throw fault('member_notification_forbidden', 403);
          const preferences = current.customClaims.role === 'admin' ? rows.map(preference) : [preference(ownRow)];
          return { ok: true, project_id: data.project_id, version: revision(snapshot), preferences };
        }

        const input = {
          operation: 'set', project_id: data.project_id, member_uid: data.member_uid,
          notifications_enabled: data.notifications_enabled, expected_actor_uid: data.expected_actor_uid,
          expected_version: data.expected_version, operation_id: data.operation_id,
        };
        const payloadHash = hash(input);
        const root = db.collection('pulseProjectMemberNotificationOperations').doc(data.project_id);
        const receiptRef = root.collection('events').doc(data.operation_id);
        const auditRef = root.collection('audit').doc(data.operation_id);
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const current = await assertCurrentActor(request, actor, project);
          const rows = memberRows(project);
          assertPreferenceAccess(project, current, data.member_uid);
          const targetIndex = rows.findIndex(row => row.userId === data.member_uid);
          if (targetIndex < 0) throw fault('member_notification_target_not_found', 404);
          const previous = receipt.data();
          if (previous.actor_uid !== current.uid || previous.actor_email !== emailOf(current) || previous.payload_hash !== payloadHash) throw fault('member_notification_operation_conflict', 409);
          if (data.resolve_only === true) return { ...previous.result, resolution: previous.cancelled ? 'cancelled' : 'committed' };
          if (previous.cancelled) throw fault('member_notification_request_cancelled', 409);
          return previous.result;
        }

        const current = await assertCurrentActor(request, actor, project);
        const rows = memberRows(project);
        assertPreferenceAccess(project, current, data.member_uid);
        const targetIndex = rows.findIndex(row => row.userId === data.member_uid);
        if (targetIndex < 0) throw fault('member_notification_target_not_found', 404);

        const result = { ok: true, project_id: data.project_id, member_uid: data.member_uid,
          notifications_enabled: data.notifications_enabled, operation_id: data.operation_id, changed: false };
        if (data.resolve_only === true) {
          result.resolution = 'cancelled';
          const record = { actor_uid: current.uid, actor_email: emailOf(current), payload_hash: payloadHash, result, cancelled: true, created_at: getServerTimestamp() };
          const audit = { actor_uid: current.uid, actor_email: emailOf(current), project_id: data.project_id, operation_id: data.operation_id,
            operation: 'member_notifications_cancelled', payload_hash: payloadHash, created_at: getServerTimestamp() };
          assertDocumentBudget([{ path: receiptRef.path, data: record }, { path: auditRef.path, data: audit }]);
          const finalActor = await assertCurrentActor(request, actor, project);
          assertPreferenceAccess(project, finalActor, data.member_uid);
          transaction.create(receiptRef, record);
          transaction.create(auditRef, audit);
          return result;
        }

        const controlRef = db.collection('pulseRuntimeControl').doc('cutover');
        const control = await transaction.get(controlRef);
        const mode = control.exists ? control.data()?.mode ?? 'coexist' : 'coexist';
        if (!['coexist', 'pulse_only'].includes(mode)) throw fault('member_notifications_read_only', 503);
        const version = revision(snapshot);
        if (version !== data.expected_version) throw fault('project_version_conflict', 409);

        const target = rows[targetIndex], before = target.notificationsEnabled !== false;
        result.changed = before !== data.notifications_enabled;
        result.resolution = 'committed';
        const record = { actor_uid: current.uid, actor_email: emailOf(current), payload_hash: payloadHash, result, cancelled: false, created_at: getServerTimestamp() };
        const audit = { actor_uid: current.uid, actor_email: emailOf(current), project_id: data.project_id, operation_id: data.operation_id,
          operation: 'member_notifications_updated', target_uid: target.userId, target_email: target.email || null,
          before, after: data.notifications_enabled, changed: result.changed, payload_hash: payloadHash, created_at: getServerTimestamp() };
        const documents = [{ path: receiptRef.path, data: record }, { path: auditRef.path, data: audit }];
        let updatedMembers;
        if (result.changed) {
          updatedMembers = rows.map((row, index) => index === targetIndex ? { ...row, notificationsEnabled: data.notifications_enabled } : row);
          documents.push({ path: projectRef.path, data: { ...project, members: updatedMembers } });
        }
        assertDocumentBudget(documents);
        const finalActor = await assertCurrentActor(request, actor, project);
        assertPreferenceAccess(project, finalActor, data.member_uid);
        if (result.changed) transaction.update(projectRef, { members: updatedMembers });
        transaction.create(receiptRef, record);
        transaction.create(auditRef, audit);
        return result;
      });
    } catch (error) { return fail(error); }
  };
}

module.exports = { createProjectMemberNotifications };
