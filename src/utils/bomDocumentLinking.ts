import { ProjectDocument, DocumentType } from '@/types/projectDocument';
import { BOMItem } from '@/types/bom';

/**
 * Filter documents by type (e.g., 'vendor-po', 'vendor-quote', 'customer-po')
 * IMPORTANT: Use this function instead of inline filtering to ensure correct field is used.
 * The field is `type` NOT `category` - this has caused regressions before.
 */
export function filterDocumentsByType(
  documents: ProjectDocument[],
  documentType: DocumentType
): ProjectDocument[] {
  return documents.filter((doc) => doc.type === documentType);
}

/**
 * Get vendor PO documents only
 * Convenience wrapper for the most common use case
 */
export function getOutgoingPODocuments(documents: ProjectDocument[]): ProjectDocument[] {
  return filterDocumentsByType(documents, 'vendor-po');
}

/**
 * Find a document that is linked to a specific BOM item
 * Returns the first matching document or undefined
 */
export function findLinkedDocument(
  documents: ProjectDocument[],
  itemId: string
): ProjectDocument | undefined {
  return documents.find(
    (doc) => doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId)
  );
}

/**
 * Find a PO document linked to a BOM item, checking both:
 * 1. Direct linkedPODocumentId on the item
 * 2. linkedBOMItems array on documents
 */
export function findLinkedPODocument(
  documents: ProjectDocument[],
  itemId: string,
  linkedPODocumentId?: string
): ProjectDocument | undefined {
  const poDocuments = getOutgoingPODocuments(documents);

  // First check if there's a direct link
  if (linkedPODocumentId) {
    const directLink = poDocuments.find((doc) => doc.id === linkedPODocumentId);
    if (directLink) return directLink;
  }

  // Otherwise check linkedBOMItems on documents
  return findLinkedDocument(poDocuments, itemId);
}

interface SyncParams {
  itemId: string;
  newDocumentId: string;
  previousDocumentId?: string;
  documents: ProjectDocument[];
  linkDocument: (documentId: string, bomItemIds: string[]) => Promise<void>;
}

const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

/**
 * Ensure BOM item↔PO document references stay in sync when an item is marked as ordered.
 * Returns an updated copy of the documents array so callers can refresh local state.
 */
export async function syncPODocumentLinks({
  itemId,
  newDocumentId,
  previousDocumentId,
  documents,
  linkDocument,
}: SyncParams): Promise<ProjectDocument[]> {
  const currentDocs = [...documents];

  const newDoc = currentDocs.find((doc) => doc.id === newDocumentId);
  const newDocLinkedItems = unique([...(newDoc?.linkedBOMItems ?? []), itemId]);
  await linkDocument(newDocumentId, newDocLinkedItems);

  let updatedDocs = currentDocs.map((doc) =>
    doc.id === newDocumentId ? { ...doc, linkedBOMItems: newDocLinkedItems } : doc
  );

  if (previousDocumentId && previousDocumentId !== newDocumentId) {
    const previousDoc = currentDocs.find((doc) => doc.id === previousDocumentId);
    const filtered = (previousDoc?.linkedBOMItems ?? []).filter((linkedId) => linkedId !== itemId);
    await linkDocument(previousDocumentId, filtered);
    updatedDocs = updatedDocs.map((doc) =>
      doc.id === previousDocumentId ? { ...doc, linkedBOMItems: filtered } : doc
    );
  }

  return updatedDocs;
}

/**
 * Result of document deletion validation
 */
export interface DocumentDeletionValidation {
  canDelete: boolean;
  blockedByItems: BOMItem[];
  reason?: string;
}

/**
 * Check if a BOM item is linked to a document.
 * Linkage is bidirectional - checked from both sides:
 * 1. Document's linkedBOMItems array contains the item ID
 * 2. Item's linkedPODocumentId or linkedInvoiceDocumentId matches the document ID
 */
export function isItemLinkedToDocument(
  item: BOMItem,
  document: ProjectDocument
): boolean {
  // Check document -> item linkage
  if (document.linkedBOMItems?.includes(item.id)) {
    return true;
  }

  // Check item -> document linkage based on document type
  if (document.type === 'vendor-po' && item.linkedPODocumentId === document.id) {
    return true;
  }

  if (document.type === 'vendor-invoice' && item.linkedInvoiceDocumentId === document.id) {
    return true;
  }

  return false;
}

/**
 * Validate whether a document can be deleted based on its type and linked BOM items.
 *
 * Business rules:
 * - vendor-po: Cannot delete if linked to items with status 'ordered'
 * - vendor-invoice: Cannot delete if linked to items with status 'received'
 * - vendor-quote, customer-po: Can always be deleted (no status restrictions)
 */
export function validateDocumentDeletion(
  document: ProjectDocument,
  bomItems: BOMItem[]
): DocumentDeletionValidation {
  // vendor-quote and customer-po can always be deleted
  if (document.type === 'vendor-quote' || document.type === 'customer-po') {
    return { canDelete: true, blockedByItems: [] };
  }

  // For vendor-po: check for linked items with 'ordered' status
  if (document.type === 'vendor-po') {
    const blockedByItems = bomItems.filter(
      item => isItemLinkedToDocument(item, document) && item.status === 'ordered'
    );

    if (blockedByItems.length > 0) {
      return {
        canDelete: false,
        blockedByItems,
        reason: `This PO is linked to ordered items: ${blockedByItems.map(item => item.name).join(', ')}. Change item status to "Not Ordered" first before deleting this document.`
      };
    }

    return { canDelete: true, blockedByItems: [] };
  }

  // For vendor-invoice: check for linked items with 'received' status
  if (document.type === 'vendor-invoice') {
    const blockedByItems = bomItems.filter(
      item => isItemLinkedToDocument(item, document) && item.status === 'received'
    );

    if (blockedByItems.length > 0) {
      return {
        canDelete: false,
        blockedByItems,
        reason: `This invoice is linked to received items: ${blockedByItems.map(item => item.name).join(', ')}. Change item status first before deleting this document.`
      };
    }

    return { canDelete: true, blockedByItems: [] };
  }

  // Default: allow deletion for any unrecognized document types
  return { canDelete: true, blockedByItems: [] };
}

