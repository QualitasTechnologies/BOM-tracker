const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBomSsoBridgeHandler, bomSsoBridgeEnabled } = require('./bomSsoBridge.cjs');

const NOW = Date.parse('2026-10-27T10:00:00Z');
const good = { uid: 'uid-1', email: 'alice@example.com', emailVerified: true, disabled: false, customClaims: { role: 'user', status: 'approved' } };

function setup(overrides = {}) {
  const calls = { minted: [], lookups: [] };
  const users = overrides.users || [good];
  const auth = {
    async getUserByEmail(email) {
      const u = users.find(x => x.email === email);
      if (!u) throw Object.assign(new Error('SDK internal text'), { code: 'auth/user-not-found' });
      return u;
    },
    async getUser(uid) { calls.lookups.push(uid); return users.find(x => x.uid === uid); },
    async createCustomToken(...args) {
      calls.minted.push(args);
      if (overrides.signError) throw new Error('SECRET sdk detail iam.serviceAccounts.signBlob');
      return overrides.token === undefined ? 'minted-token' : overrides.token;
    },
    async createUser() { throw new Error('createUser must never be called'); }
  };
  const handler = createBomSsoBridgeHandler({
    auth,
    getEnabled: overrides.getEnabled || (() => true),
    getServiceKey: overrides.getServiceKey || (() => 'sso-key'),
    now: () => NOW
  });
  return { handler, calls };
}
function request({ method = 'POST', headers } = {}) {
  const h = { 'x-bom-sso-key': 'sso-key', 'x-pulse-user-email': 'alice@example.com', 'x-pulse-authenticated-at': String(NOW - 1000), ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  return { method, get: name => h[name.toLowerCase()] };
}
function response() {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}
async function run(opts, reqOpts) {
  const s = setup(opts);
  const res = response();
  await s.handler(request(reqOpts), res);
  return { ...s, res };
}
const rejected = (r, status, code) => {
  assert.equal(r.res.statusCode, status);
  assert.deepEqual(r.res.body, { error: code });
  assert.equal(r.calls.minted.length, 0);
};

test('enabled only for exact true', () => {
  assert.equal(bomSsoBridgeEnabled({ BOM_SSO_BRIDGE_ENABLED: 'true' }), true);
  for (const v of [undefined, '', 'TRUE', '1', 'false']) assert.equal(bomSsoBridgeEnabled({ BOM_SSO_BRIDGE_ENABLED: v }), false);
});
test('disabled by default', async () => rejected(await run({ getEnabled: () => false }), 503, 'bom_sso_bridge_unavailable'));
test('non-POST rejected', async () => rejected(await run({}, { method: 'GET' }), 405, 'method_not_allowed'));
test('missing key', async () => rejected(await run({}, { headers: { 'x-bom-sso-key': undefined } }), 401, 'caller_authentication_required'));
test('wrong key', async () => rejected(await run({}, { headers: { 'x-bom-sso-key': 'nope' } }), 401, 'caller_authentication_required'));
test('read gateway key header does not work', async () => rejected(await run({}, { headers: { 'x-bom-sso-key': undefined, 'x-project-review-key': 'sso-key' } }), 401, 'caller_authentication_required'));
test('unconfigured key is unavailable', async () => rejected(await run({ getServiceKey: () => '' }), 503, 'bom_sso_bridge_unavailable'));
test('unknown user', async () => rejected(await run({}, { headers: { 'x-pulse-user-email': 'who@example.com' } }), 403, 'actor_forbidden'));
for (const [name, patch] of Object.entries({
  disabled: { disabled: true },
  unverified: { emailVerified: false },
  pending: { customClaims: { role: 'user', status: 'pending' } },
  'bad role': { customClaims: { role: 'root', status: 'approved' } },
  'no claims': { customClaims: undefined }
})) test(`refuses ${name}`, async () => rejected(await run({ users: [{ ...good, ...patch }] }), 403, 'actor_forbidden'));
test('refuses email mismatch on UID reload', async () => {
  const handler = createBomSsoBridgeHandler({
    auth: { getUserByEmail: async () => good, getUser: async () => ({ ...good, email: 'other@example.com' }), createCustomToken: async () => 'x' },
    getEnabled: () => true, getServiceKey: () => 'sso-key', now: () => NOW
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'actor_forbidden' });
});
test('refuses revoked session', async () => {
  const revoked = { ...good, tokensValidAfterTime: new Date(NOW).toUTCString() };
  rejected(await run({ users: [revoked] }), 403, 'actor_forbidden');
});
test('missing authenticatedAt', async () => rejected(await run({}, { headers: { 'x-pulse-authenticated-at': undefined } }), 401, 'authentication_time_required'));
test('non-finite authenticatedAt', async () => rejected(await run({}, { headers: { 'x-pulse-authenticated-at': 'garbage' } }), 401, 'authentication_time_required'));
test('future authenticatedAt beyond 60s', async () => rejected(await run({}, { headers: { 'x-pulse-authenticated-at': String(NOW + 61000) } }), 401, 'authentication_time_required'));
test('small clock skew tolerated', async () => assert.equal((await run({}, { headers: { 'x-pulse-authenticated-at': String(NOW + 30000) } })).res.statusCode, 200));
test('old authenticatedAt is not age-limited', async () => assert.equal((await run({}, { headers: { 'x-pulse-authenticated-at': String(NOW - 30 * 86400000) } })).res.statusCode, 200));
test('tenant actor rejected', async () => rejected(await run({ users: [{ ...good, tenantId: 't1' }] }), 403, 'actor_forbidden'));
test('signing error is sanitized', async () => {
  const r = await run({ signError: true });
  assert.equal(r.res.statusCode, 503);
  assert.deepEqual(r.res.body, { error: 'sso_token_unavailable' });
  assert.ok(!JSON.stringify(r.res.body).includes('SECRET'));
});
for (const bad of ['', '   ', null, 7]) test(`invalid minted token ${JSON.stringify(bad)}`, async () => {
  const r = await run({ token: bad });
  assert.equal(r.res.statusCode, 503);
  assert.deepEqual(r.res.body, { error: 'sso_token_unavailable' });
});
test('success mints for existing UID only, no claims, no-store', async () => {
  const r = await run({});
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.res.body, { ok: true, token: 'minted-token' });
  assert.deepEqual(r.calls.minted, [['uid-1']]);
  assert.equal(r.res.headers['cache-control'], 'private, no-store');
  assert.ok(r.calls.lookups.includes('uid-1'));
});
test('index wires dedicated export with its own secret and header', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const marker = "require('./bomSsoBridge.cjs')";
  const at = src.indexOf(marker);
  assert.ok(at > 0, 'wrapper present');
  const block = src.slice(at, src.indexOf('// end bomSsoBridge'));
  assert.match(block, /defineSecret\('BOM_SSO_BRIDGE_KEY'\)/);
  assert.match(block, /exports\.bomSsoBridge\s*=\s*onRequest/);
  assert.match(block, /region: 'us-central1'/);
  assert.match(block, /cors: false/);
  assert.match(block, /timeoutSeconds: 30/);
  assert.match(block, /maxInstances: 5/);
  assert.match(block, /secrets: \[bomSsoBridgeKey\]/);
  assert.match(block, /bomSsoBridgeEnabled\(process\.env\)/);
  assert.doesNotMatch(block, /BOM_PROJECT_(READ|OPERATIONS)_KEY|PULSE_API_KEY/);
  assert.match(src.slice(0, at), /exports\.projectOperations/);
});
