import { ProjectDocument } from '@/types/projectDocument';

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

