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
