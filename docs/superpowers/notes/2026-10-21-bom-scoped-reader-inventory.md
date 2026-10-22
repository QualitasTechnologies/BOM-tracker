# Original BOM scoped reader inventory

Source audit: 2026-10-21. Applies to canonical `src/` and Pulse's reused
`apps/bom/src/`. This records source routing and outstanding rollout work;
it is not evidence of real-user or production data acceptance.

## Root, BOM and project document readers

| Consumer | With scoped reads enabled | Legacy SDK reads retained |
| --- | --- | --- |
| `utils/projectFirestore.ts` get/list/catalog subscription | Strict `nativeProjectReads` get/list; exhaust filtered pages; current UID/context required. Catalog notices cause authorized refreshes. | Root get/list/listener only in the flag-off branch. Pulse retains its extra explicit `memberIds` catalog filter. |
| Same helper, BOM get/subscription | Existing scoped native material GET and content-free notice coordinator. Categories and revisions stay with the existing material engine. | BOM `getDoc/onSnapshot` only in the flag-off branch. |
| `pages/BOM.tsx` | Root via shared get; documents via shared document helper; material categories via existing native workspace or shared scoped GET. Original screen and captured mutation baselines retained. | Direct root SDK fetch removed. Settings remain separate reads. |
| `pages/Index.tsx` | Catalog via shared getProjects and each project's material read through getBOMData. | Ordered root catalog query retained only in the flag-off branch. Vendors, overheads and POs are separate collections/subcollections. |
| `pages/CostAnalysis.tsx` | Project root via shared get; material and documents via shared helpers. Stored historical snapshots are read as stored; never rebuilt from current categories. | Direct root SDK fetch removed. Pulse cost service remains independent. |
| `pages/Projects.tsx`, `Support.tsx` | Shared catalog subscription, including visible failures and account teardown. | No direct root collection read in these screens. |
| `pages/SupportTicket.tsx` | Shared project get, with captured route/account and visible errors. | Ticket/activity/Support-document subcollections retain their separate current authorization. They are not root/projectDocuments reads. |
| `utils/projectDocumentFirestore.ts` | Strict document pages, including empty pages with cursors; bounded retries for root/BOM revision changes, duplicate/loop rejection and UID/context checks. | `projectDocuments` SDK queries retained only in flag-off branches. Pulse's older native document read/recovery route stays available in its existing flag-off situations. |
| `pages/ReceivedPhotosGallery.tsx` | Visible received physical/photo items; authorized reverse gallery_invoice lookup even with empty document forward links. Invoice lookups deduplicate and run at most four concurrently. Render output is keyed to the project/account before effects run. | Legacy single document-list read retained only with scoped reads off. No fallback after denial. |
| `components/Project/EditProjectDialog.tsx` | No direct root read. Both original editors use paired metadata/status/snapshot/unlink commands with independent native edit gates and saved-request recovery. | Legacy status snapshot reads go through gated helpers; direct SDK unlink is unreachable under scoped reads, including forced form submissions. |
| `components/Project/ProjectMembersTab.tsx` | Authorized server roster and explicit member/scope/recipient commands. Frozen pending commands survive reload within the same browser session. Existing independent self-notification operations remain. | Legacy root/roster/recipient replacements are fenced. Pending or unreadable journals force recovery mode even when local read/edit flags close. |
| `components/BOM/POListSection.tsx` | Project refresh/status readers use shared get. Existing native PO requests and historical values retained. | No independent raw project-root read found in this consumer. |

The coordinator subscribes only to known project, own-user and approved-admin
notice documents. It never lists notices or reads root/BOM source snapshots.
Initial, focus, reconnect and visible 60-second refreshes do authorized reads;
burst notices coalesce, teardown cancels publication, and superseded/changed
accounts cannot publish late replies. Notice bodies carry version and nonce only.

## Related data retained under its separate boundary

- `utils/projectContextFirestore.ts`: `projectContexts`, not project roots.
  Context learning/transcript workflows remain; this inventory does not establish
  their independent authorization or cutover readiness.
- `utils/communicationsBackfillFirestore.ts`: own contact discovery/directory
  and project backfill job metadata. `backfilledContactEmails` remains in the
  authorized root view. Existing backfill/ingestion ledgers are retained.
- `emailFirestore.ts`, `meetingFirestore.ts`: project email/meeting
  subcollections. Full sales/delivery history and cross-system deduplication still
  require real-data comparison; root-read tests do not prove that acceptance.
- `poFirestore.ts`, `overheadFirestore.ts`, `milestoneFirestore.ts`,
  `delayLogFirestore.ts`, `supportFirestore.ts`: dedicated subcollections
  and workflows. Their existing Rules/versioned-writer work remains separate.
- Settings, clients, vendors, brands and users retain their existing boundaries.
  An admin UI condition by itself is never evidence that an unfiltered read is safe.

## Replacement-write fences and remaining activation gates

With scoped reads on, shared legacy add/update/archive/restore/delete/baseline,
member add/remove/scope and recipient replacement helpers refuse before SDK
source access. Whole-BOM and document-link replacements refuse regardless of
the separate edit switch. The paired Support profile command merges explicit
patches into raw storage; projected roots/rosters are not whole-record saves.

Canonical legacy document uploads/deletes refuse before Storage or Firestore
effects. Pulse preserves its existing versioned upload/delete route and exact
saved-request recovery; enabling scoped reads alone does not enable a new
mutation route. Migrated unpaired editors are temporarily disabled; remaining
consumer controls must be paired or disabled before activation.

Before enabling reads, finish and verify every remaining paired consumer,
including the remaining document and other workflow controls, and complete
the full UI/browser comparisons. Do not treat a safe temporary refusal as workflow
parity or retire BOM while a current workflow is unavailable.

The 2026-10-22 source batch pairs original project create/template, edit, archive
and restore controls in both clients. New scoped-mode lifecycle entry points
require scoped reads and both existing native edit switches; the edit dialog
retains its existing safe-edit routing during coexistence. Server permissions
still authorize every operation. Restore returns to Planning. Saved member/recipient and archive
requests retain their original actor/project, revision, command and nonce in
sessionStorage before sending, never a projected project or roster. Confirmed
member/archive submissions are acknowledged only after reconciliation. Receipt
resolution can return a committed result or atomically cancel an uncommitted
nonce while new writes are closed; it cannot bypass current project access.
Archive recovery remains available in the Archived view. Corrupt storage blocks
new writes. Recovery across devices or ended browser sessions is not provided.

Canonical backend 760/760 and Pulse mirrored contracts 561/561 passed for that
batch. Final full UI runs passed 713/713 canonical and 1722/1722 embedded using
the direct Vitest runner with one worker and unchanged assertions/timeouts.
Independent source review found no remaining member/archive blocker after
strict journal and receipt fixes, coexistence routing corrections and archive
reconciliation of the actual current status (including a concurrent restore).
These are source checks only; real role/browser and original-workflow acceptance
remain prerequisites.

Actual app-project TypeScript checks remain nonzero: 45 canonical diagnostics
versus the prior 49, and 95 embedded versus the prior 116. Normalized diagnostic
groups add none in either app. These results use `tsc --noEmit -p
tsconfig.app.json`; a no-emit check of the root solution with `files: []` does
not check app sources and is not accepted as verification.

The following remain unverified/open: real raw-type and membership/user census;
production indexes and required server cursor key; current-user sign-in parity;
historical money/object/communications comparison; issued Storage URL/grant
inventory; controlled global external-read marker; real role/browser acceptance;
backup/restore/rollback rehearsal and measured side-by-side, read-only and shutdown
gates. Client/server switches remain off. No production activation is implied.

## Reproduce source audit

Search the two source roots excluding tests for `getDoc`, `getDocs`,
`onSnapshot`, and literal `projects` / `projectDocuments`. Inspect the
control flow around each result: the SDK calls intentionally remain for
coexistence. Their presence alone does not mean a scoped-mode bypass; a projected
DTO passing into a legacy write is never acceptable.

