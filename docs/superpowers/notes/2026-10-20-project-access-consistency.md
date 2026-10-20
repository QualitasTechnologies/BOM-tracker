# Project-access consistency

The existing native project handler distinguishes an absent `memberIds` field
from an explicit null. Firestore rules make the same distinction: absent field
access errors and denies nonadmins; null retains the legacy fallback. Two
other existing helpers disagreed with that contract.

- Document operations used `memberIds != null`, allowing missing membership.
  Add an own-field check before the existing null/array/member test. GET,
  reserve, finalization, replay, deletion and resolution share this guard.
- Material/project operations previously required an array for every nonadmin,
  blocking the explicit-null legacy fallback. Preserve that fallback while
  retaining the existing category filter. An external actor without a scope
  still receives no categories and cannot patch any item. Missing membership
  still denies cached replay.

Both changes preserve admin access, non-array rejection, identity checks,
customer-PO restrictions, mutation flags, version checks, audit and receipts.
No new read architecture, signal documents, rule fence or policy is enabled.
The corresponding common hunks and regression tests are in both repositories;
the entire files are not identical. Canonical BOM contains an earlier linked-
document deletion query that still needs separate Pulse integration review.

Three new unit regressions failed before implementation. Final focused suites
passed 37/37 per repository; complete Pulse contract tests passed 463/463;
complete canonical Functions tests passed 666/666; Functions ESLint passed.
The additional demo-emulator matrix compares actual SDK project reads with
both native document and material readers for array, null, missing, empty/map
and admin cases, asserting that reads do not change business or receipt data.
The focused real-emulator matrix passed 1/1 (six membership/role scenarios).
The complete 92-test security run is not green: three attempts each finished
91/92. The first two failed the existing concurrent provider-evidence
reconciliation test; diagnostics captured Firestore INVALID_ARGUMENT:
Transaction is invalid or closed. An experimental frozen-request recovery
assertion let that case pass on the third run, which instead failed the existing
concurrent document-finalization assertion (one success, one service-unavailable
reply). That experiment was saved outside the repository and removed from this
patch. No production transaction behavior or baseline race assertion changed.
Do not describe the complete security suite as passing or deploy from this
evidence. Investigate the race failures separately before release.
Auth identities in these tests are synthetic; no live-user claim follows.

Claude's independent read-only diff review found no introduced blocker and ran
no tests. It identified a pre-existing rules edge case: `uid in memberIds`
also recognizes map keys, whereas existing native handlers reject non-arrays.
This patch retains those existing stricter guards. The new tests establish
missing/null parity, not universal equivalence for malformed legacy records.
Real-data inventory must identify malformed membership before a read fence;
do not silently migrate it or claim complete all-user acceptance.

Production deployment, full user/data/history acceptance, remaining reader and
writer migration, backups/restore, side-by-side and retirement remain open.
