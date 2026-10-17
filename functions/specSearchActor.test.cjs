const test = require("node:test");
const assert = require("node:assert/strict");
const {resolveSpecSearchActor} = require("./specSearchActor.cjs");

const validUser = overrides => ({
  uid: "user-1",
  disabled: false,
  customClaims: {status: "approved", role: "user"},
  tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  ...overrides,
});

const request = ({uid = "user-1", authorization = "Bearer good-token"} = {}) => ({
  auth: {uid},
  rawRequest: {get: name => name === "Authorization" ? authorization : undefined},
});

const makeAuth = ({token = {uid: "user-1", auth_time: 1_800_000_000}, user = validUser(), verifyError, userError} = {}) => ({
  verifyIdToken: async (...args) => {
    makeAuth.lastVerifyArgs = args;
    if (verifyError) throw verifyError;
    return token;
  },
  getUser: async () => {
    if (userError) throw userError;
    return user;
  },
});

const rejection = (promise, code, status) => assert.rejects(promise, error => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
});

test("accepts only the verified bearer token matching the callable uid", async () => {
  const actor = validUser();
  assert.equal(await resolveSpecSearchActor({request: request(), auth: makeAuth({user: actor})}), actor);
  assert.deepEqual(makeAuth.lastVerifyArgs, ["good-token", true]);
  await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({token: {uid: "other", auth_time: 1_800_000_000}})}), "actor_forbidden", 403);
  await rejection(resolveSpecSearchActor({request: request({uid: ""}), auth: makeAuth()}), "actor_authentication_required", 401);
  await rejection(resolveSpecSearchActor({request: request({authorization: null}), auth: makeAuth()}), "actor_authentication_required", 401);
  await rejection(resolveSpecSearchActor({request: request({authorization: "Basic good-token"}), auth: makeAuth()}), "actor_authentication_required", 401);
  await rejection(resolveSpecSearchActor({request: request({authorization: "Bearer bad-token"}), auth: makeAuth({verifyError: new Error("invalid token")})}), "actor_authentication_required", 401);
});

test("rejects tenant-scoped verified tokens", async () => {
  await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({token: {uid: "user-1", auth_time: 1_800_000_000, firebase: {tenant: "tenant-1"}}})}), "actor_forbidden", 403);
});

test("rejects disabled, unapproved, and unsupported-role accounts", async () => {
  for (const user of [
    validUser({disabled: true}),
    validUser({customClaims: {status: "pending", role: "user"}}),
    validUser({customClaims: {status: "approved", role: "owner"}}),
  ]) {
    await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({user})}), "actor_forbidden", 403);
  }
});

test("rejects tokens issued before the account revocation time", async () => {
  const token = {uid: "user-1", auth_time: Date.parse("2024-01-01T00:00:00.000Z") / 1000};
  const user = validUser({tokensValidAfterTime: "2025-01-01T00:00:00.000Z"});
  await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({token, user})}), "actor_forbidden", 403);
});

test("maps a missing Firebase user to forbidden and provider errors to unavailable", async () => {
  await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({userError: Object.assign(new Error("missing"), {code: "auth/user-not-found"})})}), "actor_forbidden", 403);
  await rejection(resolveSpecSearchActor({request: request(), auth: makeAuth({userError: Object.assign(new Error("offline"), {code: "auth/internal-error"})})}), "identity_provider_unavailable", 503);
});
