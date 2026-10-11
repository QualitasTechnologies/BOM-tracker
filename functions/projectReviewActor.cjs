const { createHash, timingSafeEqual } = require('node:crypto');

const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const fault = (code, status) => Object.assign(new Error(code), { code, status });
const hash = value => createHash('sha256').update(String(value || '')).digest();

function timestamp(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function createProjectActorFactory({ auth, getServiceKey, serviceKeyHeader = 'X-Project-Review-Key', unavailableCode = 'project_review_unavailable' }) {
  async function actorFor(req) {
    const configured = getServiceKey();
    const supplied = req.get(serviceKeyHeader);
    if (!configured) throw fault(unavailableCode, 503);
    if (!supplied || !timingSafeEqual(hash(configured), hash(supplied))) throw fault('caller_authentication_required', 401);
    const email = normalizeEmail(req.get('X-Pulse-User-Email'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fault('actor_forbidden', 403);
    let record;
    try { record = await auth.getUserByEmail(email); }
    catch (error) {
      if (error.code === 'auth/user-not-found') throw fault('actor_forbidden', 403);
      throw fault('identity_provider_unavailable', 503);
    }
    // Auth email is unique per Firebase user. Reload by UID to check current approval/disable state.
    record = await auth.getUser(record.uid);
    if (!record?.uid || normalizeEmail(record.email) !== email || record.disabled || record.emailVerified !== true
      || record.customClaims?.status !== 'approved' || !['admin', 'user', 'viewer'].includes(record.customClaims?.role)) throw fault('actor_forbidden', 403);
    const revokedAfter = timestamp(record.tokensValidAfterTime);
    const authenticatedAt = timestamp(req.get('X-Pulse-Authenticated-At'));
    if (Number.isFinite(revokedAfter) && revokedAfter > 0 && (!Number.isFinite(authenticatedAt) || authenticatedAt < revokedAfter)) throw fault('actor_forbidden', 403);
    // Optional Firebase authentication must agree with the trusted channel actor, never replace it.
    const authorization = req.get('Authorization');
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) throw fault('actor_authentication_required', 401);
      let token;
      try { token = await auth.verifyIdToken(authorization.slice(7), true); }
      catch { throw fault('actor_authentication_required', 401); }
      if (token.uid !== record.uid || normalizeEmail(token.email) !== email) throw fault('actor_forbidden', 403);
    }
    return record;
  }
  return actorFor;
}

module.exports = { createProjectActorFactory };
