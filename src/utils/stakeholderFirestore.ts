import { db } from "@/firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  Unsubscribe,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import type { Stakeholder, StakeholderInput } from "@/types/stakeholder";

// Get stakeholders collection reference for a project
const getStakeholdersCol = (projectId: string) =>
  collection(db, "projects", projectId, "stakeholders");

// Convert Firestore document to Stakeholder
const docToStakeholder = (doc: any): Stakeholder => {
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name,
    email: data.email,
    isInternalUser: data.isInternalUser,
    userId: data.userId || null,
    notificationsEnabled: data.notificationsEnabled,
    lastNotificationSentAt: data.lastNotificationSentAt?.toDate() || null,
    createdAt: data.createdAt?.toDate() || new Date(),
    createdBy: data.createdBy
  };
};

// Get all stakeholders for a project
export const getStakeholders = async (projectId: string): Promise<Stakeholder[]> => {
  const stakeholdersCol = getStakeholdersCol(projectId);
  const snapshot = await getDocs(stakeholdersCol);
  return snapshot.docs.map(docToStakeholder);
};

// Subscribe to stakeholders for real-time updates
export const subscribeToStakeholders = (
  projectId: string,
  callback: (stakeholders: Stakeholder[]) => void
): Unsubscribe => {
  const stakeholdersCol = getStakeholdersCol(projectId);
  return onSnapshot(stakeholdersCol, (snapshot) => {
    const stakeholders = snapshot.docs.map(docToStakeholder);
    callback(stakeholders);
  });
};

// Add a new stakeholder
export const addStakeholder = async (
  projectId: string,
  input: StakeholderInput,
  createdBy: string
): Promise<string> => {
  const stakeholdersCol = getStakeholdersCol(projectId);
  const newDocRef = doc(stakeholdersCol);

  await setDoc(newDocRef, {
    name: input.name,
    email: input.email.toLowerCase().trim(),
    isInternalUser: input.isInternalUser,
    userId: input.userId,
    notificationsEnabled: input.notificationsEnabled,
    lastNotificationSentAt: null,
    createdAt: serverTimestamp(),
    createdBy
  });

  return newDocRef.id;
};

// Update stakeholder
export const updateStakeholder = async (
  projectId: string,
  stakeholderId: string,
  updates: Partial<StakeholderInput>
): Promise<void> => {
  const stakeholderRef = doc(db, "projects", projectId, "stakeholders", stakeholderId);

  // Clean updates - only include defined values
  const cleanUpdates: Record<string, any> = {};
  if (updates.name !== undefined) cleanUpdates.name = updates.name;
  if (updates.email !== undefined) cleanUpdates.email = updates.email.toLowerCase().trim();
  if (updates.notificationsEnabled !== undefined) cleanUpdates.notificationsEnabled = updates.notificationsEnabled;

  await updateDoc(stakeholderRef, cleanUpdates);
};

// Toggle notifications for a stakeholder
export const toggleStakeholderNotifications = async (
  projectId: string,
  stakeholderId: string,
  enabled: boolean
): Promise<void> => {
  const stakeholderRef = doc(db, "projects", projectId, "stakeholders", stakeholderId);
  await updateDoc(stakeholderRef, { notificationsEnabled: enabled });
};

// Update last notification sent timestamp
export const updateLastNotificationSent = async (
  projectId: string,
  stakeholderId: string
): Promise<void> => {
  const stakeholderRef = doc(db, "projects", projectId, "stakeholders", stakeholderId);
  await updateDoc(stakeholderRef, { lastNotificationSentAt: serverTimestamp() });
};

// Delete a stakeholder
export const deleteStakeholder = async (
  projectId: string,
  stakeholderId: string
): Promise<void> => {
  const stakeholderRef = doc(db, "projects", projectId, "stakeholders", stakeholderId);
  await deleteDoc(stakeholderRef);
};

// Check if email already exists as stakeholder in project
export const isEmailAlreadyStakeholder = async (
  projectId: string,
  email: string
): Promise<boolean> => {
  const stakeholders = await getStakeholders(projectId);
  const normalizedEmail = email.toLowerCase().trim();
  return stakeholders.some(s => s.email === normalizedEmail);
};
