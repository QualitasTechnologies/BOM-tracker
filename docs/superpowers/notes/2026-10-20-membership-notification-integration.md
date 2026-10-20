# Membership and notification safety integration — 20 October 2026

This is source integration toward retiring BOM Tracker. It reuses the original
Members screen in Pulse and preserves self-service preferences for the existing
standalone client. It is not a release, category-read solution, or retirement approval.

## Contract

- The combined Firestore rules stop non-admin SDK updates to `members` and
  `memberIds`, including category-scope self-expansion. Admin legacy management
  remains available during coexistence. The existing lifecycle, Materials,
  Support and PO protections and single recursive wildcard remain intact.
- `updateProjectMemberNotifications` reads a minimal preference projection:
  self only for current members, all member preferences for current admins.
  It uses the project's actual update-time revision. SET carries that displayed
  revision, pinned actor UID, immutable payload and retained operation ID.
- A non-admin can update only their own preference, including external members.
  Actor identity, current role and current project access are checked again
  before reply/write. Missing/malformed membership denies; explicit-null legacy
  access still requires a declared self member. Malformed/duplicate member rows
  fail closed. Existing valid unknown member fields are preserved.
- New SET requests are paused by read_only or unknown runtime modes. Missing
  control/mode retains coexistence. This narrow self-preference callable is
  deliberately independent of broader native project/material feature flags,
  because legacy and external users must retain self-service. Other native
  commands keep their existing gates. No production gate was changed.
- Project change, receipt and audit are one transaction. No-ops also have a
  durable receipt; a delayed retry cannot reapply the old intent to newer data.
  Resolution returns the committed receipt or atomically cancels the original
  nonce, even while new writes are paused. It never invents a new save.
- The client saves the frozen request in session storage before dispatch,
  retains uncertain outcomes, blocks conflicting edits, validates replies and
  guards account/project changes. A late acknowledgement cannot erase a newer
  pending request. The screen reloads actual preferences after resolution.
- Legacy screens reload the real server project after settled preferences and
  on mount; member management locks after refresh failure. Every legacy success
  updates the local authoritative project and parent together, so a later edit
  does not revert an earlier preference/member/recipient update.
- The alternate native `member_notifications` command also enforces self/admin
  at initial validation, fresh pre-write authorization and receipt replay.
  CRM open-deal stages and email-only recipient policy are unchanged.

## Remaining gates

Legacy admin member/scope writers still rewrite arrays and can race with other
writers. The SDK membership fence closes non-admin escalation, not every admin
or Admin SDK writer. These paths need coordinated native cutover before full
safe-write parity is claimed. Raw project/bomSnapshot and category-scoped reads
remain a separate unresolved architecture stage. Real Firebase identities,
live data/history, browser acceptance, backup/restore and side-by-side pilot
remain required. Deploy the callable and compatible clients before deploying
the membership rules; older clients otherwise lose their direct self toggle.
Do not activate production fences or replace the dirty server checkout from
this source-only stage.

## Verification

Settled local checks on the integrated source:
- BOM Functions663/663; isolated demo Firestore/Storage security91/91.
- Original BOM frontend472/472; build passed.
- Pulse embedded original UI1510/1510, including20 Members component regressions.
- Pulse root659 passed/6 skipped; native contract460/460.
- Functions ESLint and writer scanner4/4 passed; manifest91 Firestore/11 Storage
  mutation call sites (inventory only, not a claim those writers are all safe).
- Both Git whitespace checks passed. Pulse combined build is recorded in the
  final handoff once its process settles.

The rules suite failed3/7 against the previous combined rules and passed7/7
with the membership fence. The first complete security run88/91 exposed native
Firestore reference size accounting rejection; a focused red/green estimator
regression and actual transaction rerun proved reference/GeoPoint/binary/Timestamp
preservation before the final91/91 run. Claude independently found the legacy
parent/local-state freshness regressions. They were corrected in both screens
with epoch-guarded publication of every legacy update; a consecutive-edit test
failed before that fix. Claude's final read-only review found no concrete blocker.
Existing frontend bundle-size and test dialog-description warnings remain.

Tests use synthetic identities and isolated demo Firebase emulators; no production
user/project/provider mutation is part of this stage.
