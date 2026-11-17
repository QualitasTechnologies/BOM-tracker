const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {createNativeSpecSearchOperation} = require("./nativeSpecSearchOperations.cjs");
const {isNativeSpecSearchEnabled} = require("./specSearchLegacyGuard.cjs");

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const receiptKey = () => createHash("sha256").update("550e8400-e29b-41d4-a716-446655440000").digest("hex");
const itemLockKey = (projectId = "P", itemId = "i1") => createHash("sha256").update(JSON.stringify([projectId, itemId])).digest("hex");
function fixture({actor = {}, project = {}, categories = [], enabled = "true", response, fetchResponse, jsonError, beforeFetch, beforeReceiptRead, fetchError, docs: sharedDocs, calls: sharedCalls, projectId = "P", failTransactionNumbers = [], loseReplyTransactionNumbers = [], transactionError = () => Object.assign(new Error("temporary Firestore failure"), {code:14}), lostReplyError = () => Object.assign(new Error("commit reply lost"), {code:14}), timestamp = () => "server-time", receiptReadError = false, materializedReservationCreatedAt, responseTimeoutMs, webhookUrl = "https://n8n.example.test/webhook/spec-search"} = {}) {
  if (!Object.hasOwn(project, "members") && !actor.email?.toLowerCase().endsWith("@qualitastech.com") && actor.customClaims?.role !== "admin") {
    project = {...project, members: [{userId: actor.uid || "alice", categoryScope: ["Parts"]}]};
  }
  const docs = sharedDocs || new Map([
    [`pulseMaterialCutovers/${projectId}`, {fence: "legacy_bom_data_writes", version: 1}],
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
      if (failTransactionNumbers.includes(transactionNumber)) throw transactionError();
      const writes = [];
      const transaction = {
        async get(reference) {
          if (reference.path.startsWith("pulseSpecSearchReceipts/") && beforeReceiptRead) await beforeReceiptRead();
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
        delete(reference) {
          writes.push(["delete", reference.path]);
        },
      };
      const result = await callback(transaction);
      for (const [mode, path, data] of writes) {
        if (mode === "create" && docs.has(path)) throw Object.assign(new Error("already exists"), {code: 6});
        if (mode === "update" && !docs.has(path)) throw new Error("missing document");
        if (mode === "delete") docs.delete(path);
        else docs.set(path, mode === "update" ? {...docs.get(path), ...data} : data);
      }
      if (loseReplyTransactionNumbers.includes(transactionNumber)) throw lostReplyError();
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
    enabled: () => isNativeSpecSearchEnabled(currentEnabled),
    getServerTimestamp: timestamp,
    responseTimeoutMs,
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      if (beforeFetch) await beforeFetch({docs, calls});
      if (fetchError) throw fetchError;
      if (fetchResponse) return {...fetchResponse, json: jsonError ? async () => { throw jsonError; } : fetchResponse.json};
      return {ok: true, json: async () => clone(response || {success: true, specificationUrl: null})};
    },
    webhookUrl,
  });
  const call = (data = {}) => handler({auth: {uid: currentActor.uid || "alice"}, data: {project_id: projectId, item_id: "i1", operation_id: "550e8400-e29b-41d4-a716-446655440000", expected_actor_uid: currentActor.uid || "alice", ...data}});
  return {call, docs, calls, updates, transactionCount: () => transactionNumber, setActor(nextActor) { currentActor = nextActor; }, setActorError(error) { actorError = error; }, clearActorError() { actorError = null; }, setEnabled(value) { currentEnabled = value; }};
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

test("project access preserves explicit-null legacy membership and denies absent, malformed or empty membership", async () => {
  for (const project of [{memberIds: null}, {memberIds: ["alice"]}]) {
    const f = fixture({actor: user(), project, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call()).ok, true);
  }
  for (const project of [{}, {memberIds: []}, {memberIds: {alice: true}}]) {
    const f = fixture({actor: user(), project, categories: [{name: "Parts", items: [component]}]});
    assert.equal((await f.call()).error, "spec_search_forbidden");
  }
  const admin = fixture({actor: user("admin", "admin"), project: {memberIds: []}, categories: [{name: "Parts", items: [component]}]});
  assert.equal((await admin.call()).ok, true);
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
  assert.equal(f.docs.has(`pulseSpecSearchLocks/${itemLockKey()}`), false);
  assert.deepEqual(f.updates, [{path: "projects/P/bom/data", fields: ["categories"]}]);
  assert.equal(f.docs.get("projects/P/bom/data").updatedAt, undefined);
});

test("a new browser session cannot redispatch an unresolved project-item search", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("network timeout")});
  const first = await f.call();
  assert.equal(first.state, "outcome_unknown");

  const second = await f.call({operation_id: "550e8400-e29b-41d4-a716-446655440001"});
  assert.equal(second.state, "outcome_unknown");
  assert.equal(second.operation_id, first.operation_id);
  assert.equal(second.reused_operation, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.docs.get(`pulseSpecSearchLocks/${itemLockKey()}`).operation_id, first.operation_id);
});

test("a different authorized actor cannot inspect or redispatch another actor's unresolved item search", async () => {
  const f = fixture({actor: user("alice"), project: {memberIds: ["alice", "bob"], members: [
    {userId: "alice", categoryScope: ["Parts"]}, {userId: "bob", categoryScope: ["Parts"]},
  ]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("network timeout")});
  const first = await f.call();
  f.setActor(user("bob"));

  const second = await f.call({operation_id: "550e8400-e29b-41d4-a716-446655440001", expected_actor_uid: "bob"});
  assert.equal(first.state, "outcome_unknown");
  assert.equal(second.state, "outcome_unknown");
  assert.equal(second.operation_id, "550e8400-e29b-41d4-a716-446655440001");
  assert.equal(second.reused_operation, undefined);
  assert.equal(f.calls.length, 1);
});

test("a stale or mismatched item lock never returns a receipt that does not match its actor and item", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], fetchError: new Error("network timeout")});
  const first = await f.call();
  const savedReceipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  f.docs.set(`pulseSpecSearchReceipts/${receiptKey()}`, {...savedReceipt, item_id: "another-item"});

  const second = await f.call({operation_id: "550e8400-e29b-41d4-a716-446655440001"});
  assert.equal(first.state, "outcome_unknown");
  assert.equal(second.state, "outcome_unknown");
  assert.equal(second.operation_id, "550e8400-e29b-41d4-a716-446655440001");
  assert.equal(second.reused_operation, undefined);
  assert.equal(f.calls.length, 1);
});

test("a second operation ID cannot dispatch while the first item search is still running", async () => {
  let markDispatchStarted;
  let releaseDispatch;
  const dispatchStarted = new Promise((resolve) => { markDispatchStarted = resolve; });
  const waitForDispatch = new Promise((resolve) => { releaseDispatch = resolve; });
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], beforeFetch: async () => {
    markDispatchStarted();
    await waitForDispatch;
  }});
  const firstPending = f.call();
  await dispatchStarted;

  const second = await f.call({operation_id: "550e8400-e29b-41d4-a716-446655440001"});
  assert.equal(second.state, "outcome_unknown");
  assert.equal(second.operation_id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(second.reused_operation, true);
  assert.equal(f.calls.length, 1);
  releaseDispatch();
  assert.equal((await firstPending).state, "not_found");
});

test("UUID casing does not create a second operation receipt or n8n dispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}});
  const upper = await f.call({operation_id: "550E8400-E29B-41D4-A716-446655440000"});
  const lower = await f.call();
  assert.equal(upper.state, "completed");
  assert.equal(lower.state, "completed");
  assert.equal(f.calls.length, 1);
  assert.equal(upper.operation_id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal([...f.docs.keys()].filter((key) => key.startsWith("pulseSpecSearchReceipts/")).length, 1);
  assert.equal(f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).operation_id, "550e8400-e29b-41d4-a716-446655440000");
});

test("two concurrent calls with the same operation ID dispatch once and share one receipt", async () => {
  let receiptReads = 0;
  let releaseReceiptReads;
  const bothReadEmpty = new Promise((resolve) => { releaseReceiptReads = resolve; });
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeReceiptRead: async () => {
    receiptReads += 1;
    if (receiptReads === 2) releaseReceiptReads();
    if (receiptReads <= 2) await bothReadEmpty;
  }});
  const [first, second] = await Promise.all([f.call(), f.call()]);
  assert.equal(f.calls.length, 1);
  assert.ok(["completed", "outcome_unknown"].includes(first.state));
  assert.ok(["completed", "outcome_unknown"].includes(second.state));
  const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  assert.equal(receipt.operation_id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.specification_url, "https://docs.example.com/spec.pdf");
  assert.equal(f.docs.get(`pulseSpecSearchAudit/${receiptKey()}`).outcome, "completed");
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, "https://docs.example.com/spec.pdf");
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
    assert.equal(f.docs.has(`pulseSpecSearchLocks/${itemLockKey()}`), false);
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

test("non-OK n8n responses and malformed JSON stay unknown and replay without another dispatch", async () => {
  const cases = [
    {fetchResponse: {ok: false, json: async () => ({success: true})}},
    {fetchResponse: {ok: true, json: async () => ({})}, jsonError: new SyntaxError("invalid JSON")},
  ];
  for (const options of cases) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], ...options});
    const first = await f.call();
    assert.equal(first.state, "outcome_unknown");
    assert.equal(first.operation_id, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).state, "outcome_unknown");
    assert.deepEqual(await f.call(), first);
    assert.equal(f.calls.length, 1);
    assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
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
  assert.equal(replay.state, "completed");
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, "https://docs.example.com/spec.pdf");
  assert.equal(f.docs.get(`pulseSpecSearchAudit/${receiptKey()}`).outcome, "outcome_unknown");
  assert.equal(f.calls.length, 1);
});

test("failed persistence of a known conflict returns unknown and replays without redispatch", async () => {
  const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    docs.get("projects/P/bom/data").categories[0].items[0].make = "Changed during search";
  }, failTransactionNumbers: [4]});
  const first = await f.call();
  assert.equal(first.state, "outcome_unknown");
  assert.equal(first.error, "spec_search_unresolved");
  const receipt = f.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`);
  assert.equal(receipt.status, "dispatching");
  assert.equal(receipt.state, undefined);
  assert.equal(receipt.outcome, undefined);
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
  const replay = await f.call();
  assert.equal(replay.state, "conflict");
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].make, "Changed during search");
  assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
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
  assert.equal(f3.docs.has(`pulseSpecSearchLocks/${itemLockKey()}`), false);
  const f4 = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], response: {success: true, specificationUrl: "https://docs.example.com/spec.pdf"}, beforeFetch: async ({docs}) => {
    docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl = "https://other.example.com/spec.pdf";
  }});
  assert.equal((await f4.call()).state, "conflict");
  assert.equal(f4.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, "https://other.example.com/spec.pdf");
  assert.equal(f4.docs.get(`pulseSpecSearchReceipts/${receiptKey()}`).state, "conflict");
  assert.equal(f4.docs.has(`pulseSpecSearchLocks/${itemLockKey()}`), false);
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
    assert.equal(result.state, "outcome_unknown");
    assert.equal(result.error, "spec_search_unresolved");
    assert.equal(f.calls.length, 1);
    assert.equal(f.docs.has(`pulseSpecSearchLocks/${itemLockKey()}`), true);
    assert.deepEqual(f.updates, []);
    assert.equal(f.docs.get("projects/P/bom/data").categories[0].items[0].specificationUrl, null);
    const key = receiptKey();
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${key}`).state, "outcome_unknown");
    assert.equal(f.docs.get(`pulseSpecSearchReceipts/${key}`).specification_url, undefined);
    assert.equal(f.docs.get(`pulseSpecSearchAudit/${key}`).outcome, "outcome_unknown");
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

test("callable gate enables only for the exact literal true and otherwise stays off", async () => {
  for (const value of [undefined, null, false, "TRUE", "True", "1", "yes", "enabled", " true", "true "]) {
    const f = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}]});
    f.setEnabled(value);
    assert.equal((await f.call()).error, "spec_search_disabled", `${String(value)} must remain disabled`);
    assert.equal(f.calls.length, 0);
  }
  const enabled = fixture({actor: user(), project: {memberIds: ["alice"]}, categories: [{name: "Parts", items: [component]}], enabled: "true"});
  assert.equal((await enabled.call()).state, "not_found");
  assert.equal(enabled.calls.length, 1);
});


test('new searches require the exact native material owner and writable global mode', async()=>{
 for(const owner of [undefined,{}, {fence:'legacy_bom_data_writes',version:'1'}]){
  const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}]});
  if(owner===undefined)f.docs.delete('pulseMaterialCutovers/P');else f.docs.set('pulseMaterialCutovers/P',owner);
  assert.equal((await f.call()).error,'material_read_only');assert.equal(f.calls.length,0);
 }
 for(const mode of ['read_only','unknown',null]){
  const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}]});f.docs.set('pulseRuntimeControl/cutover',{mode});
  assert.equal((await f.call()).error,'material_read_only');assert.equal(f.calls.length,0);
 }
 const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}]});f.docs.set('pulseRuntimeControl/cutover',{mode:'pulse_only'});assert.equal((await f.call()).state,'not_found');
});

test('accepted provider results survive pause, owner loss or current actor revocation without changing the BOM',async()=>{
 const changes=[f=>f.setEnabled('false'),f=>f.docs.delete('pulseMaterialCutovers/P'),f=>f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'}),f=>f.setActor({...user(),disabled:true}),f=>f.setActor({...user(),customClaims:{role:'owner',status:'approved'}})];
 for(const change of changes){
  let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>change(f)});
  const result=await f.call();assert.equal(result.state,'outcome_unknown');assert.equal(f.calls.length,1);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,null);
  const receipt=f.docs.get('pulseSpecSearchReceipts/'+receiptKey());assert.equal(receipt.provider_specification_url,'https://docs.example.com/spec.pdf');assert.equal(receipt.provider_outcome,'completed');
  assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.calls.length,1);
 }
});

test('a completed result is recoverable while new writes are paused or ownership has moved',async()=>{
 const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'}});
 const saved=await f.call();assert.equal(saved.state,'completed');f.setEnabled('false');f.docs.delete('pulseMaterialCutovers/P');f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 assert.deepEqual(await f.call(),saved);assert.equal(f.calls.length,1);
});

test('both a stalled dispatch and a stalled response body are bounded and retain one unresolved operation',async()=>{
 for(const stalled of [{beforeFetch:async()=>new Promise(()=>{})},{fetchResponse:{ok:true,json:async()=>new Promise(()=>{})}}]){
  const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],responseTimeoutMs:10,...stalled});
  assert.equal((await f.call()).state,'outcome_unknown');assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.calls.length,1);
 }
});

test('an identical URL linked concurrently settles the accepted result without erasing unrelated edits',async()=>{
 const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async({docs})=>{const item=docs.get('projects/P/bom/data').categories[0].items[0];item.specificationUrl='https://docs.example.com/spec.pdf';item.notes='Concurrent note';}});
 assert.equal((await f.call()).state,'completed');assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].notes,'Concurrent note');assert.equal(f.calls.length,1);
});

test('account revocation while reservation data is being read prevents any external dispatch',async()=>{
 let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],beforeReceiptRead:async()=>f.setActor({...user(),disabled:true})});
 const result=await f.call();assert.equal(result.error,'actor_forbidden');assert.equal(f.calls.length,0);assert.equal(f.docs.has('pulseSpecSearchReceipts/'+receiptKey()),false);
});


test('known accepted result settles after a pause with no second provider request and preserves the original audit',async()=>{
 let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>f.setEnabled('false')});
 assert.equal((await f.call()).state,'outcome_unknown');const audit=clone(f.docs.get('pulseSpecSearchAudit/'+receiptKey()));
 f.setEnabled('true');const result=await f.call();assert.equal(result.state,'completed');assert.equal(f.calls.length,1);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,'https://docs.example.com/spec.pdf');assert.deepEqual(f.docs.get('pulseSpecSearchAudit/'+receiptKey()),audit);
 assert.equal(f.docs.get('pulseSpecSearchAudit/'+receiptKey()+'/reconciliations/accepted_result').outcome,'completed');assert.equal(f.docs.has('pulseSpecSearchLocks/'+itemLockKey()),false);
 assert.deepEqual(await f.call(),result);assert.equal(f.calls.length,1);
});

test('membership or category revocation retains accepted-result ownership so restoration and a new browser cannot redispatch',async()=>{
 for(const revoke of [project=>{project.memberIds=[];},project=>{project.members[0].categoryScope=[];}]){
  let once=true;const f=fixture({actor:user(),project:{memberIds:['alice'],members:[{userId:'alice',categoryScope:['Parts']}]},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async({docs})=>{if(once){once=false;revoke(docs.get('projects/P'));}}});
  const first=await f.call();assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,null);assert.equal(f.calls.length,1);
  Object.assign(f.docs.get('projects/P'),{memberIds:['alice'],members:[{userId:'alice',categoryScope:['Parts']}]});
  const adopted=await f.call({operation_id:'78d77e2d-24f8-4d16-918a-397eb24e5a85'});assert.equal(f.calls.length,1);assert.equal(first.state,'outcome_unknown');assert.equal(adopted.reused_operation,true);assert.equal(adopted.state,'outcome_unknown');assert.equal(adopted.operation_id,'550e8400-e29b-41d4-a716-446655440000');
  assert.equal((await f.call()).state,'completed');assert.equal(f.calls.length,1);
 }
});


test('searched provenance is durable before dispatch and cannot be inferred for old or incomplete accepted receipts',async()=>{
 for(const remove of [receipt=>{delete receipt.searched_item_snapshot;},receipt=>{receipt.searched_item_snapshot_version=0;},receipt=>{delete receipt.provider_outcome;},receipt=>{receipt.provider_specification_url='http://localhost/private';}]){
  let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>{
   const reserved=f.docs.get('pulseSpecSearchReceipts/'+receiptKey());assert.equal(reserved.searched_item_snapshot_version,2);assert.equal(reserved.searched_item_snapshot.id,'i1');assert.equal(reserved.searched_item_snapshot.name,component.name);f.setEnabled('false');
  }});assert.equal((await f.call()).state,'outcome_unknown');f.setEnabled('true');assert.equal(f.docs.get('pulseSpecSearchReceipts/'+receiptKey()).provider_outcome,'completed');remove(f.docs.get('pulseSpecSearchReceipts/'+receiptKey()));const before=clone([...f.docs]);
  assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.calls.length,1);assert.deepEqual([...f.docs],before);
 }
});

test('known results remain paused until the current owner, global mode and write gates are restored',async()=>{
 for(const change of [f=>f.setEnabled('false'),f=>f.docs.delete('pulseMaterialCutovers/P'),f=>f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'})]){
  let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>change(f)});assert.equal((await f.call()).state,'outcome_unknown');const before=clone([...f.docs]);assert.equal((await f.call()).state,'outcome_unknown');assert.deepEqual([...f.docs],before);
  f.setEnabled('true');f.docs.set('pulseMaterialCutovers/P',{fence:'legacy_bom_data_writes',version:1});f.docs.set('pulseRuntimeControl/cutover',{mode:'pulse_only'});assert.equal((await f.call()).state,'completed');assert.equal(f.calls.length,1);
 }
});

test('a known no-result outcome settles without clearing a previously linked specification',async()=>{
 let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[{...component,specificationUrl:'https://docs.example.com/previous.pdf'}]}],response:{success:true,specificationUrl:null},beforeFetch:async()=>f.setEnabled('false')});assert.equal((await f.call()).state,'outcome_unknown');f.setEnabled('true');const result=await f.call();assert.equal(result.state,'not_found');assert.equal(result.ok,true);assert.equal(f.calls.length,1);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,'https://docs.example.com/previous.pdf');
});

test('recovery preserves later unrelated edits and refuses to overwrite changed search identity or a different URL',async()=>{
 for(const change of [item=>{item.quantity=9;item.notes={kept:true};},item=>{item.name='Changed';},item=>{item.make='Changed';},item=>{item.sku='Changed';},item=>{item.specificationUrl='https://other.example.com/spec.pdf';}]){
  let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>f.setEnabled('false')});await f.call();f.setEnabled('true');const item=f.docs.get('projects/P/bom/data').categories[0].items[0];change(item);const before=clone(item);const result=await f.call();assert.equal(f.calls.length,1);
  if(before.quantity===9){assert.equal(result.state,'completed');assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].quantity,9);assert.deepEqual(f.docs.get('projects/P/bom/data').categories[0].items[0].notes,{kept:true});}
  else {assert.equal(result.state,'conflict');assert.deepEqual(f.docs.get('projects/P/bom/data').categories[0].items[0],before);assert.equal(f.docs.get('pulseSpecSearchAudit/'+receiptKey()).outcome,'outcome_unknown');assert.equal(f.docs.get('pulseSpecSearchAudit/'+receiptKey()+'/reconciliations/accepted_result').outcome,'conflict');}
 }
});

test('current actor revocation during recovery reservation reads prevents settlement and preserves the accepted result',async()=>{
 let f,armed=false,reads=0;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>f.setEnabled('false'),beforeReceiptRead:async()=>{if(armed&&++reads===2)f.setActor({...user(),disabled:true});}});await f.call();f.setEnabled('true');armed=true;const before=clone([...f.docs]);assert.equal((await f.call()).state,'outcome_unknown');assert.deepEqual([...f.docs],before);assert.equal(f.calls.length,1);
});

test('a lost recovery commit reply resolves the same durable result with one reconciliation and no second dispatch',async()=>{
 let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>f.setEnabled('false'),loseReplyTransactionNumbers:[6]});await f.call();f.setEnabled('true');assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.docs.get('pulseSpecSearchReceipts/'+receiptKey()).state,'completed');assert.equal((await f.call()).state,'completed');assert.equal(f.calls.length,1);assert.equal([...f.docs.keys()].filter(key=>key.includes('/reconciliations/')).length,1);
});


test('a changed receipt identity cannot receive the original provider result or finalization metadata',async()=>{
 const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async({docs})=>{docs.get('pulseSpecSearchReceipts/'+receiptKey()).actor_uid='different-actor';}});
 assert.equal((await f.call()).state,'outcome_unknown');const receipt=f.docs.get('pulseSpecSearchReceipts/'+receiptKey());assert.equal(receipt.actor_uid,'different-actor');assert.equal(receipt.provider_outcome,undefined);assert.equal(receipt.state,undefined);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,null);assert.equal(f.calls.length,1);
});


test('receipt recovery does not depend on current provider endpoint configuration while new dispatch still validates it',async()=>{
 for(const paused of [false,true]){
  let f;f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},beforeFetch:async()=>{if(paused)f.setEnabled('false');}});await f.call();
  const reloaded=fixture({actor:user(),docs:f.docs,calls:f.calls,webhookUrl:'invalid endpoint',enabled:paused?'true':'false'});assert.equal((await reloaded.call()).state,'completed');assert.equal(f.calls.length,1);
 }
 const fresh=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],webhookUrl:'invalid endpoint'});assert.equal((await fresh.call()).error,'spec_search_unavailable');assert.equal(fresh.calls.length,0);assert.equal(fresh.docs.has('pulseSpecSearchReceipts/'+receiptKey()),false);
});


const closedTransaction = () => Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'),{code:3});
test('an explicitly closed transaction restarts from fresh reads without repeating provider dispatch or a committed write',async()=>{
 for(const phase of [1,2,3]){
  const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},failTransactionNumbers:[phase],transactionError:closedTransaction});assert.equal((await f.call()).state,'completed');assert.equal(f.calls.length,1);assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl,'https://docs.example.com/spec.pdf');
 }
 const committed=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],response:{success:true,specificationUrl:'https://docs.example.com/spec.pdf'},loseReplyTransactionNumbers:[3],lostReplyError:closedTransaction});assert.equal((await committed.call()).state,'completed');assert.equal(committed.calls.length,1);assert.equal(committed.updates.filter(update=>update.path==='projects/P/bom/data').length,1);
});

test('closed-transaction retries are bounded and never retry a different invalid-argument error',async()=>{
 const closed=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],failTransactionNumbers:[1,2,3,4,5],transactionError:closedTransaction});assert.equal((await closed.call()).state,'failed');assert.equal(closed.transactionCount(),3);assert.equal(closed.calls.length,0);
 const invalid=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],failTransactionNumbers:[1],transactionError:()=>Object.assign(new Error('3 INVALID_ARGUMENT: Invalid field name'),{code:3})});assert.equal((await invalid.call()).state,'failed');assert.equal(invalid.transactionCount(),1);assert.equal(invalid.calls.length,0);
});

test('a closed reply after reservation commit stays unknown rather than dispatching a potentially duplicated operation',async()=>{
 const f=fixture({actor:user(),project:{memberIds:['alice']},categories:[{name:'Parts',items:[component]}],loseReplyTransactionNumbers:[1],lostReplyError:closedTransaction});assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.calls.length,0);assert.equal((await f.call()).state,'outcome_unknown');assert.equal(f.calls.length,0);assert.equal(f.docs.has('pulseSpecSearchLocks/'+itemLockKey()),true);
});

for (const [beforeDocument, afterDocument] of [[null, 'manual-new'], ['manual-old', 'manual-new'], ['manual-old', null]]) {
  test(`a provider result cannot supersede a manual document change ${beforeDocument} to ${afterDocument}`, async () => {
    const f = fixture({ actor: user(), project: { memberIds: ['alice'] }, categories: [{ name: 'Parts', items: [{ ...component, linkedSpecDocumentId: beforeDocument }] }],
      response: { success: true, specificationUrl: 'https://docs.example.com/provider.pdf' }, beforeFetch: async ({ docs }) => {
        const item = docs.get('projects/P/bom/data').categories[0].items[0]; item.linkedSpecDocumentId = afterDocument; item.quantity = 9;
      } });
    const result = await f.call(); assert.equal(result.state, 'conflict'); assert.equal(f.calls.length, 1);
    const item = f.docs.get('projects/P/bom/data').categories[0].items[0]; assert.equal(item.linkedSpecDocumentId, afterDocument); assert.equal(item.specificationUrl, null); assert.equal(item.quantity, 9);
    assert.deepEqual(await f.call(), result); assert.equal(f.calls.length, 1);
  });
}

test('a saved accepted result conflicts with a later manual document selection without redispatch', async () => {
  let f; f = fixture({ actor: user(), project: { memberIds: ['alice'] }, categories: [{ name: 'Parts', items: [component] }],
    response: { success: true, specificationUrl: 'https://docs.example.com/provider.pdf' }, beforeFetch: async () => f.setEnabled('false') });
  assert.equal((await f.call()).state, 'outcome_unknown'); const audit = clone(f.docs.get('pulseSpecSearchAudit/' + receiptKey()));
  f.docs.get('projects/P/bom/data').categories[0].items[0].linkedSpecDocumentId = 'manual-new'; f.setEnabled('true');
  assert.equal((await f.call()).state, 'conflict'); assert.equal(f.calls.length, 1); assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].specificationUrl, null);
  assert.deepEqual(f.docs.get('pulseSpecSearchAudit/' + receiptKey()), audit);
});

test('version2 searched provenance saves the manual document identity before dispatch', async () => {
  let f, observed; f = fixture({ actor: user(), project: { memberIds: ['alice'] }, categories: [{ name: 'Parts', items: [{ ...component, linkedSpecDocumentId: 'manual-existing' }] }], response: { success: true, specificationUrl: 'https://docs.example.com/provider.pdf' }, beforeFetch: async () => {
    observed = clone(f.docs.get('pulseSpecSearchReceipts/' + receiptKey()));
  } });
  const result = await f.call(); assert.equal(observed.searched_item_snapshot_version, 2); assert.equal(observed.searched_item_snapshot.linkedSpecDocumentId, 'manual-existing'); assert.equal(Object.keys(observed.searched_item_snapshot).length, 8);
  assert.equal(result.state, 'completed'); assert.equal(f.calls.length, 1); assert.equal(f.docs.get('projects/P/bom/data').categories[0].items[0].linkedSpecDocumentId, 'manual-existing');
});

test('old version1 unresolved provenance never guesses the historical manual selection', async () => {
  let f; f = fixture({ actor: user(), project: { memberIds: ['alice'] }, categories: [{ name: 'Parts', items: [component] }], response: { success: true, specificationUrl: 'https://docs.example.com/provider.pdf' }, beforeFetch: async () => f.setEnabled('false') });
  assert.equal((await f.call()).state, 'outcome_unknown'); const receipt = f.docs.get('pulseSpecSearchReceipts/' + receiptKey());
  receipt.searched_item_snapshot_version = 1; delete receipt.searched_item_snapshot.linkedSpecDocumentId; f.setEnabled('true'); const before = clone([...f.docs]);
  assert.equal((await f.call()).state, 'outcome_unknown'); assert.equal(f.calls.length, 1); assert.deepEqual([...f.docs], before); assert.equal(f.docs.has('pulseSpecSearchLocks/' + itemLockKey()), true);
});

test('completed version1 receipts still replay with writes paused and no provider configuration', async () => {
  const f = fixture({ actor: user(), project: { memberIds: ['alice'] }, categories: [{ name: 'Parts', items: [component] }], response: { success: true, specificationUrl: 'https://docs.example.com/provider.pdf' } });
  const saved = await f.call(), receipt = f.docs.get('pulseSpecSearchReceipts/' + receiptKey()); receipt.searched_item_snapshot_version = 1; delete receipt.searched_item_snapshot.linkedSpecDocumentId;
  const replay = fixture({ actor: user(), docs: f.docs, calls: f.calls, enabled: 'false', webhookUrl: 'unconfigured' });
  assert.deepEqual(await replay.call(), saved); assert.equal(f.calls.length, 1);
});
