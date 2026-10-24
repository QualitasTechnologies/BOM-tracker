# Native Support Ticket Status Changes — Implementation Plan

## Backend branch: `codex/bom-support-ticket-status-backend`

- [x] Add tests for one atomic status transition, activity, audit, receipt, authorization, blocker parity, stale versions, replay, rollback, and strict gates.
- [x] Add read-only version lookup and idempotent transactional status operation.
- [x] Export the callable behind default-off server gates and existing runtime cutover control.
- [x] Run the full Functions unit suite and focused lint.

## Pulse client branch: `codex/bom-support-ticket-status-client`

- [x] Add a callable client with session-scoped operation journal, stable retries and reload recovery, actor-switch checks, stale-view detection, and exact Firestore revision lookup.
- [x] Gate the Pulse-hosted status path; preserve the standalone/flag-off BOM update and activity flow.
- [x] Never fall back to direct writes after a native rejection.
- [x] Pass the explicit client gate through the Pulse BOM build environment with a false default.
- [x] Run focused and full UI tests, root tests, production build, and focused lint.

## Release checks still required

- [ ] Integrate both branches with their current BOM/Pulse release stacks and review source changes.
- [ ] Deploy the callable with server gates off; confirm the deployed name and configuration without enabling writes.
- [ ] Verify the matching Rules/Functions and current user roster in the Firebase project; no emulator or signed-in acceptance was completed for this stage.
- [ ] Migrate or fence remaining direct status writers before enabling the client or server status gate.
- [ ] Complete project/user/data reconciliation, side-by-side operation, read-only, rollback, and eventual shutdown acceptance from the retirement checklist.
