const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 128
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);

function resolveSupportTicketAssignee(project, actor, userId, fault) {
  if (userId === actor.uid) {
    const email = typeof actor.email === 'string' ? actor.email.trim() : '';
    const name = typeof actor.displayName === 'string' && actor.displayName.trim() ? actor.displayName.trim() : email || actor.uid;
    return { userId, name, email };
  }
  const member = Array.isArray(project.members)
    ? project.members.find(candidate => plain(candidate) && candidate.userId === userId)
    : null;
  if (!member || !validId(member.userId)) throw fault('support_ticket_assignee_not_in_project', 422);
  if ((Object.hasOwn(member, 'email') && typeof member.email !== 'string')
    || (Object.hasOwn(member, 'displayName') && typeof member.displayName !== 'string')) {
    throw fault('support_ticket_assignee_not_in_project', 422);
  }
  const email = typeof member.email === 'string' ? member.email.trim() : '';
  const displayName = typeof member.displayName === 'string' ? member.displayName.trim() : '';
  if (email.length > 254 || (email && !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email))
    || displayName.length > 300) {
    throw fault('support_ticket_assignee_not_in_project', 422);
  }
  return { userId, name: displayName || email || userId, email };
}

module.exports = { resolveSupportTicketAssignee };
