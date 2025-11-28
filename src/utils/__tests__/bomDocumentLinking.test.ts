import { describe, it, expect, vi } from 'vitest';
import {
  syncPODocumentLinks,
  filterDocumentsByType,
  getOutgoingPODocuments,
  findLinkedDocument,
  findLinkedPODocument,
} from '@/utils/bomDocumentLinking';
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

/**
 * CRITICAL: These tests ensure we filter documents by 'type' field, NOT 'category'.
 * This has regressed multiple times. DO NOT change the field name without updating tests.
 */
describe('filterDocumentsByType', () => {
  it('filters documents by type field (NOT category)', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po', name: 'PO 001' }),
      buildDoc({ id: 'quote-1', type: 'vendor-quote', name: 'Quote 001' }),
      buildDoc({ id: 'po-2', type: 'outgoing-po', name: 'PO 002' }),
      buildDoc({ id: 'customer-1', type: 'customer-po', name: 'Customer PO' }),
    ];

    const result = filterDocumentsByType(documents, 'outgoing-po');

    expect(result).toHaveLength(2);
    expect(result.map((d) => d.id)).toEqual(['po-1', 'po-2']);
  });

  it('returns empty array when no documents match type', () => {
    const documents = [
      buildDoc({ id: 'quote-1', type: 'vendor-quote' }),
      buildDoc({ id: 'quote-2', type: 'vendor-quote' }),
    ];

    const result = filterDocumentsByType(documents, 'outgoing-po');

    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty documents array', () => {
    const result = filterDocumentsByType([], 'outgoing-po');

    expect(result).toHaveLength(0);
  });

  it('filters vendor-quote documents correctly', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po' }),
      buildDoc({ id: 'quote-1', type: 'vendor-quote' }),
    ];

    const result = filterDocumentsByType(documents, 'vendor-quote');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('quote-1');
  });

  it('filters customer-po documents correctly', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po' }),
      buildDoc({ id: 'customer-1', type: 'customer-po' }),
    ];

    const result = filterDocumentsByType(documents, 'customer-po');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('customer-1');
  });
});

describe('getOutgoingPODocuments', () => {
  it('returns only outgoing-po documents', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po' }),
      buildDoc({ id: 'quote-1', type: 'vendor-quote' }),
      buildDoc({ id: 'po-2', type: 'outgoing-po' }),
    ];

    const result = getOutgoingPODocuments(documents);

    expect(result).toHaveLength(2);
    expect(result.every((d) => d.type === 'outgoing-po')).toBe(true);
  });
});

describe('findLinkedDocument', () => {
  it('finds document linked to a BOM item', () => {
    const documents = [
      buildDoc({ id: 'doc-1', linkedBOMItems: ['item-a', 'item-b'] }),
      buildDoc({ id: 'doc-2', linkedBOMItems: ['item-c'] }),
    ];

    const result = findLinkedDocument(documents, 'item-b');

    expect(result).toBeDefined();
    expect(result?.id).toBe('doc-1');
  });

  it('returns undefined when item is not linked to any document', () => {
    const documents = [
      buildDoc({ id: 'doc-1', linkedBOMItems: ['item-a'] }),
    ];

    const result = findLinkedDocument(documents, 'item-z');

    expect(result).toBeUndefined();
  });

  it('handles documents with undefined linkedBOMItems', () => {
    const documents = [
      buildDoc({ id: 'doc-1', linkedBOMItems: undefined }),
      buildDoc({ id: 'doc-2', linkedBOMItems: ['item-a'] }),
    ];

    const result = findLinkedDocument(documents, 'item-a');

    expect(result?.id).toBe('doc-2');
  });
});

describe('findLinkedPODocument', () => {
  it('finds PO document by direct linkedPODocumentId', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] }),
      buildDoc({ id: 'po-2', type: 'outgoing-po', linkedBOMItems: [] }),
    ];

    const result = findLinkedPODocument(documents, 'item-1', 'po-2');

    expect(result?.id).toBe('po-2');
  });

  it('finds PO document via linkedBOMItems when no direct link', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] }),
      buildDoc({ id: 'po-2', type: 'outgoing-po', linkedBOMItems: [] }),
    ];

    const result = findLinkedPODocument(documents, 'item-1');

    expect(result?.id).toBe('po-1');
  });

  it('ignores non-PO documents when searching', () => {
    const documents = [
      buildDoc({ id: 'quote-1', type: 'vendor-quote', linkedBOMItems: ['item-1'] }),
      buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] }),
    ];

    const result = findLinkedPODocument(documents, 'item-1');

    // Should NOT find quote-1 even though it has item-1 linked
    expect(result).toBeUndefined();
  });

  it('prioritizes direct link over linkedBOMItems', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] }),
      buildDoc({ id: 'po-2', type: 'outgoing-po', linkedBOMItems: [] }),
    ];

    // Direct link points to po-2, but po-1 has item-1 in linkedBOMItems
    const result = findLinkedPODocument(documents, 'item-1', 'po-2');

    expect(result?.id).toBe('po-2'); // Direct link wins
  });

  it('falls back to linkedBOMItems when direct link document not found', () => {
    const documents = [
      buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] }),
    ];

    // Direct link points to non-existent document
    const result = findLinkedPODocument(documents, 'item-1', 'deleted-po');

    expect(result?.id).toBe('po-1'); // Falls back to linkedBOMItems
  });
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

