// Milestone & Delay Tracking Types (CEO Dashboard Phase 2)

// ============================================
// Milestone Types
// ============================================

export type MilestoneStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';

export interface Milestone {
  id: string;
  name: string;
  description?: string;
  order: number; // Display ordering (1, 2, 3...)

  // Dates (ISO strings)
  originalPlannedEndDate?: string; // Set when project is baselined (immutable after)
  currentPlannedEndDate: string;   // Can be updated (triggers delay log if baselined)
  actualEndDate?: string;          // When completed

  // Status (outcome-based, not percentage)
  status: MilestoneStatus;

  // Progress notes (not percentage tracking)
  lastProgressNote?: string;
  lastProgressDate?: string;

  // Metadata
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface MilestoneInput {
  name: string;
  description?: string;
  currentPlannedEndDate: string;
  status?: MilestoneStatus;
}

// ============================================
// Delay Log Types
// ============================================

export type DelayAttribution =
  | 'internal-team'      // Team capacity, skill gaps, underestimation
  | 'internal-process'   // Process failures, unclear scope, planning gaps
  | 'external-client'    // Client delays, scope changes, approvals
  | 'external-vendor'    // Supplier delays, parts availability
  | 'external-other';    // Weather, regulatory, unforeseen

export type DelayEntityType = 'project' | 'milestone';

export interface DelayLog {
  id: string;

  // What was delayed
  entityType: DelayEntityType;
  entityId: string;       // projectId or milestoneId
  entityName: string;     // For display without joins

  // The change
  previousDate: string;   // ISO string
  newDate: string;        // ISO string
  delayDays: number;      // Positive = delay, negative = acceleration

  // Why (required)
  reason: string;         // Min 20 chars
  attribution: DelayAttribution;

  // Cumulative tracking
  cumulativeProjectDelay: number; // Total days project is delayed from original

  // Metadata
  loggedAt: string;
  loggedBy: string;
  loggedByName: string;   // For display
}

export interface DelayLogInput {
  entityType: DelayEntityType;
  entityId: string;
  entityName: string;
  previousDate: string;
  newDate: string;
  reason: string;
  attribution: DelayAttribution;
}

// ============================================
// Weekly Update Types
// ============================================

export type WeeklyUpdateStatus = 'on-track' | 'at-risk' | 'delayed';
export type WeeklyUpdateDraftStatus = 'draft' | 'sent';

export interface WeeklyUpdate {
  id: string;
  weekStartDate: string; // Monday of the week (YYYY-MM-DD)

  // Auto-generated (system fills these)
  autoStatus: WeeklyUpdateStatus;
  autoMilestoneSummary: string;  // "Planning ✅, Hardware 🔄, Testing ⏳"
  autoDelaysSummary?: string;    // "+3 days this week" or "No delays"

  // Owner input (required before sending)
  ownerSummary: string;          // 2-3 sentence context
  blockers?: string;
  nextWeekPlan?: string;

  // Distribution
  status: WeeklyUpdateDraftStatus;
  sentAt?: string;
  sentBy?: string;
  sentToEmails?: string[];       // Snapshot of who received it

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Project Extension Types (for CEO Dashboard)
// ============================================

export type ProjectCategory = 'internal' | 'customer';

export interface ProjectCEOFields {
  // Classification
  category?: ProjectCategory;
  projectOwnerId?: string;
  kickoffDate?: string;

  // Baseline tracking
  originalDeadline?: string;  // Immutable once baselined
  isBaselined?: boolean;      // false until owner locks it
  baselinedAt?: string;       // When baseline was locked
  baselinedBy?: string;       // Who locked it
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate delay days between two dates
 * Positive = delay (new date is later)
 * Negative = acceleration (new date is earlier)
 */
export function calculateDelayDays(previousDate: string, newDate: string): number {
  const prev = new Date(previousDate);
  const next = new Date(newDate);
  const diffMs = next.getTime() - prev.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate cumulative project delay from original deadline
 */
export function calculateCumulativeDelay(
  originalDeadline: string | undefined,
  currentDeadline: string
): number {
  if (!originalDeadline) return 0;
  return calculateDelayDays(originalDeadline, currentDeadline);
}

/**
 * Get status label for display
 */
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'completed': 'Completed',
  'blocked': 'Blocked',
};

/**
 * Get status colors for display (Tailwind classes)
 */
export const MILESTONE_STATUS_COLORS: Record<MilestoneStatus, string> = {
  'not-started': 'bg-gray-100 text-gray-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completed': 'bg-green-100 text-green-800',
  'blocked': 'bg-red-100 text-red-800',
};

/**
 * Get status icon for display
 */
export const MILESTONE_STATUS_ICONS: Record<MilestoneStatus, string> = {
  'not-started': '⏳',
  'in-progress': '🔄',
  'completed': '✅',
  'blocked': '🚫',
};

/**
 * Get attribution label for display
 */
export const DELAY_ATTRIBUTION_LABELS: Record<DelayAttribution, string> = {
  'internal-team': 'Internal - Team',
  'internal-process': 'Internal - Process',
  'external-client': 'External - Client',
  'external-vendor': 'External - Vendor',
  'external-other': 'External - Other',
};

/**
 * Get attribution description for display
 */
export const DELAY_ATTRIBUTION_DESCRIPTIONS: Record<DelayAttribution, string> = {
  'internal-team': 'Team capacity, skill gaps, underestimation',
  'internal-process': 'Process failures, unclear scope, planning gaps',
  'external-client': 'Client delays, scope changes, approvals',
  'external-vendor': 'Supplier delays, parts availability',
  'external-other': 'Weather, regulatory, unforeseen circumstances',
};

/**
 * Get attribution colors for display (Tailwind classes)
 */
export const DELAY_ATTRIBUTION_COLORS: Record<DelayAttribution, string> = {
  'internal-team': 'bg-orange-100 text-orange-800',
  'internal-process': 'bg-yellow-100 text-yellow-800',
  'external-client': 'bg-purple-100 text-purple-800',
  'external-vendor': 'bg-blue-100 text-blue-800',
  'external-other': 'bg-gray-100 text-gray-800',
};

/**
 * Validate delay reason (min 20 chars)
 */
export function validateDelayReason(reason: string): { valid: boolean; error?: string } {
  const trimmed = reason.trim();
  if (trimmed.length < 20) {
    return {
      valid: false,
      error: `Please provide a detailed reason (min 20 characters). Current: ${trimmed.length}`,
    };
  }
  return { valid: true };
}

/**
 * Validate milestone name
 */
export function validateMilestoneName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Milestone name must be at least 3 characters' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Milestone name must be less than 100 characters' };
  }
  return { valid: true };
}

/**
 * Format date for display (e.g., "Jan 15, 2025")
 */
export function formatMilestoneDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Get variance display string (e.g., "+8 days" or "On Track")
 */
export function getVarianceDisplay(
  originalDate: string | undefined,
  currentDate: string
): { text: string; color: string } {
  if (!originalDate) {
    return { text: 'No baseline', color: 'text-gray-500' };
  }

  const delay = calculateDelayDays(originalDate, currentDate);

  if (delay === 0) {
    return { text: 'On Track', color: 'text-green-600' };
  } else if (delay > 0) {
    return { text: `+${delay} days`, color: 'text-red-600' };
  } else {
    return { text: `${delay} days`, color: 'text-green-600' }; // Ahead of schedule
  }
}

/**
 * Generate Monday of the current week (for weekly updates)
 */
export function getCurrentWeekMonday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when Sunday
  const monday = new Date(today.setDate(diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Auto-calculate weekly update status based on project data
 */
export function calculateWeeklyStatus(
  cumulativeDelay: number,
  hasBlockedMilestones: boolean
): WeeklyUpdateStatus {
  if (cumulativeDelay > 7) return 'delayed';
  if (cumulativeDelay > 0 || hasBlockedMilestones) return 'at-risk';
  return 'on-track';
}

/**
 * Generate auto milestone summary for weekly update
 */
export function generateMilestoneSummary(milestones: Milestone[]): string {
  if (milestones.length === 0) return 'No milestones defined';

  return milestones
    .sort((a, b) => a.order - b.order)
    .map((m) => `${MILESTONE_STATUS_ICONS[m.status]} ${m.name}`)
    .join(', ');
}
