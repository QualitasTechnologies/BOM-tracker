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
