# Native Support Ticket Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide Pulse with a separately gated, atomic way to create a BOM Support ticket while retaining the original BOM form and access behavior.

**Architecture:** A callable operation creates the ticket, ticket number, initial activity, idempotency receipt, and audit entry in one Firestore transaction. It derives the actor from Firebase Authentication and rechecks approved status plus current project membership. It preserves admins' membership bypass, requires non-admins to be listed when `memberIds` is an array, keeps the legacy fallback only for explicit `memberIds: null`, and denies non-admin access when the field is absent (matching the direct Firestore rule field access). The original BOM direct-write path remains available to standalone BOM; the Pulse-hosted build hides ticket creation unless its native client flag is on, and the callable has independent server-side default-off gates.

**Tech Stack:** Firebase Cloud Functions v2, Firebase Admin Firestore transactions, existing CommonJS `node:test` operation fixtures, React + TypeScript + Firebase callable client, Vitest.

---

### Task 1: Specify and test the callable contract

**Files:**
- Create: `functions/nativeSupportTicketCreate.cjs`
- Create: `functions/nativeSupportTicketCreate.test.cjs`
- Create: `functions/nativeSupportTicketCreateFixture.cjs`
- Modify: `functions/index.js`

- [ ] Write failing tests for atomic creation of ticket + `activities/created`, server-derived actor/timestamps/number, and no partial writes when a transaction fails.
- [ ] Write failing tests for exact project access parity: approved admin, approved member, rejected non-member, explicit-null `memberIds` fallback, absent `memberIds` denial, denied unapproved actor, and current-access recheck on replay.
- [ ] Write failing tests for idempotent same-operation replay, different-payload conflict, disabled-by-default writes, and replay resolution while writes are disabled.
- [ ] Run `node --test functions/nativeSupportTicketCreate.test.cjs`; confirm failures are caused by the missing operation behavior.
- [ ] Implement strict input validation and a single Firestore transaction. Keep all ticket fields within `CreateSupportTicketInput`; ignore client attempts to provide actor fields, ticket number, timestamps, or activity IDs.
- [ ] Export `nativeSupportTicketCreate` from `functions/index.js` with its independent environment gate off unless explicitly set to `true`.
- [ ] Re-run the focused test and then the full Functions tests.

### Task 2: Wire the original Support form with a hosted-only rollout gate

**Files:**
- Modify: `src/utils/supportFirestore.ts`
- Modify: `src/pages/Support.tsx`
- Modify: `src/components/Support/CreateSupportTicketDialog.tsx` only if needed to hide the Pulse-hosted action cleanly.
- Create: `src/utils/__tests__/supportTicketCreate.native.test.ts`
- Modify: `scripts/build-bom-ui.mjs` or `scripts/bom-build-environment.mjs` in the Pulse repository to mark that generated bundle as Pulse-hosted.

- [ ] Add failing tests proving standalone BOM still uses its existing direct-write path when Pulse-hosted mode is absent.
- [ ] Add failing tests proving the Pulse-hosted bundle exposes no create action when the native client flag is off, and calls only `nativeSupportTicketCreate` when on.
- [ ] Add a pending-operation ID that survives retries/reloads in session storage; reuse it for an identical unresolved request and clear it only after a confirmed response.
- [ ] Map the callable response back to the existing `SupportTicket` type and preserve the current form fields, success navigation, and error display.
- [ ] Verify original BOM standalone behavior and Pulse-hosted flag-off behavior in focused tests.

### Task 3: Verify Firebase policy parity and integration

**Files:**
- Create: `tests/security/nativeSupportTicketCreate.rules.test.mjs` if the existing rules emulator harness supports these assertions without modifying the access rule.
- Modify: `docs/superpowers/specs/2026-10-17-native-support-ticket-create.md` with the final request/response contract and tested rollout conditions.

- [ ] Run the Firestore emulator security tests against the checked-in `firestore.rules`; verify approved admin/member and explicit-null fallback can create both ticket and activity, absent `memberIds` denies non-admins, and a non-member or unapproved user cannot.
- [ ] Run focused Support tests, Functions tests, frontend type-check/build, and Pulse BOM bundle build.
- [ ] Confirm both rollout gates default off and that the legacy standalone create path remains unchanged.
- [ ] Record any missing live-project, deployed-rule, or real-user verification explicitly; do not claim production rollout readiness without it.
- [ ] Commit this stage on its isolated branch after the checks pass.
