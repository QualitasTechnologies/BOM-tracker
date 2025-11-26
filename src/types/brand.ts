/**
 * Brand represents an OEM/manufacturer
 * This is the source of truth for product brands
 */
export interface Brand {
  id: string;
  name: string;              // Brand/manufacturer name (e.g., "Basler", "Cognex")
  website?: string;          // Company website URL
  logo?: string;             // Firebase Storage URL for logo
  logoPath?: string;         // Storage path for deletion
  description?: string;      // Brief description
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Brand input for creating/updating (without id and timestamps)
 */
export type BrandInput = Omit<Brand, 'id' | 'createdAt' | 'updatedAt'>;
