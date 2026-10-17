# Native Support ticket creation from Pulse

## Status

The implementation is committed and pushed on the Pulse branch `codex/bom-support-ticket-create` and BOM Tracker branch `codex/bom-support-ticket-create-backend`. All native client and server gates default off. This is a disabled-by-default source stage, not authorization to enable writes or retire the standalone BOM app.

Firestore emulator verification and signed-in acceptance against real Firebase projects remain outstanding. The emulator could not start because Java is unavailable in the current environment. The shared callable actor helper also requires a verified email and one of the recognized roles; the current BOM user roster has not been checked to prove every existing Support user meets those requirements.

## User behavior

Pulse reuses the original BOM Support page, ticket dialog and data model. A Pulse-hosted build hides the create action and dialog unless `VITE_BOM_NATIVE_SUPPORT_TICKET_CREATE_ENABLED=true`. When the flag is off, it shows a short disabled-state message. Standalone BOM builds do not set `VITE_BOM_PULSE_HOSTED` and retain their original three-step Firestore create, ticket-number update and initial activity write.

When enabled for Pulse, the existing form sends the same form input to the `nativeSupportTicketCreate` Firebase callable. It does not fall back to direct browser writes if the callable fails. Success preserves the existing toast and navigation behavior. The client operation journal in session storage contains only the operation ID and a SHA-256 request fingerprint, scoped by Firebase UID and project. A changed request is blocked while an earlier result is unresolved. Transport errors, 5xx responses, and malformed/unknown responses retain the operation ID; an explicit 4xx rejection clears it; an acknowledged create/replay clears it.

## Callable contract

Request:

```json
{
  "project_id": "<Firestore project document ID>",
  "operation_id": "<client-generated stable operation ID>",
  "input": {
    "projectId": "<same Firestore project document ID>",
    "...": "existing CreateSupportTicketInput fields"
  }
}
```

`input.projectId` must equal `project_id`. The endpoint rejects unknown fields, validates bounds and enumerations, and ignores client-provided server-owned fields. Actor identity comes from the verified Firebase callable token and current Firebase Auth user record, never from the request body.

Successful response:

```json
{
  "ok": true,
  "project_id": "<Firestore project document ID>",
  "operation_id": "<request operation ID>",
  "ticket_id": "<created Firestore document ID>",
  "ticket_number": "SUP-2026-ABC123",
  "resolution": "committed"
}
```

An idempotent replay returns the original ticket identifiers with `resolution: "replayed"`. Errors use `{ "ok": false, "error": "<stable code>", "status": <HTTP-like status> }`. The endpoint returns no ticket body; the original subscription reads the persisted ticket.

## Atomic write and authorization rules

One Firestore transaction creates the ticket, `activities/created`, an idempotency receipt, and an immutable audit entry. The server assigns the ticket number, timestamps, initial status, SLA targets and actor fields. A receipt replay checks the current actor and project access again before returning the original result. A request with the same operation ID but a different actor or input conflicts.

Three independent server environment gates must each equal the literal string `true`: `BOM_MATERIAL_MUTATIONS_ENABLED`, `BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED`, and `BOM_NATIVE_SUPPORT_TICKET_CREATE_ENABLED`. The Pulse client flag is separately defaulted to false by the hosted BOM build script.

The callable checks an approved, verified actor and fresh token, then applies the source project policy: admins bypass membership; a non-admin whose UID appears in the project `memberIds` array is allowed; explicit `memberIds: null` follows the checked-in legacy fallback; an absent `memberIds` field denies non-admins because the checked-in Firestore rules directly access that field and evaluation fails when it is missing. Support tickets have no category-scope rule. Access to legacy records with missing membership is not broadened.

## Verification recorded

- BOM callable focused tests: 10/10; full Functions suite: 563/563; ESLint and diff checks passed.
- Pulse Support client retry/rollout tests: 8/8; standalone-vs-native service path tests: 2/2; build-environment tests: 5/5.
- The full reused-BOM UI suite passed 1,304/1,304 before the final retry regression and service-path tests were added. Those final additions passed in focused runs.
- The Pulse-hosted BOM bundle built successfully after the retry fix. Vite reported existing stale Browserslist, mixed Firebase import and large-bundle warnings.
- Backend and client code received read-only reviews. Reviews prompted the missing-versus-null membership correction and the 503 retry correction; both were fixed and covered.
- The Firestore rules emulator test is committed but unrun: Firebase CLI could not find Java and no emulator listener was available. Callable transaction atomicity/replay tests use an operation fixture; they are not an emulator concurrency test.
- No Firebase deployment, live flag change, production write, or real-user browser acceptance occurred. Keep all native Support gates off until emulator policy tests and signed-in user acceptance are completed.
