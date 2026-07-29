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
