import { db } from "@/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  Unsubscribe,
  query,
  orderBy,
  writeBatch
} from "firebase/firestore";
import type { Milestone, MilestoneInput, MilestoneStatus } from "@/types/milestone";

// Get milestones collection reference for a project
const getMilestonesCol = (projectId: string) =>
  collection(db, "projects", projectId, "milestones");

// Convert Firestore document to Milestone
const docToMilestone = (docSnap: any): Milestone => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data.name,
    description: data.description || undefined,
    order: data.order || 0,
    originalPlannedEndDate: data.originalPlannedEndDate || undefined,
    currentPlannedEndDate: data.currentPlannedEndDate,
    actualEndDate: data.actualEndDate || undefined,
    status: data.status || 'not-started',
    lastProgressNote: data.lastProgressNote || undefined,
    lastProgressDate: data.lastProgressDate || undefined,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
    updatedAt: data.updatedAt
  };
};

// Get all milestones for a project
export const getMilestones = async (projectId: string): Promise<Milestone[]> => {
  const milestonesCol = getMilestonesCol(projectId);
  const q = query(milestonesCol, orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docToMilestone);
};

// Get a single milestone
export const getMilestone = async (
  projectId: string,
  milestoneId: string
): Promise<Milestone | null> => {
  const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);
  const milestoneSnap = await getDoc(milestoneRef);
  if (milestoneSnap.exists()) {
    return docToMilestone(milestoneSnap);
  }
  return null;
};

// Subscribe to milestones for real-time updates
export const subscribeToMilestones = (
  projectId: string,
  callback: (milestones: Milestone[]) => void
): Unsubscribe => {
  const milestonesCol = getMilestonesCol(projectId);
  const q = query(milestonesCol, orderBy('order', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const milestones = snapshot.docs.map(docToMilestone);
    callback(milestones);
  });
};

// Get the next order number for a new milestone
const getNextOrder = async (projectId: string): Promise<number> => {
  const milestones = await getMilestones(projectId);
  if (milestones.length === 0) return 1;
  const maxOrder = Math.max(...milestones.map(m => m.order));
  return maxOrder + 1;
};

// Add a new milestone
export const addMilestone = async (
  projectId: string,
  input: MilestoneInput,
  createdBy: string,
  isProjectBaselined: boolean = false
): Promise<string> => {
  const milestonesCol = getMilestonesCol(projectId);
  const newDocRef = doc(milestonesCol);
  const now = new Date().toISOString();
  const nextOrder = await getNextOrder(projectId);

  const milestoneData: Record<string, any> = {
    name: input.name.trim(),
    currentPlannedEndDate: input.currentPlannedEndDate,
    status: input.status || 'not-started',
    order: nextOrder,
    createdAt: now,
    createdBy,
    updatedAt: now
  };

  // Add optional fields if provided
  if (input.description?.trim()) {
    milestoneData.description = input.description.trim();
  }

  // If project is already baselined, set originalPlannedEndDate for new milestones
  if (isProjectBaselined) {
    milestoneData.originalPlannedEndDate = input.currentPlannedEndDate;
  }

  await setDoc(newDocRef, milestoneData);
  return newDocRef.id;
};

// Update a milestone
export const updateMilestone = async (
  projectId: string,
  milestoneId: string,
  updates: Partial<Omit<Milestone, 'id' | 'createdAt' | 'createdBy'>>
): Promise<void> => {
  const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);

  // Build clean updates object (no undefined values)
  const cleanUpdates: Record<string, any> = {
    updatedAt: new Date().toISOString()
  };

  if (updates.name !== undefined) cleanUpdates.name = updates.name.trim();
  if (updates.description !== undefined) cleanUpdates.description = updates.description?.trim() || null;
  if (updates.order !== undefined) cleanUpdates.order = updates.order;
  if (updates.currentPlannedEndDate !== undefined) cleanUpdates.currentPlannedEndDate = updates.currentPlannedEndDate;
  if (updates.actualEndDate !== undefined) cleanUpdates.actualEndDate = updates.actualEndDate;
  if (updates.status !== undefined) cleanUpdates.status = updates.status;
  if (updates.lastProgressNote !== undefined) cleanUpdates.lastProgressNote = updates.lastProgressNote?.trim() || null;
  if (updates.lastProgressDate !== undefined) cleanUpdates.lastProgressDate = updates.lastProgressDate;
  // Note: originalPlannedEndDate should not be updated after baseline lock

  await updateDoc(milestoneRef, cleanUpdates);
};

// Update milestone status
export const updateMilestoneStatus = async (
  projectId: string,
  milestoneId: string,
  status: MilestoneStatus,
  progressNote?: string
): Promise<void> => {
  const now = new Date().toISOString();
  const updates: Record<string, any> = {
    status,
    updatedAt: now
  };

  // If completing, set actual end date
  if (status === 'completed') {
    updates.actualEndDate = now.split('T')[0]; // Just the date part
  }

  // If progress note provided, update it
  if (progressNote !== undefined) {
    updates.lastProgressNote = progressNote.trim() || null;
    updates.lastProgressDate = now;
  }

  const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);
  await updateDoc(milestoneRef, updates);
};

// Update milestone date (for use when not baselined, or for internal updates)
// Note: When baselined, this should trigger delay logging - handled by caller
export const updateMilestoneDate = async (
  projectId: string,
  milestoneId: string,
  newDate: string
): Promise<void> => {
  const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);
  await updateDoc(milestoneRef, {
    currentPlannedEndDate: newDate,
    updatedAt: new Date().toISOString()
  });
};

// Delete a milestone
export const deleteMilestone = async (
  projectId: string,
  milestoneId: string
): Promise<void> => {
  const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);
  await deleteDoc(milestoneRef);
};

// Reorder milestones (after drag-and-drop)
export const reorderMilestones = async (
  projectId: string,
  milestoneIds: string[]
): Promise<void> => {
  const batch = writeBatch(db);

  milestoneIds.forEach((milestoneId, index) => {
    const milestoneRef = doc(db, "projects", projectId, "milestones", milestoneId);
    batch.update(milestoneRef, {
      order: index + 1,
      updatedAt: new Date().toISOString()
    });
  });

  await batch.commit();
};

// Lock baseline for all milestones in a project
// Called when project baseline is locked
export const lockMilestonesBaseline = async (projectId: string): Promise<void> => {
  const milestones = await getMilestones(projectId);

  if (milestones.length === 0) {
    throw new Error('Cannot lock baseline: No milestones defined');
  }

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  milestones.forEach((milestone) => {
    const milestoneRef = doc(db, "projects", projectId, "milestones", milestone.id);
    batch.update(milestoneRef, {
      originalPlannedEndDate: milestone.currentPlannedEndDate,
      updatedAt: now
    });
  });

  await batch.commit();
};

// Get milestone count for a project (used for validation before baseline lock)
export const getMilestoneCount = async (projectId: string): Promise<number> => {
  const milestonesCol = getMilestonesCol(projectId);
  const snapshot = await getDocs(milestonesCol);
  return snapshot.size;
};

// Check if all milestones have end dates (validation for baseline lock)
export const validateMilestonesForBaseline = async (
  projectId: string
): Promise<{ valid: boolean; errors: string[] }> => {
  const milestones = await getMilestones(projectId);
  const errors: string[] = [];

  if (milestones.length === 0) {
    errors.push('At least one milestone is required to lock baseline');
    return { valid: false, errors };
  }

  const missingDates = milestones.filter(m => !m.currentPlannedEndDate);
  if (missingDates.length > 0) {
    errors.push(`Milestones missing end dates: ${missingDates.map(m => m.name).join(', ')}`);
  }

  const missingNames = milestones.filter(m => !m.name || m.name.trim().length < 3);
  if (missingNames.length > 0) {
    errors.push('All milestones must have names (at least 3 characters)');
  }

  return { valid: errors.length === 0, errors };
};

// Calculate milestone statistics for a project
export const getMilestoneStats = async (projectId: string): Promise<{
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  blocked: number;
  completionPercentage: number;
}> => {
  const milestones = await getMilestones(projectId);

  const stats = {
    total: milestones.length,
    notStarted: milestones.filter(m => m.status === 'not-started').length,
    inProgress: milestones.filter(m => m.status === 'in-progress').length,
    completed: milestones.filter(m => m.status === 'completed').length,
    blocked: milestones.filter(m => m.status === 'blocked').length,
    completionPercentage: 0
  };

  if (stats.total > 0) {
    stats.completionPercentage = Math.round((stats.completed / stats.total) * 100);
  }

  return stats;
};

// ============================================
// Milestone Template
// ============================================

export interface MilestoneTemplate {
  name: string;
  description: string;
  percentageOfTimeline: number; // Where in timeline (0-100%)
}

// Standard 4-milestone template for engineering projects
export const DEFAULT_MILESTONE_TEMPLATE: MilestoneTemplate[] = [
  {
    name: 'Planning & Design',
    description: 'Requirements gathering, engineering design, BOM finalization',
    percentageOfTimeline: 25,
  },
  {
    name: 'Procurement',
    description: 'Vendor selection, PO creation, materials ordering',
    percentageOfTimeline: 50,
  },
  {
    name: 'Build & Test',
    description: 'Assembly, integration, quality testing',
    percentageOfTimeline: 80,
  },
  {
    name: 'Delivery',
    description: 'Final inspection, shipping, installation, handover',
    percentageOfTimeline: 100,
  },
];

// Calculate date based on percentage between start and end
const calculateMilestoneDate = (
  startDate: Date,
  endDate: Date,
  percentage: number
): string => {
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysToAdd = Math.round((totalDays * percentage) / 100);
  const milestoneDate = new Date(startDate);
  milestoneDate.setDate(milestoneDate.getDate() + daysToAdd);
  return milestoneDate.toISOString().split('T')[0];
};

// Apply milestone template to a project
export const applyMilestoneTemplate = async (
  projectId: string,
  deadline: string,
  createdBy: string,
  template: MilestoneTemplate[] = DEFAULT_MILESTONE_TEMPLATE
): Promise<void> => {
  // Check if project already has milestones
  const existingMilestones = await getMilestones(projectId);
  if (existingMilestones.length > 0) {
    throw new Error('Cannot apply template: Project already has milestones. Delete existing milestones first.');
  }

  // Calculate dates based on project timeline
  const startDate = new Date(); // Today
  const endDate = new Date(deadline);

  // Validate deadline is in the future
  if (endDate <= startDate) {
    throw new Error('Project deadline must be in the future to apply template.');
  }

  const batch = writeBatch(db);
  const now = new Date().toISOString();
  const milestonesCol = getMilestonesCol(projectId);

  template.forEach((item, index) => {
    const newDocRef = doc(milestonesCol);
    const milestoneDate = calculateMilestoneDate(startDate, endDate, item.percentageOfTimeline);

    batch.set(newDocRef, {
      name: item.name,
      description: item.description,
      currentPlannedEndDate: milestoneDate,
      status: 'not-started',
      order: index + 1,
      createdAt: now,
      createdBy,
      updatedAt: now,
    });
  });

  await batch.commit();
};
