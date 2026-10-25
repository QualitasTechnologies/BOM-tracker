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

- [x] Add operation tests for atomic ticket/activity/receipt/audit creation, server-owned fields, transaction rollback, access cases, idempotent replay/conflict, and default-off gates.
- [x] Match the checked-in rule semantics: admin bypass, listed members allowed, explicit-null fallback, missing `memberIds` denied for non-admins, and current access rechecked on replay.
- [x] Implement strict input validation and a single Firestore transaction. Client-supplied actor fields, ticket number, timestamps, and activity IDs are ignored or rejected.
- [x] Export `nativeSupportTicketCreate` from `functions/index.js`; all three server gates default off.
- [x] Run focused tests and the full Functions suite; see the recorded results below.

### Task 2: Wire the original Support form with a hosted-only rollout gate

**Files:**
- Modify: `src/utils/supportFirestore.ts`
- Modify: `src/pages/Support.tsx`
- Modify: `src/components/Support/CreateSupportTicketDialog.tsx` only if needed to hide the Pulse-hosted action cleanly.
- Create: `src/utils/__tests__/supportTicketCreate.native.test.ts`
- Modify: `scripts/build-bom-ui.mjs` or `scripts/bom-build-environment.mjs` in the Pulse repository to mark that generated bundle as Pulse-hosted.

- [x] Add service-path tests proving standalone BOM keeps its existing three-write flow and Pulse-hosted native creation uses only the callable.
- [ ] Add a rendered-page regression proving the create action/dialog are absent when the Pulse client flag is off. The flag decision is unit-tested, and the hosted bundle builds, but the full Support page is not component-tested yet.
- [x] Add a session-storage operation journal; reuse its ID after transport loss and 503 uncertainty, block changed requests, and clear only on explicit 4xx rejection or acknowledged success.
- [x] Map callable identifiers to the existing `SupportTicket` return type; retain the existing form fields, toast/error handling, and success navigation.
- [x] Verify standalone direct writes, native callable dispatch, and default-off hosted rollout decision in focused tests.

### Task 3: Verify Firebase policy parity and integration

**Files:**
- Create: `tests/security/nativeSupportTicketCreate.rules.test.mjs` if the existing rules emulator harness supports these assertions without modifying the access rule.
- Modify: `docs/superpowers/specs/2026-10-17-native-support-ticket-create.md` with the final request/response contract and tested rollout conditions.

- [ ] Run the Firestore emulator security tests against the checked-in `firestore.rules`; expected assertions cover admin/member and explicit-null access, missing-field denial, non-member denial, and unapproved denial. Not run: Java is unavailable and no emulator listener was present.
- [x] Run focused Support tests, full Functions tests, frontend build, Pulse BOM bundle build, and the full reused-BOM UI suite. A full TypeScript-only check was not completed; the production bundle compiled successfully.
- [x] Confirm all server gates and the Pulse client flag default off, and the standalone create path remains unchanged.
- [x] Record missing emulator, deployed-rule, live-project, and real-user verification explicitly in `docs/superpowers/specs/2026-10-17-native-support-ticket-create.md`.
- [x] Commit the disabled-by-default source stage on isolated Pulse and BOM branches. Emulator and live acceptance remain release gates for enabling it.

### Recorded execution status (2026-10-17)

- BOM Tracker branch `codex/bom-support-ticket-create-backend`: commits `aeba14c` and `e5d066e`, pushed. Focused callable/export tests 10/10; full Functions suite 563/563; ESLint passed. Emulator assertions remain unrun because Java is unavailable.
- Pulse branch `codex/bom-support-ticket-create`: commit `9895dce`, pushed. Full reused-BOM UI suite 1,304/1,304 before the final retry and service-path tests; final focused retry/rollout tests 8/8 and service-path tests 2/2; build-environment tests 5/5; hosted BOM bundle built after final source change.
- The final 503 retry behavior retains the saved operation ID so an ambiguous transaction result can be replayed safely. Both code branches remain default-off; no deployment, live flag change, or Firebase write occurred.
