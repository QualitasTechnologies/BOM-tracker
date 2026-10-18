const {createHash} = require("node:crypto");
const {isIP} = require("node:net");

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
  project.memberIds == null ||
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

function createNativeSpecSearchOperation({db, resolveActor, enabled = () => false, getServerTimestamp,
  fetch: fetchImpl = globalThis.fetch, webhookUrl = process.env.BOM_SPEC_SEARCH_WEBHOOK_URL || "https://n8n.qualitastech.com/webhook/spec-search"}) {
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
      if (!enabled()) throw fault("spec_search_disabled", 503);
      let target;
      try {
        target = new URL(webhookUrl);
      } catch {
        throw fault("spec_search_unavailable", 503);
      }
      if (target.protocol !== "https:" || target.username || target.password || !target.hostname || isIP(target.hostname)) throw fault("spec_search_unavailable", 503);

      const {project_id: projectId, item_id: itemId} = data;
      const projectRef = db.collection("projects").doc(projectId);
      const bomRef = projectRef.collection("bom").doc("data");
      const documentKey = operationDocumentKey(operationId);
      const receiptRef = db.collection("pulseSpecSearchReceipts").doc(documentKey);
      const auditRef = db.collection("pulseSpecSearchAudit").doc(documentKey);
      const lockRef = db.collection("pulseSpecSearchLocks").doc(itemLockDocumentKey(projectId, itemId));
      const payloadHash = hash({actor_uid: actor.uid, project_id: projectId, item_id: itemId});
      const initial = await db.runTransaction(async (transaction) => {
        const projectSnap = await transaction.get(projectRef);
        if (!projectSnap.exists) throw fault("project_not_found", 404);
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
        if (savedReceipt) return {replay: true, receipt: savedReceipt};
        const lockedReceiptMatchesLock = lockedReceipt && lockedReceipt.actor_uid === savedLock.actor_uid &&
          lockedReceipt.project_id === projectId && lockedReceipt.item_id === itemId && lockedReceipt.operation_id === lockedOperationId;
        const unresolvedLock = savedLock && (!lockedReceiptMatchesLock || ["dispatching", "unresolved"].includes(lockedReceipt.status) || lockedReceipt.state === "outcome_unknown");
        if (unresolvedLock) {
          return savedLock.actor_uid === actor.uid && lockedReceiptMatchesLock
            ? {replay: true, receipt: lockedReceipt, operationId: lockedOperationId, reusedOperation: true}
            : {blocked: true};
        }
        const itemSnapshot = {id: item.id, name: item.name, make: item.make || "", sku: item.sku || "", itemType: item.itemType || "component", category: category.name, specificationUrl: item.specificationUrl ?? null};
        const receipt = {actor_uid: actor.uid, project_id: projectId, item_id: itemId, operation_id: operationId,
          payload_hash: payloadHash, status: "dispatching", before_specification_url: itemSnapshot.specificationUrl,
          after_specification_url: null, created_at: getServerTimestamp(), updated_at: getServerTimestamp()};
        transaction.create(receiptRef, receipt);
        transaction.set(lockRef, {actor_uid: actor.uid, operation_id: operationId, project_id: projectId, item_id: itemId,
          created_at: getServerTimestamp(), updated_at: getServerTimestamp()});
        return {receipt, itemSnapshot};
      });
      if (initial.blocked) return {ok: false, state: "outcome_unknown", operation_id: operationId, error: "spec_search_unresolved"};
      if (initial.replay) {
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
        response = await fetchImpl(webhookUrl, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(searchPayload)});
        if (!response?.ok) throw new Error("spec_search_dispatch_failed");
        response = await response.json();
        if (!plain(response) || response.success !== true) throw new Error("spec_search_result_unavailable");
        if (response.specificationUrl != null && !validPublicHttps(response.specificationUrl)) throw fault("invalid_specification_url");
      } catch (error) {
        const status = error.code === "invalid_specification_url" ? "failed" : "unresolved";
        const outcome = status === "failed" ? "failed" : "unresolved";
        const finalizedReceipt = await db.runTransaction(async (transaction) => {
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
      try {
        return await db.runTransaction(async (transaction) => {
          const projectSnap = await transaction.get(projectRef);
          const currentReceiptSnap = await transaction.get(receiptRef);
          const bomSnap = await transaction.get(bomRef);
          const lockSnap = await transaction.get(lockRef);
          if (!projectSnap.exists || !projectAccess(projectSnap.data(), actor)) throw fault("spec_search_forbidden", 403);
          if (!currentReceiptSnap.exists || !bomSnap.exists) throw fault("spec_search_conflict", 409);
          const currentReceipt = currentReceiptSnap.data();
          if (currentReceipt.status !== "dispatching") return operationResult(currentReceipt, operationId);
          const bom = bomSnap.data();
          const categories = Array.isArray(bom.categories) ? bom.categories : [];
          const matches = [];
          categories.forEach((category, categoryIndex) => (Array.isArray(category?.items) ? category.items : []).forEach((item, itemIndex) => {
            if (item?.id === itemId) matches.push({categoryIndex, itemIndex, category, item});
          }));
          if (matches.length !== 1) throw fault("spec_search_conflict", 409);
          const {categoryIndex, itemIndex, category, item} = matches[0];
          const currentProject = projectSnap.data();
          if (actor.customClaims.role !== "admin" && !internal(actor)) {
            const member = (Array.isArray(currentProject.members) ? currentProject.members : []).find((entry) => entry?.userId === actor.uid);
            if (!Array.isArray(member?.categoryScope) || !member.categoryScope.includes(category.name)) throw fault("spec_search_forbidden", 403);
          }
          const before = initial.itemSnapshot;
          if (category.name !== before.category || item.id !== before.id || item.name !== before.name ||
            (item.make || "") !== before.make || (item.sku || "") !== before.sku ||
            (item.itemType || "component") !== before.itemType ||
            (item.specificationUrl ?? null) !== before.specificationUrl) throw fault("spec_search_conflict", 409);
          if (specificationUrl) {
            const nextCategories = categories.map((row, index) => index !== categoryIndex ? row : ({...row,
              items: row.items.map((entry, index2) => index2 !== itemIndex ? entry : ({...entry, specificationUrl}))}));
            transaction.update(bomRef, {categories: nextCategories});
          }
          const state = specificationUrl ? "completed" : "not_found";
          const receipt = {...currentReceipt, status: state, state, outcome: state, after_specification_url: specificationUrl, specification_url: specificationUrl, updated_at: getServerTimestamp()};
          transaction.set(receiptRef, receipt);
          if (lockSnap.exists && lockSnap.data().operation_id === operationId) transaction.delete(lockRef);
          transaction.create(auditRef, {actor_uid: actor.uid, project_id: projectId, item_id: itemId, operation_id: operationId,
            before_specification_url: before.specificationUrl, after_specification_url: specificationUrl, outcome: state, created_at: getServerTimestamp()});
          return operationResult(receipt, operationId);
        });
      } catch (error) {
        const isTargetConflict = error.code === "spec_search_conflict";
        const accessRevoked = error.code === "spec_search_forbidden";
        const status = isTargetConflict ? "conflict" : accessRevoked ? "failed" : "unresolved";
        const state = isTargetConflict ? "conflict" : accessRevoked ? "failed" : "outcome_unknown";
        const outcome = state;
        const errorCode = isTargetConflict ? "spec_search_conflict" : accessRevoked ? "spec_search_forbidden" : "spec_search_unresolved";
        try {
          const persistedResult = await db.runTransaction(async (transaction) => {
            const receiptSnap = await transaction.get(receiptRef);
            const lockSnap = await transaction.get(lockRef);
            const current = receiptSnap.exists ? receiptSnap.data() : null;
            if (!current || current.status !== "dispatching") return current ? operationResult(current, operationId) : null;
            const terminal = {...current, status, state, outcome, error_code: errorCode, updated_at: getServerTimestamp()};
            transaction.set(receiptRef, terminal);
            if (state !== "outcome_unknown" && lockSnap.exists && lockSnap.data().operation_id === operationId) transaction.delete(lockRef);
            transaction.create(auditRef, {actor_uid: actor.uid, project_id: projectId, item_id: itemId, operation_id: operationId,
              before_specification_url: current.before_specification_url, after_specification_url: null, outcome, created_at: getServerTimestamp()});
            return operationResult(terminal, operationId);
          });
          if (persistedResult) return persistedResult;
        } catch {
          // The receipt remains dispatching if persistence also fails. Replays treat
          // that state as outcome_unknown and therefore never dispatch n8n again.
        }
        return {ok: false, state: "outcome_unknown", operation_id: operationId, error: "spec_search_unresolved"};
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
