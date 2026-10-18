// Resolves an MCP-authenticated request to the approved Firebase user bound by
// the trusted MCP authentication middleware. Stdio requests have no authInfo and
// therefore cannot authorize material writes.
const fault = (code, status = 403) => Object.assign(new Error(code), { code, status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validUid = value => typeof value === 'string' && !!value.trim() && value.length <= 128 && !/[\/\x00-\x1f]/.test(value);

function createMcpBomUserResolver({ auth }) {
  if (!auth || typeof auth.getUser !== 'function') throw new TypeError('Firebase Admin Auth is required');
  return async authInfo => {
    // authInfo is supplied by the MCP SDK's authenticated transport context, not
    // by tool arguments. The Firebase UID must be attached by trusted auth code
    // after validating the MCP session/token.
    const uid = authInfo?.extra?.firebaseUid;
    if (!plain(authInfo) || typeof authInfo.clientId !== 'string' || !authInfo.clientId.trim()
      || typeof authInfo.token !== 'string' || !authInfo.token
      || !Array.isArray(authInfo.scopes) || !validUid(uid)) throw fault('mcp_principal_unavailable');
    let record;
    try { record = await auth.getUser(uid); }
    catch { throw fault('mcp_user_unapproved'); }
    if (!record || record.uid !== uid) throw fault('mcp_user_unapproved');
    if (record.disabled === true) throw fault('mcp_user_disabled');
    const claims = plain(record.customClaims) ? record.customClaims : {};
    if (claims.status !== 'approved') throw fault('mcp_user_unapproved');
    return {
      uid: record.uid,
      email: typeof record.email === 'string' ? record.email : undefined,
      role: typeof claims.role === 'string' ? claims.role : 'viewer',
      status: claims.status,
      disabled: record.disabled === true
    };
  };
}

module.exports = { createMcpBomUserResolver };
