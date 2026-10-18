const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('MCP receipts and cutover controls have no client grant or generic root match', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
  let depth = 0; const topMatches = [];
  for (const raw of rules.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    if (depth === 2 && /\bmatch\s+\//.test(line)) topMatches.push(line.match(/\bmatch\s+(\/\S+)/)[1]);
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  }
  assert.ok(topMatches.includes('/projects/{projectId}'));
  for (const prefix of ['pulseMcpOperations', 'pulseRuntimeControl']) assert.equal(topMatches.some(route => route.startsWith(`/${prefix}/`)), false);
  assert.equal(topMatches.some(route => route.startsWith('/{')), false);
});
test('packaged writer, authenticated user resolver, and command engine exactly match the reviewed source', () => {
  for (const [source, packaged] of [['../src/mcpMaterialWriter.cjs', '../dist/mcpMaterialWriter.cjs'], ['../src/mcpBomUser.cjs', '../dist/mcpBomUser.cjs'], ['../../functions/materialCommands.cjs', '../dist/materialCommands.cjs']]) {
    assert.equal(fs.readFileSync(path.join(__dirname, source), 'utf8'), fs.readFileSync(path.join(__dirname, packaged), 'utf8'));
  }
});
