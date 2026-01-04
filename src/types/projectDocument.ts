export type DocumentType = 'vendor-quote' | 'vendor-po' | 'customer-po' | 'vendor-invoice' | 'spec-sheet';

export interface ProjectDocument {
  id: string;
  projectId: string;
  name: string;
  url: string;
  type: DocumentType;
  uploadedAt: Date;
  uploadedBy: string;
  linkedBOMItems?: string[]; // Array of BOM item IDs
  fileSize?: number;
  sourceUrl?: string; // For spec-sheets: original URL where document was found on the web
}

export interface DocumentTypeSection {
  type: DocumentType;
  label: string;
  description: string;
}

export const DOCUMENT_SECTIONS: DocumentTypeSection[] = [
  {
    type: 'vendor-quote',
    label: 'Vendor Quotes',
    description: 'Quotation PDFs and documents from vendors'
  },
  {
    type: 'vendor-po',
    label: 'Legacy Vendor POs',
    description: 'Manually uploaded PO documents (pre-system)'
  },
  {
    type: 'customer-po',
    label: 'Customer PO',
    description: 'Purchase order received from customer'
  },
  {
    type: 'vendor-invoice',
    label: 'Vendor Invoices',
    description: 'Invoices received from vendors upon delivery'
  },
  {
    type: 'spec-sheet',
    label: 'Spec Sheets',
    description: 'Product datasheets and technical specifications'
  }
];

// Document sections for BOM page (excludes customer-po which is admin-only)
export const BOM_DOCUMENT_SECTIONS: DocumentTypeSection[] = DOCUMENT_SECTIONS.filter(
  section => section.type !== 'customer-po'
);

// Document sections for Cost Analysis page (admin-only)
export const COST_DOCUMENT_SECTIONS: DocumentTypeSection[] = DOCUMENT_SECTIONS.filter(
  section => section.type === 'customer-po'
);
