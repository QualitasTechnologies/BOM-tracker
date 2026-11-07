const test = require('node:test'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process'), path = require('node:path');
test('plain/Date engine path (open + manual mark) never loads the server SDK', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'nativePoSerialization.noSdkChild.cjs')], { cwd: __dirname, encoding: 'utf8', shell: false, timeout: 60000 });
  const out = JSON.parse(run.stdout || '{}');
  assert.deepEqual(out.loaded, [], run.stderr);
  assert.equal(out.failed, undefined); assert.equal(run.status, 0, run.stderr);
  assert.equal(out.openOk, true); assert.equal(out.sendOk, true); assert.equal(out.sendPhase, 'complete');
  assert.deepEqual(out.dated, { due: '2026-10-01T00:00:00.000Z', n: [1, null, 'x'] });
});
