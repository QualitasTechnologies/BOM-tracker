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


## 2026-10-24 document, schedule and communications source review

The existing document and milestone screens have been reused in canonical BOM
and embedded Pulse. Scoped reads still do not enable edits. Saved native upload,
finalization and deletion recovery remains available when edit switches close;
legacy document effects remain fenced. Document item links use explicit deltas,
retain hidden links, and canonical captures the displayed actor/project/revision.
An uncertain same-page retry retains its operation identity. Link identity is
not persisted across reload: current source links reload and native version
checks prevent stale overwrites; cross-reload receipt proof remains a limitation.

Native milestone commands now distinguish absent membership from explicit null
only under the scoped-read server gate, while retaining existing legacy mode
and external/member/admin permissions. Receipt replay and resolution recheck
current access. Pending add/edit forms and nested delay details show saved values
locked, and retry the original request rather than discarding visible changes.
Independent source reviews found no remaining important milestone or document
boundary blocker. A final visible read-only document-control correction is under
focused verification; saved-request recovery must remain enabled.

The existing communications panel now reads bounded list previews and authorized
single-record details, enriching the surviving Pulse duplicate without changing
its actions or Sales provenance. Full bodies preserve the stored string exactly
and render as inert text. No guessed HTML stripping or valid-body truncation is
allowed; populated non-string or impossible oversized bodies fail explicitly.
BOM communications capability checks precede reads. Initiative transparency and
CRM open-deal stages are unchanged. Firebase remains the BOM history authority.

Parent verification so far: canonical full UI 948/948 before the final visible
control correction; complete backend 781/781; mirrored contracts 581/581; Pulse
root 707 passed and 6 skipped; focused canonical document 174/174, milestone
92/92, embedded combined 222/222. Actual app-project TypeScript remains nonzero
at 45 canonical and 95 embedded diagnostics, with zero new normalized groups.
These are source checks, not real-user, object, monetary or full-history parity.
No deployment, flag/Rules activation, main merge or production data change is
part of this source batch. Task 5 and all controlled-cutover gates remain open.

### Additional Task 5 consumers verified on 24 October

A fresh Claude Sonnet 5.5 caller audit found remaining workflow gaps even though
the root/BOM/document helpers fail closed: `pages/BOM.tsx` internal-budget editing
still calls fenced `updateProject`, and `SupportQuotationDialog.tsx` changes the
project billing entity through that helper before quotation preparation. These
need a paired explicit versioned route; disabling them is not workflow parity.
Order/receive/fulfilment document inputs also need correct read-on/edit-off UI
routing outside the standalone Documents panel. Existing edit-dialog scoped
checks must continue to make the legacy raw unlink unreachable. The source
inventory is not a declaration that Task 5 or retirement is complete.

Final source verification, 24 October: the visible read-only control correction
passed canonical 24/24 in a quiet three-file run, including the previously timed
out account-change case. Assertions and timeouts were unchanged. Both production
builds passed. Actual final app-project checks remain at 45/95 diagnostics and
29/46 normalized groups, with zero additions. The final embedded full UI runner
was interrupted after its owning process disappeared; its log has no terminal
result, so it is not a pass or a demonstrated source failure. The PR workflow
runs the complete embedded UI suite on the pushed head. Exact-head hosted checks
must be observed before accepting this batch. Backend 781/781, mirrored contracts
581/581 and root 707 passed plus 6 skipped remain the completed source results.

Live Firebase recheck now has a diagnosed authentication prerequisite: saved ADC
returned invalid_grant/invalid_rapt, and the CLI refresh returned HTTP 400 with an
explicit reauthentication message. These fail before project authorization and
do not establish a missing IAM grant. Official Google reauthentication is pending;
no new project permissions, data or production configuration were changed.

## 24 October 2026 — Budget, billing and procurement recovery source checkpoint

The original screens in both clients now pair project budget and Support billing-route changes with versioned raw-preserving commands. Budget remains admin-only; Support retains current member access, including external Support. Frozen draft versions/nonces, immediate pending-state display, post-write authoritative reads before acknowledgement, saved-request resolution after new-write gates close, and project/account/dialog isolation are covered. Native billing fallback no longer borrows stale project props, and late settings preserve a pending route.

The original procurement dialogs visibly gate new document uploads independently, retain recovery, reconcile before acknowledgement, reject late upload/read/reconciliation results after context changes, and keep prior valid drafts on a failed refresh. Canonical parent document callbacks now ignore repeat IDs after uncertain acknowledgement/recovery. Existing receipt photos and service-only flows remain independent.

Parent verification: full canonical UI 1090/1090 in 81 files; canonical backend 783/783; mirrored Pulse contracts 583/583; Pulse root 707 passed with 6 skipped; Pulse procurement focus 130/130 and budget/Support/client/page focus 63/63; both production builds passed. App-project TypeScript remains at existing 45 canonical / 95 embedded diagnostics with zero new normalized groups. A mixed-run Pulse budget timeout passed isolated 9/9 and complete quiet 63/63 without assertion/timeout changes; its cause is not proven. The canonical hosted workflow now also runs full frontend tests and build. New exact-head hosted results remain pending.

This is source evidence, not deployment or retirement. The Cost Analysis financial fields still need pairing, quotation generation still has a lost-ack duplication risk, and the existing PO send/recovery implementation ca0ded3 plus hardening through cfebca7 must be integrated with compatible original-client wrappers. The current Pulse wrappers are ahead of the canonical/live helpers. Reuse that existing work; do not replace it with raw writes or a rewritten screen. Live role/history/financial acceptance, runtime provisioning/index/cursor key, controlled fences, full rollback and measured coexistence/read-only/shutdown remain open. Firebase stays authoritative; no production flag, Rule, business record or app shutdown changed for this checkpoint.
