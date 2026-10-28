import { auth, db } from "@/firebase";
import { isScopedProjectReadEnabled } from "./projectReadMode";
import { nativeProjectReads } from "./nativeProjectReads";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  Unsubscribe,
  limit,
  Timestamp,
} from "firebase/firestore";
import type {
  Transcript,
  TranscriptActivity,
  TranscriptActivityInput,
  StatusUpdate,
} from "@/types/transcript";

// ============================================
// Collection References
// ============================================

// Global transcripts collection (not project-specific)
const getTranscriptsCol = () => collection(db, "transcripts");

// Global activities collection (queryable by projectId)
const getActivitiesCol = () => collection(db, "transcriptActivities");

// Global status updates collection
const getStatusUpdatesCol = () => collection(db, "statusUpdates");

// ============================================
// Transcript Operations
// ============================================

/**
 * Convert Firestore document to Transcript
 */
const docToTranscript = (docSnap: any): Transcript => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    rawText: data.rawText,
    fileName: data.fileName,
    meetingDate: data.meetingDate,
    meetingTitle: data.meetingTitle,
    processed: data.processed ?? false,
    processedAt: data.processedAt,
    extractedProjectCount: data.extractedProjectCount,
    extractedActivityCount: data.extractedActivityCount,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
    createdByName: data.createdByName,
  };
};

/**
 * Add a new transcript
 */
export const addTranscript = async (
  rawText: string,
  meetingDate: string,
  meetingTitle: string | undefined,
  createdBy: string,
  createdByName: string,
  fileName?: string
): Promise<string> => {
  const transcriptsCol = getTranscriptsCol();
  const newDocRef = doc(transcriptsCol);
  const now = new Date().toISOString();

  // Build transcript data, excluding undefined values (Firestore rejects undefined)
  const transcriptData: Record<string, any> = {
    id: newDocRef.id,
    rawText,
    meetingDate,
    processed: false,
    createdAt: now,
    createdBy,
    createdByName,
  };

  // Only add optional fields if they have values
  if (fileName) transcriptData.fileName = fileName;
  if (meetingTitle) transcriptData.meetingTitle = meetingTitle;

  await setDoc(newDocRef, transcriptData);
  return newDocRef.id;
};

/**
 * Get a transcript by ID
 */
export const getTranscript = async (transcriptId: string): Promise<Transcript | null> => {
  const transcriptsCol = getTranscriptsCol();
  const docRef = doc(transcriptsCol, transcriptId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;
  return docToTranscript(docSnap);
};

/**
 * Mark transcript as processed
 */
export const markTranscriptProcessed = async (
  transcriptId: string,
  extractedProjectCount: number,
  extractedActivityCount: number
): Promise<void> => {
  const transcriptsCol = getTranscriptsCol();
  const docRef = doc(transcriptsCol, transcriptId);

  await updateDoc(docRef, {
    processed: true,
    processedAt: new Date().toISOString(),
    extractedProjectCount,
    extractedActivityCount,
  });
};

/**
 * Get recent transcripts
 */
export const getRecentTranscripts = async (limitCount: number = 20): Promise<Transcript[]> => {
  const transcriptsCol = getTranscriptsCol();
  const q = query(
    transcriptsCol,
    orderBy("meetingDate", "desc"),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToTranscript);
};

/**
 * Subscribe to recent transcripts
 */
export const subscribeToTranscripts = (
  callback: (transcripts: Transcript[]) => void,
  limitCount: number = 20
): Unsubscribe => {
  const transcriptsCol = getTranscriptsCol();
  const q = query(
    transcriptsCol,
    orderBy("meetingDate", "desc"),
    limit(limitCount)
  );

  return onSnapshot(q, (snapshot) => {
    const transcripts = snapshot.docs.map(docToTranscript);
    callback(transcripts);
  });
};

// ============================================
// Activity Operations
// ============================================

/**
 * Convert Firestore document to TranscriptActivity
 */
const docToActivity = (docSnap: any): TranscriptActivity => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    projectId: data.projectId,
    projectName: data.projectName,
    type: data.type,
    summary: data.summary,
    rawExcerpt: data.rawExcerpt,
    speaker: data.speaker,
    meetingDate: data.meetingDate,
    timestamp: data.timestamp,
    source: data.source,
    transcriptId: data.transcriptId,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
    createdByName: data.createdByName,
  };
};

/**
 * Add a single activity
 */
export const addActivity = async (
  input: TranscriptActivityInput,
  createdBy: string,
  createdByName: string
): Promise<string> => {
  const activitiesCol = getActivitiesCol();
  const newDocRef = doc(activitiesCol);
  const now = new Date().toISOString();

  const activityData: TranscriptActivity = {
    id: newDocRef.id,
    ...input,
    createdAt: now,
    createdBy,
    createdByName,
  };

  await setDoc(newDocRef, activityData);
  return newDocRef.id;
};

/**
 * Add multiple activities (batch)
 */
export const addActivitiesBatch = async (
  activities: TranscriptActivityInput[],
  createdBy: string,
  createdByName: string
): Promise<string[]> => {
  const ids: string[] = [];

  // Note: For large batches, consider using batched writes
  for (const input of activities) {
    const id = await addActivity(input, createdBy, createdByName);
    ids.push(id);
  }

  return ids;
};

/**
 * Get activities for a specific project
 */
export const getProjectActivities = async (
  projectId: string,
  limitCount: number = 50
): Promise<TranscriptActivity[]> => {
  const activitiesCol = getActivitiesCol();
  const q = query(
    activitiesCol,
    where("projectId", "==", projectId),
    orderBy("meetingDate", "desc"),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToActivity);
};

/**
 * Get activities for a date range
 */
export const getActivitiesByDateRange = async (
  projectId: string,
  startDate: string,
  endDate: string
): Promise<TranscriptActivity[]> => {
  const activitiesCol = getActivitiesCol();
  const q = query(
    activitiesCol,
    where("projectId", "==", projectId),
    where("meetingDate", ">=", startDate),
    where("meetingDate", "<=", endDate),
    orderBy("meetingDate", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToActivity);
};

/**
 * Get all activities from a specific transcript
 */
export const getActivitiesByTranscript = async (
  transcriptId: string
): Promise<TranscriptActivity[]> => {
  const activitiesCol = getActivitiesCol();
  const q = query(
    activitiesCol,
    where("transcriptId", "==", transcriptId),
    orderBy("projectName", "asc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToActivity);
};

/**
 * Subscribe to project activities
 */
export const subscribeToProjectActivities = (
  projectId: string,
  callback: (activities: TranscriptActivity[]) => void,
  limitCount: number = 50
): Unsubscribe => {
  const activitiesCol = getActivitiesCol();
  const q = query(
    activitiesCol,
    where("projectId", "==", projectId),
    orderBy("meetingDate", "desc"),
    limit(limitCount)
  );

  return onSnapshot(q, (snapshot) => {
    const activities = snapshot.docs.map(docToActivity);
    callback(activities);
  });
};

/**
 * Update an activity
 */
export const updateActivity = async (
  activityId: string,
  updates: Partial<TranscriptActivityInput>
): Promise<void> => {
  const activitiesCol = getActivitiesCol();
  const docRef = doc(activitiesCol, activityId);
  await updateDoc(docRef, updates);
};

/**
 * Delete an activity
 */
export const deleteActivity = async (activityId: string): Promise<void> => {
  const activitiesCol = getActivitiesCol();
  const docRef = doc(activitiesCol, activityId);
  await deleteDoc(docRef);
};

/**
 * Get recent activities across all projects (for dashboard)
 */
export const getRecentActivities = async (
  limitCount: number = 20
): Promise<TranscriptActivity[]> => {
  const activitiesCol = getActivitiesCol();
  const q = query(
    activitiesCol,
    orderBy("meetingDate", "desc"),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToActivity);
};

/**
 * Get activity stats for a project
 */
export const getProjectActivityStats = async (
  projectId: string
): Promise<{
  total: number;
  byType: Record<string, number>;
  lastActivityDate: string | null;
}> => {
  const activities = await getProjectActivities(projectId, 100);

  const byType: Record<string, number> = {
    progress: 0,
    blocker: 0,
    decision: 0,
    action: 0,
    note: 0,
  };

  activities.forEach((a) => {
    byType[a.type] = (byType[a.type] || 0) + 1;
  });

  return {
    total: activities.length,
    byType,
    lastActivityDate: activities.length > 0 ? activities[0].meetingDate : null,
  };
};

// ============================================
// Status Update Operations
// ============================================

/**
 * Convert Firestore document to StatusUpdate
 */
const docToStatusUpdate = (docSnap: any): StatusUpdate => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    projectId: data.projectId,
    projectName: data.projectName,
    startDate: data.startDate,
    endDate: data.endDate,
    generatedText: data.generatedText,
    editedText: data.editedText,
    activityIds: data.activityIds || [],
    sentAt: data.sentAt,
    sentTo: data.sentTo,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
    createdByName: data.createdByName,
  };
};

/**
 * Create a status update
 */
export const createStatusUpdate = async (
  projectId: string,
  projectName: string,
  startDate: string,
  endDate: string,
  generatedText: string,
  activityIds: string[],
  createdBy: string,
  createdByName: string
): Promise<string> => {
  const statusUpdatesCol = getStatusUpdatesCol();
  const newDocRef = doc(statusUpdatesCol);
  const now = new Date().toISOString();

  const statusUpdate: StatusUpdate = {
    id: newDocRef.id,
    projectId,
    projectName,
    startDate,
    endDate,
    generatedText,
    activityIds,
    createdAt: now,
    createdBy,
    createdByName,
  };

  await setDoc(newDocRef, statusUpdate);
  return newDocRef.id;
};

/**
 * Update status update with edited text
 */
export const updateStatusUpdateText = async (
  statusUpdateId: string,
  editedText: string
): Promise<void> => {
  const statusUpdatesCol = getStatusUpdatesCol();
  const docRef = doc(statusUpdatesCol, statusUpdateId);
  await updateDoc(docRef, { editedText });
};

/**
 * Mark status update as sent
 */
export const markStatusUpdateSent = async (
  statusUpdateId: string,
  sentTo: string[]
): Promise<void> => {
  const statusUpdatesCol = getStatusUpdatesCol();
  const docRef = doc(statusUpdatesCol, statusUpdateId);
  await updateDoc(docRef, {
    sentAt: new Date().toISOString(),
    sentTo,
  });
};

/**
 * Get status updates for a project
 */
export const getProjectStatusUpdates = async (
  projectId: string
): Promise<StatusUpdate[]> => {
  const statusUpdatesCol = getStatusUpdatesCol();
  const q = query(
    statusUpdatesCol,
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToStatusUpdate);
};

// ============================================
// Manual history reads (activity -> source transcript)
// ============================================

export interface ManualHistoryOptions {
  isCurrent?: () => boolean;
}

const MANUAL_PAGE_LIMIT = 100;
const MANUAL_MAX_PAGES = 1000;
const MAX_TRANSCRIPT_BYTES = 1048576;
const manualError = (code: string, message: string) => Object.assign(new Error(message), { code });
const manualIntegrity = () => manualError('integrity', 'Meeting history failed an integrity check. Refresh and try again.');

// Captures the signed-in account once; every later step proves it is still the same account and context.
function manualContext(options?: ManualHistoryOptions) {
  const uid = auth.currentUser?.uid || '';
  const isCurrent = options?.isCurrent ?? (() => true);
  const assertContext = () => {
    if (!isCurrent() || (auth.currentUser?.uid || '') !== uid) {
      throw manualError('identity_changed', 'Your signed-in account or project context changed. Refresh and try again.');
    }
  };
  assertContext();
  if (!uid) throw manualError('sign_in_required', 'Sign in again to read meeting history.');
  return { uid, assertContext };
}

/**
 * Every activity of one project through the authorized server read (no SDK fallback).
 * Ordered like the original timeline: newest meeting first.
 */
export async function readScopedProjectActivities(
  projectId: string,
  options?: ManualHistoryOptions
): Promise<TranscriptActivity[]> {
  const { uid, assertContext } = manualContext(options);
  const rows: TranscriptActivity[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 0; pages < MANUAL_MAX_PAGES; pages++) {
    const result = await nativeProjectReads.activities(projectId, cursor ? { limit: MANUAL_PAGE_LIMIT, cursor } : { limit: MANUAL_PAGE_LIMIT }, uid, assertContext);
    assertContext();
    for (const row of result.activities) {
      if (ids.has(row.id)) throw manualIntegrity();
      ids.add(row.id);
      rows.push(row as unknown as TranscriptActivity);
    }
    if (result.next_cursor === null) {
      return rows.sort((a, b) => (a.meetingDate < b.meetingDate ? 1 : a.meetingDate > b.meetingDate ? -1 : 0));
    }
    if (cursors.has(result.next_cursor)) throw manualIntegrity();
    cursors.add(result.next_cursor);
    cursor = result.next_cursor;
  }
  throw manualIntegrity();
}

export interface SourceTranscript {
  transcript: Transcript;
  /** How many projects have activities extracted from this transcript; never which ones. */
  linkedProjectCount: number;
}

/**
 * The full stored transcript behind an activity of this project. Available only when a stored
 * activity names both the project and the transcript. Scoped reads use the server exclusively.
 */
export async function getProjectSourceTranscript(
  projectId: string,
  transcriptId: string,
  options?: ManualHistoryOptions
): Promise<SourceTranscript> {
  const { uid, assertContext } = manualContext(options);
  if (isScopedProjectReadEnabled()) {
    const result = await nativeProjectReads.transcript(projectId, transcriptId, uid, assertContext);
    assertContext();
    const transcript = result.transcript as unknown as Transcript;
    if (transcript.id !== transcriptId || typeof transcript.rawText !== "string"
      || new TextEncoder().encode(transcript.rawText).length > MAX_TRANSCRIPT_BYTES) throw manualIntegrity();
    return { transcript, linkedProjectCount: result.linked_project_count };
  }
  const links = await getDocs(query(getActivitiesCol(), where("transcriptId", "==", transcriptId)));
  assertContext();
  const projects = new Set<string>();
  for (const row of links.docs) {
    const linked = row.data().projectId;
    if (typeof linked !== "string" || !linked) throw manualIntegrity();
    projects.add(linked);
  }
  const notFound = () => manualError('not_found', 'The source transcript is not available for this project.');
  if (!projects.has(projectId)) throw notFound();
  const snapshot = await getDoc(doc(getTranscriptsCol(), transcriptId));
  assertContext();
  if (!snapshot.exists()) throw notFound();
  const data = snapshot.data();
  if (typeof data.rawText !== "string" || typeof data.meetingDate !== "string" || !data.meetingDate
    || new TextEncoder().encode(data.rawText).length > MAX_TRANSCRIPT_BYTES) throw manualIntegrity();
  return { transcript: docToTranscript(snapshot), linkedProjectCount: projects.size };
}
