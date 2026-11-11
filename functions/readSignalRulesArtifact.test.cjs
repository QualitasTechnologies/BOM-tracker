const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const canonical = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const modulePath = pathToFileURL(path.join(root, 'scripts/build-read-signal-rules.mjs')).href;
test('the notice release adds only its marked block to the exact live business-rule baseline', async () => {
  const { buildReadSignalRules, stripReadSignalAddition, BASELINE_SHA256 } = await import(modulePath);
  const baseline = canonical('firestore.legacy-po.rules'), candidate = buildReadSignalRules(baseline, canonical('firestore.rules'));
  assert.equal(BASELINE_SHA256, '58bd2d80afa51cf4a3f8849ae72ae2b50652b4855298b6162a02e69710dc9a50');
  assert.equal(stripReadSignalAddition(candidate), baseline);
  assert.equal(candidate, canonical('firestore.read-signals.rules'));
  const added = candidate.slice(candidate.indexOf('// BEGIN approved content-free notices'), candidate.indexOf('// END approved content-free notices'));
  assert.deepEqual([...added.matchAll(/match \/([A-Za-z]+)/g)].map(row => row[1]), ['pulseReadSignals', 'pulseUserReadSignals', 'pulseReadCatalog']);
  assert.equal(added.includes('match /projects/'), false); assert.equal(added.includes('allow list, write: if false'), true);
});
test('a changed baseline or ambiguous/missing notice boundary fails closed', async () => {
  const { buildReadSignalRules } = await import(modulePath), baseline = canonical('firestore.legacy-po.rules'), source = canonical('firestore.rules');
  assert.throws(() => buildReadSignalRules(baseline + '\n', source), /baseline/);
  assert.throws(() => buildReadSignalRules(baseline, source.replace('// Content-free refresh notices', '// removed notice marker')), /notice/);
  assert.throws(() => buildReadSignalRules(baseline, source.replace('match /pulseReadCatalog/admin', 'match /otherCollection/admin')), /notice/);
});
