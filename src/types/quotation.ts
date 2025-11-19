// Quotation Document Types

export type QuotationStatus = 'uploaded' | 'text_extracted' | 'parsed' | 'matched' | 'error';

export interface QuotationDocument {
  id: string;
  bomItemId: string;
  projectId: string;
  fileName: string;
  fileUrl: string; // Firebase Storage URL
  fileSize: number;
  uploadedAt: Date;
  uploadedBy: string; // User ID

  // Phase 1: Raw text storage
  extractedText?: string;
  textExtractedAt?: Date;

  // Phase 2: Structured data (will add later)
  parsedData?: QuotationData;
  parsedAt?: Date;

  // Phase 3: Vendor matching (will add later)
  matchedVendorId?: string;
  matchConfidence?: number;

  status: QuotationStatus;
  errorMessage?: string;
}

// Phase 2: Structured quotation data (placeholder for future implementation)
export interface QuotationData {
  vendor?: {
    name: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
  };
  quotationDetails?: {
    quoteNumber?: string;
    date?: string;
    validUntil?: string;
    paymentTerms?: string;
    deliveryTerms?: string;
  };
  lineItems?: Array<{
    partName: string;
    partNumber?: string;
    make?: string;
    quantity: number;
    unitPrice: number;
    totalPrice?: number;
    leadTime?: string;
    availability?: string;
    specifications?: Record<string, string>;
  }>;
  pricing?: {
    subtotal?: number;
    taxRate?: number;
    taxAmount?: number;
    shippingCost?: number;
    grandTotal?: number;
  };
}

// Firestore converter for QuotationDocument
export const quotationDocumentConverter = {
  toFirestore: (doc: QuotationDocument) => {
    return {
      ...doc,
      uploadedAt: doc.uploadedAt,
      textExtractedAt: doc.textExtractedAt || null,
      parsedAt: doc.parsedAt || null,
    };
  },
  fromFirestore: (snapshot: any, options: any) => {
    const data = snapshot.data(options);
    return {
      ...data,
      id: snapshot.id,
      uploadedAt: data.uploadedAt?.toDate() || new Date(),
      textExtractedAt: data.textExtractedAt?.toDate() || undefined,
      parsedAt: data.parsedAt?.toDate() || undefined,
    } as QuotationDocument;
  },
};
