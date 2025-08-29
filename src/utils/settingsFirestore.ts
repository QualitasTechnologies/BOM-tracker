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

// Client types and interfaces
export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  contactPerson: string;
  status: 'active' | 'inactive';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Vendor types and interfaces  
export interface Vendor {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  contactPerson: string;
  website?: string;
  paymentTerms: string;
  leadTime: string;
  rating: number;
  status: 'active' | 'inactive';
  specialties: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// BOM Settings types
export interface BOMSettings {
  id: string;
  defaultCategories: string[];
  defaultStatuses: string[];
  defaultUnits: string[];
  autoApprovalEnabled: boolean;
  requireVendorQuotes: boolean;
  minimumVendorQuotes: number;
  costCalculationMethod: 'average' | 'lowest' | 'selected';
  updatedAt: Date;
}

// Client Management Functions
const clientsCol = collection(db, "clients");

export const addClient = async (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => {
  const now = new Date();
  const clientData = {
    ...client,
    createdAt: now,
    updatedAt: now
  };
  const docRef = await addDoc(clientsCol, clientData);
  return docRef.id;
};

export const getClients = async (): Promise<Client[]> => {
  const snapshot = await getDocs(clientsCol);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Client));
};

export const subscribeToClients = (callback: (clients: Client[]) => void): Unsubscribe => {
  return onSnapshot(clientsCol, (snapshot) => {
    const clients: Client[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Client));
    callback(clients);
  });
};

export const updateClient = async (clientId: string, updates: Partial<Omit<Client, 'id' | 'createdAt'>>) => {
  const clientRef = doc(clientsCol, clientId);
  await updateDoc(clientRef, {
    ...updates,
    updatedAt: new Date()
  });
};

export const deleteClient = async (clientId: string) => {
  await deleteDoc(doc(clientsCol, clientId));
};

export const getClient = async (clientId: string): Promise<Client | null> => {
  const clientRef = doc(clientsCol, clientId);
  const clientSnap = await getDoc(clientRef);
  if (clientSnap.exists()) {
    return {
      id: clientSnap.id,
      ...clientSnap.data()
    } as Client;
  }
  return null;
};

// Vendor Management Functions
const vendorsCol = collection(db, "vendors");

export const addVendor = async (vendor: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>) => {
  const now = new Date();
  const vendorData = {
    ...vendor,
    createdAt: now,
    updatedAt: now
  };
  const docRef = await addDoc(vendorsCol, vendorData);
  return docRef.id;
};

export const getVendors = async (): Promise<Vendor[]> => {
  const snapshot = await getDocs(vendorsCol);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Vendor));
};

export const subscribeToVendors = (callback: (vendors: Vendor[]) => void): Unsubscribe => {
  return onSnapshot(vendorsCol, (snapshot) => {
    const vendors: Vendor[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Vendor));
    callback(vendors);
  });
};

export const updateVendor = async (vendorId: string, updates: Partial<Omit<Vendor, 'id' | 'createdAt'>>) => {
  const vendorRef = doc(vendorsCol, vendorId);
  await updateDoc(vendorRef, {
    ...updates,
    updatedAt: new Date()
  });
};

export const deleteVendor = async (vendorId: string) => {
  await deleteDoc(doc(vendorsCol, vendorId));
};

export const getVendor = async (vendorId: string): Promise<Vendor | null> => {
  const vendorRef = doc(vendorsCol, vendorId);
  const vendorSnap = await getDoc(vendorRef);
  if (vendorSnap.exists()) {
    return {
      id: vendorSnap.id,
      ...vendorSnap.data()
    } as Vendor;
  }
  return null;
};

// BOM Settings Management Functions
const bomSettingsRef = doc(db, "settings", "bom");

export const getBOMSettings = async (): Promise<BOMSettings | null> => {
  const bomSettingsSnap = await getDoc(bomSettingsRef);
  if (bomSettingsSnap.exists()) {
    return {
      id: bomSettingsSnap.id,
      ...bomSettingsSnap.data()
    } as BOMSettings;
  }
  return null;
};

export const updateBOMSettings = async (settings: Omit<BOMSettings, 'id' | 'updatedAt'>) => {
  await setDoc(bomSettingsRef, {
    ...settings,
    updatedAt: new Date()
  }, { merge: true });
};

export const subscribeToBOMSettings = (callback: (settings: BOMSettings | null) => void): Unsubscribe => {
  return onSnapshot(bomSettingsRef, (doc) => {
    if (doc.exists()) {
      callback({
        id: doc.id,
        ...doc.data()
      } as BOMSettings);
    } else {
      callback(null);
    }
  });
};

// Initialize default BOM settings if they don't exist
export const initializeDefaultBOMSettings = async () => {
  const settings = await getBOMSettings();
  if (!settings) {
    await updateBOMSettings({
      defaultCategories: ['Vision Systems', 'Motors & Drives', 'Sensors', 'Control Systems', 'Mechanical'],
      defaultStatuses: ['not-ordered', 'ordered', 'received', 'approved'],
      defaultUnits: ['pcs', 'kg', 'm', 'l', 'set', 'pack'],
      autoApprovalEnabled: false,
      requireVendorQuotes: true,
      minimumVendorQuotes: 2,
      costCalculationMethod: 'average'
    });
  }
};

// Utility functions for data validation
export const validateClient = (client: Partial<Client>): string[] => {
  const errors: string[] = [];
  if (!client.name?.trim()) errors.push('Client name is required');
  if (!client.company?.trim()) errors.push('Company name is required');
  if (client.email && !isValidEmail(client.email)) errors.push('Invalid email format');
  return errors;
};

export const validateVendor = (vendor: Partial<Vendor>): string[] => {
  const errors: string[] = [];
  if (!vendor.name?.trim()) errors.push('Vendor name is required');
  if (!vendor.company?.trim()) errors.push('Company name is required');
  if (vendor.email && !isValidEmail(vendor.email)) errors.push('Invalid email format');
  if (vendor.rating !== undefined && (vendor.rating < 0 || vendor.rating > 5)) {
    errors.push('Rating must be between 0 and 5');
  }
  return errors;
};

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Export collections for use in other components if needed
export { clientsCol, vendorsCol, bomSettingsRef };