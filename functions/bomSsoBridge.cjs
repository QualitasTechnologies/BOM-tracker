const { createProjectActorFactory } = require('./projectReviewActor.cjs');

const UNAVAILABLE = 'bom_sso_bridge_unavailable';
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const fault = (code, status) => Object.assign(new Error(code), { code, status });

/** Default OFF: only the exact string 'true' enables the bridge. */
const bomSsoBridgeEnabled = env => env?.BOM_SSO_BRIDGE_ENABLED === 'true';

function authenticatedAtMs(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Date.parse(value);
}

/**
 * Mints a Firebase custom token for an EXISTING, approved, enabled user whose
 * identity was asserted by Pulse over the dedicated SSO channel. Never creates
 * accounts, never adds claims, never touches Firestore. Pulse owns session expiry;
 * the actor factory's token-revocation check still applies.
 */
function createBomSsoBridgeHandler({ auth, getEnabled, getServiceKey, now = Date.now }) {
  const actorFor = createProjectActorFactory({ auth, getServiceKey, serviceKeyHeader: 'X-BOM-SSO-Key', unavailableCode: UNAVAILABLE });
  return async function bomSsoBridge(req, res) {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (getEnabled() !== true) throw fault(UNAVAILABLE, 503);
      if (req.method !== 'POST') throw fault('method_not_allowed', 405);
      let actor;
      try { actor = await actorFor(req); }
      catch (error) {
        if (error?.code && error?.status) throw error;
        throw fault('identity_provider_unavailable', 503);
      }
      const authenticatedAt = authenticatedAtMs(req.get('X-Pulse-Authenticated-At'));
      if (!Number.isFinite(authenticatedAt) || authenticatedAt > now() + MAX_FUTURE_SKEW_MS) throw fault('authentication_time_required', 401);
      if (actor.tenantId) throw fault('actor_forbidden', 403);
      let token;
      try { token = await auth.createCustomToken(actor.uid); }
      catch { throw fault('sso_token_unavailable', 503); }
      if (typeof token !== 'string' || !token.trim()) throw fault('sso_token_unavailable', 503);
      return res.status(200).json({ ok: true, token });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return res.status(status).json({ error: status === 500 ? 'internal_error' : error.code });
    }
  };
}

module.exports = { createBomSsoBridgeHandler, bomSsoBridgeEnabled };
