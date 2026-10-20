const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./nativeProjectFixture.cjs');

test('internal members may change their own notification preference but not another member', async () => {
  const f = fixture({ uid: 'alice' });
  assert.equal((await f.command({ kind: 'member_notifications', user_id: 'alice', enabled: true })).ok, true);
  const before = structuredClone([...f.docs]);
  assert.equal((await f.command({ kind: 'member_notifications', user_id: 'partner', enabled: true }, { operation_id: 'other' })).error, 'member_notification_forbidden');
  assert.deepEqual([...f.docs], before);
});

for (const replay of [false, true]) test(`fresh admin demotion blocks other-member preference ${replay ? 'receipt replay' : 'write'}`, async () => {
  let demote = false;
  const f = fixture({ onRead: (path, users) => {
    if (demote && path.includes('/receipts/')) users.get('admin').customClaims.role = 'user';
  } });
  const opening = await f.call({ operation: 'get' });
  const request = { operation: 'command', expected_version: opening.version, operation_id: 'demotion', command: { kind: 'member_notifications', user_id: 'partner', enabled: true } };
  if (replay) assert.equal((await f.call(request)).ok, true);
  demote = true;
  const before = structuredClone([...f.docs]);
  assert.equal((await f.call(request)).error, 'member_notification_forbidden');
  assert.deepEqual([...f.docs], before);
});
