# PO opening: current access at result release

Before deploying the missing native procurement callable in a default-off state, review found that its PO opening checked the live admin only before Firestore reads. A role revoked or bearer switched during a slow opening could still receive PO, material and prior-attempt details.

The opening now rechecks the existing native identity after all reads, inside each transaction callback, and requires the actor still to be an approved admin. No provider/send path, existing role policy, runtime controls, CRM behavior, Rules or UI was changed.

Five shared regression cases exercise the project/PO/BOM/prior-attempt read boundaries and account switching, asserting no data or writes/provider calls. The native source additionally covers revocation during its runtime-mode read. All six failed before the fix and pass afterward. Local complete checks: 1,088 native backend tests and 699 Pulse contracts. Hosted exact-head checks and merge remain prerequisites to deployment.

Pulse's contract fixture now exposes its database seam for these tests. Its older send-cutover implementation was deliberately retained; this change does not claim the entire copied procurement engines are identical or remove the existing legacy fence to make a test pass. The shared read-authorization cases cover the common boundaries; the native runtime-control case is tested in its source repository.

Next readiness deployment, if checks pass: only `nativeProcurementOperations`, all three existing server gates off, no provider calls or business writes. Record absence/baseline and exact source, service, IAM, gate and other-service evidence. This does not activate native sending or resolve the remaining provider ownership, legacy writer drain/reconciliation, notifications, signals, all-user/live-write acceptance, history/files/money reconciliation or whole retirement recovery.
