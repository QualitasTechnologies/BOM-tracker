const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpBomUserResolver } = require('../dist/mcpBomUser.cjs');

const authInfo = { clientId: 'mcp-client', token: 'verified-token', scopes: ['bom:write'], extra: { firebaseUid: 'alice' } };
const record = { uid: 'alice', email: 'alice@example.test', disabled: false, customClaims: { status: 'approved', role: 'viewer' } };

test('resolves the Firebase user only from authenticated MCP request context', async () => {
  const lookups = [];
  const resolve = createMcpBomUserResolver({ auth: { getUser: async uid => { lookups.push(uid); return structuredClone(record); } } });
  assert.deepEqual(await resolve(authInfo), { uid: 'alice', email: 'alice@example.test', role: 'viewer', status: 'approved', disabled: false });
  assert.deepEqual(lookups, ['alice']);
});

test('stdio, missing auth context, and client context without a verified Firebase UID fail closed', async () => {
  const resolve = createMcpBomUserResolver({ auth: { getUser: async () => structuredClone(record) } });
  for (const value of [undefined, {}, { clientId: 'mcp', token: 'token', scopes: [], extra: {} },
    { clientId: 'mcp', token: 'token', scopes: [], extra: { firebaseUid: 'a/b' } }]) {
    await assert.rejects(resolve(value), error => error.code === 'mcp_principal_unavailable');
  }
});

test('unknown, disabled, and unapproved Firebase users cannot become MCP writers', async () => {
  const missing = createMcpBomUserResolver({ auth: { getUser: async () => { throw Error('unknown'); } } });
  await assert.rejects(missing(authInfo), error => error.code === 'mcp_user_unapproved');
  const disabled = createMcpBomUserResolver({ auth: { getUser: async () => ({ ...record, disabled: true }) } });
  await assert.rejects(disabled(authInfo), error => error.code === 'mcp_user_disabled');
  const pending = createMcpBomUserResolver({ auth: { getUser: async () => ({ ...record, customClaims: { status: 'pending' } }) } });
  await assert.rejects(pending(authInfo), error => error.code === 'mcp_user_unapproved');
});

test('a tool-supplied UID has no effect on the authenticated user resolution', async () => {
  const lookups = [];
  const resolve = createMcpBomUserResolver({ auth: { getUser: async uid => { lookups.push(uid); return structuredClone(record); } } });
  await resolve(authInfo);
  assert.deepEqual(lookups, ['alice']);
});
