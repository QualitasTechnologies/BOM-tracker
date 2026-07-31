import type {
  CommercialStatus,
  CoverageType,
  SupportPriority,
  SupportProjectProfile,
  SupportTicket,
  SupportTicketStatus,
} from '@/types/support';

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  critical: 'P1 · Critical',
  high: 'P2 · High',
  medium: 'P3 · Normal',
  low: 'P4 · Low',
};

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  waiting: 'Waiting',
  'in-progress': 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const SUPPORT_STATUS_ORDER: SupportTicketStatus[] = [
  'open',
  'waiting',
  'in-progress',
  'resolved',
  'closed',
  'cancelled',
];

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  warranty: 'Under warranty',
  amc: 'Under AMC',
  chargeable: 'Chargeable',
  goodwill: 'Goodwill',
  undetermined: 'To be assessed',
};

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  'not-required': 'Not required',
  'assessment-required': 'Assessment required',
  'quotation-required': 'Quotation required',
  'quotation-prepared': 'Quotation prepared',
  'quotation-sent': 'Quotation sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  invoiced: 'Invoiced',
};

const PRIORITY_TARGETS: Record<SupportPriority, { responseHours: number; resolutionHours: number }> = {
  critical: { responseHours: 2, resolutionHours: 8 },
  high: { responseHours: 4, resolutionHours: 24 },
  medium: { responseHours: 8, resolutionHours: 72 },
  low: { responseHours: 24, resolutionHours: 120 },
};

const isWithin = (date: Date, start?: string, end?: string) => {
  if (!start || !end) return false;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T23:59:59`);
  return date >= startDate && date <= endDate;
};

export function determineCoverage(
  profile: SupportProjectProfile | undefined,
  reportedAt = new Date(),
): CoverageType {
  if (!profile) return 'undetermined';
  if (isWithin(reportedAt, profile.warrantyStartDate, profile.warrantyEndDate)) return 'warranty';
  if (
    profile.amcStatus === 'active' &&
    isWithin(reportedAt, profile.amcStartDate, profile.amcEndDate)
  ) {
    return 'amc';
  }
  if (profile.warrantyEndDate || profile.amcEndDate) return 'chargeable';
  return 'undetermined';
}

export function defaultCommercialStatus(coverage: CoverageType): CommercialStatus {
  if (coverage === 'warranty' || coverage === 'amc' || coverage === 'goodwill') {
    return 'not-required';
  }
  if (coverage === 'chargeable') return 'quotation-required';
  return 'assessment-required';
}

export function calculateSupportTargets(priority: SupportPriority, from = new Date()) {
  const target = PRIORITY_TARGETS[priority];
  return {
    firstResponseTargetAt: new Date(from.getTime() + target.responseHours * 60 * 60 * 1000),
    resolutionTargetAt: new Date(from.getTime() + target.resolutionHours * 60 * 60 * 1000),
  };
}

export function isTicketOpen(status: SupportTicketStatus) {
  return !['closed', 'cancelled'].includes(status);
}

export function isOverdue(ticket: SupportTicket, now = new Date()) {
  if (!isTicketOpen(ticket.status) || ticket.status === 'resolved') return false;
  const target = ticket.firstResponseAt ? ticket.resolutionTargetAt : ticket.firstResponseTargetAt;
  return target.getTime() < now.getTime();
}

export function getTransitionBlocker(
  ticket: SupportTicket,
  nextStatus: SupportTicketStatus,
): string | null {
  if (
    nextStatus === 'in-progress' &&
    ticket.coverageType === 'chargeable' &&
    !['accepted', 'invoiced'].includes(ticket.commercialStatus)
  ) {
    return 'A chargeable ticket needs quotation acceptance before work can be scheduled or started.';
  }

  if (
    ['resolved', 'closed'].includes(nextStatus) &&
    (!ticket.rootCause?.trim() ||
      !ticket.correctiveAction?.trim() ||
      !ticket.resolutionSummary?.trim())
  ) {
    return 'Complete the root cause, corrective action, and solution summary before resolving the ticket.';
  }

  if (nextStatus === 'closed' && ticket.customerConfirmation === 'pending') {
    return 'Record customer confirmation before closing the ticket.';
  }

  return null;
}

export function coverageExpiryLabel(profile?: SupportProjectProfile, now = new Date()) {
  const coverage = determineCoverage(profile, now);
  if (coverage === 'warranty') return `Warranty until ${profile?.warrantyEndDate}`;
  if (coverage === 'amc') return `AMC until ${profile?.amcEndDate}`;
  if (coverage === 'chargeable') return 'Out of warranty / AMC';
  return 'Coverage not configured';
}
