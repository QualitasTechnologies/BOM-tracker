import { db } from "@/firebase";
import {
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  DocumentData,
  Unsubscribe,
  getDoc
} from "firebase/firestore";
import type { BOMItem, BOMCategory, BOMStatus } from "@/types/bom";
import { sanitizeBOMItemForFirestore } from "@/types/bom";

export type { BOMItem, BOMCategory, BOMStatus };

export interface Project {
  projectId: string;
  projectName: string;
  clientName: string;
  description: string;
  status: "Planning" | "Ongoing" | "Delayed" | "Completed";
  deadline: string; // ISO string
  poValue?: number; // Purchase Order value from customer
  bomSnapshot?: any[]; // Snapshot of BOM when status changed to 'Ongoing' (order won)
  bomSnapshotDate?: string; // ISO string - when snapshot was taken
}

const projectsCol = collection(db, "projects");

// Add a new project (projectId as document ID)
export const addProject = async (project: Project) => {
  // Filter out undefined values to prevent Firestore errors
  const cleanProject = Object.fromEntries(
    Object.entries(project).filter(([_, value]) => value !== undefined)
  );
  await setDoc(doc(projectsCol, project.projectId), cleanProject);
};

// Get all projects (real-time listener)
export const subscribeToProjects = (
  callback: (projects: Project[]) => void
): Unsubscribe => {
  const q = query(projectsCol);
  return onSnapshot(q, (snapshot) => {
    const projects: Project[] = snapshot.docs.map((doc) => doc.data() as Project);
    callback(projects);
  });
};

// Update a project
export const updateProject = async (projectId: string, updates: Partial<Project>) => {
  // Filter out undefined values to prevent Firestore errors
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, value]) => value !== undefined)
  );
  await updateDoc(doc(projectsCol, projectId), cleanUpdates);
};

// Delete a project
export const deleteProject = async (projectId: string) => {
  await deleteDoc(doc(projectsCol, projectId));
};

// BOM Functions
export const getBOMData = async (projectId: string): Promise<BOMCategory[]> => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  const bomSnap = await getDoc(bomRef);
  if (bomSnap.exists()) {
    return bomSnap.data().categories as BOMCategory[];
  }
  return [];
};

export const subscribeToBOM = (projectId: string, callback: (categories: BOMCategory[]) => void) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  return onSnapshot(bomRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data().categories as BOMCategory[]);
    } else {
      callback([]);
    }
  });
};

export const updateBOMData = async (projectId: string, categories: BOMCategory[]) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  // Sanitize all items to prevent undefined values from causing Firestore errors
  const sanitizedCategories = categories.map(category => ({
    ...category,
    items: category.items.map(item => sanitizeBOMItemForFirestore(item) as BOMItem)
  }));
  await setDoc(bomRef, { categories: sanitizedCategories }, { merge: true });
};

export const updateBOMItem = async (projectId: string, categories: BOMCategory[], itemId: string, updates: Partial<BOMItem>) => {
  // Filter out undefined values from updates to prevent Firestore errors
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, value]) => value !== undefined)
  );

  const updatedCategories = categories.map(category => ({
    ...category,
    items: category.items.map(item =>
      item.id === itemId ? { ...item, ...cleanUpdates } : item
    )
  }));
  await updateBOMData(projectId, updatedCategories);
};

export const deleteBOMItem = async (projectId: string, categories: BOMCategory[], itemId: string) => {
  const updatedCategories = categories.map(category => ({
    ...category,
    items: category.items.filter(item => item.id !== itemId)
  }));
  await updateBOMData(projectId, updatedCategories);
};

// Utility to calculate total BOM material cost for a project
export const getTotalBOMCost = (categories: BOMCategory[]): number => {
  return categories.reduce((total, category) => {
    return (
      total +
      category.items.reduce((catSum, item) => {
        if (item.finalizedVendor && typeof item.finalizedVendor.price === 'number') {
          return catSum + item.finalizedVendor.price * (item.quantity || 1);
        }
        return catSum;
      }, 0)
    );
  }, 0);
}; 