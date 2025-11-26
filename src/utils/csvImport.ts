import { Vendor } from '@/utils/settingsFirestore';

export interface CSVImportResult {
  success: number;
  errors: string[];
}

// Export all vendors to CSV
export const exportVendorsToCSV = (vendors: Vendor[]) => {
  const headers = [
    'Company', 'Type', 'Makes', 'Email', 'Phone', 'Website', 'Logo',
    'PaymentTerms', 'LeadTime', 'Address', 'ContactPerson', 'Categories', 'Notes'
  ];

  // Convert vendors to CSV rows
  const vendorRows = vendors.map(vendor => [
    vendor.company || '',
    vendor.type || 'Dealer',
    vendor.makes?.join('; ') || '', // Join makes with semicolon
    vendor.email || '',
    vendor.phone || '',
    vendor.website || '',
    vendor.logo || '',
    vendor.paymentTerms || 'Net 30',
    vendor.leadTime || '2 weeks',
    vendor.address || '',
    vendor.contactPerson || '',
    vendor.categories?.join('; ') || '', // Join categories with semicolon
    vendor.notes || ''
  ]);

  const csvContent = [headers, ...vendorRows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().split('T')[0];
  a.download = `vendors_export_${timestamp}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
};

// Legacy function name for backwards compatibility
export const downloadVendorCSVTemplate = exportVendorsToCSV;

// Parse CSV content with proper handling of quoted fields
export const parseVendorCSV = (csvText: string) => {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one data row');
  }

  const headers = parseCSVLine(lines[0]);
  
  return lines.slice(1).map((line, index) => {
    const values = parseCSVLine(line);
    
    const vendor: Partial<Vendor> = {};
    headers.forEach((header, i) => {
      const value = values[i]?.trim() || '';
      
      switch (header.toLowerCase().replace(/[^a-z]/g, '')) {
        case 'company':
        case 'name': // Support legacy format
          vendor.company = value;
          break;
        case 'type':
          vendor.type = (value === 'OEM' || value === 'Dealer') ? value as 'OEM' | 'Dealer' : 'Dealer';
          break;
        case 'makes':
        case 'brands': // Support alternative naming
          // Split by semicolon and filter empty strings
          vendor.makes = value ? value.split(';').map(m => m.trim()).filter(m => m) : [];
          break;
        case 'email':
          vendor.email = value;
          break;
        case 'phone':
          vendor.phone = value;
          break;
        case 'website':
          vendor.website = value;
          break;
        case 'logo':
          vendor.logo = value;
          break;
        case 'paymentterms':
          vendor.paymentTerms = value || 'Net 30';
          break;
        case 'leadtime':
          vendor.leadTime = value || '2 weeks';
          break;
        case 'address':
          vendor.address = value;
          break;
        case 'contactperson':
          vendor.contactPerson = value;
          break;
        case 'categories':
          // Split by semicolon and filter empty strings
          vendor.categories = value ? value.split(';').map(c => c.trim()).filter(c => c) : [];
          break;
        case 'notes':
          vendor.notes = value;
          break;
      }
    });
    
    return { vendor, lineNumber: index + 2 };
  });
};

// Parse a single CSV line with proper quote handling
const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Handle escaped quotes ("")
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add the last field
  values.push(current);
  
  return values;
};

// Validate vendor data
export const validateVendorData = (vendor: Partial<Vendor>, lineNumber: number): string[] => {
  const errors: string[] = [];
  
  if (!vendor.company?.trim()) {
    errors.push(`Line ${lineNumber}: Company is required`);
  }
  
  if (vendor.email && !isValidEmail(vendor.email)) {
    errors.push(`Line ${lineNumber}: Invalid email format`);
  }
  
  if (vendor.website && !isValidWebsite(vendor.website)) {
    errors.push(`Line ${lineNumber}: Invalid website format`);
  }
  
  return errors;
};

// Email validation helper
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Website validation helper
const isValidWebsite = (website: string): boolean => {
  try {
    // Add protocol if missing
    const url = website.startsWith('http') ? website : `https://${website}`;
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// =====================================================
// BRAND CSV IMPORT/EXPORT FUNCTIONS
// =====================================================

import { Brand, BrandInput } from '@/types/brand';

export interface BrandCSVImportResult {
  success: number;
  errors: string[];
}

// Export brands to CSV
export const exportBrandsToCSV = (brands: Brand[]) => {
  const headers = ['Name', 'Website', 'Description', 'Status'];

  const brandRows = brands.map(brand => [
    brand.name || '',
    brand.website || '',
    brand.description || '',
    brand.status || 'active'
  ]);

  const csvContent = [headers, ...brandRows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().split('T')[0];
  a.download = `brands_export_${timestamp}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
};

// Parse Brand CSV content
export const parseBrandCSV = (csvText: string) => {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one data row');
  }

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line, index) => {
    const values = parseCSVLine(line);

    const brand: Partial<BrandInput> = {};
    headers.forEach((header, i) => {
      const value = values[i]?.trim() || '';

      switch (header.toLowerCase().replace(/[^a-z]/g, '')) {
        case 'name':
        case 'brand':
        case 'brandname':
          brand.name = value;
          break;
        case 'website':
        case 'url':
          brand.website = value;
          break;
        case 'description':
        case 'desc':
          brand.description = value;
          break;
        case 'status':
          brand.status = value === 'inactive' ? 'inactive' : 'active';
          break;
      }
    });

    return { brand, lineNumber: index + 2 };
  });
};

// Validate brand data
export const validateBrandData = (brand: Partial<BrandInput>, lineNumber: number): string[] => {
  const errors: string[] = [];

  if (!brand.name?.trim()) {
    errors.push(`Line ${lineNumber}: Brand name is required`);
  }

  if (brand.website && !isValidWebsite(brand.website)) {
    errors.push(`Line ${lineNumber}: Invalid website format`);
  }

  return errors;
};