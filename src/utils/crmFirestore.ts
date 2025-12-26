import { db } from "@/firebase";
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
  limit,
  setDoc,
  Timestamp,
  Unsubscribe,
} from "firebase/firestore";
import {
  Deal,
  DealStage,
  Contact,
  ActivityLogEntry,
  ActivityType,
  DraftBOMData,
  DraftBOMCategory,
  Proposal,
  PipelineSummary,
  PipelineStageSummary,
  DEAL_STAGE_ORDER,
  calculateWeightedValue,
} from "@/types/crm";

// ============================================
// Collection References
// ============================================

const dealsCol = collection(db, "deals");
const contactsCol = collection(db, "contacts");

// Helper to clean undefined values for Firestore
const cleanFirestoreData = <T extends Record<string, unknown>>(data: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(data).filter(([_, value]) => value !== undefined)
  ) as Partial<T>;
};

// ============================================
// DEALS CRUD
// ============================================

export const createDeal = async (deal: Omit<Deal, 'id'>): Promise<string> => {
  const now = new Date();
  const dealData = cleanFirestoreData({
    ...deal,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    isArchived: false,
    hasDraftBOM: false,
    draftBOMTotalCost: 0,
  });

  const docRef = await addDoc(dealsCol, dealData);
  return docRef.id;
};

export const getDeal = async (dealId: string): Promise<Deal | null> => {
  const docRef = doc(dealsCol, dealId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Deal;
  }
  return null;
};

export const updateDeal = async (dealId: string, updates: Partial<Deal>): Promise<void> => {
  const docRef = doc(dealsCol, dealId);
  const cleanedUpdates = cleanFirestoreData({
    ...updates,
    updatedAt: new Date(),
  });
  await updateDoc(docRef, cleanedUpdates);
};

export const deleteDeal = async (dealId: string): Promise<void> => {
  const docRef = doc(dealsCol, dealId);
  await deleteDoc(docRef);
};

export const archiveDeal = async (dealId: string): Promise<void> => {
  await updateDeal(dealId, {
    isArchived: true,
    archivedAt: new Date(),
  });
};

export const restoreDeal = async (dealId: string, stage: DealStage = 'new'): Promise<void> => {
  const docRef = doc(dealsCol, dealId);
  await updateDoc(docRef, {
    isArchived: false,
    archivedAt: null,
    stage: stage,
    updatedAt: new Date(),
  });
};

// Get all deals (optionally filter by archived status)
export const getDeals = async (includeArchived: boolean = false): Promise<Deal[]> => {
  let q;
  if (includeArchived) {
    q = query(dealsCol, orderBy("updatedAt", "desc"));
  } else {
    q = query(dealsCol, where("isArchived", "==", false), orderBy("updatedAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
};

// Get deals by client
export const getDealsByClient = async (clientId: string): Promise<Deal[]> => {
  const q = query(
    dealsCol,
    where("clientId", "==", clientId),
    where("isArchived", "==", false),
    orderBy("updatedAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
};

// Get deals by stage
export const getDealsByStage = async (stage: DealStage): Promise<Deal[]> => {
  const q = query(
    dealsCol,
    where("stage", "==", stage),
    where("isArchived", "==", false),
    orderBy("updatedAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
};

// Get deals assigned to a user
export const getDealsByAssignee = async (assigneeId: string): Promise<Deal[]> => {
  const q = query(
    dealsCol,
    where("assigneeId", "==", assigneeId),
    where("isArchived", "==", false),
    orderBy("updatedAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
};

// Subscribe to deals (real-time updates)
export const subscribeToDeals = (
  callback: (deals: Deal[]) => void,
  includeArchived: boolean = false
): Unsubscribe => {
  let q;
  if (includeArchived) {
    q = query(dealsCol, orderBy("updatedAt", "desc"));
  } else {
    q = query(dealsCol, where("isArchived", "==", false), orderBy("updatedAt", "desc"));
  }

  return onSnapshot(q, (snapshot) => {
    const deals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
    callback(deals);
  });
};

// Duplicate a deal
export const duplicateDeal = async (dealId: string, newName?: string): Promise<string> => {
  const originalDeal = await getDeal(dealId);
  if (!originalDeal) throw new Error("Deal not found");

  const { id, createdAt, updatedAt, lastActivityAt, convertedProjectId, closedAt, ...dealData } = originalDeal;

  const newDeal: Omit<Deal, 'id'> = {
    ...dealData,
    name: newName || `${originalDeal.name} (Copy)`,
    stage: 'new',
    isArchived: false,
    archivedAt: undefined,
    lostReasonCategory: undefined,
    lostReasonDetails: undefined,
    hasDraftBOM: false,
    draftBOMTotalCost: 0,
    nextStep: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
  };

  return createDeal(newDeal);
};

// ============================================
// PIPELINE SUMMARY
// ============================================

export const getPipelineSummary = async (): Promise<PipelineSummary> => {
  const deals = await getDeals(false);

  const stageMap = new Map<DealStage, PipelineStageSummary>();

  // Initialize all stages
  for (const stage of DEAL_STAGE_ORDER) {
    stageMap.set(stage, {
      stage,
      count: 0,
      totalValue: 0,
      weightedValue: 0,
    });
  }

  // Aggregate deals by stage
  for (const deal of deals) {
    const summary = stageMap.get(deal.stage);
    if (summary) {
      summary.count += 1;
      summary.totalValue += deal.expectedValue;
      summary.weightedValue += calculateWeightedValue(deal.expectedValue, deal.probability);
    }
  }

  const stages = DEAL_STAGE_ORDER.map(stage => stageMap.get(stage)!);

  return {
    stages,
    totalDeals: deals.length,
    totalValue: stages.reduce((sum, s) => sum + s.totalValue, 0),
    totalWeightedValue: stages.reduce((sum, s) => sum + s.weightedValue, 0),
  };
};

// ============================================
// CONTACTS CRUD
// ============================================

export const createContact = async (contact: Omit<Contact, 'id'>): Promise<string> => {
  const now = new Date();
  const contactData = cleanFirestoreData({
    ...contact,
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(contactsCol, contactData);
  return docRef.id;
};

export const getContact = async (contactId: string): Promise<Contact | null> => {
  const docRef = doc(contactsCol, contactId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Contact;
  }
  return null;
};

export const updateContact = async (contactId: string, updates: Partial<Contact>): Promise<void> => {
  const docRef = doc(contactsCol, contactId);
  const cleanedUpdates = cleanFirestoreData({
    ...updates,
    updatedAt: new Date(),
  });
  await updateDoc(docRef, cleanedUpdates);
};

export const deleteContact = async (contactId: string): Promise<void> => {
  const docRef = doc(contactsCol, contactId);
  await deleteDoc(docRef);
};

// Get all contacts
export const getContacts = async (): Promise<Contact[]> => {
  const q = query(contactsCol, orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));
};

// Get contacts by client
export const getContactsByClient = async (clientId: string): Promise<Contact[]> => {
  const q = query(
    contactsCol,
    where("clientId", "==", clientId),
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));
};

// Get primary contact for a client
export const getPrimaryContact = async (clientId: string): Promise<Contact | null> => {
  const q = query(
    contactsCol,
    where("clientId", "==", clientId),
    where("isPrimary", "==", true),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.docs.length > 0) {
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Contact;
  }
  return null;
};

// Subscribe to contacts for a client
export const subscribeToClientContacts = (
  clientId: string,
  callback: (contacts: Contact[]) => void
): Unsubscribe => {
  const q = query(
    contactsCol,
    where("clientId", "==", clientId),
    orderBy("name", "asc")
  );

  return onSnapshot(q, (snapshot) => {
    const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));
    callback(contacts);
  });
};

// ============================================
// ACTIVITY LOG
// ============================================

const getActivityLogCol = (dealId: string) =>
  collection(db, "deals", dealId, "activityLog");

export const logActivity = async (
  dealId: string,
  entry: Omit<ActivityLogEntry, 'id' | 'dealId' | 'createdAt'>
): Promise<string> => {
  const activityCol = getActivityLogCol(dealId);
  const now = new Date();

  const entryData = cleanFirestoreData({
    ...entry,
    dealId,
    createdAt: now,
  });

  const docRef = await addDoc(activityCol, entryData);

  // Update deal's lastActivityAt
  await updateDeal(dealId, { lastActivityAt: now });

  return docRef.id;
};

export const getActivityLog = async (dealId: string, limitCount?: number): Promise<ActivityLogEntry[]> => {
  const activityCol = getActivityLogCol(dealId);

  let q;
  if (limitCount) {
    q = query(activityCol, orderBy("completedAt", "desc"), limit(limitCount));
  } else {
    q = query(activityCol, orderBy("completedAt", "desc"));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLogEntry));
};

export const subscribeToActivityLog = (
  dealId: string,
  callback: (entries: ActivityLogEntry[]) => void,
  limitCount?: number
): Unsubscribe => {
  const activityCol = getActivityLogCol(dealId);

  let q;
  if (limitCount) {
    q = query(activityCol, orderBy("completedAt", "desc"), limit(limitCount));
  } else {
    q = query(activityCol, orderBy("completedAt", "desc"));
  }

  return onSnapshot(q, (snapshot) => {
    const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLogEntry));
    callback(entries);
  });
};

// Log stage change automatically
export const logStageChange = async (
  dealId: string,
  fromStage: DealStage,
  toStage: DealStage,
  userId: string
): Promise<void> => {
  await logActivity(dealId, {
    action: `Stage changed from ${fromStage} to ${toStage}`,
    type: 'stage-change',
    completedAt: new Date(),
    completedBy: userId,
    stageAtTime: toStage,
  });
};

// ============================================
// DRAFT BOM
// ============================================

const getDraftBOMRef = (dealId: string) =>
  doc(db, "deals", dealId, "draftBOM", "data");

export const getDraftBOM = async (dealId: string): Promise<DraftBOMCategory[]> => {
  const bomRef = getDraftBOMRef(dealId);
  const bomSnap = await getDoc(bomRef);

  if (bomSnap.exists()) {
    const data = bomSnap.data() as DraftBOMData;
    return data.categories || [];
  }
  return [];
};

export const updateDraftBOM = async (dealId: string, categories: DraftBOMCategory[]): Promise<void> => {
  const bomRef = getDraftBOMRef(dealId);

  // Calculate total cost
  const totalCost = categories.reduce((sum, cat) => {
    return sum + cat.items.reduce((catSum, item) => {
      return catSum + (item.estimatedUnitPrice * item.quantity);
    }, 0);
  }, 0);

  await setDoc(bomRef, { categories }, { merge: true });

  // Update deal's draft BOM flags
  await updateDeal(dealId, {
    hasDraftBOM: categories.some(cat => cat.items.length > 0),
    draftBOMTotalCost: totalCost,
  });
};

export const subscribeToDraftBOM = (
  dealId: string,
  callback: (categories: DraftBOMCategory[]) => void
): Unsubscribe => {
  const bomRef = getDraftBOMRef(dealId);

  return onSnapshot(bomRef, (doc) => {
    if (doc.exists()) {
      const data = doc.data() as DraftBOMData;
      callback(data.categories || []);
    } else {
      callback([]);
    }
  });
};

// ============================================
// PROPOSALS
// ============================================

const getProposalsCol = (dealId: string) =>
  collection(db, "deals", dealId, "proposals");

export const createProposal = async (
  dealId: string,
  proposal: Omit<Proposal, 'id' | 'dealId'>
): Promise<string> => {
  const proposalsCol = getProposalsCol(dealId);
  const now = new Date();

  const proposalData = cleanFirestoreData({
    ...proposal,
    dealId,
    createdAt: now,
  });

  const docRef = await addDoc(proposalsCol, proposalData);
  return docRef.id;
};

export const getProposals = async (dealId: string): Promise<Proposal[]> => {
  const proposalsCol = getProposalsCol(dealId);
  const q = query(proposalsCol, orderBy("createdAt", "desc"));

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Proposal));
};

export const updateProposal = async (
  dealId: string,
  proposalId: string,
  updates: Partial<Proposal>
): Promise<void> => {
  const proposalRef = doc(db, "deals", dealId, "proposals", proposalId);
  const cleanedUpdates = cleanFirestoreData(updates);
  await updateDoc(proposalRef, cleanedUpdates);
};

// ============================================
// DEAL → PROJECT CONVERSION
// ============================================

export const markDealAsWon = async (
  dealId: string,
  projectId: string,
  userId: string
): Promise<void> => {
  await updateDeal(dealId, {
    stage: 'won',
    convertedProjectId: projectId,
    closedAt: new Date(),
  });

  await logStageChange(dealId, 'negotiation', 'won', userId);
};

export const markDealAsLost = async (
  dealId: string,
  reasonCategory: Deal['lostReasonCategory'],
  reasonDetails: string,
  userId: string
): Promise<void> => {
  const deal = await getDeal(dealId);
  const previousStage = deal?.stage || 'new';

  await updateDeal(dealId, {
    stage: 'lost',
    lostReasonCategory: reasonCategory,
    lostReasonDetails: reasonDetails,
    closedAt: new Date(),
  });

  await logStageChange(dealId, previousStage, 'lost', userId);
  await archiveDeal(dealId);
};
