export type BOMStatus = 'not-ordered' | 'ordered' | 'received' | 'approved';
export type BOMItemType = 'component' | 'service';

export interface BOMItem {
  id: string;
  itemType: BOMItemType; // NEW: Distinguish between component and service
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

  createdAt?: Date;
  updatedAt?: Date;
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