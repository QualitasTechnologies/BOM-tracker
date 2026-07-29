# KPI Dashboard Redesign & Pulse Cost Integration Restore

## Status
Draft — pending user review

## Context

Two related problems, discovered while investigating a request to redesign the KPI dashboard ("remove hardcoded stuff, show real data, surface pending approvals"):

1. **The KPI dashboard (`src/pages/Index.tsx`) has fake data mixed in with real data.**
   - Real: Total Projects, Active, Completed, Overdue, Total Budget, Total Cost (material only), Total Parts, Project Status pie chart.
   - Fake: "Cost Trend Analysis" line chart (hardcoded Jan–Apr numbers, only the May `actual` value is real), "Project Productivity" bar chart (fully hardcoded, references project names — "ITC Vision", "DevOps Pipeline" — that don't exist in this account's data), "Total Hours" card and "Avg Hours per Project" badge (hardcoded to 0 via `setTotalManHours(0)`).
   - There is no surfacing of pending approvals anywhere on the dashboard, despite two real approval workflows existing in the app.

2. **Man-hours tracking is not actually missing — it was built, then accidentally regressed.**
   - May 2026: a full integration with the company's internal Pulse time-tracking system (`eagle-eye.qualitastech.com/pulse`) was built and merged (`feature/pulse-cost-integration`). Backend: `listPulseProjects` and `getProjectCosts` Cloud Functions (`functions/index.js`). Frontend: `CostAnalysis.tsx` was rebuilt around a `getProjectCosts(weekStart, weekEnd)` roll-up with a `WeekNavigator`, showing real per-project and per-person hours, time cost, material cost, gross profit, and profit margin sourced from Pulse.
   - June 18, 2026 (`a0d9a7f`, "remove Time Tracking and Sales Pipeline (handled by separate app)"): this commit correctly deleted an old, unrelated **manual** timesheet feature (`TimeTracking.tsx`, genuinely obsolete since Pulse replaced it). But in the same commit, `CostAnalysis.tsx` and `Index.tsx` were reverted to an older client-side implementation with `totalManHours` hardcoded to `0`, destroying the working Pulse roll-up. This looks like an unintended side effect of the cleanup, not a deliberate decision.
   - The backend functions and the `WeekNavigator` component are still in the repo and fully functional — nothing calls them today.
   - Consequence: "Engineering Cost" on `CostAnalysis.tsx`'s project detail view has been silently `₹0` for every project since June 18, understating total project cost and overstating gross profit/margin for any project with real labor hours.

This spec covers restoring the Pulse integration and redesigning the KPI dashboard around real data, including pending approvals. It does not cover the travel-visit receipt upload bug (missing Storage rule) or the "Review Claim" email link bug (hardcoded to app root instead of the project) — both already fixed and deployed separately, outside this spec.

## Goals

- `CostAnalysis.tsx` (Summary and Detail views) shows real hours/time cost/gross profit from Pulse again, with Customer PO docs, BOM-snapshot diff, PO value editing, and membership-filtered project lists (all built after the regression) preserved.
- KPI Dashboard (`Index.tsx`) shows only real, live data. No hardcoded chart arrays. No dead 0-value cards.
- KPI Dashboard surfaces pending approvals (travel expense claims + user account signups) so nothing needing action is invisible.
- "Total Cost" (both on the dashboard and in CostAnalysis Summary's per-project column) becomes material + time cost (matches how CostAnalysis Detail already defines total cost: BOM + Engineer + Misc), not material-only as today.

## Non-goals

- Building a new time-entry UI — Pulse remains the system of record for hours; this app only displays what Pulse reports.
- Migrating the fallback `projects/{id}/engineers` subcollection path (used when a project has no `pulseProjectId` linked) — `getProjectCosts` already handles this fallback server-side; no changes needed here.
- A week-by-week trend chart. There's no historical snapshot storage for budget/cost, so a real "trend over time" chart is out of scope for this pass (fake chart is removed, not replaced with a lookalike).

## Design

### 1. Restore `CostAnalysis.tsx`

**Summary view (`CostAnalysisSummary`)**

Replace the per-project client-side loop (`getBOMData` + hardcoded `totalManHours = 0`) with a single call to `getProjectCosts(weekStart, weekEnd)` once projects are loaded. `getProjectCosts` already:
- Computes material cost server-side from each project's BOM doc (same numbers `getTotalBOMCost` would produce) — the client-side BOM fetch loop is no longer needed for this view.
- Returns cumulative `timeHours`, `timeCost`, `grossProfit`, `profitMargin`, `poValue`, `usingFallbackHours`, and `warnings` per project.

`weekStart`/`weekEnd` only affect the `thisWeek` slice of the response, which the Summary view doesn't use — pass the current week (Mon–Sun) as a fixed default; no `WeekNavigator` needed here.

New `totalCost` for this view = `cumulative.materialCost + cumulative.timeCost + miscCost` (miscCost still read from the project doc directly, same as before — it's not part of `getProjectCosts`'s response). Table gains no new columns; the existing "Total Cost" and "Profit/Loss" columns now reflect real labor cost.

Keep unchanged: `subscribeToProjects` with membership filter, `subscribeToClients` for logos, status grouping/collapsing, admin gate.

**Detail view (`CostAnalysisDetail`)**

Fetch `getProjectCosts(weekStart, weekEnd)` filtered to `projectIdParam`'s row (or add a lightweight single-project path — see Open Question below) instead of hardcoding `totalManHours = 0`. Use `cumulative.timeHours` for "Total Man Hours" and `cumulative.timeCost` for "Engineering Cost" (replacing the local `totalManHours * costPerHour` calculation — the per-person rate resolution already happened server-side).

Add the `WeekNavigator` component (already exists, unused, at `src/components/CostAnalysis/WeekNavigator.tsx`) to this view so `thisWeek` figures are viewable, matching the pre-regression design. Cumulative figures (used for the main cost breakdown) don't change with the navigator.

If `pulseProjectId` isn't linked for a project, or a Pulse fetch fails, or an engineer has no rate set: show the existing `warnings` array from the response as a small dismissible notice near the Engineering Cost line (e.g. "Falling back to manually-logged hours" or "No rate set for jane@qualitastech.com — using ₹0"), so the gap is visible instead of silently showing 0 like today.

Keep unchanged: Customer PO upload/delete, BOM-snapshot diff section, PO value / misc cost / cost-per-hour inline editing, admin gate.

### 2. KPI Dashboard (`Index.tsx`) redesign

**Data fetching**

On load: fetch projects (existing), fetch `getProjectCosts(weekStart, weekEnd)` once for dashboard-wide totals (sum `cumulative.timeHours`, `cumulative.timeCost`, `cumulative.materialCost` across all returned rows — this replaces the existing per-project `getBOMData` loop used for `totalCost`, though `totalParts` still needs the BOM item count, so that loop stays for part-counting purposes only), fetch vendor count (existing), fetch pending travel-visit approvals and pending user approvals (new, see below).

**Summary cards** (real data only):
- Total Projects, Active, Completed, Overdue — unchanged.
- Total Budget — unchanged.
- Total Cost — now `sum(materialCost) + sum(timeCost) + sum(miscCost)` across projects (previously material-only). `miscCost` is already present on each project doc already fetched for the existing project list — no extra read needed. This matches the formula used in CostAnalysis Detail (material + engineer + misc) and the corrected CostAnalysis Summary (below).
- Total Parts — unchanged.
- Total Hours — restored, real: `sum(cumulative.timeHours)` across projects.
- "Avg Hours per Project" badge — kept, now real (`totalHours / totalProjects`) instead of always 0.

**Charts**:
- Keep the Project Status Distribution pie chart (real, unchanged).
- Remove "Cost Trend Analysis" line chart and "Project Productivity" bar chart entirely, along with their hardcoded `costTrendData`/`productivityData` arrays.

**New "Needs Attention" panel** (fills the space freed by the removed charts):

Two cards, both admin-only (dashboard is already admin-gated):

- **Pending Expense Claims**: count and total ₹ of all `TravelVisit`s across all projects with `reimbursementStatus === 'pending'`. List up to 10 (oldest first), each row showing project name, claimant name, amount, and a link to `/project/{projectId}/bom` (lands on the Costs tab where the Travel & Site Visits section lives — same URL pattern as the just-fixed approval email link). No "view all" beyond that cap (see Open Questions).
- **Pending User Approvals**: count and list of pending signups (name/email), reusing `fetchPendingUsers()` from `src/utils/userService.ts` (the same data source Settings' Users tab badge already uses). Each row links to `/settings` (Users tab).

If both counts are zero, show a single compact "All caught up" state instead of two empty cards.

**Data fetching for pending expense claims**: loop over the already-fetched project list and read each project's `projects/{projectId}/overheads/data` doc (`getOverheads(projectId)` from `src/utils/overheadFirestore.ts`), filter `travelVisits` for `reimbursementStatus === 'pending'`. This is the same N-reads-across-all-projects pattern the dashboard already uses for BOM data — acceptable at current project-count scale (tens, not thousands). No new backend needed; Firestore rules already permit this (the existing per-project BOM loop proves admins can already read across all projects regardless of membership).

### Error handling

- If `getProjectCosts` fails outright (e.g. Pulse API down), catch at the dashboard/CostAnalysis level and show Total Hours / Total Cost as "—" with a small inline error note, rather than crashing the page or silently reverting to 0 (which is exactly the bug being fixed here).
- Per-project `warnings` from `getProjectCosts` (fallback hours, missing rate) are non-fatal — surfaced as notices, don't block rendering.
- Overheads-doc reads for pending claims: a single project's read failing shouldn't block the rest — catch per-project, skip on error, log to console (matches existing `getBOMData` error handling pattern in `Index.tsx`).

### Testing

- Manual verification in the browser (per project conventions) for: KPI dashboard loads with real Total Hours matching what Pulse/CostAnalysis shows for the same projects; pending approvals panel shows real pending travel claims and pending users, and links navigate correctly; CostAnalysis Summary and Detail views show non-zero engineering cost for at least one Pulse-linked project.
- No existing automated test suite covers these pages (none found for `Index.tsx` or `CostAnalysis.tsx`) — no regression tests to update.

## Open Questions

1. **Single-project fetch for CostAnalysis Detail**: `getProjectCosts` always computes costs for *all* non-archived projects in one call. Detail view only needs one row. Options: (a) call it and pick out the one row (simple, slightly wasteful — matches how Summary already works), (b) add an optional `projectId` filter param to the Cloud Function to compute just one project's row. Recommend (a) for now — YAGNI, the function is already fast enough for Summary's full-list case, and Detail is a lower-traffic page.
2. **"View all" destination for pending expense claims**: there's no existing "all pending claims across all projects" page, and building one is out of scope for this pass. Decision: cap the inline list at 10 rows (oldest-first) instead of 5, no "view all" link. If pending-claim volume ever regularly exceeds 10, that's a signal for a dedicated view — not addressed here.

## Files touched

- `src/pages/Index.tsx` — dashboard rewrite
- `src/pages/CostAnalysis.tsx` — restore Pulse wiring in both Summary and Detail views
- `src/components/CostAnalysis/WeekNavigator.tsx` — re-wired into Detail view (already exists, no changes expected)
- `src/utils/pulseProxyFirestore.ts` — no changes expected, already correct
- `src/utils/overheadFirestore.ts` — no changes expected, reused as-is for pending-claims fetch
- `src/utils/userService.ts` — no changes expected, `fetchPendingUsers()` reused as-is
