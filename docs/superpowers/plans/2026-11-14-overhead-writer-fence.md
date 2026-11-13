# Overhead writer fence repair

Execute solo in the two existing migration worktrees. Preserve original screens and permissions. No new product behavior or activation.

Goal: prevent native overhead/expense writes until original SDK saves of `projects/{projectId}/overheads/data` are fenced. The saved real-Rules emulator audit reproduced both audited cost overwrite and expense approval-pointer loss.

Architecture: reuse the existing server-only cutover document with an exact boolean `overheadClientWritesFenced`. Missing/false/malformed values preserve SDK behavior and disable new native mutations. Reads, committed receipt replay and cancellation remain available under existing authorization. Read the control inside the mutation transaction so revocation races retry safely. Reuse the existing paused-mutation error; no UI redesign is needed.

Rules: protect only the root overhead data document through the existing recursive grant; preserve nested metadata, other overhead documents, other project collections and all read permissions. Add the guard to candidate Rules. Generate a separate staged artifact from the exact published read-notice baseline with a reversible two-part addition, rather than publishing the full candidate or editing historical release artifacts.

- [x] Add failing native cases for absent/malformed controls, exact-true acceptance, flag revocation during commit and receipt replay/cancellation while paused.
- [x] Add actual Rules/native/SDK tests for create/update/delete/replace, current roles and membership, unchanged unrelated/nested access, and both previously reproduced stale-save losses.
- [x] Implement the minimal native and Rules guards; update only accepted-cutover fixtures.
- [x] Generate/check the staged artifact and prove removing the helper/grant replacement exactly restores the pinned published baseline. Reject baseline drift.
- [x] Mirror only the native guard, fixture and tests into Pulse; preserve existing reference-module differences and current main.
- [ ] Run focused/full backend, review contracts and security checks. Personally review the change; exact-head hosted checks must pass before merge.
- [ ] Prepare protected runtime recovery and selectively deploy the overhead handler with its existing gates/settings/IAM preserved. Keep live fence, writes and notification schedules off. Rules publication/activation and real-user acceptance remain separate gates.

Local verification: 24 focused native/artifact checks, 1,121 full backend passes plus one emulator-only skip, 730 Pulse review contracts, 132 full security checks and six staged-baseline security checks passed. The actual transaction test checks revocation after opening and before server authorization; the isolated transactional fixture separately covers revocation before commit. Do not await an outside write to a document already locked by a pessimistic Firestore transaction in the test harness.

Rollback must retain a live writer fence and later team records while writes are paused. Removing an accepted fence to reopen stale SDK writers requires a drained, reconciled transition; it is not an automatic rollback action.
