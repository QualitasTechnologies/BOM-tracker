const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {createNativeSpecSearchOperation} = require("./nativeSpecSearchOperations.cjs");

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const receiptKey = () => createHash("sha256").update("550e8400-e29b-41d4-a716-446655440000").digest("hex");
function fixture({actor = {}, project = {}, categories = [], enabled = true, response, beforeFetch, fetchError, docs: sharedDocs, calls: sharedCalls, projectId = "P", failTransactionNumbers = [], timestamp = () => "server-time", receiptReadError = false, materializedReservationCreatedAt} = {}) {
  if (!Object.hasOwn(project, "members") && !actor.email?.toLowerCase().endsWith("@qualitastech.com") && actor.customClaims?.role !== "admin") {
    project = {...project, members: [{userId: actor.uid || "alice", categoryScope: ["Parts"]}]};
  }
  const docs = sharedDocs || new Map([
    [`projects/${projectId}`, {projectId, ...project}],
    [`projects/${projectId}/bom/data`, {categories: clone(categories)}],
  ]);
  const calls = sharedCalls || [];
  const updates = [];
  let transactionNumber = 0;
  let currentActor = actor;
  let actorError;
  let currentEnabled = enabled;
  const db = {
    collection(name) {
      return {doc(id) {
        return ref(`${name}/${id}`);
      }};
    },
    runTransaction: async (callback) => {
      transactionNumber += 1;
      if (failTransactionNumbers.includes(transactionNumber)) throw Object.assign(new Error("temporary Firestore failure"), {code: 14});
      const writes = [];
      const transaction = {
        async get(reference) {
          return snap(docs.get(reference.path));
        },
        create(reference, data) {
          const storedData = clone(data);
          if (reference.path.startsWith("pulseSpecSearchReceipts/") && data.status === "dispatching" && materializedReservationCreatedAt !== undefined) {
            storedData.created_at = materializedReservationCreatedAt;
          }
          writes.push(["create", reference.path, storedData]);
        },
        set(reference, data) {
          writes.push(["set", reference.path, clone(data)]);
        },
        update(reference, data) {
          updates.push({path: reference.path, fields: Object.keys(data)});
          writes.push(["update", reference.path, clone(data)]);
        },
      };
      const result = await callback(transaction);
      for (const [mode, path, data] of writes) {
        if (mode === "create" && docs.has(path)) throw Object.assign(new Error("already exists"), {code: 6});
        if (mode === "update" && !docs.has(path)) throw new Error("missing document");
        docs.set(path, mode === "update" ? {...docs.get(path), ...data} : data);
      }
      return result;
    },
  };
  function ref(path) {
    return {path, async get() {
      if (path.startsWith("pulseSpecSearchReceipts/") && receiptReadError) throw new Error("receipt lookup unavailable");
      return snap(docs.get(path));
    }, collection(name) {
      return {doc(id) {
        return ref(`${path}/${name}/${id}`);
      }};
    }};
  }
  function snap(data) {
    return {exists: data !== undefined, data: () => clone(data)};
  }
  const handler = createNativeSpecSearchOperation({
    db,
    resolveActor: async () => {
      if (actorError) throw actorError;
      return currentActor;
    },
    enabled: () => currentEnabled,
    getServerTimestamp: timestamp,
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      if (beforeFetch) await beforeFetch({docs, calls});
      if (fetchError) throw fetchError;
      return {ok: true, json: async () => clone(response || {success: true, specificationUrl: null})};
    },
    webhookUrl: "https://n8n.example.test/webhook/spec-search",
  });
  const call = (data = {}) => handler({auth: {uid: currentActor.uid || "alice"}, data: {project_id: projectId, item_id: "i1", operation_id: "550e8400-e29b-41d4-a716-446655440000", expected_actor_uid: currentActor.uid || "alice", ...data}});
  return {call, docs, calls, updates, setActor(nextActor) { currentActor = nextActor; }, setActorError(error) { actorError = error; }, clearActorError() { actorError = null; }, setEnabled(value) { currentEnabled = value; }};
}
const user = (uid = "alice", role = "viewer", email = "alice@partner.example") => ({uid, email, disabled: false, customClaims: {role, status: "approved"}});
const component = {id: "i1", name: "Valve", make: "Acme", sku: "V-1", itemType: "component", specificationUrl: null};

test("approved admin, internal member and viewer can search; external members need category scope", async () => {
  for (const actor of [user("admin", "admin"), user("internal", "viewer", "internal@qualitastech.com"), user()]) {
    const f = fixture({actor, project: {memberIds: [actor.uid]}, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call({expected_actor_uid: actor.uid})).ok, true);
  }
  const scoped = fixture({actor: user(), project: {memberIds: ["alice"], members: [{userId: "alice", categoryScope: ["Parts"]}]}, categories: [{name: "Parts", items: [component]}]});
  assert.equal((await scoped.call()).ok, true);
  for (const categoryScope of [[], ["Other"], undefined]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"], members: [{userId: "alice", categoryScope}]}, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call()).error, "spec_search_forbidden");
  }
});

test("project access permits explicit null legacy fallback but rejects missing memberIds and non-members", async () => {
  for (const project of [{memberIds: null}, {memberIds: ["alice"]}]) {
    const f = fixture({actor: user(), project, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call()).ok, true);
  }
  for (const project of [{}, {memberIds: []}]) {
    const f = fixture({actor: user(), project, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call()).error, "spec_search_forbidden");
  }
});

test("server derives search metadata and rejects caller-supplied item or webhook fields", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}]});
  assert.equal((await f.call()).ok, true);
  assert.deepEqual(f.calls[0], {searchId: "550e8400-e29b-41d4-a716-446655440000", projectId: "P", bomItemId: "i1", itemName: "Valve", make: "Acme", sku: "V-1", category: "Parts"});
  assert.equal((await f.call({name: "Forged"})).error, "invalid_spec_search_request");
});

test("missing, duplicate and service items are rejected without n8n dispatch", async () => {
  for (const categories of [[], [{name: "Parts", items: [component, component]}], [{name: "Services", items: [{...component, itemType: "service"}]}]]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories});
    assert.notEqual((await f.call()).ok, true);
    assert.equal(f.calls.length, 0);
  }
});

test("pre-dispatch missing project or item is distinguishable from a completed search with no result", async () => {
  const missingProject = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], projectId: "missing", docs: new Map()});
  assert.equal((await missingProject.call()).state, "project_not_found");
  assert.equal(missingProject.calls.length, 0);

  const missingItem = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: []}]});
  assert.equal((await missingItem.call()).state, "item_not_found");
  assert.equal(missingItem.calls.length, 0);

  const noSearchResult = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true}});
  assert.equal((await noSearchResult.call()).state, "not_found");
  assert.equal((await noSearchResult.call()).state, "not_found");
  assert.equal(noSearchResult.calls.length, 1);
});

test("same operation replay is saved and changed input conflicts without another dispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}});
  const first = await f.call();
  assert.equal(first.ok, true);
  assert.equal((await f.call()).specificationUrl, "https://docs.example.com/spec.pdf");
  assert.equal((await f.call({item_id: "other"})).error, "operation_conflict");
  assert.equal(f.calls.length, 1);
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, "https://docs.example.com/spec.pdf");
  assert.equal(f.docs.get(`pulseSpecSearchAudit/${receiptKey()}`).outcome, "completed");
  assert.deepEqual(f.updates, [{path: "projects/P/bom/data", fields: ["categories"]}]);
  assert.equal(f.docs.get("projects/P/bom/data").updatedAt, undefined);
});

test("operation IDs conflict globally when reused by another project or actor", async () => {
  const first = fixture({actor: user(), project: {memberIds: ["alice"], members: [{userId: "alice", categoryScope: ["Parts"]}]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}});
  assert.equal((await first.call()).state, "completed");
  first.docs.set("projects/Q", {projectId: "Q", memberIds: ["alice"], members: [{userId: "alice", categoryScope: ["Parts"]}]});
  first.docs.set("projects/Q/bom/data", {categories: [{name: "Parts", items: [component]}]});
  const otherProject = fixture({actor: user(), projectId: "Q", docs: first.docs, response: {success: true}});
  assert.equal((await otherProject.call()).error, "operation_conflict");
  const currentProject = first.docs.get("projects/P");
  currentProject.memberIds.push("bob");
  currentProject.members.push({userId: "bob", categoryScope: ["Parts"]});
  const otherActor = fixture({actor: user("bob"), docs: first.docs, response: {success: true}});
  assert.equal((await otherActor.call()).error, "operation_conflict");
  assert.equal(first.calls.length, 1);
  assert.equal(otherProject.calls.length, 0);
  assert.equal(otherActor.calls.length, 0);
});

test("a completed search without a link returns and replays not_found", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true}});
  const result = await f.call();
  assert.equal(result.state, "not_found");
  assert.equal(result.ok, true);
  assert.equal((await f.call()).state, "not_found");
  assert.equal(f.calls.length, 1);
  assert.equal(f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).state, "not_found");
  assert.equal(f.docs.get(`pulseSpecSearchAudit/${receiptKey()}`).outcome, "not_found");
});

test("only valid public HTTPS URLs are stored", async () => {
  for (const specificationUrl of ["http://docs.example.com/a", "https://user:pass@docs.example.com/a", "https://@docs.example.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a"]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl}});
    const first = await f.call();
    const replay = await f.call();
    assert.equal(first.error, "invalid_specification_url");
    assert.deepEqual(replay, first);
    assert.equal(f.calls.length, 1);
    assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
  }
});

test("n8n failures and timeouts remain unresolved and never automatically retry", async () => {
  for (const fetchError of [new Error("workflow rejected"), Object.assign(new Error("timeout"), {name: "AbortError"})]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError});
    assert.equal((await f.call()).state, "outcome_unknown");
    assert.equal((await f.call()).state, "outcome_unknown");
    assert.equal(f.calls.length, 1);
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).status, "unresolved");
  }
});

test("replays preserve unresolved operation IDs through auth failures, flag-off, revoked access, and uncertain receipt reads", async () => {
  for (const {status, receiptState} of [{status: 401, receiptState: "dispatching"}, {status: 503, receiptState: "unresolved"}]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("n8n timeout")});
    assert.equal((await f.call()).state, "outcome_unknown");
    const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
    receipt.status = receiptState;
    receipt.state = receiptState === "dispatching" ? undefined : "outcome_unknown";
    f.setActorError(Object.assign(new Error("auth unavailable"), {status, code: status === 401 ? "unauthenticated" : "unavailable"}));
    const result = await f.call();
    assert.deepEqual(result, {ok: false, state: "outcome_unknown", operation_id: "550e8400-e29b-41d4-a716-446655440000", error: "spec_search_unresolved"});
    assert.equal(f.calls.length, 1);
  }

  const flagOff = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("n8n timeout")});
  assert.equal((await flagOff.call()).state, "outcome_unknown");
  flagOff.setEnabled(false);
  assert.equal((await flagOff.call()).state, "outcome_unknown");
  assert.equal(flagOff.calls.length, 1);

  const revoked = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("n8n timeout")});
  assert.equal((await revoked.call()).state, "outcome_unknown");
  revoked.docs.get("projects/P").memberIds = [];
  assert.equal((await revoked.call()).state, "outcome_unknown");
  assert.equal(revoked.calls.length, 1);

  const uncheckable = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], receiptReadError: true});
  uncheckable.setActorError(Object.assign(new Error("auth unavailable"), {status: 503}));
  const uncertain = await uncheckable.call();
  assert.equal(uncertain.state, "outcome_unknown");
  assert.deepEqual(Object.keys(uncertain).sort(), ["error", "ok", "operation_id", "state"]);
  assert.equal(uncheckable.calls.length, 0);

  const noReceipt = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}]});
  noReceipt.setActorError(Object.assign(new Error("not signed in"), {status: 401, code: "unauthenticated"}));
  const rejected = await noReceipt.call();
  assert.deepEqual(rejected, {ok: false, state: "failed", operation_id: "550e8400-e29b-41d4-a716-446655440000", error: "unauthenticated"});
  assert.equal(noReceipt.calls.length, 0);
});

test("dispatch-failure finalization preserves the receipt creation timestamp", async () => {
  const serverTimestamp = {serverTimestamp: true};
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("n8n timeout"), timestamp: () => serverTimestamp, materializedReservationCreatedAt: "persisted-reservation-created-at"});
  await f.call();
  const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  assert.equal(receipt.created_at, "persisted-reservation-created-at");
});

test("failure to persist a post-dispatch error remains unknown and never invites redispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("network reset after dispatch"), failTransactionNumbers: [2]});
  const first = await f.call();
  assert.equal(first.state, "outcome_unknown");
  assert.equal(first.error, "spec_search_unresolved");
  assert.equal(first.ok, false);
  assert.equal((await f.call()).state, "outcome_unknown");
  assert.equal(f.calls.length, 1);
});

test("transient finalization failure is stored as outcome_unknown and replay does not redispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, failTransactionNumbers: [2]});
  const first = await f.call();
  assert.equal(first.state, "outcome_unknown");
  assert.equal(first.error, "spec_search_unresolved");
  const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  assert.equal(receipt.status, "unresolved");
  assert.equal(receipt.state, "outcome_unknown");
  assert.equal(receipt.outcome, "outcome_unknown");
  assert.equal(f.docs.get(`pulseSpecSearchAudit/${receiptKey()}`).outcome, "outcome_unknown");
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
  const replay = await f.call();
  assert.deepEqual(replay, first);
  assert.equal(f.calls.length, 1);
});

test("failed persistence of a known conflict returns unknown and replays without redispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    docs.get("projects/P/bom/data").categories[0].items[0].make = "Changed during search";
  }, failTransactionNumbers: [3]});
  const first = await f.call();
  assert.equal(first.state, "outcome_unknown");
  assert.equal(first.error, "spec_search_unresolved");
  const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  assert.equal(receipt.status, "dispatching");
  assert.equal(receipt.state, undefined);
  assert.equal(receipt.outcome, undefined);
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
  const replay = await f.call();
  assert.equal(replay.state, "outcome_unknown");
  assert.equal(replay.operation_id, first.operation_id);
  assert.equal(f.calls.length, 1);
});

test("target identity edits conflict while unrelated edits made during search survive", async () => {
  const make = (f) => async () => {
    const bom = f.docs.get("projects/P/bom/data");
    bom.categories[0].items[0].notes = "changed";
    bom.updatedBy = "other editor";
  };
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}});
  await make(f)();
  const f2 = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    const bom = docs.get("projects/P/bom/data"); bom.categories[0].items[0].notes = "changed"; bom.updatedBy = "other editor";
  }});
  assert.equal((await f2.call()).ok, true);
  assert.equal(f2.docs.get("projects/P/bom/data").categories[0].items[0].notes, "changed");
  assert.equal(f2.docs.get("projects/P/bom/data").updatedBy, "other editor");
  const f3 = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    docs.get("projects/P/bom/data").categories[0].items[0].make = "Different";
  }});
  assert.equal((await f3.call()).error, "spec_search_conflict");
  assert.equal(f3.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
  const f4 = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl = "https://other.example.com/spec.pdf";
  }});
  assert.equal((await f4.call()).state, "conflict");
  assert.equal(f4.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, "https://other.example.com/spec.pdf");
  assert.equal(f4.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).state, "conflict");
});

test("replay rechecks current project and component-category access before returning a receipt", async () => {
  for (const revoke of [
    (project) => { project.memberIds = []; },
    (_project, bom) => { bom.categories[0].items[0].itemType = "service"; },
    (project) => { project.members[0].categoryScope = []; },
    (_project, bom) => { bom.categories[0].items.push({...component}); },
  ]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"], members: [{userId: "alice", categoryScope: ["Parts"]}]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}});
    assert.equal((await f.call()).state, "completed");
    revoke(f.docs.get("projects/P"), f.docs.get("projects/P/bom/data"));
    assert.notEqual((await f.call()).state, "completed");
    assert.equal(f.calls.length, 1);
  }
});

test("membership or category-scope revocation during n8n dispatch blocks the final URL write", async () => {
  for (const revoke of [
    (project) => { project.memberIds = []; },
    (project) => { project.members[0].categoryScope = []; },
  ]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"], members: [{userId: "alice", categoryScope: ["Parts"]}]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
      revoke(docs.get("projects/P"));
    }});
    const result = await f.call();
    assert.equal(result.state, "failed");
    assert.equal(result.error, "spec_search_forbidden");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.updates, []);
    assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
    const key = receiptKey();
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${key}`).state, "failed");
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${key}`).specification_url, undefined);
    assert.equal(f.docs.get(`pulseSpecSearchAudit/${key}`).outcome, "failed");
    assert.equal(f.docs.get(`pulseSpecSearchAudit/${key}`).after_specification_url, null);
  }
});

test("disabled actors and the default-off gate are rejected", async () => {
  const f = fixture({actor: {...user(), disabled: true}, project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}]});
  assert.equal((await f.call()).error, "actor_forbidden");
  const g = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], enabled: false});
  assert.equal((await g.call()).error, "spec_search_disabled");
  assert.equal(g.calls.length, 0);
});
