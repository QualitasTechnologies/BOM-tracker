# Recover closed transactions in approval, document and billing workflows

Preserve the existing workflows when the Firestore SDK rejects an explicitly closed transaction. Do not resend mail, repeat a provider lookup within one HTTP request, republish uploaded bytes, reset counters, duplicate receipts/audits, bypass current access, or overwrite a changed opening.

## Confirmed causes

- Approval evidence: the original real concurrent reconciliation case captured numeric 3 and the exact message `3 INVALID_ARGUMENT: Transaction is invalid or closed.` in poApprovalReconciliation.cjs. The SDK does not retry that exact response.
- Document finalization: after rebasing onto Gmail main c0d3762, the full local suite failed the original matching-results/one-publication/typed-archive assertion. A minimal diagnostic full suite then captured the same numeric 3/message in nativeProjectDocumentOperations.cjs. Focused repetitions alone had passed and did not explain that failure.
- Billing metadata: the same local full suite failed the original concurrent receipt/archive assertion. Thirty single-case repetitions passed; tracing the complete billing test file reproduced the failure at repetition 3 and captured the same numeric 3/message in nativeBillingEntityOperations.cjs. It is now directly confirmed, not inferred from the other controllers.

The red logs and raw underlying exceptions are retained privately. No original strong security assertion was weakened. Hosted green checks on the earlier approval-only head did not override the local failures.

## Implementation boundaries

Each affected factory starts at most three fresh SDK transactions only for numeric 3 and the exact closed-handle message, optionally prefixed by `3 INVALID_ARGUMENT: `. Forward transaction options, including the approval read-only opening. Other invalid arguments and exhausted attempts retain existing errors.

Approval provider lookup remains outside transaction callbacks. Every finalize retry reuses that already obtained evidence and rechecks the original receipt, request hash, current admin/session, current revision and evidence. Resolve-only cancellation does not look up or send anything. Preserve existing read-only metadata-reconciliation semantics.

All nine document transaction callbacks use the bounded boundary. Storage publication remains outside them with the existing create-only generation precondition. Retain original reserve/finalize/cancel/delete/restore receipts, current membership/type access, versions, integrity proofs, immutable bytes and complete typed archives. Idempotent Storage reads inside a read callback may repeat; a Storage write or its acknowledgement error is not retried by this DB wrapper.

Billing has one metadata transaction and no provider or Storage writes. Re-read receipts/current actors/original entity or catalog versions. Preserve legal metadata, independent counters, the existing company-versus-billing role distinction, deletion archives, and nonce cancellation during pauses.

Mirror only these controllers and their tests in Pulse integration/bom-project-review. No new feature, UI, export, Rules, flag, capacity setting or dependency.

## Validation and release

- [x] Five approval, eight document and six billing deterministic cases failed before their fixes. The separate Storage-boundary case already passed and remains unchanged in meaning.
- [x] All 84 focused controller cases pass in both worktrees: 14 approval, 45 document, 25 billing. Tests cover before-commit errors, lost commit acknowledgements, one publication/archive/audit, current revocation/version conflicts, paused cancellation, bounded exhaustion, unrelated errors and Storage acknowledgements outside the retry.
- [ ] Complete backend/Pulse review suites and builds; repeat the complete real billing file and strong real document concurrency case ten times without instrumentation, then run the entire security suite. Retain the previous ten passing approval concurrency runs and revalidate that unchanged controller in the full suite.
- [ ] Require exact final hosted-green heads and solo source/IO review before merging the existing PRs 69 and 94 with updated scope.
- [ ] Use fresh transaction-recovery-release-20261117 snapshots: 86 functions, three target settings/IAM/secret references/source archives, current Rules 94/eae, absent runtime control/material markers, protected data/queues/schedules; preserve Pulse server local work and consistent SQLite backup. Earlier narrower recovery captures remain intact.
- [ ] Deploy only nativePOApprovalNotificationReconciliation, nativeProjectDocumentOperations and nativeBillingEntityOperations. Preserve every flag off/unset, capacity/identity, other 83 functions, current Gmail revisions 00004-gut/00005-wuv, and both intentionally paused approval retry schedules. Use anonymous rejection probes only; no real provider/send/user-impersonation tests or live flag activation.
- [ ] Verify actual deployed source and protected state, then merge/deploy Pulse through its normal auto-deploy while preserving all 34 local files, service health, database integrity and public flags. Seal checksummed recovery evidence, user report and handoff.

NativeSpec remains 00002-fud; Rules remain eae3d45d-161a-4604-a319-41cad16a57dc. This release does not activate any native workflow or prove individual acceptance. Continue the existing manual-specification-link race/opening repair, workflow and flag-path verification, all 16 individual acceptances, reconciliation, side-by-side operation and actual rollback before retirement.
