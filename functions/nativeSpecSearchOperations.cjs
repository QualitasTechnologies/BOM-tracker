const {createHash} = require("node:crypto");
const {isIP} = require("node:net");
const {materialWritesAllowed} = require("./materialWriterOwnership.cjs");
const {fetchJsonResponse} = require("./emailNetwork.cjs");

const fault = (code, status = 400) => Object.assign(new Error(code), {code, status});
const plain = (value) => value && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = (value) => typeof value === "string" && value.trim() && value.length <= 512 &&
  !/[\/\x00-\x1f]/.test(value) && ![".", ".."].includes(value) && !/^__.*__$/.test(value);
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normalizedEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const internal = (actor) => normalizedEmail(actor.email).endsWith("@qualitastech.com");
const canonicalUuid = (value) => uuid(value) ? value.toLowerCase() : null;
const projectAccess = (project, actor) => actor.customClaims.role === "admin" ||
  (Object.hasOwn(project, "memberIds") && project.memberIds === null) ||
  (Array.isArray(project.memberIds) && project.memberIds.includes(actor.uid));
const validPublicHttps = (value) => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0];
    const hostForIpCheck = host.replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !authority.includes("@") && !url.username && !url.password && host.includes(".") &&
      host !== "localhost" && !host.endsWith(".localhost") && !isIP(hostForIpCheck) &&
      /^[a-z0-9.-]+$/.test(host) && !host.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"));
  } catch {
    return false;
  }
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operationDocumentKey = (operationId) => createHash("sha256").update(canonicalUuid(operationId) || operationId).digest("hex");
const itemLockDocumentKey = (projectId, itemId) => hash([projectId, itemId]);
const receiptExistsOrCannotBeChecked = async (db, operationId) => {
  const id = canonicalUuid(operationId);
  if (!id) return false;
  try {
    const snapshot = await db.collection("pulseSpecSearchReceipts").doc(operationDocumentKey(id)).get();
    return snapshot.exists;
  } catch {
    // An unavailable lookup cannot prove that a previous dispatch did not occur.
    return true;
  }
};
const operationResult = (receipt, operationId) => ({
  ok: ["completed", "not_found"].includes(receipt.state || receipt.status), operation_id: operationId,
  state: receipt.state || (receipt.status === "dispatching" || receipt.status === "unresolved" ? "outcome_unknown" : receipt.status),
  specificationUrl: receipt.specification_url || null,
  ...(receipt.error_code ? {error: receipt.error_code} :
    ["unresolved", "dispatching"].includes(receipt.status) ? {error: "spec_search_unresolved"} : {}),
});


const searchedSnapshot = (receipt) => {
  const value = receipt.searched_item_snapshot;
  return receipt.searched_item_snapshot_version === 1 && plain(value) &&
    Object.keys(value).length === 7 && ["id", "name", "make", "sku", "itemType", "category"].every(key => typeof value[key] === "string") &&
    value.id === receipt.item_id && value.itemType === "component" &&
    (value.specificationUrl === null || typeof value.specificationUrl === "string") &&
    value.specificationUrl === receipt.before_specification_url ? value : null;
};
const knownProviderResult = receipt =>
  Object.hasOwn(receipt, "provider_specification_url") &&
  ((receipt.provider_outcome === "completed" && validPublicHttps(receipt.provider_specification_url)) ||
    (receipt.provider_outcome === "not_found" && receipt.provider_specification_url === null));
const pendingAcceptedResult = receipt => ["dispatching", "unresolved"].includes(receipt.status) &&
  knownProviderResult(receipt) && searchedSnapshot(receipt);

function createNativeSpecSearchOperation({db, resolveActor, enabled = () => false, getServerTimestamp,
  fetch: fetchImpl = globalThis.fetch, responseTimeoutMs = 90000, webhookUrl = process.env.BOM_SPEC_SEARCH_WEBHOOK_URL || "https://n8n.qualitastech.com/webhook/spec-search"}) {
  // The SDK retries expired transactions, but the observed closed-transaction
  // response is not included. Restart only that exact response, with a fresh
  // transaction/read set. Every callback here is receipt-checked DB work;
  // provider dispatch remains outside transactions and is never repeated.
  const transact = async callback => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.runTransaction(callback); }
      catch (error) {
        if (attempt >= 2 || error.code !== 3 ||
          !/^(?:3 INVALID_ARGUMENT: )?Transaction is invalid or closed\.$/.test(String(error.message || "").trim())) throw error;
      }
    }
  };
  return async (request) => {
    let dispatchReserved = false;
    try {
      const actor = await resolveActor(request);
      const data = request.data;
      const operationId = canonicalUuid(data?.operation_id);
      const allowed = ["project_id", "item_id", "operation_id", "expected_actor_uid"];
      if (!plain(data) || Object.keys(data).some((key) => !allowed.includes(key)) ||
        allowed.some((key) => !Object.hasOwn(data, key)) || !validId(data.project_id) || !validId(data.item_id) ||
        !operationId || data.expected_actor_uid !== actor.uid) {
        throw fault(data?.expected_actor_uid !== actor.uid ? "actor_session_changed" : "invalid_spec_search_request", data?.expected_actor_uid !== actor.uid ? 403 : 400);
      }
      if (!actor || actor.disabled || actor.customClaims?.status !== "approved" ||
        !["admin", "user", "viewer"].includes(actor.customClaims.role)) throw fault("actor_forbidden", 403);
      const openingIdentity = JSON.stringify([actor.uid, normalizedEmail(actor.email), actor.customClaims.role]);
      const freshActor = async () => {
        const current = await resolveActor(request);
        if (!current || current.disabled || current.customClaims?.status !== "approved" ||
          !["admin", "user", "viewer"].includes(current.customClaims?.role) ||
          JSON.stringify([current.uid, normalizedEmail(current.email), current.customClaims.role]) !== openingIdentity) throw fault("actor_forbidden", 403);
        return current;
      };
      const assertDispatchConfigured = () => {
        let target;
        try {
          target = new URL(webhookUrl);
        } catch {
          throw fault("spec_search_unavailable", 503);
        }
        if (target.protocol !== "https:" || target.username || target.password || !target.hostname || isIP(target.hostname)) throw fault("spec_search_unavailable", 503);
      };

      const {project_id: projectId, item_id: itemId} = data;
      const projectRef = db.collection("projects").doc(projectId);
      const bomRef = projectRef.collection("bom").doc("data");
      const ownerRef = db.collection("pulseMaterialCutovers").doc(projectId);
      const controlRef = db.collection("pulseRuntimeControl").doc("cutover");
      const writable = async transaction => {
        const owner = await transaction.get(ownerRef), control = await transaction.get(controlRef);
        const data = control.exists ? control.data() : null;
        const mode = data && Object.hasOwn(data, "mode") ? data.mode : "coexist";
        if (enabled() !== true) throw fault("spec_search_disabled", 503);
        if (!["coexist", "pulse_only"].includes(mode) || !materialWritesAllowed(owner, "native")) throw fault("material_read_only", 503);
      };
      const documentKey = operationDocumentKey(operationId);
      const receiptRef = db.collection("pulseSpecSearchReceipts").doc(documentKey);
      const auditRef = db.collection("pulseSpecSearchAudit").doc(documentKey);
      const lockRef = db.collection("pulseSpecSearchLocks").doc(itemLockDocumentKey(projectId, itemId));
      const payloadHash = hash({actor_uid: actor.uid, project_id: projectId, item_id: itemId});
      const resultRefs = id => {
        const key = operationDocumentKey(id);
        const audit = db.collection("pulseSpecSearchAudit").doc(key);
        return {receipt: db.collection("pulseSpecSearchReceipts").doc(key), audit,
          reconciliation: audit.collection("reconciliations").doc("accepted_result")};
      };
      const settleKnownResult = async (id, recovery = false) => transact(async transaction => {
        const refs = resultRefs(id);
        const projectSnap = await transaction.get(projectRef), receiptSnap = await transaction.get(refs.receipt);
        const bomSnap = await transaction.get(bomRef), lockSnap = await transaction.get(lockRef);
        const auditSnap = await transaction.get(refs.audit), reconciliation = await transaction.get(refs.reconciliation);
        const current = await freshActor();
        if (!projectSnap.exists || !projectAccess(projectSnap.data(), current)) throw fault("spec_search_forbidden", 403);
        if (!receiptSnap.exists || !bomSnap.exists) throw fault("spec_search_conflict", 409);
        const receipt = receiptSnap.data();
        if (receipt.actor_uid !== current.uid || receipt.project_id !== projectId || receipt.item_id !== itemId ||
          receipt.operation_id !== id || receipt.payload_hash !== payloadHash) throw fault("operation_conflict", 409);
        const bom = bomSnap.data(), categories = Array.isArray(bom.categories) ? bom.categories : [], matches = [];
        categories.forEach((category, categoryIndex) => (Array.isArray(category?.items) ? category.items : []).forEach((item, itemIndex) => {
          if (item?.id === itemId) matches.push({categoryIndex, itemIndex, category, item});
        }));
        if (matches.length !== 1) throw fault("spec_search_conflict", 409);
        const {categoryIndex, itemIndex, category, item} = matches[0];
        if (current.customClaims.role !== "admin" && !internal(current)) {
          const member = (Array.isArray(projectSnap.data().members) ? projectSnap.data().members : []).find(entry => entry?.userId === current.uid);
          if (!Array.isArray(member?.categoryScope) || !member.categoryScope.includes(category.name)) throw fault("spec_search_forbidden", 403);
        }
        if (!["dispatching", "unresolved"].includes(receipt.status)) return operationResult(receipt, id);
        const before = searchedSnapshot(receipt);
        if (!before || !knownProviderResult(receipt) || !lockSnap.exists || lockSnap.data().operation_id !== id ||
          lockSnap.data().actor_uid !== current.uid || lockSnap.data().project_id !== projectId || lockSnap.data().item_id !== itemId) throw fault("spec_search_unresolved", 503);
        await writable(transaction);
        const specificationUrl = receipt.provider_specification_url;
        if (category.name !== before.category || item.id !== before.id || item.name !== before.name ||
          (item.make || "") !== before.make || (item.sku || "") !== before.sku ||
          (item.itemType || "component") !== before.itemType ||
          ((item.specificationUrl ?? null) !== before.specificationUrl && (item.specificationUrl ?? null) !== specificationUrl)) throw fault("spec_search_conflict", 409);
        await freshActor();
        if (specificationUrl) transaction.update(bomRef, {categories: categories.map((row, index) => index !== categoryIndex ? row : ({...row,
          items: row.items.map((entry, index2) => index2 !== itemIndex ? entry : ({...entry, specificationUrl}))}))});
        const state = specificationUrl ? "completed" : "not_found";
        const saved = {...receipt, status: state, state, outcome: state, error_code: null,
          after_specification_url: specificationUrl, specification_url: specificationUrl, updated_at: getServerTimestamp()};
        transaction.set(refs.receipt, saved);transaction.delete(lockRef);
        const audit = {actor_uid: current.uid, project_id: projectId, item_id: itemId, operation_id: id,
          before_specification_url: before.specificationUrl, after_specification_url: specificationUrl, outcome: state, created_at: getServerTimestamp()};
        if (!auditSnap.exists) transaction.create(refs.audit, audit);
        // Preserve the original failure/unknown audit instead of overwriting it.
        if ((recovery || auditSnap.exists) && !reconciliation.exists) transaction.create(refs.reconciliation,
          {...audit, previous_status: receipt.status, previous_state: receipt.state ?? null, reason: "known_provider_result_recovered"});
        return operationResult(saved, id);
      });
      const recordAcceptedFailure = async (id, providerOutcome, error, recovery = false) => {
        const conflict = error.code === "spec_search_conflict", refs = resultRefs(id);
        try {
          const saved = await transact(async transaction => {
            const receiptSnap = await transaction.get(refs.receipt), lockSnap = await transaction.get(lockRef);
            const auditSnap = await transaction.get(refs.audit), reconciliation = await transaction.get(refs.reconciliation);
            const receipt = receiptSnap.exists ? receiptSnap.data() : null;
            if (!receipt || receipt.actor_uid !== actor.uid || receipt.project_id !== projectId || receipt.item_id !== itemId ||
              receipt.operation_id !== id || receipt.payload_hash !== payloadHash) return null;
            if (!["dispatching", "unresolved"].includes(receipt.status)) return operationResult(receipt, id);
            const state = conflict ? "conflict" : "outcome_unknown";
            const terminal = {...receipt, ...providerOutcome, status: conflict ? "conflict" : "unresolved", state, outcome: state,
              error_code: conflict ? "spec_search_conflict" : "spec_search_unresolved", updated_at: getServerTimestamp()};
            transaction.set(refs.receipt, terminal);
            if (conflict && lockSnap.exists && lockSnap.data().operation_id === id) transaction.delete(lockRef);
            const audit = {actor_uid: receipt.actor_uid, project_id: projectId, item_id: itemId, operation_id: id,
              before_specification_url: receipt.before_specification_url, after_specification_url: null, outcome: state, created_at: getServerTimestamp()};
            if (!auditSnap.exists) transaction.create(refs.audit, audit);
            if (recovery && !reconciliation.exists) transaction.create(refs.reconciliation,
              {...audit, previous_status: receipt.status, previous_state: receipt.state ?? null, reason: "known_provider_result_conflict"});
            return operationResult(terminal, id);
          });
          if (saved) return saved;
        } catch {
          // Durable reservations/results remain unresolved if finalization also fails.
        }
        return {ok: false, state: "outcome_unknown", operation_id: id, error: "spec_search_unresolved"};
      };
      const initial = await transact(async (transaction) => {
        const projectSnap = await transaction.get(projectRef);
        if (!projectSnap.exists) throw fault("project_not_found", 404);
        await freshActor();
        const project = projectSnap.data();
        if (!projectAccess(project, actor)) throw fault("spec_search_forbidden", 403);
        const bomSnap = await transaction.get(bomRef);
        if (!bomSnap.exists) throw fault("bom_not_found", 404);
        const receiptSnap = await transaction.get(receiptRef);
        const savedReceipt = receiptSnap.exists ? receiptSnap.data() : null;
        const lockSnap = await transaction.get(lockRef);
        const savedLock = lockSnap.exists ? lockSnap.data() : null;
        let lockedReceipt = null;
        const lockedOperationId = canonicalUuid(savedLock?.operation_id);
        if (savedLock && lockedOperationId && lockedOperationId !== operationId) {
          const lockedReceiptRef = db.collection("pulseSpecSearchReceipts").doc(operationDocumentKey(lockedOperationId));
          const lockedReceiptSnap = await transaction.get(lockedReceiptRef);
          lockedReceipt = lockedReceiptSnap.exists ? lockedReceiptSnap.data() : null;
        }
        if (savedReceipt && (savedReceipt.actor_uid !== actor.uid || savedReceipt.payload_hash !== payloadHash)) throw fault("operation_conflict", 409);
        const bom = bomSnap.data();
        const matches = [];
        for (const category of Array.isArray(bom.categories) ? bom.categories : []) {
          for (const item of Array.isArray(category?.items) ? category.items : []) if (item?.id === itemId) matches.push({category, item});
        }
        if (!matches.length) throw fault("bom_item_not_found", 404);
        if (matches.length !== 1) throw fault("bom_item_conflict", 409);
        const {category, item} = matches[0];
        if (item.itemType === "service") throw fault("service_item_not_supported");
        if (item.itemType && item.itemType !== "component") throw fault("invalid_bom_item");
        if (actor.customClaims.role !== "admin" && !internal(actor)) {
          const member = (Array.isArray(project.members) ? project.members : []).find((entry) => entry?.userId === actor.uid);
          if (!Array.isArray(member?.categoryScope) || !member.categoryScope.includes(category.name)) throw fault("spec_search_forbidden", 403);
        }
        await freshActor();
        if (savedReceipt) return {replay: true, receipt: savedReceipt};
        const lockedReceiptMatchesLock = lockedReceipt && lockedReceipt.actor_uid === savedLock.actor_uid &&
          lockedReceipt.project_id === projectId && lockedReceipt.item_id === itemId && lockedReceipt.operation_id === lockedOperationId;
        const unresolvedLock = savedLock && (!lockedReceiptMatchesLock || ["dispatching", "unresolved"].includes(lockedReceipt.status) || lockedReceipt.state === "outcome_unknown");
        if (unresolvedLock) {
          return savedLock.actor_uid === actor.uid && lockedReceiptMatchesLock
            ? {replay: true, receipt: lockedReceipt, operationId: lockedOperationId, reusedOperation: true}
            : {blocked: true};
        }
        await writable(transaction);
        await freshActor();
        assertDispatchConfigured();
        const itemSnapshot = {id: item.id, name: item.name, make: item.make || "", sku: item.sku || "", itemType: item.itemType || "component", category: category.name, specificationUrl: item.specificationUrl ?? null};
        const receipt = {actor_uid: actor.uid, project_id: projectId, item_id: itemId, operation_id: operationId,
          payload_hash: payloadHash, status: "dispatching", before_specification_url: itemSnapshot.specificationUrl,
          searched_item_snapshot_version: 1, searched_item_snapshot: itemSnapshot,
          after_specification_url: null, created_at: getServerTimestamp(), updated_at: getServerTimestamp()};
        transaction.create(receiptRef, receipt);
        transaction.set(lockRef, {actor_uid: actor.uid, operation_id: operationId, project_id: projectId, item_id: itemId,
          created_at: getServerTimestamp(), updated_at: getServerTimestamp()});
        return {receipt, itemSnapshot};
      });
      if (initial.blocked) return {ok: false, state: "outcome_unknown", operation_id: operationId, error: "spec_search_unresolved"};
      if (initial.replay) {
        // A new browser first adopts the original ID through the existing unknown
        // response. Only a request naming that original ID may settle its result.
        if (!initial.reusedOperation && pendingAcceptedResult(initial.receipt)) {
          try { return await settleKnownResult(operationId, true); }
          catch (error) {
            if (error.code === "spec_search_conflict") return recordAcceptedFailure(operationId, {}, error, true);
            throw error;
          }
        }
        const replay = operationResult(initial.receipt, initial.operationId || operationId);
        return initial.reusedOperation ? {...replay, reused_operation: true} : replay;
      }
      // From this point onward a receipt exists and the request may have reached
      // n8n. Any uncaught failure must preserve the operation ID as unresolved.
      dispatchReserved = true;

      const searchPayload = {searchId: operationId, projectId, bomItemId: itemId, itemName: initial.itemSnapshot.name,
        make: initial.itemSnapshot.make, sku: initial.itemSnapshot.sku, category: initial.itemSnapshot.category};
      let response;
      try {
        response = await fetchJsonResponse(fetchImpl, webhookUrl, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(searchPayload)}, responseTimeoutMs);
        if (!response?.ok) throw new Error("spec_search_dispatch_failed");
        response = await response.json();
        if (!plain(response) || response.success !== true) throw new Error("spec_search_result_unavailable");
        if (response.specificationUrl != null && !validPublicHttps(response.specificationUrl)) throw fault("invalid_specification_url");
      } catch (error) {
        const status = error.code === "invalid_specification_url" ? "failed" : "unresolved";
        const outcome = status === "failed" ? "failed" : "unresolved";
        const finalizedReceipt = await transact(async (transaction) => {
          const current = await transaction.get(receiptRef);
          const lock = await transaction.get(lockRef);
          if (!current.exists) throw fault("spec_search_unavailable", 503);
          const persistedReceipt = current.data();
          if (persistedReceipt.status !== "dispatching") return persistedReceipt;
          const receipt = {...persistedReceipt, status, state: status === "failed" ? "failed" : "outcome_unknown", outcome,
            error_code: error.code === "invalid_specification_url" ? error.code : "dispatch_uncertain", updated_at: getServerTimestamp()};
          transaction.set(receiptRef, receipt);
          if (status === "failed" && lock.exists && lock.data().operation_id === operationId) transaction.delete(lockRef);
          transaction.create(auditRef, {actor_uid: actor.uid, project_id: projectId, item_id: itemId, operation_id: operationId,
            before_specification_url: receipt.before_specification_url, after_specification_url: null, outcome,
            created_at: getServerTimestamp()});
          return receipt;
        });
        return operationResult(finalizedReceipt, operationId);
      }

      const specificationUrl = response.specificationUrl || null;
      const providerOutcome = {provider_specification_url: specificationUrl, provider_outcome: specificationUrl ? "completed" : "not_found"};
      try {
        // This journal records the accepted provider result independently of the
        // user's current right to modify business data. Never resend it on retry.
        await transact(async transaction => {
          const snap = await transaction.get(receiptRef);
          if (!snap.exists) throw fault("spec_search_unavailable", 503);
          const receipt = snap.data();
          if (receipt.actor_uid !== actor.uid || receipt.project_id !== projectId || receipt.item_id !== itemId ||
            receipt.operation_id !== operationId || receipt.payload_hash !== payloadHash) throw fault("operation_conflict", 409);
          if (receipt.status === "dispatching") transaction.set(receiptRef, {...snap.data(), ...providerOutcome, updated_at: getServerTimestamp()});
        });
        return await settleKnownResult(operationId);
      } catch (error) {
        // A confirmed provider result survives revoked access or paused writes.
        // Keep its lock and unknown state so another operation cannot redispatch.
        return recordAcceptedFailure(operationId, providerOutcome, error);
      }
    } catch (error) {
      const operationId = canonicalUuid(request?.data?.operation_id);
      // Conflicts are already receipt-bound; malformed requests aren't eligible
      // for lookup. Other failures must prove no receipt exists before they clear
      // the caller's journal, including auth, gate, and access failures.
      const receiptMayExist = dispatchReserved || (!["operation_conflict", "invalid_spec_search_request"].includes(error.code) && await receiptExistsOrCannotBeChecked(db, operationId));
      if (receiptMayExist) {
        return {ok: false, state: "outcome_unknown", ...(operationId ? {operation_id: operationId} : {}), error: "spec_search_unresolved"};
      }
      const code = error.status ? error.code : "spec_search_unavailable";
      const state = /conflict/.test(code) ? "conflict" : code === "project_not_found" ? "project_not_found" : code === "bom_item_not_found" ? "item_not_found" : code === "bom_not_found" ? "bom_not_found" : code === "spec_search_unresolved" ? "outcome_unknown" : "failed";
      return {ok: false, state, ...(operationId ? {operation_id: operationId} : {}), error: code};
    }
  };
}

module.exports = {createNativeSpecSearchOperation, validPublicHttps};
