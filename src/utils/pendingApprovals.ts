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
