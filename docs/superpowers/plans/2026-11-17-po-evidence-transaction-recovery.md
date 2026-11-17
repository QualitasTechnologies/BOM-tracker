# Approval and document transaction recovery

Goal: reconcile existing provider evidence reliably after an explicitly closed Firestore transaction, without sending email, repeating the provider lookup, changing frozen message fields or duplicating receipt/audit metadata.

Evidence: the existing real concurrent PO evidence test failed in the corrected private audit with numeric3 and exact message "3 INVALID_ARGUMENT: Transaction is invalid or closed." The installed/locked SDK7.11.3 does not retry this exact response. Native specification search already has the tested bounded remedy. This stage applies that same narrowly matched max3 fresh-transaction approach to the reconciliation controller, forwarding original transaction options. Preserve read-only opening snapshots and all current admin/auth/revision/evidence checks. Provider lookup remains outside retries; finalization re-reads receipts and current revisions; committed receipt replay and resolve-only cancellation continue after pauses/deletion. No new feature, UI, function, flags or Rules.

Alternatives: automatic resend or re-running the whole request would cross the existing no-send/provider-lookup boundary. A blanket retry for all invalid-argument errors would hide malformed requests. Restart only the observed closed-handle response at the DB transaction boundary.

Files: functions/poApprovalReconciliation.cjs and its existing tests; mirror applicable changes in Pulse integration/bom-project-review/poApprovalReconciliation.cjs and its test. Existing real tests/security/nativePOResolution.transaction.test.mjs must keep its strong concurrent same-result/one receipt/one audit/frozen-mail assertions. Solo in existing worktrees; original Development remains untouched.

- [x] Add failing deterministic cases for closed opening/finalization/cancellation, lost commit acknowledgements, options preservation, bounded exhaustion, unrelated errors, current admin revocation and stale revisions after lookup.
- [x] Implement bounded fresh DB transactions and mirror only the tested source/test delta in Pulse. No provider dispatch/lookup in a retry callback.
- [ ] Verify focused real concurrency repeatedly, full backend/review/security/UI/build checks; review and require exact hosted-green heads before merge.
- [ ] Fresh86-function/currentRules94/controlABSENT/markers0/data/queues/schedulers and function settings/IAM/secret-reference/source recovery baseline; preserve Pulse server local files and database before normal auto-deploy. Merge pinned source, selectively deploy only nativePOApprovalNotificationReconciliation with reconciliation flag OFF and approval retry jobs still PAUSED. Independently verify all tested source/settings/other85 functions/protected data; anonymous calls only, no authenticated write/provider send or lookup probe.
- [ ] Verify Pulse normal deployment preserves local work and database; seal final recovery/report/handoff. Continue document upload root-cause investigation, manual spec-link/open workflow, all workflow/config paths,16individual acceptances/reconciliation/retirement with actual rollback.

Existing controls: nativePOApprovalNotificationReconciliation uses BOM_NATIVE_PO_NOTIFICATION_RECONCILIATION_ENABLED, timeout60,maxInstances3 and existing Resend secret reference. Preserve all capacity/identity/configuration and exact existing readonly-metadata semantics. Previous search release is live00002-fud/source309; do not redeploy it or old Rules. Protect the corrected diagnostic evidence before implementation.

Local evidence: five deterministic cases failed before the fix; all14 reconciliation cases now pass in both repositories. Full backend1241pass/1skip, Pulse760review contracts, ten uninstrumented real concurrency repeats and all165 full security cases pass. Both production builds pass using existing dependencies. Hosted exact-head checks and release verification remain pending. Fresh cloud and server recovery snapshots are protected; no gates or schedules changed.

Release resumed after Gmail PR 70: rebase this existing repair onto main c0d3762dca9fbcdab6c208a18821d50f8cd4476b, retaining the new Message-ID repair. Re-run the exact combined head before publishing. The previous recovery baseline is retained; use a new po-evidence-release-20261117 capture because the two Gmail revisions have advanced to 00004-gut and 00005-wuv. No further Gmail deployment is part of this release. Pulse PR 94 remains the unchanged tested mirror.


## Document finalization failure captured during release checks

The rebased head passed all five hosted jobs, but the local full suite failed the original document concurrency assertion and the billing-entity concurrency assertion. Release is held. The next diagnostic full suite passed 164 cases and failed the same document case, capturing numeric 3 with the exact closed-transaction message in nativeProjectDocumentOperations.cjs. This is direct evidence, not an inference from the approval controller.

All nine document DB callbacks now use the same narrowly matched, maximum-three fresh-transaction boundary. Storage publication remains outside those callbacks with its original create-only generation precondition. Reserve/finalize/cancel/delete/restore receipt checks, current access checks, original versions, typed archives, and integrity proofs remain unchanged. Read callbacks may repeat idempotent Storage reads; no Storage write is retried by this wrapper.

Nine added cases cover closed reservation/finalization before commit and lost commit acknowledgements, deletion archive replay, cancellation while paused, revoked access during retry, bounded exhaustion/unrelated invalid arguments, and a committed Storage publication with a lost acknowledgement that must not be uploaded again. Eight cases failed before the fix; all 45 document cases pass in both worktrees. Original real concurrent publication/archive assertions remain unchanged. Repeat real concurrency and full security verification are still required.

The separate billing-entity failure is not yet explained or fixed. Thirty focused repetitions passed; a trace of the complete billing test file, including preceding browser/permission cases, is running to capture the actual failure before any implementation change.
