import { describe, it, expect, vi } from 'vitest';
import {
  syncPODocumentLinks,
  filterDocumentsByType,
  getOutgoingPODocuments,
  findLinkedDocument,
  findLinkedPODocument,
  isItemLinkedToDocument,
  validateDocumentDeletion,
} from '@/utils/bomDocumentLinking';
import { ProjectDocument } from '@/types/projectDocument';
import { BOMItem } from '@/types/bom';

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

const buildItem = (overrides: Partial<BOMItem>): BOMItem => ({
  id: overrides.id ?? 'item-1',
  itemType: overrides.itemType ?? 'component',
  name: overrides.name ?? 'Test Item',
  description: overrides.description ?? 'Test description',
  quantity: overrides.quantity ?? 1,
  category: overrides.category ?? 'Electronics',
  vendors: overrides.vendors ?? [],
  status: overrides.status ?? 'not-ordered',
  linkedPODocumentId: overrides.linkedPODocumentId,
  linkedInvoiceDocumentId: overrides.linkedInvoiceDocumentId,
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

/**
 * CRITICAL: These tests validate document deletion business rules.
 * - PO documents cannot be deleted if linked to items with status 'ordered'
 * - Invoice documents cannot be deleted if linked to items with status 'received'
 * - Quote and customer-po documents can always be deleted
 */
describe('isItemLinkedToDocument', () => {
  it('returns true when document.linkedBOMItems contains the item ID', () => {
    const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1', 'item-2'] });
    const item = buildItem({ id: 'item-1' });

    expect(isItemLinkedToDocument(item, doc)).toBe(true);
  });

  it('returns true when item.linkedPODocumentId matches PO document ID', () => {
    const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] });
    const item = buildItem({ id: 'item-1', linkedPODocumentId: 'po-1' });

    expect(isItemLinkedToDocument(item, doc)).toBe(true);
  });

  it('returns true when item.linkedInvoiceDocumentId matches invoice document ID', () => {
    const doc = buildDoc({ id: 'inv-1', type: 'vendor-invoice', linkedBOMItems: [] });
    const item = buildItem({ id: 'item-1', linkedInvoiceDocumentId: 'inv-1' });

    expect(isItemLinkedToDocument(item, doc)).toBe(true);
  });

  it('returns false when no linkage exists', () => {
    const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['other-item'] });
    const item = buildItem({ id: 'item-1', linkedPODocumentId: 'other-po' });

    expect(isItemLinkedToDocument(item, doc)).toBe(false);
  });

  it('returns false when linkedBOMItems is undefined', () => {
    const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: undefined });
    const item = buildItem({ id: 'item-1' });

    expect(isItemLinkedToDocument(item, doc)).toBe(false);
  });

  it('ignores linkedPODocumentId for non-PO documents', () => {
    // Item has linkedPODocumentId pointing to a quote (wrong type)
    const doc = buildDoc({ id: 'quote-1', type: 'vendor-quote', linkedBOMItems: [] });
    const item = buildItem({ id: 'item-1', linkedPODocumentId: 'quote-1' });

    // Should NOT match because vendor-quote doesn't use linkedPODocumentId
    expect(isItemLinkedToDocument(item, doc)).toBe(false);
  });

  it('ignores linkedInvoiceDocumentId for non-invoice documents', () => {
    const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] });
    const item = buildItem({ id: 'item-1', linkedInvoiceDocumentId: 'po-1' });

    // Should NOT match because outgoing-po doesn't use linkedInvoiceDocumentId
    expect(isItemLinkedToDocument(item, doc)).toBe(false);
  });
});

describe('validateDocumentDeletion', () => {
  describe('outgoing-po documents', () => {
    it('blocks deletion when linked item has status "ordered"', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', name: 'Resistor 10k', status: 'ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(1);
      expect(result.blockedByItems[0].id).toBe('item-1');
      expect(result.reason).toContain('Resistor 10k');
    });

    it('blocks deletion when item links back via linkedPODocumentId', () => {
      // Document has no linkedBOMItems, but item points to document
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] });
      const items = [buildItem({ id: 'item-1', name: 'Capacitor', status: 'ordered', linkedPODocumentId: 'po-1' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(1);
    });

    it('allows deletion when linked item has status "not-ordered"', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', status: 'not-ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
      expect(result.blockedByItems).toHaveLength(0);
    });

    it('allows deletion when linked item has status "received"', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', status: 'received' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
      expect(result.blockedByItems).toHaveLength(0);
    });

    it('allows deletion when no items are linked', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: [] });
      const items = [buildItem({ id: 'item-1', status: 'ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
    });

    it('blocks only for items that are both linked AND ordered', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1', 'item-2'] });
      const items = [
        buildItem({ id: 'item-1', name: 'Blocked Item', status: 'ordered' }),
        buildItem({ id: 'item-2', name: 'Allowed Item', status: 'received' }),
        buildItem({ id: 'item-3', name: 'Unlinked Ordered', status: 'ordered' }), // Not linked
      ];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(1);
      expect(result.blockedByItems[0].name).toBe('Blocked Item');
    });
  });

  describe('vendor-invoice documents', () => {
    it('blocks deletion when linked item has status "received"', () => {
      const doc = buildDoc({ id: 'inv-1', type: 'vendor-invoice', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', name: 'Inductor', status: 'received' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(1);
      expect(result.reason).toContain('Inductor');
    });

    it('blocks deletion when item links back via linkedInvoiceDocumentId', () => {
      const doc = buildDoc({ id: 'inv-1', type: 'vendor-invoice', linkedBOMItems: [] });
      const items = [buildItem({ id: 'item-1', status: 'received', linkedInvoiceDocumentId: 'inv-1' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(1);
    });

    it('allows deletion when linked item has status "ordered"', () => {
      const doc = buildDoc({ id: 'inv-1', type: 'vendor-invoice', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', status: 'ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
    });

    it('allows deletion when linked item has status "not-ordered"', () => {
      const doc = buildDoc({ id: 'inv-1', type: 'vendor-invoice', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', status: 'not-ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
    });
  });

  describe('vendor-quote documents', () => {
    it('can always be deleted regardless of linked items status', () => {
      const doc = buildDoc({ id: 'quote-1', type: 'vendor-quote', linkedBOMItems: ['item-1', 'item-2'] });
      const items = [
        buildItem({ id: 'item-1', status: 'ordered' }),
        buildItem({ id: 'item-2', status: 'received' }),
      ];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
      expect(result.blockedByItems).toHaveLength(0);
    });
  });

  describe('customer-po documents', () => {
    it('can always be deleted regardless of linked items status', () => {
      const doc = buildDoc({ id: 'cpo-1', type: 'customer-po', linkedBOMItems: ['item-1'] });
      const items = [buildItem({ id: 'item-1', status: 'received' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
      expect(result.blockedByItems).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty bomItems array', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1'] });

      const result = validateDocumentDeletion(doc, []);

      expect(result.canDelete).toBe(true);
    });

    it('handles document with undefined linkedBOMItems', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: undefined });
      const items = [buildItem({ id: 'item-1', status: 'ordered' })];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(true);
    });

    it('reports multiple blocked items in reason', () => {
      const doc = buildDoc({ id: 'po-1', type: 'outgoing-po', linkedBOMItems: ['item-1', 'item-2'] });
      const items = [
        buildItem({ id: 'item-1', name: 'First Item', status: 'ordered' }),
        buildItem({ id: 'item-2', name: 'Second Item', status: 'ordered' }),
      ];

      const result = validateDocumentDeletion(doc, items);

      expect(result.canDelete).toBe(false);
      expect(result.blockedByItems).toHaveLength(2);
      expect(result.reason).toContain('First Item');
      expect(result.reason).toContain('Second Item');
    });
  });
});

