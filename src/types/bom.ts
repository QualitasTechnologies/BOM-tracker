export type BOMStatus = 'not-ordered' | 'ordered' | 'received';
export type BOMItemType = 'component' | 'service';

export interface BOMItem {
  id: string;
  itemType: BOMItemType; // Distinguish between component and service
  name: string;
  make?: string;
  description: string;
  sku?: string;

  // For components: unit price (₹)
  // For services: rate per day (₹/day)
  price?: number;

  // For components: quantity of units
  // For services: duration in days (minimum 0.5)
  quantity: number;

  thumbnailUrl?: string; // Thumbnail image URL for the part
  category: string; // Category name (matches BOMCategory.name)
  order?: number; // For drag-and-drop ordering within categories

  // Vendor info (only applicable for components)
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  }>;
  status: BOMStatus;
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: {
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  };

  // Document linking fields (for components)
  linkedQuoteDocumentId?: string; // Reference to vendor-quote document
  linkedPODocumentId?: string; // Reference to outgoing-po document
  linkedInvoiceDocumentId?: string; // Reference to vendor-invoice document

  // Inward Tracking fields (for components)
  orderDate?: string; // ISO string - when PO was placed
  expectedArrival?: string; // ISO string - calculated from orderDate + leadTime
  actualArrival?: string; // ISO string - when item was actually received
  receivedPhotoUrl?: string; // Photo proof of receipt (box or items)

  // Specification sheet fields (for components)
  specificationUrl?: string; // Original source URL where spec sheet was found
  linkedSpecDocumentId?: string; // Reference to downloaded spec-sheet document

  createdAt?: Date;
  updatedAt?: Date;
}

// Helper type for inward tracking status
export type InwardStatus = 'not-ordered' | 'on-track' | 'arriving-soon' | 'overdue' | 'received';

// Helper function to calculate inward status
export function getInwardStatus(item: BOMItem): InwardStatus {
  if (item.status === 'not-ordered' || item.itemType === 'service') return 'not-ordered';
  if (item.status === 'received') return 'received';
  if (!item.expectedArrival) return 'on-track';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expected = new Date(item.expectedArrival);
  expected.setHours(0, 0, 0, 0);

  const daysUntilArrival = Math.ceil((expected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilArrival < 0) return 'overdue';
  if (daysUntilArrival <= 7) return 'arriving-soon';
  return 'on-track';
}

// Calculate expected arrival from order date and lead time
export function calculateExpectedArrival(orderDate: string, leadTimeDays: number): string {
  const date = new Date(orderDate);
  date.setDate(date.getDate() + leadTimeDays);
  return date.toISOString().split('T')[0];
}

// Parse lead time string (e.g., "14 days", "2-3 weeks") to number of days
export function parseLeadTimeToDays(leadTime: string): number {
  if (!leadTime) return 0;

  const lower = leadTime.toLowerCase().trim();

  // Match patterns like "14 days", "14days", "14 d"
  const daysMatch = lower.match(/(\d+)\s*(?:days?|d)/);
  if (daysMatch) return parseInt(daysMatch[1], 10);

  // Match patterns like "2 weeks", "2-3 weeks"
  const weeksMatch = lower.match(/(\d+)(?:\s*-\s*\d+)?\s*(?:weeks?|w)/);
  if (weeksMatch) return parseInt(weeksMatch[1], 10) * 7;

  // Match patterns like "1 month", "1-2 months"
  const monthsMatch = lower.match(/(\d+)(?:\s*-\s*\d+)?\s*(?:months?|m)/);
  if (monthsMatch) return parseInt(monthsMatch[1], 10) * 30;

  // Try to parse as plain number (assume days)
  const plainNumber = parseInt(lower, 10);
  if (!isNaN(plainNumber)) return plainNumber;

  return 0;
}

// UI display structure for BOM categories (grouping items)
export interface BOMCategory {
  name: string;
  items: BOMItem[];
  isExpanded: boolean;
}

// This is now just for UI state - actual categories are in settings
export interface BOMCategoryState {
  categoryId: string;
  isExpanded: boolean;
}

// Project BOM structure - items are stored separately from categories
export interface ProjectBOM {
  projectId: string;
  items: BOMItem[];
  categoryStates: BOMCategoryState[];
  updatedAt: Date;
}

// Vendor types
export type VendorType = 'OEM' | 'Dealer';

export interface Vendor {
  id: string;
  name: string;
  type: VendorType; // OEM or Dealer
  makes: string[]; // Array of makes this vendor deals with
  contactInfo?: {
    email?: string;
    phone?: string;
    website?: string;
  };
  address?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sanitizes a BOM item for Firestore storage by removing undefined values.
 * Firestore does not accept undefined values - they must be omitted from the object.
 * This function creates a clean object with only defined values.
 */
export function sanitizeBOMItemForFirestore(item: Partial<BOMItem>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  // Required fields - these should always be present
  if (item.id !== undefined) sanitized.id = item.id;
  if (item.itemType !== undefined) sanitized.itemType = item.itemType;
  if (item.name !== undefined) sanitized.name = item.name;
  if (item.description !== undefined) sanitized.description = item.description;
  if (item.quantity !== undefined) sanitized.quantity = item.quantity;
  if (item.category !== undefined) sanitized.category = item.category;
  if (item.status !== undefined) sanitized.status = item.status;
  if (item.vendors !== undefined) sanitized.vendors = item.vendors;

  // Optional fields - only include if they have a value
  if (item.make !== undefined) sanitized.make = item.make;
  if (item.sku !== undefined) sanitized.sku = item.sku;
  if (item.price !== undefined) sanitized.price = item.price;
  if (item.thumbnailUrl !== undefined) sanitized.thumbnailUrl = item.thumbnailUrl;
  if (item.order !== undefined) sanitized.order = item.order;
  if (item.expectedDelivery !== undefined) sanitized.expectedDelivery = item.expectedDelivery;
  if (item.poNumber !== undefined) sanitized.poNumber = item.poNumber;
  if (item.finalizedVendor !== undefined) sanitized.finalizedVendor = item.finalizedVendor;
  if (item.orderDate !== undefined) sanitized.orderDate = item.orderDate;
  if (item.expectedArrival !== undefined) sanitized.expectedArrival = item.expectedArrival;
  if (item.actualArrival !== undefined) sanitized.actualArrival = item.actualArrival;
  if (item.linkedQuoteDocumentId !== undefined) sanitized.linkedQuoteDocumentId = item.linkedQuoteDocumentId;
  if (item.linkedPODocumentId !== undefined) sanitized.linkedPODocumentId = item.linkedPODocumentId;
  if (item.linkedInvoiceDocumentId !== undefined) sanitized.linkedInvoiceDocumentId = item.linkedInvoiceDocumentId;
  if (item.receivedPhotoUrl !== undefined) sanitized.receivedPhotoUrl = item.receivedPhotoUrl;
  if (item.specificationUrl !== undefined) sanitized.specificationUrl = item.specificationUrl;
  if (item.linkedSpecDocumentId !== undefined) sanitized.linkedSpecDocumentId = item.linkedSpecDocumentId;
  if (item.createdAt !== undefined) sanitized.createdAt = item.createdAt;
  if (item.updatedAt !== undefined) sanitized.updatedAt = item.updatedAt;

  return sanitized;
}