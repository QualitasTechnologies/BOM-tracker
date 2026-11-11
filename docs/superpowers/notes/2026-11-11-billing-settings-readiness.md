# Original Billing Settings: versioned write readiness

This stage ports existing workflows. It does not activate cutover or retire standalone BOM. Work was performed without Claude or subagents, as requested.

| Existing workflow | Pulse home | Safety |
| --- | --- | --- |
| List legal entities and choose a default | Original embedded Settings → Billing entities | Complete catalog revision; default flags change atomically. Authorized catalog refreshes on focus and every 30 seconds while idle, without rebasing an open form. |
| Create/edit legal, bank, quotation and PO sequence details | Same original form | Fresh actor, original opening revision, protected audit with changed values; concurrent allocation rejects a stale form. |
| Primary company details | Same original form, `company` alias | Writes `settings/company`, preserves unknown fields, never creates `billingEntities/company`; primary remains active and cannot be deleted. |
| Upload a company logo | Original upload helper and form | Confirmed URL/path retained across retries; metadata cannot fetch arbitrary URLs. Historical unchanged references remain intact. |
| Delete a legal entity | Original delete control | Revision pinned before confirmation; complete original record archived privately; deleted identity is not recycled. |
| Retry an interrupted save | Recovery controls in the original screen | Account-bound session storage, frozen payload/revision/nonce, receipt replay or cancellation, authoritative refresh before acknowledgement. Recovery survives a client-flag rollback and cannot fall back to legacy writes. |

## Controls and protected records

- New server gate `BOM_NATIVE_BILLING_ENTITY_MUTATIONS_ENABLED`: only exact `true` enables new writes. Default is off.
- New client gate `VITE_BOM_NATIVE_BILLING_ENTITY_WRITES_ENABLED`: default false, validated by the Pulse build. Saved native requests retain recovery even when false.
- New writes also require runtime mode `coexist` or `pulse_only` and all three exact booleans: `poClientWritesFenced`, `poCounterClientWritesFenced`, `billingEntityClientWritesFenced`.
- New full metadata Rules fence protects root billing entities and root company Settings. Existing reads, nested metadata and unrelated Settings grants remain. Billing writes require an approved admin; company writes preserve the existing distinction at the approved native-actor boundary. The visible Settings page remains admin-only.
- `pulseBillingEntityOperations`, `pulseBillingEntityAudit`, and `pulseDeletedBillingEntities` are private. Client admins cannot forge or read them. Recovery and replay retain current authorization; unknown rollout modes fail closed.
- Generated server helpers come from the original Settings mappings/defaults/form. A source parity test runs in both repositories. Real SDK values are preserved in storage and archives, not serialized as connection objects.

## Verification before PR

- 1,082 backend tests passed, including default-off callable wiring, SDK serialization, mutation protocol, auditing and original domain parity.
- Full BOM UI run: 1,315 tests across 104 files passed. Subsequent focus-refresh and rolled-back-client recovery additions passed focused tests: 19 across two files. Hosted CI must verify the final complete head.
- Full Firestore/Storage security suite: 126 passed, no failures/skips. The first complete run caught a test isolation issue: an earlier historical-rules characterization left staged rules loaded. The new Billing fixture now explicitly loads current source Rules; the full rerun passed.
- Pulse review contracts: 694 passed. Pulse suite: 891 passed, one existing skip. Both production builds passed; final UI additions are rebuilt before commit/CI.
- Writer inventory still matches 90 Firestore and 11 Storage call sites; no new direct SDK writer was added.
- No production Rules, runtime controls, provider calls, real emails, data migrations or user permissions changed during this local implementation.

## Deployed readiness and one real admin read

BOM PR55 merged as `a67c3de7d97aa27eb305dbdc37aecc9c2e61ee9e`; Pulse PR83 merged as `79c7d640ba74653fd69cd6214fd9558487fad0a6`. Exact-head hosted checks passed: 1,082 backend, 1,317 standalone UI, 126 security plus 12 staged legacy Rules, 694 Pulse contracts, 2,318 embedded UI and 891 Pulse tests (one existing skip), plus builds.

Only `nativeBillingEntityOperations` was added, revision `nativebillingentityoperations-00001-roc`. Its mutation environment gate is absent and therefore strictly off. All other 69 service revisions/environment/secret fingerprints stayed unchanged; the deployed archive matches 191 tested source/test/package files. These are files, not 191 runtime handlers. Source exports number 84, deployed services 70. Production Pulse auto-deployed normally and passed health/integrity checks; project/time/email counts and pre-existing edits/config stayed unchanged.

At 05:21Z, the existing admin renewed the existing Pulse sign-in through its normal Google/SSO flow. An isolated temporary page reused the original BillingEntitiesTab, native client and normal SSO boundary. Both real entities loaded; all 29 rendered fields for each matched the original Settings forms exactly. Save/create/delete/default remained disabled. No mutation or logo/provider action was invoked. Complete Billing-document hashes remained unchanged; operation/audit/deleted-entity collections stayed empty. The temporary page was removed and the normal production HTML hash stayed unchanged. Proof and before/after metadata are retained in the protected `billing-settings-20261111` recovery directory; screenshots remain local rather than publishing account/bank fields.

This proves one current admin's reads and rendered field parity. Live native writes/recovery and the other users remain unaccepted. Before activation, drain/reconcile legacy PO creates/counters, accept the native Settings/PO/notification ownership, and prove the deployed Rules/control artifact. Preserve later team activity during rollback.

The wider retirement requirements remain open: complete workflow inventory acceptance, remaining writer/service homes, full history deduplication and file/money reconciliation, actual access for every current user, measured coexistence, read-only acceptance, whole-system restore and shutdown. Do not repeat the sealed email migration, purge or applied project links.
