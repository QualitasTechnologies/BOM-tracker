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
| `components/Project/EditProjectDialog.tsx` | No direct root read. Canonical legacy editor disabled; Pulse retains existing paired native metadata/status/snapshot/unlink command and request recovery. | Legacy status snapshot reads go through gated helpers; direct SDK unlink is unreachable under scoped reads, including forced form submissions. |
| `components/Project/ProjectMembersTab.tsx` | Its refresh calls use the shared get with expected UID/context. Existing independent notification operations remain. | Legacy root/roster/recipient replacements are fenced in the shared helper; remaining UI/writer pairing is an activation prerequisite. |
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
including canonical project/member/recipient and document controls, and complete
the full UI/browser comparisons. Do not treat a safe temporary refusal as workflow
parity or retire BOM while a current workflow is unavailable.

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

