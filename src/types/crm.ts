// CRM / Pre-Sales Module Types

// ============================================
// Deal Types
// ============================================

export type DealStage =
  | 'new'           // Just received, not yet qualified
  | 'qualification' // Understanding requirements, budget, timeline
  | 'proposal'      // Preparing/sent proposal
  | 'negotiation'   // Price/terms discussion
  | 'won'           // Deal closed - auto-creates project
  | 'lost';         // Deal lost - capture reason

export type DealSource =
  | 'organic'       // Inbound inquiry
  | 'referral'      // Customer/partner referral
  | 'exhibition'    // Trade show/exhibition
  | 'cold-outreach' // Sales prospecting
  | 'repeat'        // Existing customer new project
  | 'tender';       // RFQ/Tender response

export type LostReasonCategory =
  | 'price'         // Too expensive
  | 'competition'   // Lost to competitor
  | 'timing'        // Bad timing / delayed
  | 'budget'        // Client budget cut
  | 'requirements'  // Couldn't meet requirements
  | 'no-response'   // Client went silent
  | 'internal'      // Client internal decision
  | 'other';        // Other reason

export type Currency = 'INR' | 'USD' | 'EUR';

export interface DealNextStep {
  action: string;           // "Send revised proposal"
  dueDate?: Date;           // Optional target date
  assigneeId: string;       // Firebase Auth UID
}

export interface Deal {
  id: string;

  // Basic Info
  name: string;                    // "Safety & MOP Vision AI"
  description: string;             // Project scope description

  // Client & Contacts
  clientId: string;                // Parent client (from Settings → Clients)
  assignedContactIds: string[];    // Contacts from this client assigned to deal

  // Pipeline
  stage: DealStage;
  probability: number;             // 0-100% win probability
  expectedValue: number;           // Estimated deal value
  currency: Currency;              // Default: INR
  expectedCloseDate: Date;

  // Source & Assignment
  source: DealSource;
  assigneeId: string;              // Sales team member (Firebase Auth UID)

  // Google Drive Integration
  driveFolderId?: string;          // Google Drive folder ID
  driveFolderUrl?: string;         // Direct link to folder

  // Draft BOM (for proposals - built during PROPOSAL stage)
  hasDraftBOM: boolean;            // Whether draft BOM exists
  draftBOMTotalCost: number;       // Calculated total for quick reference

  // Linked Entities
  convertedProjectId?: string;     // Set when deal is won

  // Current Next Step (single action)
  nextStep: DealNextStep | null;

  // Tracking
  createdAt: Date;
  createdBy: string;               // Firebase Auth UID
  updatedAt: Date;
  closedAt?: Date;
  lastActivityAt: Date;            // Last log entry timestamp

  // Lost Deal Info
  lostReasonCategory?: LostReasonCategory;
  lostReasonDetails?: string;

  // Archive
  isArchived: boolean;
  archivedAt?: Date;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  clientId: string;                // Parent client

  // Contact Info
  name: string;                    // "Raghav Sharma"
  designation: string;             // "Project Manager"
  email: string;
  phone: string;

  // Role
  isPrimary: boolean;              // Primary contact for client
  department?: string;             // "Engineering", "Procurement"

  // External Links
  hubspotContactId?: string;       // For reference only

  // Tracking
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Activity Log Types
// ============================================

export type ActivityType =
  | 'call'          // Phone call
  | 'meeting'       // In-person or video meeting
  | 'email'         // Email sent
  | 'demo'          // Product demonstration
  | 'proposal'      // Proposal sent
  | 'follow-up'     // Follow-up completed
  | 'stage-change'  // Deal moved to new stage
  | 'note';         // General update

export interface ActivityLogEntry {
  id: string;
  dealId: string;

  // What happened
  action: string;                  // "Sent proposal v1"
  type: ActivityType;

  // When
  completedAt: Date;
  durationInStage?: number;        // Days spent before this action

  // Who
  completedBy: string;             // Firebase Auth UID

  // Context
  notes?: string;
  stageAtTime: DealStage;          // Stage when action was taken

  // Tracking
  createdAt: Date;
}

// ============================================
// Draft BOM Types
// ============================================

export interface DraftBOMItem {
  id: string;

  // Item Info
  name: string;                    // "Industrial Camera - Basler ace2"
  description?: string;
  category: string;                // Must match canonical categories from Settings
  itemType: 'component' | 'service';

  // Quantity & Pricing
  quantity: number;                // For services: duration in days
  estimatedUnitPrice: number;      // Estimated cost

  // For Proposals (customer-facing)
  includeInProposal: boolean;
  proposalDescription?: string;
  proposalUnitPrice?: number;      // Price to quote customer (with margin)

  // Tracking
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftBOMCategory {
  name: string;
  items: DraftBOMItem[];
  isExpanded: boolean;
}

export interface DraftBOMData {
  categories: DraftBOMCategory[];
}

// ============================================
// Proposal Types
// ============================================

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'revised';

export interface ProposalLineItem {
  id: string;
  description: string;
  category: 'hardware' | 'software' | 'services' | 'integration';
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Proposal {
  id: string;
  dealId: string;

  // Proposal Info
  name: string;                    // "Vision Inspection System Proposal v1"
  version: number;
  status: ProposalStatus;

  // Financials
  totalValue: number;
  currency: Currency;
  validUntil: Date;

  // Line Items
  lineItems: ProposalLineItem[];

  // Documents
  proposalDocUrl?: string;         // Google Drive link to PDF

  // Tracking
  sentAt?: Date;
  respondedAt?: Date;
  createdAt: Date;
  createdBy: string;
}

// ============================================
// Client CRM Extension Types
// ============================================

export type ClientSegment = 'enterprise' | 'mid-market' | 'smb';
export type ClientCRMStatus = 'prospect' | 'active' | 'inactive';

export interface ClientCRMFields {
  // CRM fields to extend existing Client model
  industry?: string;               // "Automotive", "FMCG", etc.
  website?: string;
  segment?: ClientSegment;
  crmStatus?: ClientCRMStatus;

  // Google Drive Integration
  driveFolderId?: string;
  driveFolderUrl?: string;

  // External Links
  hubspotCompanyId?: string;

  // Computed/cached
  totalDeals?: number;
  wonDeals?: number;
  totalRevenue?: number;
}

// ============================================
// Pipeline Summary Types (for Dashboard)
// ============================================

export interface PipelineStageSummary {
  stage: DealStage;
  count: number;
  totalValue: number;
  weightedValue: number;           // value * probability
}

export interface PipelineSummary {
  stages: PipelineStageSummary[];
  totalDeals: number;
  totalValue: number;
  totalWeightedValue: number;
}

// ============================================
// Helper Functions
// ============================================

export const DEAL_STAGE_ORDER: DealStage[] = [
  'new',
  'qualification',
  'proposal',
  'negotiation',
  'won',
  'lost'
];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  new: 'New',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost'
};

export const DEAL_SOURCE_LABELS: Record<DealSource, string> = {
  organic: 'Organic / Inbound',
  referral: 'Referral',
  exhibition: 'Exhibition / Trade Show',
  'cold-outreach': 'Cold Outreach',
  repeat: 'Repeat Customer',
  tender: 'Tender / RFQ'
};

export const LOST_REASON_LABELS: Record<LostReasonCategory, string> = {
  price: 'Price Too High',
  competition: 'Lost to Competitor',
  timing: 'Bad Timing',
  budget: 'Budget Cut',
  requirements: 'Requirements Mismatch',
  'no-response': 'No Response',
  internal: 'Internal Decision',
  other: 'Other'
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  demo: 'Demo',
  proposal: 'Proposal',
  'follow-up': 'Follow-up',
  'stage-change': 'Stage Change',
  note: 'Note'
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€'
};

// Calculate weighted value
export function calculateWeightedValue(value: number, probability: number): number {
  return value * (probability / 100);
}

// Check if deal is stale (no activity in 7+ days)
export function isDealStale(lastActivityAt: Date, thresholdDays: number = 7): boolean {
  const now = new Date();
  const diffMs = now.getTime() - new Date(lastActivityAt).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= thresholdDays;
}

// Get days since last activity
export function getDaysSinceActivity(lastActivityAt: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - new Date(lastActivityAt).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Format currency value
export function formatCurrencyValue(value: number, currency: Currency = 'INR'): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (value >= 10000000) {
    return `${symbol}${(value / 10000000).toFixed(1)}Cr`;
  } else if (value >= 100000) {
    return `${symbol}${(value / 100000).toFixed(1)}L`;
  } else if (value >= 1000) {
    return `${symbol}${(value / 1000).toFixed(1)}K`;
  }
  return `${symbol}${value.toLocaleString()}`;
}
