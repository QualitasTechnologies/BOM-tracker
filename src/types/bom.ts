export type BOMStatus = 'not-ordered' | 'ordered' | 'received' | 'approved';

export interface BOMItem {
  id: string;
  name: string;
  make?: string;
  description: string;
  sku?: string;
  categoryId: string; // Now references category ID instead of name
  quantity: number;
  order: number; // For drag-and-drop ordering within categories
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
  createdAt: Date;
  updatedAt: Date;
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