import { describe, it, expect, vi } from 'vitest';
import { syncPODocumentLinks } from '@/utils/bomDocumentLinking';
import { ProjectDocument } from '@/types/projectDocument';

const buildDoc = (overrides: Partial<ProjectDocument>): ProjectDocument => ({
  id: overrides.id ?? 'doc-1',
  projectId: overrides.projectId ?? 'project-1',
  name: overrides.name ?? 'Test Doc',
  url: overrides.url ?? 'https://example.com/doc.pdf',
  type: overrides.type ?? 'outgoing-po',
  uploadedAt: overrides.uploadedAt ?? new Date(),
  uploadedBy: overrides.uploadedBy ?? 'user-1',
  linkedBOMItems: overrides.linkedBOMItems ?? [],
  fileSize: overrides.fileSize,
});

describe('syncPODocumentLinks', () => {
  it('adds the BOM item to the new document and persists the link', async () => {
    const documents = [buildDoc({ id: 'doc-1', linkedBOMItems: ['item-2'] })];
    const linkDocument = vi.fn().mockResolvedValue(undefined);

    const updated = await syncPODocumentLinks({
      itemId: 'item-1',
      newDocumentId: 'doc-1',
      documents,
      linkDocument,
    });

    expect(linkDocument).toHaveBeenCalledTimes(1);
    expect(linkDocument).toHaveBeenCalledWith('doc-1', ['item-2', 'item-1']);
    expect(updated[0].linkedBOMItems).toEqual(['item-2', 'item-1']);
  });

  it('moves the BOM item off the previous document when the PO changes', async () => {
    const documents = [
      buildDoc({ id: 'doc-old', linkedBOMItems: ['item-1', 'item-3'] }),
      buildDoc({ id: 'doc-new', linkedBOMItems: [] }),
    ];
    const linkDocument = vi.fn().mockResolvedValue(undefined);

    const updated = await syncPODocumentLinks({
      itemId: 'item-1',
      newDocumentId: 'doc-new',
      previousDocumentId: 'doc-old',
      documents,
      linkDocument,
    });

    expect(linkDocument).toHaveBeenCalledTimes(2);
    expect(linkDocument).toHaveBeenNthCalledWith(1, 'doc-new', ['item-1']);
    expect(linkDocument).toHaveBeenNthCalledWith(2, 'doc-old', ['item-3']);

    const oldDoc = updated.find((doc) => doc.id === 'doc-old');
    const newDoc = updated.find((doc) => doc.id === 'doc-new');
    expect(oldDoc?.linkedBOMItems).toEqual(['item-3']);
    expect(newDoc?.linkedBOMItems).toEqual(['item-1']);
  });
});

