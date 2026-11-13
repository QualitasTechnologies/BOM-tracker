# Notification ownership fence repair

Goal: preserve existing notifications and project access during the approved BOM cutover, with no new UI or sending activation.

The existing overhead fence owns both original SDK writers and old expense callbacks. Use the exact same boolean flag in the legacy expense callback before any recipient lookup, template, credentials or provider. Keep missing-control/coexist behavior and existing PO provider behavior. Do not infer expense identity from old callback dates/amounts: those requests have no stable visit ID. Preserve the managed PO acknowledgement's current actor/event/fingerprint checks while aligning its explicit-null membership behavior with the original Rules.

Alternatives considered: global pulse_only would unnecessarily stop unrelated legacy workflows; guessing expense events by payload could suppress unrelated notifications. Scoped exact-boolean ownership reuses the already published cutover mechanism. This guard prevents new callbacks after observation; drain already-authorized/in-flight callbacks before activation remains a required rollout gate.

- [x] Trace original UI callback, existing wrappers, guard and original membership Rules.
- [x] Reproduce explicit-null PO acknowledgement denial and scoped expense callback bypass (3 expected test failures, synthetic provider only).
- [x] Repair only poApprovalLegacyGuard.cjs and expense wrapper; mirror shared guard contract into Pulse without unrelated fixture/module changes.
- [x] Focused14 tests, full Functions1126pass/1 emulator-only skip and Pulse734 contracts pass.
- [x] Verify actual legacy expense wrapper and SDK writes against published scoped Rules in local emulator (7 passing cases).
- [ ] Personally review full diff, create PRs, require hosted checks and exact tested heads before merging.
- [ ] Capture protected before evidence; selectively update only notifyExpenseApproval and notifyPOApproval. Preserve gates, IAM, settings, unrelated services, control, Rules and business data. Test unauthenticated rejection only on live callables; never send real mail.
- [ ] Record source/runtime/deployment evidence and remaining gates in handoff. No native activation, fence activation or standalone retirement.

Files: functions/poApprovalLegacyGuard.cjs, functions/index.js, functions/notificationOwnershipFence.test.cjs, tests/security/overheadWriterFences.rules.test.mjs; Pulse integration/bom-project-review shared guard and guard-only tests. No product UI changes, Rules edits or dependency installation.
