import { db, storage } from '@/firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { QuotationDocument, QuotationStatus, quotationDocumentConverter } from '@/types/quotation';

/**
 * Upload a quotation PDF file to Firebase Storage and create Firestore document
 */
export async function uploadQuotation(
  file: File,
  projectId: string,
  bomItemId: string,
  userId: string
): Promise<QuotationDocument> {
  try {
    // Create unique filename with timestamp
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `quotations/${projectId}/${bomItemId}/${timestamp}_${sanitizedFileName}`;

    // Upload to Firebase Storage
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);

    // Create Firestore document
    const quotationData: Omit<QuotationDocument, 'id'> = {
      bomItemId,
      projectId,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      uploadedAt: new Date(),
      uploadedBy: userId,
      status: 'uploaded',
    };

    const quotationsRef = collection(db, 'quotations');
    const docRef = await addDoc(quotationsRef, {
      ...quotationData,
      uploadedAt: Timestamp.fromDate(quotationData.uploadedAt),
    });

    return {
      id: docRef.id,
      ...quotationData,
    };
  } catch (error) {
    console.error('Error uploading quotation:', error);
    throw new Error('Failed to upload quotation');
  }
}

/**
 * Get all quotations for a specific BOM item
 */
export async function getQuotationsForItem(bomItemId: string): Promise<QuotationDocument[]> {
  try {
    const quotationsRef = collection(db, 'quotations').withConverter(quotationDocumentConverter);
    const q = query(
      quotationsRef,
      where('bomItemId', '==', bomItemId),
      orderBy('uploadedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data());
  } catch (error) {
    console.error('Error getting quotations:', error);
    return [];
  }
}

/**
 * Update quotation status
 */
export async function updateQuotationStatus(
  quotationId: string,
  status: QuotationStatus,
  errorMessage?: string
): Promise<void> {
  try {
    const quotationRef = doc(db, 'quotations', quotationId);
    await updateDoc(quotationRef, {
      status,
      ...(errorMessage && { errorMessage }),
    });
  } catch (error) {
    console.error('Error updating quotation status:', error);
    throw new Error('Failed to update quotation status');
  }
}

/**
 * Update quotation with extracted text
 */
export async function updateQuotationText(
  quotationId: string,
  extractedText: string
): Promise<void> {
  try {
    const quotationRef = doc(db, 'quotations', quotationId);
    await updateDoc(quotationRef, {
      extractedText,
      textExtractedAt: Timestamp.now(),
      status: 'text_extracted',
    });
  } catch (error) {
    console.error('Error updating quotation text:', error);
    throw new Error('Failed to update quotation text');
  }
}

/**
 * Delete a quotation document and its file from storage
 */
export async function deleteQuotation(quotationId: string, fileUrl: string): Promise<void> {
  try {
    // Delete from Storage
    const storageRef = ref(storage, fileUrl);
    await deleteObject(storageRef);

    // Delete from Firestore
    const quotationRef = doc(db, 'quotations', quotationId);
    await deleteDoc(quotationRef);
  } catch (error) {
    console.error('Error deleting quotation:', error);
    throw new Error('Failed to delete quotation');
  }
}
