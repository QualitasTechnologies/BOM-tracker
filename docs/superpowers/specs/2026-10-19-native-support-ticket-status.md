# Native Support Ticket Status Changes

## Problem

The reused Support page currently updates a ticket's status and appends its activity as separate browser writes. A failed second write leaves a status change without its activity, concurrent edits have no revision check, and browser-supplied activity identity is not authoritative. The retirement plan needs each daily Support action to have a safe Pulse path while preserving BOM behavior during staged rollout.

## Scope

This stage moves only ticket status changes to an optional native callable. It does not move assignment, notes, coverage, RCA, machine tags, service dates, payment, contact/document links, support files, quotations, profiles, or ticket deletion. The standalone BOM flow remains available while the Pulse client flag is off.

## Contract

- A read-only `get` operation verifies the actor and project access, then returns the ticket's Firestore `updateTime` revision and current status. The client compares this status with the status shown in the ticket before beginning a new command, then uses the returned revision to close the race between read and write.
- A `command` operation accepts only `status_change` and a known destination status. It receives the project, ticket, actor UID, expected revision, and operation ID. The server derives actor identity from the verified callable token.
- One Firestore transaction changes the ticket and creates one status activity, immutable audit record, and idempotency receipt. Reusing an operation ID with a different actor, action, ticket, revision, or target conflicts; a matching retry returns the recorded result.
- Every replay rechecks the current actor and project access. Project access follows the existing Support/create rule: admins bypass membership; members must be listed; explicit `memberIds: null` keeps the legacy fallback; a missing field denies non-admins.
- New writes require `BOM_MATERIAL_MUTATIONS_ENABLED=true`, `BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED=true`, `BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED=true`, and runtime cutover mode `coexist` or `pulse_only`. These gates are default off. Existing receipts may be replayed while writes are disabled.
- The Pulse-hosted BOM UI uses the callable only when `VITE_BOM_NATIVE_SUPPORT_TICKET_STATUS_ENABLED=true`; the build script validates and carries this flag, defaulting to false. A failed native call never falls back to direct writes. Flag-off retains the existing ticket update followed by activity append.
- An ambiguous command is journaled with its target status, operation ID, intent hash, and revision. The ticket page exposes a retry-and-confirm action after reload so the same command can be replayed without duplicating its writes; status selection remains blocked until it is resolved.

## Behavior parity

The server repeats the existing `getTransitionBlocker` checks: chargeable work needs accepted/invoiced status before `in-progress`; resolution and closure require root cause, corrective action, and solution summary; closure is blocked only when `customerConfirmation === 'pending'`. There is no new transition graph. Same-status commands are rejected as no-ops. The server stamps first response once, stamps resolved/closed dates when those statuses are selected, and leaves prior dates intact when moving back to another status.

## Rollout boundary

This additive stage does not fence legacy direct status writes or make their activity append atomic. Keep both client and server flags off until legacy writers are fenced or retired, the matching server callable is deployed, real-user access is verified, and the side-by-side/cutover gate permits writes. Firestore rules and production settings/data are unchanged by this stage.

## Verification

Backend tests cover actor and membership checks, status blocker parity, version conflicts, idempotent replay, transaction rollback, activity/audit/receipt writes, and strict default-off/cutover gates. Client tests cover the read-version plus command flow, ambiguous retry, session changes, flag-off legacy behavior, and no direct-write fallback. The Firestore emulator, deployed Functions/Rules, signed-in Firebase users, and production data are not verified by these source tests.
