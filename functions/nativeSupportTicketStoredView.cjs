// Response projections for stored support-ticket values. Stored data is untrusted: a Firestore SDK object
// (e.g. a DocumentReference) must never reach a callable response. Valid current shapes pass through unchanged.
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const STATE_ERROR = 'support_ticket_state_invalid';

function createStoredViews(fault) {
  const invalid = () => fault(STATE_ERROR, 409);
  // Status is a string (known key or legacy text); absent stays absent.
  const statusView = value => {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string' || value.length > 128) throw invalid();
    return value;
  };
  // Assignee is {userId, name, email?}; anything else, including extra nested values, is rejected.
  const assigneeView = value => {
    if (!value) return null;
    if (!plain(value)) throw invalid();
    const keys = Object.keys(value);
    if (keys.some(key => !['userId', 'name', 'email'].includes(key))
      || typeof value.userId !== 'string' || typeof value.name !== 'string'
      || (Object.hasOwn(value, 'email') && typeof value.email !== 'string')) throw invalid();
    return Object.hasOwn(value, 'email')
      ? { userId: value.userId, name: value.name, email: value.email }
      : { userId: value.userId, name: value.name };
  };
  return { statusView, assigneeView };
}

module.exports = { createStoredViews, STATE_ERROR };
