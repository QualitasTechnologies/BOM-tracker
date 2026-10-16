const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

// Actual deployment policy lives in BOM; the shared backend reference has no
// Firestore policy and must not silently skip this assertion or copy stale rules.
test('source boundary keeps grants outside legacy writes and native uploads outside legacy Storage match', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
  assert.match(rules, /match \/projects\/\{projectId\}\/received-photos\/native\/\{fileName\}/);
  assert.match(rules, /allow read, update, delete: if false/); assert.match(rules, /allow create:/);
  assert.match(rules, /match \/projects\/\{projectId\}\/received-photos\/finalized\/\{fileName\}/);
  assert.match(rules, /request\.time < .*expires_at/); assert.match(rules, /pulseNativeUploadIntents/); assert.match(rules, /nativeUploadModeAllowsWrite/);
  const firestore = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.doesNotMatch(firestore, /^ {4}match \/\{[^}]+\}/m);
});
