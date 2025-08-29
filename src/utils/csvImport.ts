import { Vendor } from '@/utils/settingsFirestore';

export interface CSVImportResult {
  success: number;
  errors: string[];
}

// Download CSV template with sample data
export const downloadVendorCSVTemplate = () => {
  const headers = [
    'Company', 'Type', 'Email', 'Phone', 'Website', 'Logo',
    'PaymentTerms', 'LeadTime', 'Address', 'ContactPerson', 'Notes'
  ];
  
  const sampleData = [
    [
      'Basler AG', 'OEM', 
      'sales@baslerweb.com', '+49 4102 463 0', 'www.baslerweb.com', 'https://www.baslerweb.com/fp-1551958789/media/images/logos/basler-logo.svg',
      'Net 30', '2 weeks', 'An der Strusbek 60-62, 22926 Ahrensburg, Germany',
      'Sales Team', 'Leading German manufacturer of machine vision cameras'
    ],
    [
      'Allied Vision Technologies GmbH', 'OEM',
      'info@alliedvision.com', '', 'www.alliedvision.com', 'https://www.alliedvision.com/etc/clientlibs/allied-vision/img/logos/allied-vision-logo.svg',
      'Net 30', '3 weeks', '', 'Sales Department',
      'Founded 1989, specializes in FireWire, GigE, and Camera Link interfaces'
    ],
    [
      'Machine Vision Store LLC', 'Dealer',
      'sales@machinevisionstore.com', '+1-555-0123', 'www.machinevisionstore.com', '',
      'Net 30', '1 week', '123 Tech Drive, Silicon Valley, CA 94000',
      'John Smith', 'Authorized stocking distributor offering competitive prices'
    ],
    [
      'LUCID Vision Labs Inc.', 'OEM',
      'sales@thinklucid.com', '1-833-465-8243', 'www.thinklucid.com', 'https://thinklucid.com/wp-content/uploads/2019/05/LUCID-Vision-Labs-Logo-300x126.png',
      'Net 30', '3 weeks', '4600 Jacombs Rd #110, Richmond B.C. Canada, V6V 3B1',
      'Sales Team', 'Canadian manufacturer founded 2017, innovative cameras'
    ]
  ];

  const csvContent = [headers, ...sampleData]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vendor_import_template.csv';
  a.click();
  window.URL.revokeObjectURL(url);
};

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