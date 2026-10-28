# Native project operations: disabled runtime rollout

**Goal:** Deploy the existing project operations callable as an additive runtime
prerequisite, with every business-write gate closed. This does not enable native
editing or complete BOM retirement.

**Architecture:** Keep the existing Firebase callable identity checks, current
actor revalidation, project membership, read projection, transaction versions,
receipts and audit logic. Deploy only `nativeProjectOperations`; do not change
Rules, Storage, IAM roles, existing callables, user accounts or frontend flags.

## Source and verification

- [x] Add behavioral coverage for unauthenticated/invalid identities before any
  Firestore access, all fourteen ordinary command kinds under five closed-gate
  configurations, read-only permission advertisement, and idempotent cancelled
  receipt resolution. No project mutations are allowed in these cases.
- [x] Read the actual deployed Rules and compare them with the staged legacy PO
  candidate. The fresh 28 October result matches ruleset
  `0ae08a30-af58-403e-9457-96988ed71774` exactly. Legacy root reads already allow
  an approved member/admin to read the raw project document; native internal
  projections do not add broader financial access. External projections remain
  allowlisted. All 18 current project documents have populated `memberIds`
  arrays; none is missing, null, empty or malformed.
- [ ] Pin this callable's source options to 256 MiB and concurrency 1, preserving
  its 30-second timeout and maximum five instances. Other exports are unchanged.
- [ ] Run the native project suites and exact-head CI; review before merge.

Resolution while paused intentionally writes only an actor-bound cancellation
receipt and audit entry after current actor, project and command authorization.
It cannot change the project. Recovery metadata is not represented as a fully
read-only endpoint. Project creation is implemented by another service and is
outside this target's deployment claim.

## Targeted deployment after source acceptance

1. Save a private before-state function inventory and the fresh target-not-found
   result. Retain aggregate config fingerprints for every existing callable.
2. Inspect the gcloud upload file inventory. Source root is `functions/`; reject
   private credentials, local env files or recovery artifacts in the archive.
   Do not create a `.env.<project>` file to configure this rollout.
3. Deploy exactly `nativeProjectOperations` in `us-central1`, Node 22, HTTP callable
   transport, the existing default runtime identity, 256 MiB, concurrency 1,
   30 seconds and maximum five instances. Set these target-only flags explicitly
   to `false`: `BOM_NATIVE_PROJECT_MUTATIONS_ENABLED`,
   `BOM_MATERIAL_MUTATIONS_ENABLED`, `BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED`,
   `BOM_NATIVE_SUPPORT_PROFILE_ENABLED`.
4. Verify actual runtime metadata and all four false flags. Compare existing
   function fingerprints; never restore another agent's unrelated changes from
   the snapshot. Do not deploy the full codebase or candidate Rules.
5. Probe unauthenticated callable requests and confirm denial without business
   data changes. Record this as startup/auth-denial proof, not admin acceptance.
6. Prove an actual existing admin's authorized read and a denied write through a
   suitable staged client before claiming native runtime acceptance. Do not send
   vendor emails or invent cost edits for testing.

## Later gates

Do not enable global write flags merely for the three Cost Analysis fields.
Dependent native services, all legacy/native writer fences, real actor/category
permissions, audit/concurrency and user acceptance still require verification.
Standalone BOM stays available through measured coexistence, read-only and
shutdown, with recovery retained. A rollback of this new callable must preserve
the project documents and operation history; do not restore an old database for
a code/configuration rollback.
