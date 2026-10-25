const test = require('node:test');
const assert = require('node:assert/strict');
const modulePath = '../dist/googlePrincipal.js';
test('machine identity is resolved from the actual credential token, never a tool-selected Firebase user', async () => {
  const { createGooglePrincipalResolver } = await import(modulePath);
  const tokens = [];
  const resolve = createGooglePrincipalResolver({ getCredential: () => ({ getAccessToken: async () => ({ access_token: 'fixture-token', expires_in: 300 }) }),
    getTokenInfo: async token => { tokens.push(token); return { sub: 'google-service-subject', email: 'svc@example.iam.gserviceaccount.com', expiry_date: 2000 }; }, now: () => 1000 });
  assert.deepEqual(await resolve(), { id: 'google:google-service-subject', email: 'svc@example.iam.gserviceaccount.com' });
  assert.deepEqual(tokens, ['fixture-token']);
});
test('unidentifiable, expired or unavailable credentials cannot authorize a machine write', async () => {
  const { createGooglePrincipalResolver } = await import(modulePath);
  for (const info of [{ expiry_date: 2000 }, { sub: 'subject', expiry_date: 999 }, { sub: 'subject', expiry_date: NaN }]) {
    const resolve = createGooglePrincipalResolver({ getCredential: () => ({ getAccessToken: async () => ({ access_token: 'fixture', expires_in: 300 }) }), getTokenInfo: async () => info, now: () => 1000 });
    await assert.rejects(resolve, /principal_unavailable/);
  }
  await assert.rejects(createGooglePrincipalResolver({ getCredential: () => undefined })(), /principal_unavailable/);
});
test('a subsequent request uses the current credential identity instead of a cached principal', async () => {
  const { createGooglePrincipalResolver } = await import(modulePath); let id = 'one';
  const resolve = createGooglePrincipalResolver({ getCredential: () => ({ getAccessToken: async () => ({ access_token: id, expires_in: 300 }) }), getTokenInfo: async token => ({ user_id: token, expiry_date: 2000 }), now: () => 1000 });
  assert.equal((await resolve()).id, 'google:one'); id = 'two'; assert.equal((await resolve()).id, 'google:two');
});
