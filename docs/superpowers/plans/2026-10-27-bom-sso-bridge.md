# BOM SSO Bridge (backend source only)

Approved design: Pulse asserts an already-authenticated user to BOM over a dedicated server-to-server channel; BOM mints a Firebase custom token for that user's **existing** UID. No account creation, no extra claims, current permissions apply.

## Scope
- `functions/bomSsoBridge.cjs` — `createBomSsoBridgeHandler`, `bomSsoBridgeEnabled`.
- `functions/bomSsoBridge.test.cjs` — offline tests (injected `getEnabled/getServiceKey/now/auth`; no Firestore, no provider calls).
- `functions/index.js` — one wrapper: `exports.bomSsoBridge` (`onRequest`, `us-central1`, `cors:false`, 30s, max 5 instances, secret `BOM_SSO_BRIDGE_KEY`). Placed before the "Reused BOM UI" block, because existing VM source-slice tests execute the file tail and would break on an appended `onRequest`.

## Behavior
1. Default OFF unless `process.env.BOM_SSO_BRIDGE_ENABLED === 'true'` (503 `bom_sso_bridge_unavailable`).
2. POST only (405). Responses are `Cache-Control: private, no-store`.
3. Reuses `createProjectActorFactory` with header `X-BOM-SSO-Key` and unavailable code `bom_sso_bridge_unavailable`: constant-time key check, lookup by email then reload by UID, `emailVerified`, not disabled, `status=approved`, valid role, `tokensValidAfterTime` revocation vs `X-Pulse-Authenticated-At`. The read gateway is unchanged; its key cannot mint.
4. `X-Pulse-Authenticated-At` must be finite and not more than 60s in the future. There is deliberately **no** login-age cutoff: Pulse owns session expiry.
5. Actors with `tenantId` are refused (403).
6. `auth.createCustomToken(actor.uid)` only (no developer claims, never `createUser`). Empty/non-string token or signing failure → 503 `sso_token_unavailable`; SDK text is never returned or logged; nothing is cached.

## Errors
`method_not_allowed` 405, `caller_authentication_required` 401, `authentication_time_required` 401, `actor_forbidden` 403, `identity_provider_unavailable` 503, `bom_sso_bridge_unavailable` 503, `sso_token_unavailable` 503.

## Blockers before any deployment (not done here)
- Provision the dedicated `pulse-bom-sso@visionbomtracker.iam.gserviceaccount.com`
  identity declared in the wrapper. Grant `roles/firebaseauth.viewer` on the
  project, `roles/iam.serviceAccountTokenCreator` on itself only, and
  `roles/secretmanager.secretAccessor` on its dedicated bridge secret only.
  Leave the existing Compute identity unchanged; grant no Firestore or Storage
  access to the bridge identity. Actual token signing remains unverified.
- `BOM_SSO_BRIDGE_KEY` secret must be created (distinct from the read/operations keys) and shared with Pulse.
- Pulse must call with a scoped BOM flow; do not widen the general Pulse external allowlist (it would grant the internal flow).
- Set `BOM_SSO_BRIDGE_ENABLED=true` only at rollout.

## Verification
Root verification: 28 focused tests and 942 full backend tests passed. Additional
regressions caught response-envelope mismatch, whitespace tokens and missing
dedicated service-account wiring before correction. Re-run full CI on the final
head before merging. No live SSO configuration or account changes made here.
