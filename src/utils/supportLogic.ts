import type {
  CommercialStatus,
  CoverageType,
  SupportPriority,
  SupportPaymentStatus,
  InstalledMachine,
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
  machine?: InstalledMachine,
): CoverageType {
  if (!profile && !machine) return 'undetermined';
  const coverage = machine || profile;
  if (isWithin(reportedAt, coverage?.warrantyStartDate, coverage?.warrantyEndDate)) return 'warranty';
  if (
    coverage?.amcStatus === 'active' &&
    isWithin(reportedAt, coverage.amcStartDate, coverage.amcEndDate)
  ) {
    return 'amc';
  }
  if (coverage?.warrantyEndDate || coverage?.amcEndDate) return 'chargeable';
  return 'undetermined';
}

export function getInstalledMachines(profile?: SupportProjectProfile): InstalledMachine[] {
  if (Array.isArray(profile?.machines)) return profile.machines;
  if (
    profile?.machineSerialNumber ||
    profile?.machineModel ||
    profile?.siteLocation ||
    profile?.commissioningDate
  ) {
    return [{
      id: 'legacy-primary-machine',
      name: profile.machineModel || 'Primary machine',
      model: profile.machineModel,
      serialNumber: profile.machineSerialNumber || 'Not recorded',
      siteLocation: profile.siteLocation,
      commissioningDate: profile.commissioningDate,
      warrantyStartDate: profile.warrantyStartDate,
      warrantyEndDate: profile.warrantyEndDate,
      amcStatus: profile.amcStatus,
      amcStartDate: profile.amcStartDate,
      amcEndDate: profile.amcEndDate,
      amcContractNumber: profile.amcContractNumber,
      status: 'active',
    }];
  }
  return [];
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

export function shouldShowInvoiceTracking(ticket: SupportTicket) {
  if (ticket.coverageType !== 'chargeable') return false;
  return Boolean(
    ticket.quotation ||
      ticket.invoiceDocumentId ||
      ticket.invoiceNumber ||
      (ticket.paymentStatus && ticket.paymentStatus !== 'not-invoiced') ||
      ['accepted', 'invoiced'].includes(ticket.commercialStatus),
  );
}

export function needsCommercialAction(ticket: SupportTicket) {
  if (ticket.coverageType !== 'chargeable' || ticket.status === 'cancelled') return false;
  if (ticket.commercialStatus === 'rejected') return false;

  const paymentStatus = ticket.paymentStatus || 'not-invoiced';
  if (paymentStatus === 'paid' || paymentStatus === 'waived') return false;
  if (paymentStatus === 'invoice-raised' || paymentStatus === 'partially-paid') return true;
  if (ticket.commercialStatus === 'invoiced') return true;
  if (ticket.commercialStatus === 'accepted') {
    return ['resolved', 'closed'].includes(ticket.status);
  }
  return true;
}

export interface PaymentTrackingInput {
  paymentStatus: SupportPaymentStatus;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceDueDate: string;
  invoiceAmount: number;
  amountReceived: number;
  paymentReceivedDate: string;
  paymentReference: string;
}

export function validatePaymentTracking(input: PaymentTrackingInput): string | null {
  if (input.paymentStatus === 'not-invoiced' || input.paymentStatus === 'waived') return null;
  if (!input.invoiceNumber.trim()) return 'Enter the invoice number.';
  if (!input.invoiceDate) return 'Enter the invoice date.';
  if (!input.invoiceDueDate) return 'Enter the invoice due date.';
  if (!(input.invoiceAmount > 0)) return 'Enter an invoice amount greater than zero.';

  if (input.paymentStatus === 'partially-paid' || input.paymentStatus === 'paid') {
    if (!(input.amountReceived > 0)) return 'Enter the amount received.';
    if (!input.paymentReceivedDate) return 'Enter the payment received date.';
    if (!input.paymentReference.trim()) return 'Enter the payment reference.';
  }
  if (input.paymentStatus === 'partially-paid' && input.amountReceived >= input.invoiceAmount) {
    return 'Use Paid when the full invoice amount has been received.';
  }
  if (input.paymentStatus === 'paid' && input.amountReceived < input.invoiceAmount) {
    return 'Payment received is below the invoice total. Use Partially paid instead.';
  }
  return null;
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

export function coverageExpiryLabel(
  profile?: SupportProjectProfile,
  now = new Date(),
  machine?: InstalledMachine,
) {
  const coverage = determineCoverage(profile, now, machine);
  const source = machine || profile;
  if (coverage === 'warranty') return `Warranty until ${source?.warrantyEndDate}`;
  if (coverage === 'amc') return `AMC until ${source?.amcEndDate}`;
  if (coverage === 'chargeable') return 'Out of warranty / AMC';
  return 'Coverage not configured';
}
