# KPI Dashboard & Pulse Cost Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove hardcoded/fake data from the KPI dashboard, surface pending approvals on it, and restore the real Pulse time-tracking integration (accidentally reverted in commit `a0d9a7f`) in both the KPI dashboard and Cost Analysis pages.

**Architecture:** Two new pure, unit-tested utility modules (`dashboardCostTotals.ts`, `pendingApprovals.ts`) feed data into two existing page components (`Index.tsx`, `CostAnalysis.tsx`), which are rewired to call the already-deployed `getProjectCosts` Cloud Function (Pulse roll-up) instead of hardcoded/dead values. No backend changes — `getProjectCosts`, `listPulseProjects`, `getOverheads`, and `fetchPendingUsers` already exist and work.

**Tech Stack:** React + TypeScript, Firebase Firestore/Functions, Vitest for unit tests, existing `recharts` for the one chart that stays (Project Status pie).

## Global Constraints

- Currency formatting: Indian Rupee, `en-IN` locale, no decimal places — reuse each file's existing `formatCurrency`/`INR` helper, don't add a new one.
- Both pages stay admin-only, gated the same way they already are (`user.isAdmin` client-side; `getProjectCosts`/`fetchPendingUsers` are independently admin-gated server-side via custom claims — don't relax either).
- No new Cloud Functions, no changes to `functions/index.js`, `storage.rules`, or `firestore.rules` — everything needed is already deployed.
- Preserve everything built in `CostAnalysis.tsx` since the June 18 regression: Customer PO upload/delete, BOM-snapshot diff section, PO value / misc cost / cost-per-hour inline editing, membership-filtered `subscribeToProjects`, client logos in the Summary table. Do not remove or restructure these.
- "Total Cost" (dashboard summary card, CostAnalysis Summary table column, CostAnalysis Detail breakdown) = material cost + Pulse time cost + misc cost, everywhere. `getProjectCosts`'s `cumulative.total` already equals this sum server-side — use it directly, don't recompute client-side.
- New utility functions (`computeDashboardCostTotals`, `extractPendingClaims`) must be pure (no Firestore/network calls) so Vitest can test them without mocking.
- This repo has no `tsc` type-check step in `npm run build` (Vite doesn't type-check by default here) and no existing tests for page components (`Index.tsx`, `CostAnalysis.tsx`) — verify page-level tasks by running the dev server and checking in the browser, not by writing new page-level test files. This matches the codebase's existing pattern: unit tests exist only for pure utils/types and small presentational components (e.g. `WeekNavigator.test.tsx`).

---

## File Structure

- Create: `src/utils/dashboardCostTotals.ts` — pure aggregation of Pulse cost rows into dashboard totals.
- Create: `src/utils/__tests__/dashboardCostTotals.test.ts`
- Create: `src/utils/pendingApprovals.ts` — pure extraction/sorting of pending travel-expense claims.
- Create: `src/utils/__tests__/pendingApprovals.test.ts`
- Modify: `src/pages/Index.tsx` — dashboard: real Pulse-backed hours/cost, remove fake charts, add "Needs Attention" panel.
- Modify: `src/pages/CostAnalysis.tsx` — `CostAnalysisSummary`: use `getProjectCosts` instead of hardcoded 0 engineer cost. `CostAnalysisDetail`: same, plus restore `WeekNavigator` and Pulse warnings display.

---

### Task 1: `dashboardCostTotals.ts` — pure cost aggregation utility

**Files:**
- Create: `src/utils/dashboardCostTotals.ts`
- Test: `src/utils/__tests__/dashboardCostTotals.test.ts`

**Interfaces:**
- Consumes: `ProjectCostRow` from `src/utils/pulseProxyFirestore.ts` (already exists — has a `cumulative: { materialCost, timeHours, timeCost, miscCost, total, poValue, grossProfit, profitMargin }` field per row).
- Produces: `computeDashboardCostTotals(rows: ProjectCostRow[]): DashboardCostTotals`, `interface DashboardCostTotals { totalMaterialCost: number; totalTimeCost: number; totalTimeHours: number; totalCost: number }`. Task 3 (`Index.tsx`) imports and calls this.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/dashboardCostTotals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDashboardCostTotals } from '../dashboardCostTotals';
import type { ProjectCostRow } from '../pulseProxyFirestore';

const row = (overrides: Partial<ProjectCostRow['cumulative']> = {}): ProjectCostRow => ({
  projectId: 'p1',
  projectName: 'Project 1',
  status: 'Ongoing',
  pulseProjectId: 1,
  usingFallbackHours: false,
  thisWeek: { materialCost: 0, timeHours: 0, timeCost: 0, total: 0 },
  cumulative: {
    materialCost: 0,
    timeHours: 0,
    timeCost: 0,
    miscCost: 0,
    total: 0,
    poValue: 0,
    grossProfit: 0,
    profitMargin: null,
    ...overrides,
  },
  byPerson: [],
  warnings: [],
});

describe('computeDashboardCostTotals', () => {
  it('returns all zeros for an empty list', () => {
    expect(computeDashboardCostTotals([])).toEqual({
      totalMaterialCost: 0,
      totalTimeCost: 0,
      totalTimeHours: 0,
      totalCost: 0,
    });
  });

  it('sums a single project row', () => {
    const rows = [row({ materialCost: 1000, timeCost: 500, timeHours: 10, total: 1500 })];
    expect(computeDashboardCostTotals(rows)).toEqual({
      totalMaterialCost: 1000,
      totalTimeCost: 500,
      totalTimeHours: 10,
      totalCost: 1500,
    });
  });

  it('sums across multiple project rows', () => {
    const rows = [
      row({ materialCost: 1000, timeCost: 500, timeHours: 10, total: 1500 }),
      row({ materialCost: 2000, timeCost: 300, timeHours: 6, total: 2300 }),
    ];
    expect(computeDashboardCostTotals(rows)).toEqual({
      totalMaterialCost: 3000,
      totalTimeCost: 800,
      totalTimeHours: 16,
      totalCost: 3800,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/dashboardCostTotals.test.ts`
Expected: FAIL — `Cannot find module '../dashboardCostTotals'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/utils/dashboardCostTotals.ts`:

```ts
import type { ProjectCostRow } from './pulseProxyFirestore';

export interface DashboardCostTotals {
  totalMaterialCost: number;
  totalTimeCost: number;
  totalTimeHours: number;
  /** material + time + misc, per project, summed — matches ProjectCostRow.cumulative.total */
  totalCost: number;
}

export function computeDashboardCostTotals(rows: ProjectCostRow[]): DashboardCostTotals {
  return rows.reduce<DashboardCostTotals>(
    (acc, row) => ({
      totalMaterialCost: acc.totalMaterialCost + row.cumulative.materialCost,
      totalTimeCost: acc.totalTimeCost + row.cumulative.timeCost,
      totalTimeHours: acc.totalTimeHours + row.cumulative.timeHours,
      totalCost: acc.totalCost + row.cumulative.total,
    }),
    { totalMaterialCost: 0, totalTimeCost: 0, totalTimeHours: 0, totalCost: 0 }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/dashboardCostTotals.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/dashboardCostTotals.ts src/utils/__tests__/dashboardCostTotals.test.ts
git commit -m "feat: add pure dashboard cost totals aggregation utility"
```

---

### Task 2: `pendingApprovals.ts` — pure pending-claims extraction utility

**Files:**
- Create: `src/utils/pendingApprovals.ts`
- Test: `src/utils/__tests__/pendingApprovals.test.ts`

**Interfaces:**
- Consumes: `TravelVisit` from `src/types/overhead.ts` (has `id, reimbursementStatus, totalCost, createdAt, createdBy`), `ProjectMember` from `src/utils/projectFirestore.ts` (has `userId, displayName`).
- Produces: `extractPendingClaims(projects: ProjectVisits[], limit?: number): PendingClaimsSummary`, `interface ProjectVisits { projectId: string; projectName: string; members: ProjectMember[]; visits: TravelVisit[] }`, `interface PendingClaim { projectId: string; projectName: string; visitId: string; claimantName: string; amount: number; createdAt: string }`, `interface PendingClaimsSummary { claims: PendingClaim[]; count: number; totalAmount: number }`, `PENDING_CLAIMS_DISPLAY_LIMIT = 10`. Task 3 (`Index.tsx`) imports and calls this.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/pendingApprovals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractPendingClaims, PENDING_CLAIMS_DISPLAY_LIMIT } from '../pendingApprovals';
import type { ProjectVisits } from '../pendingApprovals';
import type { TravelVisit } from '@/types/overhead';

const visit = (overrides: Partial<TravelVisit>): TravelVisit => ({
  id: 'v1',
  startDate: '2026-07-01',
  endDate: '2026-07-02',
  attendees: ['u1'],
  expenses: [],
  totalCost: 1000,
  reimbursementStatus: 'pending',
  createdAt: '2026-07-01T10:00:00.000Z',
  createdBy: 'u1',
  ...overrides,
});

const project = (overrides: Partial<ProjectVisits>): ProjectVisits => ({
  projectId: 'p1',
  projectName: 'Project 1',
  members: [
    { userId: 'u1', email: 'a@qualitastech.com', displayName: 'Alice', addedAt: '2026-01-01', addedBy: 'migration' },
  ],
  visits: [],
  ...overrides,
});

describe('extractPendingClaims', () => {
  it('returns an empty summary for no projects', () => {
    expect(extractPendingClaims([])).toEqual({ claims: [], count: 0, totalAmount: 0 });
  });

  it('filters out non-pending visits', () => {
    const projects = [
      project({
        visits: [
          visit({ id: 'v-approved', reimbursementStatus: 'approved' }),
          visit({ id: 'v-draft', reimbursementStatus: 'draft' }),
        ],
      }),
    ];
    expect(extractPendingClaims(projects)).toEqual({ claims: [], count: 0, totalAmount: 0 });
  });

  it('resolves claimant name from project members', () => {
    const projects = [project({ visits: [visit({})] })];
    const result = extractPendingClaims(projects);
    expect(result.claims[0].claimantName).toBe('Alice');
  });

  it('falls back to the raw user id when no member match is found', () => {
    const projects = [project({ members: [], visits: [visit({ createdBy: 'unknown-uid' })] })];
    const result = extractPendingClaims(projects);
    expect(result.claims[0].claimantName).toBe('unknown-uid');
  });

  it('sorts pending claims oldest first', () => {
    const projects = [
      project({
        visits: [
          visit({ id: 'v-new', createdAt: '2026-07-10T00:00:00.000Z' }),
          visit({ id: 'v-old', createdAt: '2026-07-01T00:00:00.000Z' }),
        ],
      }),
    ];
    const result = extractPendingClaims(projects);
    expect(result.claims.map((c) => c.visitId)).toEqual(['v-old', 'v-new']);
  });

  it('counts and sums the full pending set even when the returned list is capped', () => {
    const visits = Array.from({ length: 12 }, (_, i) =>
      visit({
        id: `v${i}`,
        createdAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        totalCost: 100,
      })
    );
    const projects = [project({ visits })];
    const result = extractPendingClaims(projects);
    expect(result.count).toBe(12);
    expect(result.totalAmount).toBe(1200);
    expect(result.claims).toHaveLength(PENDING_CLAIMS_DISPLAY_LIMIT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/pendingApprovals.test.ts`
Expected: FAIL — `Cannot find module '../pendingApprovals'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/pendingApprovals.ts`:

```ts
import type { TravelVisit } from '@/types/overhead';
import type { ProjectMember } from './projectFirestore';

export interface ProjectVisits {
  projectId: string;
  projectName: string;
  members: ProjectMember[];
  visits: TravelVisit[];
}

export interface PendingClaim {
  projectId: string;
  projectName: string;
  visitId: string;
  claimantName: string;
  amount: number;
  createdAt: string;
}

export interface PendingClaimsSummary {
  /** Oldest-first, capped at `limit` */
  claims: PendingClaim[];
  /** Total pending count across ALL projects, not capped by `limit` */
  count: number;
  /** Total pending amount across ALL projects, not capped by `limit` */
  totalAmount: number;
}

export const PENDING_CLAIMS_DISPLAY_LIMIT = 10;

export function extractPendingClaims(
  projects: ProjectVisits[],
  limit: number = PENDING_CLAIMS_DISPLAY_LIMIT
): PendingClaimsSummary {
  const all: PendingClaim[] = [];

  for (const project of projects) {
    for (const visit of project.visits) {
      if (visit.reimbursementStatus !== 'pending') continue;
      const member = project.members.find((m) => m.userId === visit.createdBy);
      all.push({
        projectId: project.projectId,
        projectName: project.projectName,
        visitId: visit.id,
        claimantName: member?.displayName ?? visit.createdBy,
        amount: visit.totalCost,
        createdAt: visit.createdAt,
      });
    }
  }

  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const totalAmount = all.reduce((sum, c) => sum + c.amount, 0);

  return { claims: all.slice(0, limit), count: all.length, totalAmount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/pendingApprovals.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pendingApprovals.ts src/utils/__tests__/pendingApprovals.test.ts
git commit -m "feat: add pure pending travel-claims extraction utility"
```

---

### Task 3: Rewire `Index.tsx` (KPI Dashboard)

**Files:**
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: `getProjectCosts` from `src/utils/pulseProxyFirestore.ts`; `computeDashboardCostTotals`/`DashboardCostTotals` from Task 1; `extractPendingClaims`/`PendingClaimsSummary`/`ProjectVisits` from Task 2; `getOverheads` from `src/utils/overheadFirestore.ts`; `weekRangeFromDate` from `src/components/CostAnalysis/WeekNavigator.tsx`; `fetchPendingUsers` from `src/utils/userService.ts`.
- Produces: nothing consumed by later tasks — this is a leaf page.

This task removes: the `costTrendData`/`productivityData` hardcoded arrays and their two chart cards, the `totalManHours` state and its hardcoded-0 assignment, the `totalBOMCost` accumulator (now redundant — `getProjectCosts` computes the same material cost server-side), and the now-unused `recharts`/`lucide-react` imports that powered only the removed charts.

It adds: a call to `getProjectCosts` for real hours/cost totals, a call to `getOverheads` per project (extending the existing per-project loop) to build pending-claims data, a call to `fetchPendingUsers` for pending user signups, and a "Needs Attention" panel with two cards.

- [ ] **Step 1: Update imports**

In `src/pages/Index.tsx`, replace the recharts import block:

```tsx
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from "recharts";
```

with:

```tsx
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
```

Replace the lucide-react import block:

```tsx
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Package, 
  Clock, 
  Users, 
  AlertTriangle,
  CheckCircle,
  Activity,
  BarChart3,
  Calendar,
  FileText
} from "lucide-react";
```

with:

```tsx
import {
  TrendingUp,
  DollarSign,
  Package,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle,
  Activity,
  BarChart3,
  Calendar,
  FileText,
  Receipt,
  UserCheck,
} from "lucide-react";
```

Replace:

```tsx
import { getBOMData, getTotalBOMCost } from "@/utils/projectFirestore";
```

with:

```tsx
import { getBOMData } from "@/utils/projectFirestore";
import { getProjectCosts } from "@/utils/pulseProxyFirestore";
import { computeDashboardCostTotals, type DashboardCostTotals } from "@/utils/dashboardCostTotals";
import { extractPendingClaims, type PendingClaimsSummary, type ProjectVisits } from "@/utils/pendingApprovals";
import { getOverheads } from "@/utils/overheadFirestore";
import { weekRangeFromDate } from "@/components/CostAnalysis/WeekNavigator";
import { fetchPendingUsers } from "@/utils/userService";
```

- [ ] **Step 2: Replace state and the data-fetching effect**

Replace:

```tsx
  const [totalManHours, setTotalManHours] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
```

with:

```tsx
  const [totalParts, setTotalParts] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
  const [dashboardCosts, setDashboardCosts] = useState<DashboardCostTotals>({
    totalMaterialCost: 0,
    totalTimeCost: 0,
    totalTimeHours: 0,
    totalCost: 0,
  });
  const [costsError, setCostsError] = useState<string | null>(null);
  const [pendingClaims, setPendingClaims] = useState<PendingClaimsSummary>({
    claims: [],
    count: 0,
    totalAmount: 0,
  });
  const [pendingUsers, setPendingUsers] = useState<{ id?: string; uid?: string; email?: string; displayName?: string }[]>([]);
```

Replace the entire `fetchKPIData` function body (everything inside `useEffect(() => { const fetchKPIData = async () => { ... }; fetchKPIData(); }, [user]);`) with:

```tsx
    const fetchKPIData = async () => {
      if (!user) return;

      try {
        // Fetch projects
        const projectsRef = collection(db, 'projects');
        const projectsQuery = query(projectsRef, orderBy('createdAt', 'desc'));
        const projectsSnapshot = await getDocs(projectsQuery);

        const projectsData: any[] = [];
        let totalBOMParts = 0;
        const projectVisits: ProjectVisits[] = [];

        for (const projectDoc of projectsSnapshot.docs) {
          const projectData = { id: projectDoc.id, ...projectDoc.data() };
          projectsData.push(projectData);

          // Get BOM data for part count
          try {
            const bomData = await getBOMData(projectDoc.id);
            bomData.forEach(category => {
              totalBOMParts += category.parts.length;
            });
          } catch (error) {
            console.log(`No BOM data for project ${projectDoc.id}`);
          }

          // Get overheads for pending expense-claim detection
          try {
            const overheads = await getOverheads(projectDoc.id);
            projectVisits.push({
              projectId: projectDoc.id,
              projectName: projectData.projectName || projectDoc.id,
              members: projectData.members ?? [],
              visits: overheads.travelVisits,
            });
          } catch (error) {
            console.log(`No overheads data for project ${projectDoc.id}`);
          }
        }

        setProjects(projectsData);
        setTotalProjects(projectsData.length);
        setActiveProjects(projectsData.filter(p => p.status === 'Ongoing').length);
        setCompletedProjects(projectsData.filter(p => p.status === 'Completed').length);

        // Calculate overdue projects (simplified logic)
        const today = new Date();
        const overdue = projectsData.filter(p => {
          if (p.status === 'Completed') return false;
          if (!p.deadline) return false;
          return new Date(p.deadline) < today;
        }).length;
        setOverdueProjects(overdue);

        // Calculate total budget
        const totalBudgetAmount = projectsData.reduce((sum, p) => sum + (p.estimatedBudget || 0), 0);
        setTotalBudget(totalBudgetAmount);
        setTotalParts(totalBOMParts);

        setPendingClaims(extractPendingClaims(projectVisits));

        // Fetch vendor count
        const vendorsRef = collection(db, 'vendors');
        const vendorsSnapshot = await getDocs(vendorsRef);
        setVendorCount(vendorsSnapshot.size);

        // Real hours/cost data from Pulse (via getProjectCosts roll-up)
        try {
          const range = weekRangeFromDate(new Date());
          const costsRes = await getProjectCosts(range.start, range.end);
          setDashboardCosts(computeDashboardCostTotals(costsRes.projects));
          setCostsError(null);
        } catch (error) {
          console.error('Error fetching project costs from Pulse:', error);
          setCostsError('Could not load hours/cost data from Pulse.');
        }

        // Pending user account approvals
        try {
          const pendingRes = await fetchPendingUsers() as { users: { id?: string; uid?: string; email?: string; displayName?: string }[] };
          setPendingUsers(pendingRes.users ?? []);
        } catch (error) {
          console.error('Error fetching pending users:', error);
        }

      } catch (error) {
        console.error('Error fetching KPI data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchKPIData();
```

(This sits inside the same `useEffect(() => { ... }, [user]);` wrapper that was already there — only the function body changes.)

- [ ] **Step 3: Remove the hardcoded chart data and the two fake chart cards**

Delete these two hardcoded arrays entirely (just above the `return (` in the component):

```tsx
  const costTrendData = [
    { month: 'Jan', budget: 2500000, actual: 2100000 },
    { month: 'Feb', budget: 2800000, actual: 2400000 },
    { month: 'Mar', budget: 3200000, actual: 2900000 },
    { month: 'Apr', budget: 3000000, actual: 2700000 },
    { month: 'May', budget: 3500000, actual: totalCost },
  ];

  const productivityData = [
    { project: 'ITC Vision', hours: 120, parts: 45 },
    { project: 'Inventory Portal', hours: 80, parts: 32 },
    { project: 'DevOps Pipeline', hours: 95, parts: 28 },
    { project: 'ERP Integration', hours: 150, parts: 67 },
  ];
```

Delete the entire "Cost Trend Analysis" `<Card>` block (the second card inside the `{/* Project Status Overview */}` grid — the one with `<LineChart data={costTrendData}>`).

Delete the entire "Project Productivity" `<Card>` block (the first card inside the `{/* Productivity & Performance */}` grid — the one with `<BarChart data={productivityData}>`).

- [ ] **Step 4: Replace the "Total Hours" card and fix `totalCost` references**

Replace:

```tsx
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalManHours.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Engineering hours logged
              </p>
            </CardContent>
          </Card>
```

with:

```tsx
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{Math.round(dashboardCosts.totalTimeHours).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {costsError ? costsError : 'Logged in Pulse, all projects'}
              </p>
            </CardContent>
          </Card>
```

Everywhere else in the file that reads the old `totalCost` state variable — the "Total Budget" card subtitle (`{formatCurrency(totalCost)} spent`) and the "Budget Utilization" badge calc (`Math.round((totalCost / totalBudget) * 100)`) — replace `totalCost` with `dashboardCosts.totalCost`. Also replace `totalManHours` in the "Avg Hours per Project" badge calc (`Math.round(totalManHours / totalProjects)`) with `Math.round(dashboardCosts.totalTimeHours / totalProjects)`.

Remove the now-unused `totalCost` and `totalManHours` state declarations if any remain (there should be none left after Step 2 — `totalCost` itself was never a separate state var to begin with in the original file beyond what Step 2 already removed; double check no stray `const [totalCost, setTotalCost] = useState(0);` line remains and remove it if present, since its only assignment `setTotalCost(totalBOMCost)` was deleted in Step 2).

- [ ] **Step 5: Add the "Needs Attention" panel**

Replace the now-single-card `{/* Project Status Overview */}` grid (pie chart card only, after Step 3 deleted its sibling) so it becomes a two-column grid again, pairing the pie chart with the new panel:

```tsx
        {/* Project Status Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Project Status Distribution
              </CardTitle>
              <CardDescription>
                Current status of all projects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={projectStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {projectStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Needs Attention
              </CardTitle>
              <CardDescription>
                Items waiting on your approval
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingClaims.count === 0 && pendingUsers.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  All caught up
                </div>
              ) : (
                <>
                  {pendingClaims.count > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Receipt className="h-4 w-4 text-amber-600" />
                          Pending Expense Claims
                        </div>
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          {pendingClaims.count} · {formatCurrency(pendingClaims.totalAmount)}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {pendingClaims.claims.map(claim => (
                          <button
                            key={claim.visitId}
                            onClick={() => navigate(`/project/${claim.projectId}/bom`)}
                            className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted/50 text-left"
                          >
                            <span className="truncate">{claim.projectName} — {claim.claimantName}</span>
                            <span className="font-medium ml-2 shrink-0">{formatCurrency(claim.amount)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingUsers.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <UserCheck className="h-4 w-4 text-blue-600" />
                          Pending User Approvals
                        </div>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          {pendingUsers.length}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {pendingUsers.map(u => (
                          <button
                            key={u.id ?? u.uid ?? u.email}
                            onClick={() => navigate('/settings')}
                            className="w-full flex items-center text-sm px-2 py-1.5 rounded hover:bg-muted/50 text-left truncate"
                          >
                            {u.displayName || u.email}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
```

- [ ] **Step 6: Collapse the now-single-card "Productivity & Performance" grid**

After Step 3 removed the "Project Productivity" chart card, the `{/* Productivity & Performance */}` grid has only "Project Health Summary" left. Change its wrapper `className` from `"grid grid-cols-1 lg:grid-cols-2 gap-6"` to `"grid grid-cols-1 gap-6"` so the remaining card doesn't sit in a half-empty two-column grid.

- [ ] **Step 7: Manual verification**

Run the dev server and check the dashboard in a browser:

```bash
npm run dev
```

Navigate to `/` (or `/kpi`) as an admin user. Verify:
- Total Hours card shows a real number (not 0), or shows the `costsError` message if Pulse is unreachable — either way, no crash.
- Total Budget "spent" and Budget Utilization % reflect material + time + misc cost.
- No "Cost Trend Analysis" or "Project Productivity" cards remain.
- "Needs Attention" panel shows real pending travel claims (cross-check against a project's Overheads tab) and real pending users (cross-check against Settings → Users), or "All caught up" if there are none.
- Clicking a pending claim row navigates to that project's Costs tab. Clicking a pending user row navigates to Settings.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add src/pages/Index.tsx
git commit -m "feat: redesign KPI dashboard with real Pulse cost data and pending approvals"
```

---

### Task 4: Restore Pulse wiring in `CostAnalysisSummary`

**Files:**
- Modify: `src/pages/CostAnalysis.tsx` (the `CostAnalysisSummary` component, roughly lines 1–309)

**Interfaces:**
- Consumes: `getProjectCosts`, `type ProjectCostRow` from `src/utils/pulseProxyFirestore.ts`; `weekRangeFromDate`, `type WeekRange` from `src/components/CostAnalysis/WeekNavigator.tsx`.
- Produces: nothing new consumed by Task 5 (separate component in the same file, but independent data flow).

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { getBOMData, getTotalBOMCost, updateProject, subscribeToProjects } from "@/utils/projectFirestore";
```

with:

```tsx
import { getBOMData, getTotalBOMCost, updateProject, subscribeToProjects } from "@/utils/projectFirestore";
import { getProjectCosts, type ProjectCostRow } from "@/utils/pulseProxyFirestore";
import { weekRangeFromDate, type WeekRange } from "@/components/CostAnalysis/WeekNavigator";
```

(`getBOMData`/`getTotalBOMCost` stay imported — still used by `CostAnalysisDetail` later in the same file.)

- [ ] **Step 2: Replace the cost-fetching effect in `CostAnalysisSummary`**

Replace the `[projectCosts, loading]` state block:

```tsx
  const [projectCosts, setProjectCosts] = useState<Map<string, ProjectCostData>>(new Map());
  const [loading, setLoading] = useState(true);
```

with:

```tsx
  const [projectCosts, setProjectCosts] = useState<Map<string, ProjectCostData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [range] = useState<WeekRange>(() => weekRangeFromDate(new Date()));
```

Replace the entire "Fetch cost data for all projects" `useEffect` block:

```tsx
  // Fetch cost data for all projects
  useEffect(() => {
    const fetchAllCosts = async () => {
      if (projects.length === 0) {
        setLoading(false);
        return;
      }

      const costsMap = new Map<string, ProjectCostData>();

      await Promise.all(
        projects.map(async (project) => {
          try {
            // Get project details for costPerHour and miscCost
            const projectRef = doc(db, 'projects', project.projectId);
            const projectSnap = await getDoc(projectRef);
            const projectData = projectSnap.exists() ? projectSnap.data() : {};

            const costPerHour = projectData.costPerHour || 0;
            const miscCost = projectData.miscCost || 0;
            const poValue = projectData.poValue || project.poValue || 0;

            // Get BOM cost
            const bomCategories = await getBOMData(project.projectId);
            const materialCost = getTotalBOMCost(bomCategories);

            // Engineering cost not tracked (time tracking removed)
            const totalManHours = 0;
            const engineerCost = totalManHours * costPerHour;

            // Calculate totals
            const totalCost = materialCost + engineerCost + miscCost;
            const grossProfit = poValue - totalCost;
            const profitMargin = poValue ? ((grossProfit / poValue) * 100) : 0;

            costsMap.set(project.projectId, {
              project,
              materialCost,
              engineerCost,
              miscCost,
              totalCost,
              poValue,
              grossProfit,
              profitMargin,
              isProfit: grossProfit >= 0,
            });
          } catch (error) {
            console.error(`Error fetching costs for project ${project.projectId}:`, error);
          }
        })
      );

      setProjectCosts(costsMap);
      setLoading(false);
    };

    fetchAllCosts();
  }, [projects]);
```

with:

```tsx
  // Fetch cost data for all projects — real Pulse hours/cost via getProjectCosts roll-up
  useEffect(() => {
    const fetchAllCosts = async () => {
      if (projects.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const res = await getProjectCosts(range.start, range.end);
        const rowsById = new Map<string, ProjectCostRow>(res.projects.map(r => [r.projectId, r]));

        const costsMap = new Map<string, ProjectCostData>();
        for (const project of projects) {
          const row = rowsById.get(project.projectId);
          if (!row) continue;
          costsMap.set(project.projectId, {
            project,
            materialCost: row.cumulative.materialCost,
            engineerCost: row.cumulative.timeCost,
            miscCost: row.cumulative.miscCost,
            totalCost: row.cumulative.total,
            poValue: row.cumulative.poValue,
            grossProfit: row.cumulative.grossProfit,
            profitMargin: row.cumulative.profitMargin ?? 0,
            isProfit: row.cumulative.grossProfit >= 0,
          });
        }
        setProjectCosts(costsMap);
        setCostsError(null);
      } catch (error) {
        console.error('Error fetching project costs from Pulse:', error);
        setCostsError('Could not load cost data from Pulse. Showing project list without cost figures.');
      } finally {
        setLoading(false);
      }
    };

    fetchAllCosts();
  }, [projects, range.start, range.end]);
```

- [ ] **Step 3: Show the error banner when present**

Immediately after the opening of the `<div className="container mx-auto px-4 py-6 space-y-4">` block in `CostAnalysisSummary`'s render (right before the `{loading ? ... : ...}` ternary), add:

```tsx
          {costsError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {costsError}
            </div>
          )}
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Navigate to `/cost-analysis` as an admin. Verify:
- Projects load grouped by status, same as before.
- "Total Cost" and "Profit/Loss" columns show non-zero values for any project with logged Pulse hours (cross-check a project you know has hours in Pulse).
- Temporarily breaking the network (or checking the console) confirms the amber error banner appears if `getProjectCosts` fails, instead of a blank/crashed page.
- Customer PO upload, BOM-snapshot diff, and inline editing on any project's Detail view (via the `Package` icon link) still work — these aren't touched by this task but shouldn't regress.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/pages/CostAnalysis.tsx
git commit -m "fix: restore real Pulse cost data in Cost Analysis summary view"
```

---

### Task 5: Restore Pulse wiring, WeekNavigator, and warnings in `CostAnalysisDetail`

**Files:**
- Modify: `src/pages/CostAnalysis.tsx` (the `CostAnalysisDetail` component, roughly lines 312–1064)

**Interfaces:**
- Consumes: `getProjectCosts`, `type ProjectCostRow` from `src/utils/pulseProxyFirestore.ts` (already imported into this file by Task 4); `WeekNavigator`, `weekRangeFromDate`, `type WeekRange` from `src/components/CostAnalysis/WeekNavigator.tsx` (`weekRangeFromDate`/`WeekRange` already imported by Task 4 — add `WeekNavigator` to that same import).
- Produces: nothing consumed elsewhere — leaf component.

**Depends on:** Task 4 (same file, sequential edits — do not start this task until Task 4's changes are in place).

- [ ] **Step 1: Add the `WeekNavigator` import**

Change the import added in Task 4:

```tsx
import { weekRangeFromDate, type WeekRange } from "@/components/CostAnalysis/WeekNavigator";
```

to:

```tsx
import { WeekNavigator, weekRangeFromDate, type WeekRange } from "@/components/CostAnalysis/WeekNavigator";
```

- [ ] **Step 2: Replace `totalManHours` state with real Pulse data**

Replace:

```tsx
  const [materialCost, setMaterialCost] = useState(0);
  const [totalManHours, setTotalManHours] = useState(0);
  const [currentBOM, setCurrentBOM] = useState<any[]>([]);
```

with:

```tsx
  const [materialCost, setMaterialCost] = useState(0);
  const [currentBOM, setCurrentBOM] = useState<any[]>([]);
  const [costRow, setCostRow] = useState<ProjectCostRow | null>(null);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [range, setRange] = useState<WeekRange>(() => weekRangeFromDate(new Date()));
```

In the existing `fetchAllData` effect (`useEffect(() => { const fetchAllData = async () => { ... }; fetchAllData(); }, [projectIdParam]);`), delete this line:

```tsx
      // Time tracking removed — man hours not tracked in this app
      setTotalManHours(0);
```

Add a new effect right after that one, for the Pulse cost row:

```tsx
  useEffect(() => {
    const fetchCosts = async () => {
      if (!projectIdParam) return;
      try {
        const res = await getProjectCosts(range.start, range.end);
        setCostRow(res.projects.find(p => p.projectId === projectIdParam) ?? null);
        setCostsError(null);
      } catch (error) {
        console.error('Error fetching project costs from Pulse:', error);
        setCostsError('Could not load hours/cost data from Pulse.');
      }
    };
    fetchCosts();
  }, [projectIdParam, range.start, range.end]);
```

- [ ] **Step 3: Derive hours/engineer cost from the Pulse row**

Replace:

```tsx
  const engineerCost = totalManHours * costPerHour;
  const totalCost = materialCost + engineerCost + miscCost;
```

with:

```tsx
  const totalManHours = costRow?.cumulative.timeHours ?? 0;
  const engineerCost = costRow?.cumulative.timeCost ?? 0;
  const totalCost = materialCost + engineerCost + miscCost;
```

Update the description-sync effect — replace:

```tsx
  // Update engineer description if hours or rate changes
  useEffect(() => {
    setCostDescriptions((prev) => [
      prev[0],
      `${totalManHours} hrs @ ₹${costPerHour}/hr`,
      prev[2],
    ]);
  }, [totalManHours, costPerHour]);
```

with:

```tsx
  // Update engineer description when Pulse hours change
  useEffect(() => {
    setCostDescriptions((prev) => [
      prev[0],
      `${totalManHours} hrs logged in Pulse`,
      prev[2],
    ]);
  }, [totalManHours]);
```

(The old description implied a flat `hours × costPerHour` calculation; the real figure now comes from per-person Pulse rates, so the flat-rate phrasing would be misleading — this fixes it.)

- [ ] **Step 4: Add a "This Week" card with the WeekNavigator, and surface warnings**

Insert a new Card right after the header `</div>` and before the `{/* Project Snapshot */}` Card, inside the `<div className="container mx-auto px-4 py-6 space-y-6">` block:

```tsx
          {/* This Week (Pulse) */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">This Week (Pulse)</h3>
                <WeekNavigator range={range} onChange={setRange} />
              </div>
              {costsError ? (
                <p className="text-sm text-amber-600">{costsError}</p>
              ) : (
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Hours</p>
                    <p className="font-semibold">{costRow?.thisWeek.timeHours ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Time Cost</p>
                    <p className="font-semibold">{formatCurrency(costRow?.thisWeek.timeCost ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Material Cost</p>
                    <p className="font-semibold">{formatCurrency(costRow?.thisWeek.materialCost ?? 0)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

```

Inside the "Cost Breakdown Summary" card, right after the "Engineering Cost" row (`<div className="flex justify-between items-center py-2 border-b"> ... Engineering Cost ... </div>`), add a warnings block:

```tsx
                  {(costRow?.usingFallbackHours || (costRow?.warnings?.length ?? 0) > 0) && (
                    <div className="text-xs text-amber-600 space-y-0.5">
                      {costRow?.usingFallbackHours && (
                        <p>Not linked to Pulse — using manually-logged hours as a fallback. Link this project to Pulse from the Edit Project dialog for live data.</p>
                      )}
                      {costRow?.warnings?.map((w, i) => <p key={i}>{w}</p>)}
                    </div>
                  )}
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Navigate to `/cost-analysis?project=<a real projectId>` as an admin. Verify:
- "This Week (Pulse)" card renders with a working WeekNavigator (prev/next/"This week" buttons change the displayed hours/cost).
- "Total Man Hours" and "Engineering Cost" in the Cost Breakdown Summary show real, non-zero values for a project with logged Pulse hours.
- For a project not linked to Pulse (no `pulseProjectId` set), the amber fallback notice appears instead of a silent 0.
- Customer PO upload/delete, BOM-snapshot diff, and PO value / misc cost / cost-per-hour inline editing all still work unchanged.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/pages/CostAnalysis.tsx
git commit -m "fix: restore real Pulse hours and WeekNavigator in Cost Analysis detail view"
```

---

## Self-Review Notes

- **Spec coverage:** CostAnalysis Summary restore (Task 4), CostAnalysis Detail restore + WeekNavigator + warnings (Task 5), KPI dashboard real Total Hours + Total Cost formula (Task 3), fake charts removed (Task 3), Needs Attention panel for both approval types (Task 3), pending-claims data via per-project `getOverheads` loop (Task 3), pending-users via `fetchPendingUsers` (Task 3) — all covered. Open Question 1 from the spec (single-project fetch efficiency) resolved as documented: Task 5 calls the full-list `getProjectCosts` and picks its row, matching Task 4's approach — simplest, consistent, no backend change.
- **Type consistency:** `ProjectCostRow`, `DashboardCostTotals`, `PendingClaimsSummary`, `ProjectVisits`, `PendingClaim` are defined once each (Tasks 1–2) and only ever imported, not redefined, in Tasks 3–5.
- **Simplification vs. spec wording:** the spec doc says CostAnalysisSummary's total cost should add `miscCost` "read from the project doc directly" — while writing this plan it became clear `ProjectCostRow.cumulative` already includes `miscCost` and a pre-computed `total` (material + time + misc), server-side. This plan uses `cumulative.total`/`cumulative.miscCost` directly instead of a redundant client-side read, which is strictly simpler and produces the same numbers the spec asked for.
