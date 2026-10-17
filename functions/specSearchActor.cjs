const actorError = (code, status) => Object.assign(new Error(code), {code, status});

const resolveSpecSearchActor = async ({request, auth}) => {
  const uid = request.auth?.uid;
  const bearer = request.rawRequest?.get?.('Authorization');
  if (typeof uid !== 'string' || !uid || typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) {
    throw actorError('actor_authentication_required', 401);
  }

  let token;
  try {
    token = await auth.verifyIdToken(bearer.slice(7), true);
  } catch {
    throw actorError('actor_authentication_required', 401);
  }
  if (token.uid !== uid || token.firebase?.tenant) throw actorError('actor_forbidden', 403);

  let actor;
  try {
    actor = await auth.getUser(uid);
  } catch (error) {
    const missing = error.code === 'auth/user-not-found';
    throw actorError(missing ? 'actor_forbidden' : 'identity_provider_unavailable', missing ? 403 : 503);
  }

  if (actor.uid !== uid || actor.disabled || actor.customClaims?.status !== 'approved'
    || !['admin', 'user', 'viewer'].includes(actor.customClaims?.role)) {
    throw actorError('actor_forbidden', 403);
  }

  const revokedAfter = Date.parse(actor.tokensValidAfterTime);
  if (Number.isFinite(revokedAfter) && revokedAfter > 0
    && (!Number.isFinite(token.auth_time) || token.auth_time * 1000 < revokedAfter)) {
    throw actorError('actor_forbidden', 403);
  }
  return actor;
};

module.exports = {resolveSpecSearchActor};
