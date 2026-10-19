const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');

const PUBLIC = Symbol('project-member-notification');
const fault = (code, status = 400) => Object.assign(Error(code), { code, status, [PUBLIC]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeId = value => typeof value === 'string' && !!value.trim() && value.length <= 128
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function createProjectMemberNotifications({ db, auth, getServerTimestamp }) {
  async function actorOf(request) {
    try { return await currentNativeActor(auth, request); }
    catch (error) {
      const codes = { actor_authentication_required: 401, actor_forbidden: 403, identity_provider_unavailable: 503 };
      if (Object.hasOwn(codes, error?.code) && codes[error.code] === error.status) throw fault(error.code, error.status);
      throw error;
    }
  }

  return async request => {
    try {
      const actor = await actorOf(request), data = request.data;
      if (!plain(data) || Object.keys(data).some(key => ![
        'project_id', 'member_uid', 'notifications_enabled', 'expected_actor_uid', 'operation_id',
      ].includes(key)) || !safeId(data.project_id) || !safeId(data.member_uid)
        || !safeId(data.operation_id) || typeof data.notifications_enabled !== 'boolean'
        || data.expected_actor_uid !== actor.uid) throw fault('invalid_member_notification_request');

      const input = {
        project_id: data.project_id,
        member_uid: data.member_uid,
        notifications_enabled: data.notifications_enabled,
        expected_actor_uid: actor.uid,
        operation_id: data.operation_id,
      };
      const payloadHash = hash(input);
      const projectRef = db.collection('projects').doc(data.project_id);
      const eventRef = db.collection('pulseProjectMemberNotificationOperations')
        .doc(data.project_id).collection('events').doc(data.operation_id);

      return await db.runTransaction(async tx => {
        const projectSnapshot = await tx.get(projectRef);
        if (!projectSnapshot.exists) throw fault('member_notification_project_not_found', 404);
        const project = projectSnapshot.data();
        if (project.projectId && project.projectId !== data.project_id) throw fault('member_notification_project_identity_conflict', 409);
        const members = Array.isArray(project.members) ? project.members : [];
        const actorIsAdmin = actor.customClaims.role === 'admin';
        const actorMember = members.find(member => member?.userId === actor.uid);
        if (!actorIsAdmin && (!actorMember
          || Array.isArray(project.memberIds) && !project.memberIds.includes(actor.uid)
          || data.member_uid !== actor.uid)) throw fault('member_notification_forbidden', 403);
        const targetIndex = members.findIndex(member => member?.userId === data.member_uid);
        if (targetIndex < 0) throw fault('member_notification_target_not_found', 404);

        const currentActor = await actorOf(request);
        if (currentActor.uid !== actor.uid || currentActor.email !== actor.email) throw fault('actor_session_changed', 403);
        const receipt = await tx.get(eventRef);
        if (receipt.exists) {
          const previous = receipt.data();
          if (previous.actor_uid !== actor.uid || previous.payload_hash !== payloadHash) {
            throw fault('member_notification_operation_conflict', 409);
          }
          return previous.result;
        }

        const before = members[targetIndex].notificationsEnabled !== false;
        const result = {
          ok: true,
          project_id: data.project_id,
          member_uid: data.member_uid,
          notifications_enabled: data.notifications_enabled,
          changed: before !== data.notifications_enabled,
        };
        if (before === data.notifications_enabled) return result;

        const updatedMembers = members.map((member, index) => index === targetIndex
          ? { ...member, notificationsEnabled: data.notifications_enabled } : member);
        const event = {
          operation_id: data.operation_id,
          actor_uid: currentActor.uid,
          actor_email: currentActor.email,
          target_uid: data.member_uid,
          target_email: members[targetIndex].email || null,
          before,
          after: data.notifications_enabled,
          payload_hash: payloadHash,
          result,
          at: getServerTimestamp(),
        };
        tx.update(projectRef, { members: updatedMembers });
        tx.create(eventRef, event);
        return result;
      });
    } catch (error) {
      return {
        ok: false,
        error: error?.[PUBLIC] ? error.code : 'member_notification_unavailable',
        status: error?.[PUBLIC] ? error.status : 503,
      };
    }
  };
}

module.exports = { createProjectMemberNotifications };
