// Transcript Activity Types (Standup Capture System)
// Groups activities by PROJECT (not milestone) for status update generation

// ============================================
// Activity Types
// ============================================

export type ActivityType =
  | 'progress'   // Work completed, milestones hit
  | 'blocker'    // Issues preventing progress
  | 'decision'   // Technical or process decisions made
  | 'action'     // Action items, commitments, next steps
  | 'note';      // General notes, context

// ============================================
// Transcript Activity
// ============================================

export interface TranscriptActivity {
  id: string;
  projectId: string;
  projectName: string;  // "APIT", "Tweezerman", etc. (for display)

  // Extracted content
  type: ActivityType;
  summary: string;           // Cleaned up, client-readable summary
  rawExcerpt?: string;       // Original transcript segment (for reference)

  // Attribution
  speaker?: string;          // Who said it: "Anandha", "Puneeth"

  // Timing
  meetingDate: string;       // Date of the meeting (YYYY-MM-DD)
  timestamp?: string;        // Time in meeting: "00:03:50"

  // Source tracking
  source: 'transcript' | 'manual';
  transcriptId?: string;     // Reference to parent Transcript document

  // Metadata
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface TranscriptActivityInput {
  projectId: string;
  projectName: string;
  type: ActivityType;
  summary: string;
  rawExcerpt?: string;
  speaker?: string;
  meetingDate: string;
  timestamp?: string;
  source: 'transcript' | 'manual';
  transcriptId?: string;
}

// ============================================
// Transcript (Raw Storage)
// ============================================

export interface Transcript {
  id: string;

  // Content
  rawText: string;           // Full transcript text
  fileName?: string;         // Original filename if available

  // Timing
  meetingDate: string;       // Date of the meeting (YYYY-MM-DD)
  meetingTitle?: string;     // "Daily Engineering Updates"

  // Processing status
  processed: boolean;
  processedAt?: string;
  extractedProjectCount?: number;
  extractedActivityCount?: number;

  // Metadata
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

// ============================================
// AI Extraction Types
// ============================================

export interface ExtractedActivity {
  projectName: string;       // AI-identified project name
  type: ActivityType;
  summary: string;
  rawExcerpt: string;
  speaker?: string;
  timestamp?: string;
  confidence: number;        // 0-1, AI confidence score
}

export interface ExtractionResult {
  activities: ExtractedActivity[];
  unrecognizedProjects: string[];  // Projects AI couldn't match
  warnings: string[];              // Any extraction issues
}

// ============================================
// Status Update Types
// ============================================

export interface StatusUpdate {
  id: string;
  projectId: string;
  projectName: string;

  // Date range covered
  startDate: string;
  endDate: string;

  // Generated content
  generatedText: string;     // AI-generated status update
  editedText?: string;       // User's edited version

  // Activities included
  activityIds: string[];     // References to TranscriptActivity docs

  // Distribution
  sentAt?: string;
  sentTo?: string[];         // Email addresses

  // Metadata
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

// ============================================
// Display Constants
// ============================================

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  'progress': 'Progress',
  'blocker': 'Blocker',
  'decision': 'Decision',
  'action': 'Action Item',
  'note': 'Note',
};

export const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  'progress': 'bg-green-100 text-green-800 border-green-200',
  'blocker': 'bg-red-100 text-red-800 border-red-200',
  'decision': 'bg-purple-100 text-purple-800 border-purple-200',
  'action': 'bg-blue-100 text-blue-800 border-blue-200',
  'note': 'bg-gray-100 text-gray-800 border-gray-200',
};

export const ACTIVITY_TYPE_ICONS: Record<ActivityType, string> = {
  'progress': '✅',
  'blocker': '🚫',
  'decision': '🎯',
  'action': '📋',
  'note': '📝',
};

// ============================================
// Helper Functions
// ============================================

/**
 * Format meeting date for display
 */
export function formatMeetingDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group activities by project
 */
export function groupActivitiesByProject(
  activities: TranscriptActivity[]
): Map<string, TranscriptActivity[]> {
  const grouped = new Map<string, TranscriptActivity[]>();

  activities.forEach((activity) => {
    const key = activity.projectId;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(activity);
  });

  return grouped;
}

/**
 * Group activities by date
 */
export function groupActivitiesByDate(
  activities: TranscriptActivity[]
): Map<string, TranscriptActivity[]> {
  const grouped = new Map<string, TranscriptActivity[]>();

  // Sort by date descending first
  const sorted = [...activities].sort(
    (a, b) => b.meetingDate.localeCompare(a.meetingDate)
  );

  sorted.forEach((activity) => {
    const key = activity.meetingDate;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(activity);
  });

  return grouped;
}

/**
 * Generate status update prompt for AI
 */
export function generateStatusUpdatePrompt(
  projectName: string,
  activities: TranscriptActivity[]
): string {
  const byType = {
    progress: activities.filter((a) => a.type === 'progress'),
    blocker: activities.filter((a) => a.type === 'blocker'),
    decision: activities.filter((a) => a.type === 'decision'),
    action: activities.filter((a) => a.type === 'action'),
    note: activities.filter((a) => a.type === 'note'),
  };

  let context = `Project: ${projectName}\n\n`;

  if (byType.progress.length > 0) {
    context += `Progress this week:\n${byType.progress.map((a) => `- ${a.summary}`).join('\n')}\n\n`;
  }

  if (byType.blocker.length > 0) {
    context += `Current blockers:\n${byType.blocker.map((a) => `- ${a.summary}`).join('\n')}\n\n`;
  }

  if (byType.decision.length > 0) {
    context += `Key decisions:\n${byType.decision.map((a) => `- ${a.summary}`).join('\n')}\n\n`;
  }

  if (byType.action.length > 0) {
    context += `Next steps:\n${byType.action.map((a) => `- ${a.summary}`).join('\n')}\n\n`;
  }

  return context;
}

/**
 * Parse date from Fathom transcript filename
 * Example: "Daily Engineering Updates  73840614- transcript.txt"
 * Returns null if date cannot be parsed
 */
export function parseDateFromFilename(filename: string): string | null {
  // Fathom filenames don't contain dates in a parseable format
  // The number (73840614) is a Fathom meeting ID, not a date
  // We'll need to use today's date or let user select
  return null;
}

/**
 * Extract meeting title from filename
 * Example: "Daily Engineering Updates  73840614- transcript.txt" -> "Daily Engineering Updates"
 */
export function extractMeetingTitle(filename: string): string {
  // Remove trailing " XXXXXXXX- transcript.txt" pattern
  const match = filename.match(/^(.+?)\s+\d+-\s*transcript\.txt$/i);
  if (match) {
    return match[1].trim();
  }
  // Remove just ".txt" if pattern doesn't match
  return filename.replace(/\.txt$/i, '').trim();
}
