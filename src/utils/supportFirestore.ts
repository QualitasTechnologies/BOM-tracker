import { db, functions, storage } from '@/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type {
  CreateSupportTicketInput,
  SupportActivity,
  SupportActivityType,
  SupportDocument,
  SupportDocumentCategory,
  SupportTicket,
} from '@/types/support';
import type { ClientContact, ClientContactRole } from './settingsFirestore';
import { calculateSupportTargets } from './supportLogic';

const asDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }
  return fallback;
};

const optionalDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  return asDate(value);
};

const mapTicket = (id: string, data: DocumentData): SupportTicket => ({
  ...data,
  id,
  reportedAt: asDate(data.reportedAt),
  createdAt: asDate(data.createdAt),
  updatedAt: asDate(data.updatedAt),
  firstResponseTargetAt: asDate(data.firstResponseTargetAt),
  resolutionTargetAt: asDate(data.resolutionTargetAt),
  firstResponseAt: optionalDate(data.firstResponseAt),
  scheduledFor: optionalDate(data.scheduledFor),
  quotationSentAt: optionalDate(data.quotationSentAt),
  quotationAcceptedAt: optionalDate(data.quotationAcceptedAt),
  resolvedAt: optionalDate(data.resolvedAt),
  closedAt: optionalDate(data.closedAt),
  customerConfirmedAt: optionalDate(data.customerConfirmedAt),
}) as SupportTicket;

const mapActivity = (id: string, data: DocumentData): SupportActivity => ({
  ...data,
  id,
  createdAt: asDate(data.createdAt),
}) as SupportActivity;

const mapDocument = (id: string, data: DocumentData): SupportDocument => ({
  ...data,
  id,
  uploadedAt: asDate(data.uploadedAt),
}) as SupportDocument;

const clean = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

export async function createSupportTicket(
  input: CreateSupportTicketInput,
  actor: { uid: string; name: string },
): Promise<SupportTicket> {
  const now = input.reportedAt || new Date();
  const targets = calculateSupportTargets(input.priority, now);
  const ticketsRef = collection(db, 'projects', input.projectId, 'supportTickets');
  const data = clean({
    ...input,
    status: 'open',
    reportedAt: Timestamp.fromDate(now),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    ticketNumber: 'Pending',
    customerConfirmation: 'pending',
    ...Object.fromEntries(
      Object.entries(targets).map(([key, value]) => [key, Timestamp.fromDate(value)]),
    ),
  });
  const ticketRef = await addDoc(ticketsRef, data);
  const ticketNumber = `SUP-${now.getFullYear()}-${ticketRef.id.slice(0, 6).toUpperCase()}`;
  await updateDoc(ticketRef, { ticketNumber });
  await addSupportActivity(input.projectId, ticketRef.id, {
    type: 'created',
    message: `Ticket ${ticketNumber} created`,
    createdBy: actor.uid,
    createdByName: actor.name,
  });

  return mapTicket(ticketRef.id, {
    ...data,
    ticketNumber,
    createdAt: now,
    updatedAt: now,
  });
}

export function subscribeToSupportTickets(
  projectIds: string[],
  callback: (tickets: SupportTicket[]) => void,
): Unsubscribe {
  if (!projectIds.length) {
    callback([]);
    return () => undefined;
  }

  const byProject = new Map<string, SupportTicket[]>();
  const emit = () => {
    const tickets = [...byProject.values()]
      .flat()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    callback(tickets);
  };

  const unsubscribers = projectIds.map((projectId) => {
    const ticketsQuery = query(
      collection(db, 'projects', projectId, 'supportTickets'),
      orderBy('updatedAt', 'desc'),
    );
    return onSnapshot(ticketsQuery, (snapshot) => {
      byProject.set(
        projectId,
        snapshot.docs.map((ticketDoc) => mapTicket(ticketDoc.id, ticketDoc.data())),
      );
      emit();
    });
  });

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function subscribeToSupportTicket(
  projectId: string,
  ticketId: string,
  callback: (ticket: SupportTicket | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'projects', projectId, 'supportTickets', ticketId), (snapshot) => {
    callback(snapshot.exists() ? mapTicket(snapshot.id, snapshot.data()) : null);
  });
}

export async function updateSupportTicket(
  projectId: string,
  ticketId: string,
  updates: Partial<SupportTicket>,
) {
  const serialized = Object.fromEntries(
    Object.entries(updates)
      .filter(([key, value]) => key !== 'id' && value !== undefined)
      .map(([key, value]) => [key, value instanceof Date ? Timestamp.fromDate(value) : value]),
  );
  await updateDoc(doc(db, 'projects', projectId, 'supportTickets', ticketId), {
    ...serialized,
    updatedAt: serverTimestamp(),
  });
}

export async function addSupportActivity(
  projectId: string,
  ticketId: string,
  activity: {
    type: SupportActivityType;
    message: string;
    createdBy: string;
    createdByName: string;
    metadata?: SupportActivity['metadata'];
  },
) {
  await addDoc(
    collection(db, 'projects', projectId, 'supportTickets', ticketId, 'activities'),
    clean({ ...activity, createdAt: serverTimestamp() }),
  );
}

export function subscribeToSupportActivities(
  projectId: string,
  ticketId: string,
  callback: (activities: SupportActivity[]) => void,
): Unsubscribe {
  const activityQuery = query(
    collection(db, 'projects', projectId, 'supportTickets', ticketId, 'activities'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(activityQuery, (snapshot) => {
    callback(snapshot.docs.map((activityDoc) => mapActivity(activityDoc.id, activityDoc.data())));
  });
}

export async function uploadSupportDocument(
  file: File,
  input: {
    projectId: string;
    ticketId?: string;
    category: SupportDocumentCategory;
    userId: string;
    userName: string;
  },
): Promise<SupportDocument> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ticketSegment = input.ticketId || 'project-library';
  const storagePath = `projects/${input.projectId}/support/${ticketSegment}/${input.category}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(storageRef);

  const data = clean({
    projectId: input.projectId,
    ticketId: input.ticketId,
    name: file.name,
    url,
    storagePath,
    category: input.category,
    fileSize: file.size,
    contentType: file.type || 'application/octet-stream',
    uploadedAt: serverTimestamp(),
    uploadedBy: input.userId,
    uploadedByName: input.userName,
  });
  const documentRef = await addDoc(
    collection(db, 'projects', input.projectId, 'supportDocuments'),
    data,
  );
  return mapDocument(documentRef.id, { ...data, uploadedAt: new Date() });
}

export function subscribeToSupportDocuments(
  projectId: string,
  callback: (documents: SupportDocument[]) => void,
): Unsubscribe {
  const documentsQuery = query(
    collection(db, 'projects', projectId, 'supportDocuments'),
    orderBy('uploadedAt', 'desc'),
  );
  return onSnapshot(documentsQuery, (snapshot) => {
    callback(snapshot.docs.map((documentSnapshot) => mapDocument(documentSnapshot.id, documentSnapshot.data())));
  });
}

export async function getSupportDocumentCounts(projectIds: string[]) {
  const counts = await Promise.all(
    projectIds.map(async (projectId) => {
      const snapshot = await getDocs(collection(db, 'projects', projectId, 'supportDocuments'));
      return [projectId, snapshot.size] as const;
    }),
  );
  return Object.fromEntries(counts);
}

export async function deleteSupportDocument(document: SupportDocument) {
  await deleteObject(ref(storage, document.storagePath));
  await deleteDoc(doc(db, 'projects', document.projectId, 'supportDocuments', document.id));
}

export type SupportCommunicationKind = 'acknowledgement' | 'quotation' | 'resolution';

export async function sendSupportCommunication(input: {
  projectId: string;
  ticketId: string;
  kind: SupportCommunicationKind;
  cc?: string[];
  message?: string;
  documentId?: string;
}) {
  const callable = httpsCallable<typeof input, { success: boolean; messageId?: string }>(
    functions,
    'sendSupportCommunication',
  );
  const result = await callable(input);
  return result.data;
}

export async function addClientCRMContact(input: {
  projectId: string;
  clientId: string;
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
  role: ClientContactRole;
}): Promise<ClientContact> {
  const callable = httpsCallable<typeof input, { contact: ClientContact }>(
    functions,
    'addClientCRMContact',
  );
  const result = await callable(input);
  return result.data.contact;
}
