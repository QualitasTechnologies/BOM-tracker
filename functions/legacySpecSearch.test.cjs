const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./nativeMilestoneFixture.cjs');
const {createLegacySpecSearch} = require('./legacySpecSearch.cjs');
function setup(duringFetch = () => {}) {
  const f = fixture();
  f.docs.delete('pulseRuntimeControl/cutover');
  f.docs.set('projects/P/bom/data', {categories: [{name: 'Parts', items: [{id: 'motor', name: 'Motor', quantity: 1}]}]});
  const calls = [];
  const handler = createLegacySpecSearch({db: f.db, getServerTimestamp: () => 'server-time', fetch: async (...args) => {
    calls.push(args); await duringFetch(f);
    return {ok: true, json: async () => ({success: true, specificationUrl: 'https://example.com/motor.pdf'})};
  }});
  const call = async (body = {projectId: 'P', bomItemId: 'motor', itemName: 'Motor'}) => {
    const result = {}; await handler({method: 'POST', body}, {set() {}, status(code) {result.status = code; return this;}, json(body) {result.body = body;}, send() {}}); return result;
  };
  return {...f, calls, call};
}
test('legacy spec search refuses every ownership marker and non-coexist mode before dispatch', async () => {
  for (const marker of [{}, {fence: 'legacy_bom_data_writes', version: 1}, {version: '1'}]) {
    const f = setup(); f.docs.set('pulseMaterialCutovers/P', marker);
    assert.equal((await f.call()).status, 503); assert.equal(f.calls.length, 0);
  }
  for (const mode of ['pulse_only', 'read_only', 'unknown', null]) {
    const f = setup(); f.docs.set('pulseRuntimeControl/cutover', {mode});
    assert.equal((await f.call()).status, 503); assert.equal(f.calls.length, 0);
  }
});
test('an ownership transfer or pause during the provider call cannot save a stale callback', async () => {
  for (const change of [f => f.docs.set('pulseMaterialCutovers/P', {fence: 'legacy_bom_data_writes', version: 1}), f => f.docs.set('pulseRuntimeControl/cutover', {mode: 'read_only'})]) {
    const f = setup(change), before = structuredClone(f.docs.get('projects/P/bom/data'));
    const result = await f.call(); assert.equal(result.status, 503); assert.equal(result.body.success, false);
    assert.deepEqual(f.docs.get('projects/P/bom/data'), before); assert.equal(f.calls.length, 1);
  }
});
test('legacy callback merges the latest unrelated edits and refuses changed or ambiguous target identity', async () => {
  const f = setup(f => {const item = f.docs.get('projects/P/bom/data').categories[0].items[0]; item.quantity = 9;});
  assert.equal((await f.call()).status, 200);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].quantity, 9);
  assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl, 'https://example.com/motor.pdf');
  for (const change of [f => {f.docs.get('projects/P/bom/data').categories[0].items[0].name = 'Changed';}, f => {f.docs.get('projects/P/bom/data').categories[0].items.push({id: 'motor', name: 'Duplicate'});}]) {
    const g = setup(change); assert.equal((await g.call()).status, 409); assert.equal(g.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl, undefined);
  }
});
test('missing BOM or item and malformed IDs fail before provider dispatch', async () => {
  for (const change of [f => f.docs.delete('projects/P/bom/data'), f => {f.docs.get('projects/P/bom/data').categories[0].items = [];}]) {
    const f = setup(); change(f); assert.equal((await f.call()).status, 404); assert.equal(f.calls.length, 0);
  }
  const f = setup(); assert.equal((await f.call({projectId: 'P/other', bomItemId: 'motor', itemName: 'Motor'})).status, 400); assert.equal(f.calls.length, 0);
});
