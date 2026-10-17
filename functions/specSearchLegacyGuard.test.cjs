const test = require("node:test");
const assert = require("node:assert/strict");
const {rejectLegacySpecSearch} = require("./specSearchLegacyGuard.cjs");

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
