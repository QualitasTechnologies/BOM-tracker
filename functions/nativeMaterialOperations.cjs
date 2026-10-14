const { createProjectOperationsHandler } = require('./projectOperations.cjs');
const fault = (code, status) => Object.assign(new Error(code), { code, status });
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

async function currentNativeActor(auth, request) {
  const uid = request.auth?.uid;
  const bearer = request.rawRequest?.get?.('Authorization');
  if (typeof uid !== 'string' || !uid || typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) throw fault('actor_authentication_required', 401);
  let token;
  try { token = await auth.verifyIdToken(bearer.slice(7), true); }
  catch { throw fault('actor_authentication_required', 401); }
  if (token.uid !== uid || token.firebase?.tenant) throw fault('actor_forbidden', 403);
  let actor;
  try { actor = await auth.getUser(uid); }
  catch (error) { throw fault(error.code === 'auth/user-not-found' ? 'actor_forbidden' : 'identity_provider_unavailable', error.code === 'auth/user-not-found' ? 403 : 503); }
  const email = emailOf(actor?.email);
  if (actor?.uid !== uid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emailOf(token.email) !== email
    || actor.emailVerified !== true || actor.disabled || actor.customClaims?.status !== 'approved'
    || !['admin', 'user', 'viewer'].includes(actor.customClaims?.role)) throw fault('actor_forbidden', 403);
  const revokedAfter = Date.parse(actor.tokensValidAfterTime);
  if (Number.isFinite(revokedAfter) && revokedAfter > 0 && (!Number.isFinite(token.auth_time) || token.auth_time * 1000 < revokedAfter)) throw fault('actor_forbidden', 403);
  return actor;
}

/** Firebase callable transport: native identity never passes through browser-selected Pulse headers. */
function createNativeMaterialOperations({ db, auth, mutationsEnabled = false, getServerTimestamp }) {
  return async request => {
    try {
      const actor = await currentNativeActor(auth, request);
      const data = request.data;
      if (!plain(data) || !['get', 'patch', 'fulfill', 'command', 'create_project'].includes(data.operation)) throw fault('invalid_material_request', 400);
      const allowed = data.operation === 'get' ? ['operation', 'project_id']
        : data.operation === 'create_project' ? ['operation', 'project_id', 'operation_id', 'project']
        : data.operation === 'command' ? ['operation', 'project_id', 'expected_version', 'operation_id', 'command']
        : ['operation', 'project_id', 'item_id', 'expected_version', 'operation_id', data.operation === 'fulfill' ? 'fulfillment' : 'patch'];
      if (data.operation !== 'get') allowed.push('expected_actor_uid');
      if (Object.keys(data).some(key => !allowed.includes(key))) throw fault('invalid_material_request', 400);
      if (data.operation === 'create_project' && !Object.hasOwn(data, 'expected_actor_uid')) throw fault('invalid_material_request', 400);
      // A session assertion never selects identity: the freshly verified bearer does.
      if (data.operation !== 'get' && Object.hasOwn(data, 'expected_actor_uid')
        && (typeof data.expected_actor_uid !== 'string' || data.expected_actor_uid !== actor.uid)) throw fault('actor_session_changed', 403);
      const { operation, project_id: projectId, expected_actor_uid: _expectedActorUid, ...body } = data;
      const handler = createProjectOperationsHandler({ db, auth, mutationsEnabled, getServerTimestamp, resolveActor: async () => actor });
      let result;
      const res = { set() {}, status() { return this; }, json(value) { result = value; return this; } };
      await handler({ method: operation === 'get' ? 'GET' : ['fulfill', 'command', 'create_project'].includes(operation) ? 'POST' : 'PATCH', query: { project_id: projectId, ...(operation === 'create_project' ? { resource: 'project_create' } : operation === 'fulfill' ? { resource: 'fulfillment' } : operation === 'command' ? { resource: 'commands' } : {}) }, body }, res);
      return result;
    } catch (error) {
      return { ok: false, error: error.status ? error.code : 'project_operations_unavailable' };
    }
  };
}

module.exports = { createNativeMaterialOperations };
