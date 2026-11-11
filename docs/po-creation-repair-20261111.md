# PO creation error and retry integrity repair

The production `PRJ-001` SWASHA failure was a partial-success bug. The legacy
browser saved a draft, then updated `billingEntities.nextPoNumber` in a separate
write. Naresh is an approved project member with role `user`; production Rules
correctly protect billing master records with an admin-only grant. The second
write failed, the UI reported failure, and retries saved more drafts at the same
number. No user role or billing-master permissions should be broadened.

## Fix

`legacyPOCreation` reuses the validated PO authoring transaction in a create-only
legacy ownership lane. Current Firebase identity, project membership, materials,
vendor and billing snapshots are checked before a draft and its number are
committed together. The service cannot edit, approve, delete or send POs. Native
write flags remain unchanged; legacy creation refuses native cutover/fenced modes.
The original frontend delegates creation to this callable and stores its exact
request in account/project-bound session storage before issuing it. Lost replies
replay one receipt; changed form values settle the earlier request first.
Underlying errors are now visible in the toast instead of a generic retry prompt.

## Integrity scope

The read-only census found 63 POs. Six SWASHA drafts created by Naresh today had
identical vendor, items, amounts, issuer, references and other substantive data;
only timestamps, payment/delivery terms and expected-delivery date differed.
Preserve the latest revised draft, archive all original typed records privately,
check all project subcollections and project documents for duplicate references,
and condition the complete repair on original update times. The retained draft
receives `PO-DS-2026-007`; the counter advances to 8. This preserves the distinct
already-sent PRJ-017 order numbered `PO-DS-2026-006`.

Two older, distinct sent orders also share `PO-2026-005` (PRJ-001 VIKAS and
PRJ-014 WENGLOR). Preserve their issued numbers and financial history. Add a
visible integrity warning for Accounts review rather than deleting or silently
renumbering issued documents. This historical collision is flagged, not resolved
by rewriting vendor-facing history.

Local recovery records are retained under `output/po-integrity-recovery` and
server-side originals under private `poIntegrityRepairs/<repair-id>`. Restoring
an original requires checking later team activity; never overwrite newer data.

Tests cover non-admin creation, denied access, writer fences, transaction failure,
concurrent allocation, revocation, lost acknowledgements and durable client retry.
A Firestore emulator additionally verifies actual SDK atomic/concurrent behavior.
No live vendor email or synthetic production PO is used as a test.
