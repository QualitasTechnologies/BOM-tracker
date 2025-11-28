import { ProjectDocument, DocumentType } from '@/types/projectDocument';

/**
 * Filter documents by type (e.g., 'outgoing-po', 'vendor-quote', 'customer-po')
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
 * Get outgoing PO documents only
 * Convenience wrapper for the most common use case
 */
export function getOutgoingPODocuments(documents: ProjectDocument[]): ProjectDocument[] {
  return filterDocumentsByType(documents, 'outgoing-po');
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

