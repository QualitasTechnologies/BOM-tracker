// Transcript Service - AI extraction and status update generation

import type { ExtractedActivity, ActivityType } from '@/types/transcript';
import { buildContextPrompt, getProjectNamesForExtraction } from '@/utils/projectContextFirestore';

const FUNCTIONS_BASE_URL = 'https://us-central1-visionbomtracker.cloudfunctions.net';

export interface ExtractionRequest {
  transcript: string;
  knownProjects: string[];
  meetingDate?: string;
  projectContext?: string; // Rich context from project context files
}

export interface ExtractionResponse {
  activities: ExtractedActivity[];
  unrecognizedProjects: string[];
  warnings: string[];
  totalActivities: number;
  projectsFound: string[];
}

export interface StatusUpdateRequest {
  projectName: string;
  activities: {
    type: ActivityType;
    summary: string;
  }[];
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface StatusUpdateResponse {
  statusUpdate: string;
  projectName: string;
  activitiesIncluded: number;
}

/**
 * Extract activities from a transcript using AI
 */
export const extractActivitiesFromTranscript = async (
  request: ExtractionRequest
): Promise<ExtractionResponse> => {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/extractTranscriptActivities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript: request.transcript,
      knownProjects: request.knownProjects,
      meetingDate: request.meetingDate,
      projectContext: request.projectContext,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Extraction failed: ${response.status}`);
  }

  return response.json();
};

/**
 * Extract activities with auto-loaded context from project context files
 */
export const extractActivitiesWithContext = async (
  transcript: string,
  meetingDate?: string
): Promise<ExtractionResponse> => {
  // Load context from project context files
  const [projectContext, projectNames] = await Promise.all([
    buildContextPrompt(),
    getProjectNamesForExtraction(),
  ]);

  return extractActivitiesFromTranscript({
    transcript,
    knownProjects: projectNames,
    meetingDate,
    projectContext,
  });
};

/**
 * Generate a client-ready status update from activities
 */
export const generateStatusUpdate = async (
  request: StatusUpdateRequest
): Promise<StatusUpdateResponse> => {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/generateStatusUpdate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Generation failed: ${response.status}`);
  }

  return response.json();
};
