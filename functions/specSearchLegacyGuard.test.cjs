const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {rejectLegacySpecSearch, isNativeSpecSearchEnabled} = require("./specSearchLegacyGuard.cjs");

test("native spec search enablement accepts only the exact literal true", () => {
  for (const value of [undefined, null, false, "TRUE", "True", "1", "yes", "enabled", " true", "true "]) {
    assert.equal(isNativeSpecSearchEnabled(value), false, `${String(value)} must remain disabled`);
  }
  assert.equal(isNativeSpecSearchEnabled("true"), true);
});

test("legacy spec search is allowed while the native gate is off", () => {
  const response = {status() {
    throw new Error("unexpected rejection");
  }};
  assert.equal(rejectLegacySpecSearch(response, () => false), false);
});

test("legacy spec search is fenced before side effects when native gate is on", () => {
  let status; let body;
  const response = {status(value) {
    status = value; return this;
  }, json(value) {
    body = value;
  }};
  assert.equal(rejectLegacySpecSearch(response, () => true), true);
  assert.equal(status, 410);
  assert.deepEqual(body, {success: false, error: "native_spec_search_enabled"});
});

test("public triggerSpecSearch endpoint is retired before n8n or Firestore, even while native search is gated off", async () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const start = source.indexOf("exports.triggerSpecSearch = onRequest(");
  const end = source.indexOf("// ==================== BOM STATUS DIGEST", start);
  let handler;
  let status;
  let body;
  let fetchCalls = 0;
  let firestoreCalls = 0;
  const context = {
    exports: {},
    process: {env: {BOM_NATIVE_SPEC_SEARCH_ENABLED: "false"}},
    onRequest: (value) => { handler = value; return value; },
    require: () => require("./specSearchLegacyGuard.cjs"),
    fetch: async () => { fetchCalls++; },
    admin: {firestore: () => { firestoreCalls++; return {}; }},
  };
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  const response = {
    set() { return this; },
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  };
  await handler({method: "POST", body: {bomItemId: "i1", projectId: "P", itemName: "Valve"}}, response);
  assert.equal(status, 410);
  assert.deepEqual(body, {success: false, error: "native_spec_search_enabled"});
  assert.equal(fetchCalls, 0);
  assert.equal(firestoreCalls, 0);
});
