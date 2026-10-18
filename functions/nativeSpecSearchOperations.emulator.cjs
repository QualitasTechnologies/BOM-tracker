const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {createNativeSpecSearchOperation} = require("./nativeSpecSearchOperations.cjs");

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run this test with the Firestore emulator.");
  const app = initializeApp({projectId: "demo-bom-native-security"}, `spec-lock-${randomUUID()}`);
  const db = getFirestore(app);
  const projectId = `spec-lock-${randomUUID()}`;
  const itemId = "component-1";
  const actor = {uid: "spec-lock-admin", email: "admin@qualitastech.com", disabled: false,
    customClaims: {status: "approved", role: "admin"}};
  const projectRef = db.collection("projects").doc(projectId);
  let releaseDispatch;
  let markDispatchStarted;
  const dispatchStarted = new Promise((resolve) => { markDispatchStarted = resolve; });
  const waitForRelease = new Promise((resolve) => { releaseDispatch = resolve; });
  let dispatchCount = 0;
  const search = createNativeSpecSearchOperation({
    db,
    resolveActor: async () => actor,
    enabled: () => true,
    getServerTimestamp: () => new Date(),
    webhookUrl: "https://n8n.example.com/webhook/spec-search",
    fetch: async () => {
      dispatchCount += 1;
      markDispatchStarted();
      await waitForRelease;
      return {ok: true, json: async () => ({success: true, specificationUrl: null})};
    },
  });

  try {
    await projectRef.set({memberIds: [actor.uid], members: []});
    await projectRef.collection("bom").doc("data").set({categories: [{name: "Parts", items: [
      {id: itemId, name: "Sample part", make: "Acme", sku: "A-1", itemType: "component"},
    ]}]});

    const requests = ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"].map((operationId) =>
      search({data: {project_id: projectId, item_id: itemId, operation_id: operationId, expected_actor_uid: actor.uid}}));
    await dispatchStarted;
    const secondResponse = await Promise.race(requests.map((request) => request.then((result) =>
      result.state === "outcome_unknown" ? result : new Promise(() => {}))));
    assert.equal(secondResponse.state, "outcome_unknown");
    assert.equal(dispatchCount, 1, "only one request may reach the webhook while the item is locked");
    releaseDispatch();
    const results = await Promise.all(requests);
    assert.equal(results.filter((result) => result.state === "not_found").length, 1);
    assert.equal(results.filter((result) => result.state === "outcome_unknown").length, 1);
    assert.equal(dispatchCount, 1);
    process.stdout.write("PASS: two concurrent operation IDs produced one webhook dispatch.\n");
  } finally {
    releaseDispatch?.();
    const [receipts, locks, audits] = await Promise.all([
      db.collection("pulseSpecSearchReceipts").where("project_id", "==", projectId).get(),
      db.collection("pulseSpecSearchLocks").where("project_id", "==", projectId).get(),
      db.collection("pulseSpecSearchAudit").where("project_id", "==", projectId).get(),
    ]);
    const batch = db.batch();
    for (const snapshot of [receipts, locks, audits]) snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    await db.recursiveDelete(projectRef);
    await deleteApp(app);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
