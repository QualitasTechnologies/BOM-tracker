export type SupportPriority = 'critical' | 'high' | 'medium' | 'low';

export type SupportTicketStatus =
  | 'open'
  | 'waiting'
  | 'in-progress'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type SupportIssueCategory =
  | 'vision-performance'
  | 'camera-lens-lighting'
  | 'software'
  | 'electrical'
  | 'mechanical'
  | 'plc-integration'
  | 'network'
  | 'preventive-maintenance'
  | 'training'
  | 'other';

export type SupportChannel = 'email' | 'phone' | 'whatsapp' | 'site' | 'internal';

export type CoverageType = 'warranty' | 'amc' | 'chargeable' | 'goodwill' | 'undetermined';

export type CommercialStatus =
  | 'not-required'
  | 'assessment-required'
  | 'quotation-required'
  | 'quotation-prepared'
  | 'quotation-sent'
  | 'accepted'
  | 'rejected'
  | 'invoiced';

export type CustomerConfirmation = 'pending' | 'confirmed' | 'not-required';

export type SupportDocumentCategory =
  | 'manual'
  | 'drawing'
  | 'electrical-drawing'
  | 'mechanical-drawing'
  | 'software-backup'
  | 'acceptance-document'
  | 'amc-contract'
  | 'machine-photo'
  | 'diagnostic-log'
  | 'quotation'
  | 'quotation-acceptance'
  | 'rca-report'
  | 'solution-report'
  | 'other';

export interface SupportContact {
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
}

export interface SupportProjectProfile {
  commissioningDate?: string;
  machineSerialNumber?: string;
  machineModel?: string;
  siteLocation?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  amcStatus?: 'none' | 'active' | 'expired';
  amcStartDate?: string;
  amcEndDate?: string;
  amcContractNumber?: string;
  responseCommitmentHours?: number;
  supportContactId?: string;
  /** @deprecated Contacts now belong to the client CRM. Kept for reading legacy data only. */
  supportContacts?: SupportContact[];
  internalNotes?: string;
}

export interface SupportAssignee {
  userId: string;
  name: string;
  email?: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  projectId: string;
  projectName: string;
  clientName: string;
  clientId?: string;
  title: string;
  description: string;
  category: SupportIssueCategory;
  priority: SupportPriority;
  status: SupportTicketStatus;
  channel: SupportChannel;
  reportedByName: string;
  reportedByContactId?: string;
  reportedByEmail?: string;
  reportedByPhone?: string;
  reportedAt: Date;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  updatedAt: Date;
  assignee?: SupportAssignee;
  coverageType: CoverageType;
  coverageNotes?: string;
  commercialStatus: CommercialStatus;
  estimatedAmount?: number;
  quotationNumber?: string;
  quotationDocumentId?: string;
  quotationSentAt?: Date;
  quotationAcceptedAt?: Date;
  acceptanceReference?: string;
  firstResponseTargetAt: Date;
  resolutionTargetAt: Date;
  firstResponseAt?: Date;
  scheduledFor?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  siteVisitRequired: boolean;
  downtime: boolean;
  machineStopped: boolean;
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  resolutionSummary?: string;
  customerConfirmation: CustomerConfirmation;
  customerConfirmedAt?: Date;
}

export type SupportActivityType =
  | 'created'
  | 'note'
  | 'status-change'
  | 'assignment'
  | 'commercial'
  | 'communication'
  | 'document'
  | 'resolution';

export interface SupportActivity {
  id: string;
  type: SupportActivityType;
  message: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SupportDocument {
  id: string;
  projectId: string;
  ticketId?: string;
  name: string;
  url: string;
  storagePath: string;
  category: SupportDocumentCategory;
  fileSize: number;
  contentType: string;
  uploadedAt: Date;
  uploadedBy: string;
  uploadedByName: string;
}

export interface CreateSupportTicketInput {
  projectId: string;
  projectName: string;
  clientName: string;
  clientId?: string;
  title: string;
  description: string;
  category: SupportIssueCategory;
  priority: SupportPriority;
  channel: SupportChannel;
  reportedByName: string;
  reportedByContactId?: string;
  reportedByEmail?: string;
  reportedByPhone?: string;
  reportedAt?: Date;
  coverageType: CoverageType;
  coverageNotes?: string;
  commercialStatus: CommercialStatus;
  assignee?: SupportAssignee;
  siteVisitRequired: boolean;
  downtime: boolean;
  machineStopped: boolean;
}
