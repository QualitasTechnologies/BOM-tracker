import { db, functions } from "@/firebase";
import {
  collection,
  addDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  Unsubscribe,
  runTransaction,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  PurchaseOrder,
  POStatus,
  POItem,
  POWarning,
  TaxType,
  calculatePOTotals,
  generatePONumber,
  determineTaxType,
  numberToWords,
} from "@/types/purchaseOrder";
import { getCompanySettings, updateCompanySettings } from "./settingsFirestore";

// Re-export types for convenience
export type { PurchaseOrder, POStatus, POItem, POWarning, TaxType };

/**
 * Remove undefined values from an object to prevent Firestore errors
 * Recursively cleans nested objects and arrays
 */
const cleanFirestoreData = <T extends Record<string, unknown>>(data: T): Partial<T> => {
  const cleanValue = (value: unknown): unknown => {
    if (value === undefined) return null; // Convert undefined to null for Firestore
    if (value === null) return null;
    if (Array.isArray(value)) {
      return value.map(cleanValue);
    }
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value !== null) {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) {
          cleaned[k] = cleanValue(v);
        }
      }
      return cleaned;
    }
    return value;
  };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result[key] = cleanValue(value);
    }
  }
  return result as Partial<T>;
};

/**
 * Convert Firestore Timestamp to Date
 */
const toDate = (timestamp: Timestamp | Date | undefined): Date | undefined => {
  if (!timestamp) return undefined;
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  return timestamp;
};

/**
 * Convert Date to Firestore Timestamp
 */
const toTimestamp = (date: Date | undefined): Timestamp | undefined => {
  if (!date) return undefined;
  return Timestamp.fromDate(date);
};

// ============================================
// PO Collection Reference
// ============================================

const getPOCollectionRef = (projectId: string) => {
  return collection(db, "projects", projectId, "purchaseOrders");
};

// ============================================
// Create Purchase Order
// ============================================

export interface CreatePOInput {
  projectId: string;
  projectReference: string;

  // Vendor info
  vendorId: string;
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  vendorStateCode: string;
  vendorStateName: string;
  vendorEmail?: string;
  vendorPhone?: string;

  // Items
  items: Omit<POItem, 'slNo'>[];

  // Terms
  paymentTerms: string;
  deliveryTerms: string;
  dispatchedThrough?: string;
  destination?: string;
  termsAndConditions?: string;
  includeAnnexure: boolean;

  // Dates
  expectedDeliveryDate?: Date;

  // Reference
  customerPoReference?: string;

  // User
  createdBy: string;
}

export const createPurchaseOrder = async (input: CreatePOInput): Promise<string> => {
  // Get company settings for invoice details and PO numbering
  const companySettings = await getCompanySettings();

  if (!companySettings) {
    throw new Error("Company settings not configured. Please set up company details in Settings.");
  }

  // Validate company settings
  if (!companySettings.gstin || !companySettings.stateCode) {
    throw new Error("Company GSTIN and State Code must be configured in Settings.");
  }

  // Generate PO number
  const poNumber = generatePONumber(
    companySettings.poNumberPrefix,
    companySettings.poNumberFormat,
    companySettings.nextPoNumber
  );

  // Determine tax type based on states
  const taxType = determineTaxType(companySettings.stateCode, input.vendorStateCode);
  const taxPercentage = 18; // Standard GST rate

  // Add serial numbers to items
  const itemsWithSlNo: POItem[] = input.items.map((item, index) => ({
    ...item,
    slNo: index + 1,
  }));

  // Calculate totals
  const totals = calculatePOTotals(itemsWithSlNo, taxType, taxPercentage);

  // Create PO object
  const now = new Date();
  const po: Omit<PurchaseOrder, 'id'> = {
    projectId: input.projectId,
    poNumber,

    // Vendor
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    vendorAddress: input.vendorAddress,
    vendorGstin: input.vendorGstin,
    vendorStateCode: input.vendorStateCode,
    vendorStateName: input.vendorStateName,
    vendorEmail: input.vendorEmail,
    vendorPhone: input.vendorPhone,

    // Reference
    projectReference: input.projectReference,
    customerPoReference: input.customerPoReference,

    // Invoice To (from company settings)
    invoiceToCompany: companySettings.companyName,
    invoiceToAddress: companySettings.companyAddress,
    invoiceToGstin: companySettings.gstin,
    invoiceToStateCode: companySettings.stateCode,
    invoiceToStateName: companySettings.stateName,

    // Ship To (same as invoice for now - can be customized later)
    shipToAddress: companySettings.companyAddress,
    shipToGstin: companySettings.gstin,
    shipToStateCode: companySettings.stateCode,
    shipToStateName: companySettings.stateName,

    // Items
    items: itemsWithSlNo,

    // Financials
    subtotal: totals.subtotal,
    taxType,
    taxPercentage,
    igstAmount: totals.igstAmount,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    totalAmount: totals.totalAmount,
    amountInWords: totals.amountInWords,
    currency: 'INR',

    // Terms
    paymentTerms: input.paymentTerms,
    deliveryTerms: input.deliveryTerms,
    dispatchedThrough: input.dispatchedThrough,
    destination: input.destination,
    termsAndConditions: input.termsAndConditions,
    includeAnnexure: input.includeAnnexure,

    // Dates
    poDate: now,
    expectedDeliveryDate: input.expectedDeliveryDate,

    // Status - always starts as draft
    status: 'draft',

    // Warnings - empty for now, can be populated later
    warnings: [],

    // Tracking
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
  };

  // Clean undefined values
  const cleanedPO = cleanFirestoreData(po);

  // Convert dates to Timestamps
  const firestorePO = {
    ...cleanedPO,
    poDate: Timestamp.fromDate(now),
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
    expectedDeliveryDate: input.expectedDeliveryDate ? Timestamp.fromDate(input.expectedDeliveryDate) : null,
  };

  // Add to Firestore
  const collectionRef = getPOCollectionRef(input.projectId);
  const docRef = await addDoc(collectionRef, firestorePO);

  // Increment PO number in company settings
  await updateCompanySettings({
    nextPoNumber: companySettings.nextPoNumber + 1,
  });

  return docRef.id;
};

// ============================================
// Get Purchase Orders
// ============================================

export const getPurchaseOrders = async (projectId: string): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(collectionRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      poDate: toDate(data.poDate) || new Date(),
      createdAt: toDate(data.createdAt) || new Date(),
      updatedAt: toDate(data.updatedAt) || new Date(),
      expectedDeliveryDate: toDate(data.expectedDeliveryDate),
      sentAt: toDate(data.sentAt),
      closedAt: toDate(data.closedAt),
    } as PurchaseOrder;
  });
};

export const getPurchaseOrder = async (projectId: string, poId: string): Promise<PurchaseOrder | null> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    poDate: toDate(data.poDate) || new Date(),
    createdAt: toDate(data.createdAt) || new Date(),
    updatedAt: toDate(data.updatedAt) || new Date(),
    expectedDeliveryDate: toDate(data.expectedDeliveryDate),
    sentAt: toDate(data.sentAt),
    closedAt: toDate(data.closedAt),
  } as PurchaseOrder;
};

// ============================================
// Subscribe to Purchase Orders
// ============================================

export const subscribeToPurchaseOrders = (
  projectId: string,
  callback: (pos: PurchaseOrder[]) => void
): Unsubscribe => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(collectionRef, orderBy("createdAt", "desc"));

  return onSnapshot(q, (snapshot) => {
    const pos = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        poDate: toDate(data.poDate) || new Date(),
        createdAt: toDate(data.createdAt) || new Date(),
        updatedAt: toDate(data.updatedAt) || new Date(),
        expectedDeliveryDate: toDate(data.expectedDeliveryDate),
        sentAt: toDate(data.sentAt),
        closedAt: toDate(data.closedAt),
      } as PurchaseOrder;
    });
    callback(pos);
  });
};

// ============================================
// Update Purchase Order
// ============================================

export interface UpdatePOInput {
  // Terms (can be edited while in draft)
  paymentTerms?: string;
  deliveryTerms?: string;
  dispatchedThrough?: string;
  destination?: string;
  termsAndConditions?: string;
  includeAnnexure?: boolean;

  // Dates
  expectedDeliveryDate?: Date;

  // Status
  status?: POStatus;

  // Reference
  customerPoReference?: string;

  // Warnings
  warnings?: POWarning[];

  // PDF URL (set after generation)
  pdfUrl?: string;
}

export const updatePurchaseOrder = async (
  projectId: string,
  poId: string,
  updates: UpdatePOInput
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  const cleanedUpdates = cleanFirestoreData({
    ...updates,
    updatedAt: Timestamp.fromDate(new Date()),
    expectedDeliveryDate: updates.expectedDeliveryDate
      ? Timestamp.fromDate(updates.expectedDeliveryDate)
      : undefined,
  });

  await updateDoc(docRef, cleanedUpdates);
};

// ============================================
// Send Purchase Order (Admin Only)
// ============================================

export interface SendPOInput {
  sentBy: string;
  sentToEmail: string;
}

export const sendPurchaseOrder = async (
  projectId: string,
  poId: string,
  input: SendPOInput,
  updateBOMItemsCallback?: (bomItemIds: string[]) => Promise<void>
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  // Get the PO to get BOM item IDs
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  if (po.status !== 'draft') {
    throw new Error("Only draft POs can be sent");
  }

  const now = new Date();

  // Update PO status to sent
  await updateDoc(docRef, {
    status: 'sent',
    sentAt: Timestamp.fromDate(now),
    sentBy: input.sentBy,
    sentToEmail: input.sentToEmail,
    updatedAt: Timestamp.fromDate(now),
  });

  // Update BOM items to "Ordered" status if callback provided
  if (updateBOMItemsCallback) {
    const bomItemIds = po.items.map(item => item.bomItemId);
    await updateBOMItemsCallback(bomItemIds);
  }
};

// ============================================
// Delete Purchase Order
// ============================================

export const deletePurchaseOrder = async (
  projectId: string,
  poId: string
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  await deleteDoc(docRef);
};

// ============================================
// Get POs by Vendor
// ============================================

export const getPurchaseOrdersByVendor = async (
  projectId: string,
  vendorId: string
): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(
    collectionRef,
    where("vendorId", "==", vendorId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      poDate: toDate(data.poDate) || new Date(),
      createdAt: toDate(data.createdAt) || new Date(),
      updatedAt: toDate(data.updatedAt) || new Date(),
      expectedDeliveryDate: toDate(data.expectedDeliveryDate),
      sentAt: toDate(data.sentAt),
      closedAt: toDate(data.closedAt),
    } as PurchaseOrder;
  });
};

// ============================================
// Get POs by Status
// ============================================

export const getPurchaseOrdersByStatus = async (
  projectId: string,
  status: POStatus
): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(
    collectionRef,
    where("status", "==", status),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      poDate: toDate(data.poDate) || new Date(),
      createdAt: toDate(data.createdAt) || new Date(),
      updatedAt: toDate(data.updatedAt) || new Date(),
      expectedDeliveryDate: toDate(data.expectedDeliveryDate),
      sentAt: toDate(data.sentAt),
      closedAt: toDate(data.closedAt),
    } as PurchaseOrder;
  });
};

// ============================================
// Update PO Status
// ============================================

export const updatePOStatus = async (
  projectId: string,
  poId: string,
  newStatus: POStatus
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: Timestamp.fromDate(new Date()),
  };

  // Add closedAt for terminal statuses
  if (newStatus === 'completed' || newStatus === 'cancelled') {
    updates.closedAt = Timestamp.fromDate(new Date());
  }

  await updateDoc(docRef, updates);
};

// ============================================
// Recalculate PO Totals
// ============================================

export const recalculatePOTotals = async (
  projectId: string,
  poId: string
): Promise<void> => {
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  const totals = calculatePOTotals(po.items, po.taxType, po.taxPercentage);

  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  await updateDoc(docRef, {
    ...totals,
    updatedAt: Timestamp.fromDate(new Date()),
  });
};

// ============================================
// PDF Generation
// ============================================

export interface GeneratePOPDFInput {
  purchaseOrder: PurchaseOrder;
  companySettings: {
    companyName: string;
    companyAddress: string;
    gstin: string;
    stateCode: string;
    stateName: string;
    pan?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  companyLogo?: string;       // Base64 encoded logo (optional)
  companyLogoPath?: string;   // Firebase Storage path (preferred - avoids CORS)
}

export interface GeneratePOPDFResult {
  success: boolean;
  pdfUrl: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
}

/**
 * Serialize Date objects to ISO strings for Firebase callable functions
 * This prevents serialization errors when Date objects are null or invalid
 */
const serializeDates = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (obj instanceof Date) {
    // Return ISO string, or null if date is invalid
    return isNaN(obj.getTime()) ? null : obj.toISOString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeDates);
  }
  
  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeDates(value);
    }
    return serialized;
  }
  
  return obj;
};

/**
 * Generate a PDF for a Purchase Order
 * Calls Firebase Function to create PDF and store in Firebase Storage
 */
export const generatePOPDF = async (
  input: GeneratePOPDFInput
): Promise<GeneratePOPDFResult> => {
  const generatePOPDFFunction = httpsCallable<GeneratePOPDFInput, GeneratePOPDFResult>(
    functions,
    'generatePOPDF'
  );

  // Serialize Date objects to ISO strings to prevent serialization errors
  const serializedInput = serializeDates(input);

  const result = await generatePOPDFFunction(serializedInput);
  return result.data;
};

// ============================================
// Send PO via Email
// ============================================

export interface SendPOEmailInput {
  purchaseOrder: PurchaseOrder;
  companySettings: {
    companyName: string;
    companyAddress: string;
    gstin: string;
    stateCode: string;
    stateName: string;
    pan?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  companyLogo?: string;       // Base64 encoded logo (optional)
  companyLogoPath?: string;   // Firebase Storage path (preferred - avoids CORS)
  recipientEmail: string;
  ccEmails?: string[];
}

export interface SendPOEmailResult {
  success: boolean;
  message: string;
  pdfUrl: string;
}

/**
 * Generate PDF and send PO via email to vendor
 * Uses Firebase Function with SendGrid
 */
export const sendPOEmail = async (
  input: SendPOEmailInput
): Promise<SendPOEmailResult> => {
  const sendPurchaseOrderFunction = httpsCallable<SendPOEmailInput, SendPOEmailResult>(
    functions,
    'sendPurchaseOrder'
  );

  const result = await sendPurchaseOrderFunction(input);
  return result.data;
};
