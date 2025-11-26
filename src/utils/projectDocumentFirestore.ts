import { collection, addDoc, query, where, getDocs, deleteDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/firebase';
import { ProjectDocument, DocumentType } from '@/types/projectDocument';

/**
 * Upload a project document to Firebase Storage and create Firestore record
 */
export async function uploadProjectDocument(
  file: File,
  projectId: string,
  documentType: DocumentType,
  userId: string
): Promise<ProjectDocument> {
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
export async function getProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  const q = query(
    collection(db, 'projectDocuments'),
    where('projectId', '==', projectId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    uploadedAt: doc.data().uploadedAt?.toDate() || new Date()
  })) as ProjectDocument[];
}

/**
 * Get documents by type for a project
 */
export async function getProjectDocumentsByType(
  projectId: string,
  documentType: DocumentType
): Promise<ProjectDocument[]> {
  const q = query(
    collection(db, 'projectDocuments'),
    where('projectId', '==', projectId),
    where('type', '==', documentType)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    uploadedAt: doc.data().uploadedAt?.toDate() || new Date()
  })) as ProjectDocument[];
}

/**
 * Link a document to BOM items
 */
export async function linkDocumentToBOMItems(
  documentId: string,
  bomItemIds: string[]
): Promise<void> {
  const docRef = doc(db, 'projectDocuments', documentId);
  await updateDoc(docRef, {
    linkedBOMItems: bomItemIds
  });
}

/**
 * Delete a project document
 */
export async function deleteProjectDocument(documentId: string, fileUrl: string): Promise<void> {
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
  bomItemId: string
): Promise<ProjectDocument[]> {
  const allDocs = await getProjectDocuments(projectId);
  return allDocs.filter(doc =>
    doc.linkedBOMItems && doc.linkedBOMItems.includes(bomItemId)
  );
}
