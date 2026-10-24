import { collection, addDoc, query, where, getDocs, deleteDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '@/firebase';
import { ProjectDocument, DocumentType } from '@/types/projectDocument';
import { nativeProjectDocumentsEnabled } from './projectDocumentMode';
import { isNativeMaterialCommandEnabled } from './nativeMaterialCommands';
import { isScopedProjectReadEnabled } from './projectReadMode';
import { createNativeProjectDocumentUploadAttempt, getPendingNativeProjectDocumentTypes } from './nativeProjectDocumentUpload';
import { createNativeProjectDocumentDeleteAttempt, getNativeProjectDocuments, getPendingNativeProjectDocumentDeletes } from './nativeProjectDocumentOperations';
import { nativeProjectReads, type NativeProjectDocument } from './nativeProjectReads';

export interface ProjectDocumentRequestOptions {
  isCurrent?: () => boolean;
}

export interface ReceivedPhotoInvoiceOptions extends ProjectDocumentRequestOptions {
  // Only used when scoped reads are off: the legacy document list is searched for this document.
  invoiceDocumentId?: string;
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 1000;
const MAX_SCAN_ATTEMPTS = 3;

const isSafeMaterialEditsEnabled = () => import.meta.env.VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED === 'true';
const nativeFinalized = /(%2F|\/)documents(%2F|\/)native(%2F|\/)finalized(%2F|\/)/;
const currentUid = () => auth.currentUser?.uid || '';
const currentOf = (options?: ProjectDocumentRequestOptions) => options?.isCurrent ?? (() => true);
const readError = (code: string, message: string) => Object.assign(new Error(message), { code });
const changed = () => readError('identity_changed', 'The signed-in account or document project changed. Reopen the form.');
const integrity = () => readError('integrity', 'Project data failed an integrity check. Refresh and try again.');
const signInRequired = () => readError('sign_in_required', 'Sign in again to read project documents.');
const assertSame = (uid: string, isCurrent: () => boolean) => {
  if (!isCurrent() || currentUid() !== uid) throw changed();
};
const scopedWriteUnavailable = () => new Error('Document changes are temporarily unavailable here. Reopen the project to use its safe document actions.');
const savedStateRequired = () => new Error('There is no saved document request to recover.');

// Saved work for this account and project, read from metadata only. Throws when recovery storage is unreadable.
export function getPendingProjectDocumentOperations(projectId: string, uid: string): { uploads: DocumentType[]; deletions: string[] } {
  return {
    uploads: getPendingNativeProjectDocumentTypes(uid, projectId),
    deletions: getPendingNativeProjectDocumentDeletes(uid, projectId),
  };
}

const hasPendingWork = (uid: string, projectId: string) => {
  const pending = getPendingProjectDocumentOperations(projectId, uid);
  return pending.uploads.length > 0 || pending.deletions.length > 0;
};

// Legacy Firestore reads must remain available when optional recovery metadata is damaged.
// Native requests still fail closed because their own client validates its persisted operation.
const hasPendingReadWork = (uid: string, projectId: string) => {
  try {
    return hasPendingWork(uid, projectId);
  } catch {
    return false;
  }
};

// A saved deletion for this exact document (unreadable recovery storage counts as none, failing closed).
const hasPendingDeletion = (projectId: string | undefined, documentId: string) => {
  const uid = currentUid();
  if (!uid || !projectId) return false;
  try {
    return getPendingNativeProjectDocumentDeletes(uid, projectId).includes(documentId);
  } catch {
    return false;
  }
};

// Native documents must be read through the authenticated API: the shared Firestore metadata is tokenless.
async function readNative(projectId: string, uid: string, isCurrent: () => boolean) {
  const documents = await getNativeProjectDocuments(projectId, uid, isCurrent);
  assertSame(uid, isCurrent);
  return documents;
}

const toLegacyDocuments = (snapshot: { docs: any[] }) => snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data(),
  uploadedAt: doc.data().uploadedAt?.toDate() || new Date()
})) as ProjectDocument[];

// The server reports the upload time as an ISO string (null when unreadable); the UI expects a Date.
function toScopedDocument(document: NativeProjectDocument): ProjectDocument {
  const { uploadedAt, ...rest } = document;
  let date: Date;
  if (uploadedAt === null || uploadedAt === undefined) date = new Date(0);
  else if (typeof uploadedAt === 'string' && Number.isFinite(Date.parse(uploadedAt))) date = new Date(uploadedAt);
  else throw integrity();
  return { ...rest, uploadedAt: date } as unknown as ProjectDocument;
}

// One authorized scan of every page. Returns undefined when the project or BOM revision moved
// between pages: visibility is decided per revision, so mixed pages would not be coherent.
async function scanScopedDocuments(projectId: string, uid: string, assertContext: () => void): Promise<ProjectDocument[] | undefined> {
  const documents: ProjectDocument[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let revision: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    assertContext();
    const result = await nativeProjectReads.documents(projectId, cursor ? { limit: PAGE_LIMIT, cursor } : { limit: PAGE_LIMIT }, uid, assertContext);
    assertContext();
    const stamp = `${result.project_version}|${result.bom_version}`;
    if (revision === undefined) revision = stamp;
    else if (stamp !== revision) return undefined;
    for (const row of result.documents) {
      if (ids.has(row.id)) throw integrity();
      ids.add(row.id);
      documents.push(toScopedDocument(row));
    }
    // An empty filtered page can still carry a next cursor; only a null cursor ends the scan.
    if (result.next_cursor === null) return documents;
    if (cursors.has(result.next_cursor)) throw integrity();
    cursors.add(result.next_cursor);
    cursor = result.next_cursor;
  }
  throw integrity();
}

// Strict authorized read: never falls back to the SDK or the older native document API after a
// denied, malformed or failed read.
async function readScopedDocuments(projectId: string, options?: ProjectDocumentRequestOptions): Promise<ProjectDocument[]> {
  const uid = currentUid(), isCurrent = currentOf(options);
  const assertContext = () => assertSame(uid, isCurrent);
  assertContext();
  if (!uid) throw signInRequired();
  for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
    const documents = await scanScopedDocuments(projectId, uid, assertContext);
    if (documents) {
      assertContext();
      return documents;
    }
  }
  throw readError('request_failed', 'Project documents changed while loading. Refresh and try again.');
}

/**
 * Upload a project document to Firebase Storage and create Firestore record
 */
export async function uploadProjectDocument(
  file: File,
  projectId: string,
  documentType: DocumentType,
  userId: string,
  options?: ProjectDocumentRequestOptions
): Promise<ProjectDocument> {
  // A saved native request for this type keeps using the native path even when the flag is off.
  if (nativeProjectDocumentsEnabled() || getPendingNativeProjectDocumentTypes(userId, projectId).includes(documentType)) {
    // The caller refreshes, then acknowledges explicitly.
    return createNativeProjectDocumentUploadAttempt({
      projectId, documentType, expectedActorUid: userId, file, isCurrent: currentOf(options),
    }).run();
  }

  // No paired versioned writer covers this legacy path: scoped reads must never take it.
  if (isScopedProjectReadEnabled()) throw scopedWriteUnavailable();

  // Create storage path
  const timestamp = Date.now();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `projects/${projectId}/documents/${documentType}/${timestamp}_${sanitizedFileName}`;

  // Upload file to Storage
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);

  // Create Firestore document
  const docData = {
    projectId,
    name: file.name,
    url: fileUrl,
    type: documentType,
    uploadedAt: Timestamp.now(),
    uploadedBy: userId,
    linkedBOMItems: [],
    fileSize: file.size
  };

  const docRef = await addDoc(collection(db, 'projectDocuments'), docData);

  return {
    id: docRef.id,
    ...docData,
    uploadedAt: new Date()
  };
}

/**
 * Get all documents for a project
 */
export async function getProjectDocuments(
  projectId: string,
  options?: ProjectDocumentRequestOptions
): Promise<ProjectDocument[]> {
  if (isScopedProjectReadEnabled()) return readScopedDocuments(projectId, options);
  const uid = currentUid(), isCurrent = currentOf(options);
  if (nativeProjectDocumentsEnabled() || (uid && hasPendingReadWork(uid, projectId))) return readNative(projectId, uid, isCurrent);

  const q = query(
    collection(db, 'projectDocuments'),
    where('projectId', '==', projectId)
  );

  const snapshot = await getDocs(q);
  assertSame(uid, isCurrent);
  const documents = toLegacyDocuments(snapshot);
  // Tokenless public metadata must never become a broken link.
  if (uid && documents.some(d => d.pulseNativeDocument)) return readNative(projectId, uid, isCurrent);
  return documents;
}

/**
 * Get documents by type for a project
 */
export async function getProjectDocumentsByType(
  projectId: string,
  documentType: DocumentType,
  options?: ProjectDocumentRequestOptions
): Promise<ProjectDocument[]> {
  if (isScopedProjectReadEnabled()) return (await readScopedDocuments(projectId, options)).filter(d => d.type === documentType);
  const uid = currentUid(), isCurrent = currentOf(options);
  if (nativeProjectDocumentsEnabled() || (uid && hasPendingReadWork(uid, projectId))) {
    return (await readNative(projectId, uid, isCurrent)).filter(d => d.type === documentType);
  }

  const q = query(
    collection(db, 'projectDocuments'),
    where('projectId', '==', projectId),
    where('type', '==', documentType)
  );

  const snapshot = await getDocs(q);
  assertSame(uid, isCurrent);
  const documents = toLegacyDocuments(snapshot);
  if (uid && documents.some(d => d.pulseNativeDocument)) {
    return (await readNative(projectId, uid, isCurrent)).filter(d => d.type === documentType);
  }
  return documents;
}

/**
 * Link a document to BOM items
 */
export async function linkDocumentToBOMItems(
  documentId: string,
  bomItemIds: string[]
): Promise<void> {
  // Native linking is one atomic command in the parent screen; never bypass it through the SDK.
  if (nativeProjectDocumentsEnabled() || isSafeMaterialEditsEnabled() || isNativeMaterialCommandEnabled() || isScopedProjectReadEnabled()) throw new Error('Document links are saved with the BOM item in native mode.');
  const docRef = doc(db, 'projectDocuments', documentId);
  await updateDoc(docRef, {
    linkedBOMItems: bomItemIds
  });
}

/**
 * Delete a project document
 */
export async function deleteProjectDocument(
  documentId: string,
  fileUrl: string,
  original?: ProjectDocument,
  options?: ProjectDocumentRequestOptions
): Promise<void> {
  const scoped = isScopedProjectReadEnabled();
  // Rows read through scoped reads all carry an opening, so under scoped reads the opening alone no
  // longer proves a native document: only a saved deletion for this exact document does.
  const nativeByOpening = !!original?.nativeOpening && (!scoped || hasPendingDeletion(original.projectId, documentId));
  if (nativeProjectDocumentsEnabled() || nativeByOpening || original?.pulseNativeDocument || nativeFinalized.test(fileUrl)) {
    // Exact displayed opening only: never re-read or rebase before deleting.
    if (!original?.projectId || !original.nativeOpening) throw new Error('Reload the documents before deleting this document.');
    await createNativeProjectDocumentDeleteAttempt({
      projectId: original.projectId, documentId, expectedActorUid: currentUid(), opening: original.nativeOpening, isCurrent: currentOf(options),
    }).run();
    return;
  }

  // No paired versioned writer covers this legacy path: scoped reads must never take it.
  if (scoped) throw scopedWriteUnavailable();

  // Delete from Storage first
  try {
    // Extract storage path from the download URL
    // URL format: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?token=...
    // The path is URL-encoded between /o/ and ?
    const match = fileUrl.match(/\/o\/(.+?)\?/);
    if (match && match[1]) {
      const storagePath = decodeURIComponent(match[1]);
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
    }
  } catch (error) {
    console.error('Error deleting file from storage:', error);
    // Continue to delete Firestore record even if storage deletion fails
  }

  // Delete from Firestore
  await deleteDoc(doc(db, 'projectDocuments', documentId));
}

/**
 * Get documents linked to a specific BOM item
 */
export async function getDocumentsForBOMItem(
  projectId: string,
  bomItemId: string,
  options?: ProjectDocumentRequestOptions
): Promise<ProjectDocument[]> {
  const allDocs = await getProjectDocuments(projectId, options);
  return allDocs.filter(doc =>
    doc.linkedBOMItems && doc.linkedBOMItems.includes(bomItemId)
  );
}

/**
 * Invoice shown for a received item in the photo gallery. Scoped reads use the server's reverse
 * lookup through the item's linkedInvoiceDocumentId, so an invoice whose own link array is empty
 * is still returned. An unavailable invoice resolves to undefined; denial and failures reject.
 */
export async function getReceivedPhotoInvoice(
  projectId: string,
  itemId: string,
  options?: ReceivedPhotoInvoiceOptions
): Promise<ProjectDocument | undefined> {
  if (!isScopedProjectReadEnabled()) {
    if (!options?.invoiceDocumentId) return undefined;
    return (await getProjectDocuments(projectId, options)).find(d => d.id === options.invoiceDocumentId);
  }
  const uid = currentUid(), isCurrent = currentOf(options);
  const assertContext = () => assertSame(uid, isCurrent);
  assertContext();
  if (!uid) throw signInRequired();
  try {
    const result = await nativeProjectReads.galleryInvoice(projectId, itemId, uid, assertContext);
    assertContext();
    return toScopedDocument(result.document);
  } catch (error) {
    assertContext();
    if ((error as { code?: string } | null)?.code === 'not_found') return undefined;
    throw error;
  }
}

const requireSavedUpload = (projectId: string, type: DocumentType, uid: string) => {
  if (!getPendingNativeProjectDocumentTypes(uid, projectId).includes(type)) throw savedStateRequired();
};
const requireSavedDeletion = (projectId: string, documentId: string, uid: string) => {
  if (!getPendingNativeProjectDocumentDeletes(uid, projectId).includes(documentId)) throw savedStateRequired();
};
const uploadAttempt = (projectId: string, type: DocumentType, uid: string, options?: ProjectDocumentRequestOptions, file?: File) =>
  createNativeProjectDocumentUploadAttempt({ projectId, documentType: type, expectedActorUid: uid, file, isCurrent: currentOf(options) });
const deleteAttempt = (projectId: string, documentId: string, uid: string, options?: ProjectDocumentRequestOptions) =>
  createNativeProjectDocumentDeleteAttempt({ projectId, documentId, expectedActorUid: uid, opening: undefined, isCurrent: currentOf(options) });

// Recovery runs the same saved request (same ids); it never creates a new one and never acknowledges.
export async function recoverProjectDocumentUpload(
  projectId: string, type: DocumentType, uid: string, file?: File, options?: ProjectDocumentRequestOptions
): Promise<ProjectDocument> {
  requireSavedUpload(projectId, type, uid);
  return uploadAttempt(projectId, type, uid, options, file).run();
}

export async function cancelProjectDocumentUpload(
  projectId: string, type: DocumentType, uid: string, options?: ProjectDocumentRequestOptions
): Promise<{ resolution: 'cancelled' | 'committed'; document?: ProjectDocument }> {
  requireSavedUpload(projectId, type, uid);
  return uploadAttempt(projectId, type, uid, options).cancel();
}

export async function acknowledgeProjectDocumentUpload(
  projectId: string, type: DocumentType, uid: string, options?: ProjectDocumentRequestOptions
): Promise<void> {
  requireSavedUpload(projectId, type, uid);
  await uploadAttempt(projectId, type, uid, options).acknowledge();
}

export async function recoverProjectDocumentDeletion(
  projectId: string, documentId: string, uid: string, resolve: boolean, options?: ProjectDocumentRequestOptions
): Promise<'committed' | 'cancelled'> {
  requireSavedDeletion(projectId, documentId, uid);
  const attempt = deleteAttempt(projectId, documentId, uid, options);
  return resolve ? attempt.resolve() : attempt.run();
}

export async function acknowledgeProjectDocumentDeletion(
  projectId: string, documentId: string, uid: string, options?: ProjectDocumentRequestOptions
): Promise<void> {
  requireSavedDeletion(projectId, documentId, uid);
  await deleteAttempt(projectId, documentId, uid, options).acknowledge();
}
