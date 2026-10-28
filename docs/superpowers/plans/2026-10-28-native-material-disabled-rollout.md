# Native material operations: disabled runtime rollout

Date: 2026-10-28. Companion to `2026-10-28-native-project-disabled-rollout.md`.
Goal remains full BOM retirement. This stage is a stepping stone, not a permanent
read-only subset.

## Scope of this source stage

- `nativeMaterialOperations` (`functions/index.js`) now declares
  `memory: '256MiB'` and `concurrency: 1` explicitly, with the existing
  `timeoutSeconds: 30` and `maxInstances: 5`. These were already the platform
  defaults for a fractional-CPU function; the change removes reliance on defaults.
  No other function's options changed. Concurrency above one would also require an
  explicit `cpu >= 1`; do not raise it without measured read latency or 429s.
- No handler behavior changed. Writes still require
  `BOM_MATERIAL_MUTATIONS_ENABLED === 'true'` **and**
  `BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED === 'true'`. Each cloud function has its
  own environment, so the same names on `projectOperations` or
  `nativeProjectOperations` say nothing about this target. No flag redesign.

## Tests (pinned)

- `functions/nativeMaterialExport.test.cjs`: exact options object for this target
  only; no secrets; both-flag gate.
- `functions/nativeMaterialOperations.disabledRuntime.test.cjs`:
  - unauthenticated, no-bearer, wrong-scheme, rejected-token and uid-mismatch
    callers never touch Firestore, for the read and all four write paths;
  - eight closed gate environments (unset, both false, each flag alone, each flag
    flipped off, `TRUE`, `1`) reject `patch`, `fulfill`, `command` and
    `create_project` with `material_mutations_disabled`, open no transaction and
    leave stored data unchanged;
  - a disabled read returns `permissions.edit` and `command` false, is repeatable
    and writes nothing, for admin, user and viewer.

## Deployment checklist (target-only, when approved)

Same as the project stage: private before-inventory (`--v2`), upload manifest
check, external env file (outside the upload directory) containing the verified
existing `FIREBASE_CONFIG`, `GCLOUD_PROJECT` and the two flags as **separate**
keys set to `false` (the shared entry module initializes a Storage bucket at load;
do not pass flags as a comma-joined PowerShell argument). Deploy only
`nativeMaterialOperations`, then verify runtime metadata and flags, unauthenticated
denial, a fingerprint comparison of every existing function, and a real admin read
plus a denied write. Unauthenticated denial is not admin acceptance.

## HARD PREREQUISITES before any material write is ever enabled

Do not set either write flag to `true` for this function until both are done and
tested. Disabled deployment does not satisfy them.

1. **Cutover `read_only` fence.** `nativeMaterialOperations` and the code it calls
   (`projectOperations.cjs`) never read `pulseRuntimeControl/cutover`. Other native
   endpoints honor `coexist` / `pulse_only` / `read_only`. Material `get`, `patch`,
   `fulfill`, `command` and `create_project` must read the control document inside
   their transaction; `read_only` (or any unknown mode) must block every write, and
   `permissions.edit` / `permissions.command` must be true only in `coexist` or
   `pulse_only`. Without this, BOM retirement has no way to freeze material writes.
2. **Uncertain-receipt resolution while paused.** The write gate is checked before
   the receipt lookup, so replaying an in-doubt `command` or `create_project` while
   the gate is off or the mode is `read_only` returns `material_mutations_disabled`
   instead of the stored result. A client that lost a response then cannot learn
   whether the write landed. Receipt replay (with the existing actor and payload-hash
   conflict checks, and the existing category/document re-authorization) must work
   while paused, or a `resolve_only` equivalent must exist, as in
   `nativeProjectOperations`. Replay must never perform a new write.

Required tests for these two (not written in this stage): a control-mode matrix
across all five operations; replay of an existing receipt succeeds while gate-off
and `read_only`; conflicting actor or payload still returns 409; paused replay
changes no stored data.

Also outstanding before write enablement: legacy writer fences and Rules parity, and
the upload stage (`nativeUploadOperations`, three flags, bucket) and procurement
stage (Resend secret) as separate deployments.

## Not done here

No deployment, cloud access, secrets, flags, data or email. No commit or push.
