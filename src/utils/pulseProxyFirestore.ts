import { getFunctions, httpsCallable } from 'firebase/functions';

export interface PulseProjectOption {
  id: number;
  name: string;
  tag?: string | null;
}

export interface ProjectCostRow {
  projectId: string;
  projectName: string;
  status: string;
  pulseProjectId: number | null;
  usingFallbackHours: boolean;
  thisWeek: {
    materialCost: number;
    timeHours: number;
    timeCost: number;
    total: number;
  };
  cumulative: {
    materialCost: number;
    timeHours: number;
    timeCost: number;
    miscCost: number;
    total: number;
    poValue: number;
    grossProfit: number;
    profitMargin: number | null;
  };
  byPerson: Array<{
    email: string;
    name: string;
    hoursThisWeek: number;
    hoursCumulative: number;
    costThisWeek: number;
    costCumulative: number;
    rateUsed: number;
    rateSource: 'engineer' | 'project_fallback' | 'none';
  }>;
  warnings: string[];
}

export interface ProjectCostsResponse {
  range: { from: string; to: string };
  projects: ProjectCostRow[];
}

export const listPulseProjects = async (): Promise<PulseProjectOption[]> => {
  const fn = httpsCallable<unknown, { projects: PulseProjectOption[] }>(getFunctions(), 'listPulseProjects');
  const res = await fn();
  return res.data.projects;
};

export const getProjectCosts = async (weekStart: string, weekEnd: string): Promise<ProjectCostsResponse> => {
  const fn = httpsCallable<{ weekStart: string; weekEnd: string }, ProjectCostsResponse>(getFunctions(), 'getProjectCosts');
  const res = await fn({ weekStart, weekEnd });
  return res.data;
};
