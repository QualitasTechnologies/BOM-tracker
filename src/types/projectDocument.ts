export type DocumentType = 'vendor-quote' | 'outgoing-po' | 'customer-po';

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
    type: 'outgoing-po',
    label: 'POs (Outgoing)',
    description: 'Purchase orders sent to vendors'
  },
  {
    type: 'customer-po',
    label: 'Customer PO',
    description: 'Purchase orders received from customer'
  }
];
