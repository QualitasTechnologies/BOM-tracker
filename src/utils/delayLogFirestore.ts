import { db } from "@/firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  query,
  orderBy,
  where,
  Unsubscribe
} from "firebase/firestore";
import type {
  DelayLog,
  DelayLogInput,
  DelayAttribution,
  DelayEntityType
} from "@/types/milestone";
import { calculateDelayDays, calculateCumulativeDelay } from "@/types/milestone";
import { getProject } from "./projectFirestore";

// Get delay logs collection reference for a project
const getDelayLogsCol = (projectId: string) =>
  collection(db, "projects", projectId, "delayLogs");

// Convert Firestore document to DelayLog
const docToDelayLog = (docSnap: any): DelayLog => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    entityType: data.entityType,
    entityId: data.entityId,
    entityName: data.entityName,
    previousDate: data.previousDate,
    newDate: data.newDate,
    delayDays: data.delayDays,
    reason: data.reason,
    attribution: data.attribution,
    cumulativeProjectDelay: data.cumulativeProjectDelay,
    loggedAt: data.loggedAt,
    loggedBy: data.loggedBy,
    loggedByName: data.loggedByName
  };
};

// Get all delay logs for a project (ordered by date, newest first)
export const getDelayLogs = async (projectId: string): Promise<DelayLog[]> => {
  const delayLogsCol = getDelayLogsCol(projectId);
  const q = query(delayLogsCol, orderBy('loggedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToDelayLog);
};

// Get delay logs for a specific milestone
export const getMilestoneDelayLogs = async (
  projectId: string,
  milestoneId: string
): Promise<DelayLog[]> => {
  const delayLogsCol = getDelayLogsCol(projectId);
  const q = query(
    delayLogsCol,
    where('entityType', '==', 'milestone'),
    where('entityId', '==', milestoneId),
    orderBy('loggedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToDelayLog);
};

// Get delay logs by attribution (for filtering)
export const getDelayLogsByAttribution = async (
  projectId: string,
  attribution: DelayAttribution
): Promise<DelayLog[]> => {
  const delayLogsCol = getDelayLogsCol(projectId);
  const q = query(
    delayLogsCol,
    where('attribution', '==', attribution),
    orderBy('loggedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToDelayLog);
};

// Subscribe to delay logs for real-time updates
export const subscribeToDelayLogs = (
  projectId: string,
  callback: (delayLogs: DelayLog[]) => void
): Unsubscribe => {
  const delayLogsCol = getDelayLogsCol(projectId);
  const q = query(delayLogsCol, orderBy('loggedAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const delayLogs = snapshot.docs.map(docToDelayLog);
    callback(delayLogs);
  });
};

// Add a new delay log
export const addDelayLog = async (
  projectId: string,
  input: DelayLogInput,
  loggedBy: string,
  loggedByName: string,
  currentDeadline: string
): Promise<string> => {
  const delayLogsCol = getDelayLogsCol(projectId);
  const newDocRef = doc(delayLogsCol);
  const now = new Date().toISOString();

  // Get project to calculate cumulative delay
  const project = await getProject(projectId);
  const cumulativeProjectDelay = calculateCumulativeDelay(
    project?.originalDeadline,
    currentDeadline
  );

  const delayLogData: DelayLog = {
    id: newDocRef.id,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    previousDate: input.previousDate,
    newDate: input.newDate,
    delayDays: calculateDelayDays(input.previousDate, input.newDate),
    reason: input.reason.trim(),
    attribution: input.attribution,
    cumulativeProjectDelay,
    loggedAt: now,
    loggedBy,
    loggedByName
  };

  await setDoc(newDocRef, delayLogData);
  return newDocRef.id;
};

// Get delay statistics for a project
export const getDelayStats = async (projectId: string): Promise<{
  totalDelayDays: number;
  delayCount: number;
  byAttribution: Record<DelayAttribution, { days: number; count: number }>;
  internalDays: number;
  externalDays: number;
  internalPercentage: number;
  externalPercentage: number;
}> => {
  const delayLogs = await getDelayLogs(projectId);

  const byAttribution: Record<DelayAttribution, { days: number; count: number }> = {
    'internal-team': { days: 0, count: 0 },
    'internal-process': { days: 0, count: 0 },
    'external-client': { days: 0, count: 0 },
    'external-vendor': { days: 0, count: 0 },
    'external-other': { days: 0, count: 0 }
  };

  let totalDelayDays = 0;

  delayLogs.forEach(log => {
    // Only count positive delays (not accelerations)
    if (log.delayDays > 0) {
      totalDelayDays += log.delayDays;
      byAttribution[log.attribution].days += log.delayDays;
      byAttribution[log.attribution].count += 1;
    }
  });

  const internalDays = byAttribution['internal-team'].days + byAttribution['internal-process'].days;
  const externalDays =
    byAttribution['external-client'].days +
    byAttribution['external-vendor'].days +
    byAttribution['external-other'].days;

  return {
    totalDelayDays,
    delayCount: delayLogs.filter(l => l.delayDays > 0).length,
    byAttribution,
    internalDays,
    externalDays,
    internalPercentage: totalDelayDays > 0 ? Math.round((internalDays / totalDelayDays) * 100) : 0,
    externalPercentage: totalDelayDays > 0 ? Math.round((externalDays / totalDelayDays) * 100) : 0
  };
};

// Get delays logged this week (for weekly updates)
export const getDelaysThisWeek = async (projectId: string): Promise<DelayLog[]> => {
  const delayLogs = await getDelayLogs(projectId);

  // Get Monday of current week
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diff));
  monday.setHours(0, 0, 0, 0);

  return delayLogs.filter(log => {
    const logDate = new Date(log.loggedAt);
    return logDate >= monday;
  });
};

// Generate delay summary text for weekly updates
export const generateDelaySummary = async (projectId: string): Promise<string> => {
  const weekDelays = await getDelaysThisWeek(projectId);

  if (weekDelays.length === 0) {
    return 'No delays logged this week';
  }

  const totalDays = weekDelays.reduce((sum, log) => sum + log.delayDays, 0);
  const entityCount = new Set(weekDelays.map(l => l.entityName)).size;

  if (totalDays > 0) {
    return `+${totalDays} days across ${entityCount} ${entityCount === 1 ? 'milestone' : 'milestones'}`;
  } else if (totalDays < 0) {
    return `${totalDays} days (ahead of schedule) across ${entityCount} ${entityCount === 1 ? 'milestone' : 'milestones'}`;
  }

  return 'No net delay this week';
};

// Format delay history for display (grouped by date)
export interface DelayHistoryGroup {
  date: string;
  formattedDate: string;
  logs: DelayLog[];
}

export const getGroupedDelayHistory = async (
  projectId: string
): Promise<DelayHistoryGroup[]> => {
  const delayLogs = await getDelayLogs(projectId);

  // Group by date (YYYY-MM-DD)
  const grouped: Record<string, DelayLog[]> = {};

  delayLogs.forEach(log => {
    const dateKey = log.loggedAt.split('T')[0];
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(log);
  });

  // Convert to array and sort by date (newest first)
  return Object.entries(grouped)
    .map(([date, logs]) => ({
      date,
      formattedDate: new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
      logs
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
};
