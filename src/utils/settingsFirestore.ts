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
  company: string;
  email: string;
  phone: string;
  address: string;
  contactPerson: string;
  website?: string;
  logo?: string;
  logoPath?: string;
  paymentTerms: string;
  leadTime: string;
  rating: number;
  status: 'active' | 'inactive';
  notes?: string;
  type: 'OEM' | 'Dealer';
  makes: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Category types with subcategory support
export interface BOMCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string; // For subcategories
  order: number;
  isActive: boolean;
  subcategories?: BOMCategory[];
}

// Enhanced BOM Settings types (maintaining backward compatibility)
export interface BOMSettings {
  id: string;
  defaultCategories: string[]; // Keep for backward compatibility
  categories?: BOMCategory[]; // Optional enhanced categories
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

export const getOEMVendors = async (): Promise<Vendor[]> => {
  const snapshot = await getDocs(vendorsCol);
  return snapshot.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Vendor))
    .filter(vendor => vendor.type === 'OEM');
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

// Category management functions
export const addCategory = async (category: Omit<BOMCategory, 'id'>) => {
  const settings = await getBOMSettings();
  if (!settings) return null;
  
  const newCategory: BOMCategory = {
    ...category,
    id: Date.now().toString()
  };
  
  const currentCategories = settings.categories || [];
  const updatedCategories = [...currentCategories, newCategory];
  
  await updateBOMSettings({
    ...settings,
    categories: updatedCategories
  });
  
  return newCategory.id;
};

export const updateCategory = async (categoryId: string, updates: Partial<BOMCategory>) => {
  const settings = await getBOMSettings();
  if (!settings) return;
  
  const currentCategories = settings.categories || [];
  const updatedCategories = currentCategories.map(cat => 
    cat.id === categoryId ? { ...cat, ...updates } : cat
  );
  
  await updateBOMSettings({
    ...settings,
    categories: updatedCategories
  });
};

export const deleteCategory = async (categoryId: string) => {
  const settings = await getBOMSettings();
  if (!settings) return;
  
  const currentCategories = settings.categories || [];
  const updatedCategories = currentCategories.filter(cat => cat.id !== categoryId);
  
  await updateBOMSettings({
    ...settings,
    categories: updatedCategories
  });
};

export const reorderCategories = async (reorderedCategories: BOMCategory[]) => {
  const settings = await getBOMSettings();
  if (!settings) return;
  
  await updateBOMSettings({
    ...settings,
    categories: reorderedCategories
  });
};

// Initialize default BOM settings if they don't exist
export const initializeDefaultBOMSettings = async () => {
  const settings = await getBOMSettings();
  if (!settings) {
    // Create both old format (defaultCategories) and new format (categories)
    const categoryNames = ['Vision Systems', 'Motors & Drives', 'Sensors', 'Control Systems', 'Mechanical', 'Electrical', 'Uncategorized'];
    
    const enhancedCategories: BOMCategory[] = [
      { id: 'vision-systems', name: 'Vision Systems', order: 1, isActive: true, color: '#3B82F6' },
      { id: 'vision-cameras', name: 'Cameras', parentId: 'vision-systems', order: 1, isActive: true },
      { id: 'vision-lenses', name: 'Lenses', parentId: 'vision-systems', order: 2, isActive: true },
      { id: 'vision-lighting', name: 'Lighting', parentId: 'vision-systems', order: 3, isActive: true },
      
      { id: 'motors-drives', name: 'Motors & Drives', order: 2, isActive: true, color: '#10B981' },
      { id: 'motors-servo', name: 'Servo Motors', parentId: 'motors-drives', order: 1, isActive: true },
      { id: 'motors-stepper', name: 'Stepper Motors', parentId: 'motors-drives', order: 2, isActive: true },
      { id: 'motors-drives-units', name: 'Drive Units', parentId: 'motors-drives', order: 3, isActive: true },
      
      { id: 'sensors', name: 'Sensors', order: 3, isActive: true, color: '#F59E0B' },
      { id: 'sensors-proximity', name: 'Proximity', parentId: 'sensors', order: 1, isActive: true },
      { id: 'sensors-pressure', name: 'Pressure', parentId: 'sensors', order: 2, isActive: true },
      { id: 'sensors-temperature', name: 'Temperature', parentId: 'sensors', order: 3, isActive: true },
      
      { id: 'control-systems', name: 'Control Systems', order: 4, isActive: true, color: '#8B5CF6' },
      { id: 'control-plc', name: 'PLCs', parentId: 'control-systems', order: 1, isActive: true },
      { id: 'control-hmi', name: 'HMI/Displays', parentId: 'control-systems', order: 2, isActive: true },
      
      { id: 'mechanical', name: 'Mechanical', order: 5, isActive: true, color: '#6B7280' },
      { id: 'mechanical-fasteners', name: 'Fasteners', parentId: 'mechanical', order: 1, isActive: true },
      { id: 'mechanical-brackets', name: 'Brackets', parentId: 'mechanical', order: 2, isActive: true },
      
      { id: 'electrical', name: 'Electrical', order: 6, isActive: true, color: '#EF4444' },
      { id: 'electrical-cables', name: 'Cables', parentId: 'electrical', order: 1, isActive: true },
      { id: 'electrical-connectors', name: 'Connectors', parentId: 'electrical', order: 2, isActive: true },
      
      { id: 'uncategorized', name: 'Uncategorized', order: 999, isActive: true, color: '#9CA3AF' }
    ];
    
    await updateBOMSettings({
      defaultCategories: categoryNames, // Backward compatibility
      categories: enhancedCategories, // Future enhancement
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
  if (!client.company?.trim()) errors.push('Company name is required');
  if (client.email && !isValidEmail(client.email)) errors.push('Invalid email format');
  return errors;
};

export const validateVendor = (vendor: Partial<Vendor>): string[] => {
  const errors: string[] = [];
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

// Utility functions for category management
export const getCategoriesFlat = (categories: BOMCategory[]): BOMCategory[] => {
  return categories.filter(cat => !cat.parentId);
};

export const getCategoryWithSubcategories = (categories: BOMCategory[], parentId: string): BOMCategory[] => {
  return categories.filter(cat => cat.parentId === parentId);
};

export const buildCategoryTree = (categories: BOMCategory[]): BOMCategory[] => {
  const parentCategories = categories.filter(cat => !cat.parentId);
  
  return parentCategories.map(parent => ({
    ...parent,
    subcategories: categories.filter(cat => cat.parentId === parent.id)
  }));
};

// Purchase Request Settings Interface
export interface PRSettings {
  id: string;
  recipients: string[]; // Array of email addresses
  companyName: string;
  fromEmail: string; // Sender email (must be verified in SendGrid)
  updatedAt: Date;
}

// Purchase Request Settings Management
const prSettingsRef = doc(db, "settings", "purchaseRequest");

export const getPRSettings = async (): Promise<PRSettings | null> => {
  try {
    const docSnap = await getDoc(prSettingsRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as PRSettings;
    }
    // Return default settings if not found
    return {
      id: 'purchaseRequest',
      recipients: [],
      companyName: 'Qualitas Technologies Pvt Ltd',
      fromEmail: 'info@qualitastech.com',
      updatedAt: new Date()
    };
  } catch (error) {
    console.error("Error fetching PR settings:", error);
    return null;
  }
};

export const updatePRSettings = async (settings: Omit<PRSettings, 'id' | 'updatedAt'>) => {
  try {
    await setDoc(prSettingsRef, {
      ...settings,
      updatedAt: new Date()
    }, { merge: true });
  } catch (error) {
    console.error("Error updating PR settings:", error);
    throw error;
  }
};

export const subscribeToPRSettings = (callback: (settings: PRSettings | null) => void): Unsubscribe => {
  return onSnapshot(prSettingsRef, (docSnap) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() } as PRSettings);
    } else {
      callback({
        id: 'purchaseRequest',
        recipients: [],
        companyName: 'Qualitas Technologies Pvt Ltd',
        fromEmail: 'info@qualitastech.com',
        updatedAt: new Date()
      });
    }
  });
};

// Email validation utility
export const validateEmail = (email: string): boolean => {
  return isValidEmail(email);
};

export const validatePRSettings = (settings: Partial<PRSettings>): string[] => {
  const errors: string[] = [];

  if (!settings.companyName?.trim()) {
    errors.push('Company name is required');
  }

  if (!settings.fromEmail?.trim()) {
    errors.push('Sender email is required');
  } else if (!isValidEmail(settings.fromEmail)) {
    errors.push('Invalid sender email format');
  }

  if (!settings.recipients || settings.recipients.length === 0) {
    errors.push('At least one recipient email is required');
  }

  // Validate each email
  if (settings.recipients) {
    settings.recipients.forEach((email, index) => {
      if (!isValidEmail(email)) {
        errors.push(`Invalid email format at position ${index + 1}: ${email}`);
      }
    });
  }

  return errors;
};

// Export collections for use in other components if needed
export { clientsCol, vendorsCol, bomSettingsRef, prSettingsRef };