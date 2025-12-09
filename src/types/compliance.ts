import { BOMItem } from './bom';

// Types of compliance issues that can be detected
export type ComplianceIssueType =
  | 'name-format'           // Name doesn't follow standard format
  | 'invalid-sku'           // SKU code is malformed or doesn't match patterns
  | 'description-mismatch'  // Description inconsistent with name/category
  | 'quote-mismatch'        // Quote doesn't match BOM item specs
  | 'missing-quote'         // Item has no linked quote
  | 'missing-field'         // Required field is empty
  | 'duplicate-item'        // Potential duplicate detected
  | 'price-mismatch'        // Quote price differs significantly from BOM price
  | 'quantity-mismatch';    // Quote quantity differs from BOM quantity

// Severity levels for compliance issues
export type ComplianceSeverity = 'error' | 'warning' | 'info';

// Suggested fix for a compliance issue
export interface ComplianceFix {
  type: 'update-field' | 'link-document' | 'add-spec-url' | 'merge-items';
  field?: keyof BOMItem;
  suggestedValue?: string | number;
  documentId?: string;
  mergeTargetId?: string;
  specificationUrl?: string;
  description: string;
}

// Individual compliance issue
export interface ComplianceIssue {
  id: string;
  bomItemId: string;
  bomItemName: string;
  category: string;
  issueType: ComplianceIssueType;
  severity: ComplianceSeverity;
  message: string;
  details: string;
  currentValue?: string;
  suggestedFix?: ComplianceFix;
  documentId?: string;        // For quote-related issues
  documentName?: string;      // For display purposes
  confidence?: number;        // 0-100, for AI-detected issues
  createdAt: Date;
}

// Overall compliance report for a project
export interface ComplianceReport {
  id: string;
  projectId: string;
  createdAt: Date;
  createdBy: string;
  status: 'running' | 'completed' | 'failed';

  // Summary metrics
  totalItemsChecked: number;
  itemsWithIssues: number;
  totalIssues: number;
  issuesByType: Partial<Record<ComplianceIssueType, number>>;
  issuesBySeverity: Record<ComplianceSeverity, number>;

  // Quote matching results
  quotesAnalyzed: number;
  quotesMatched: number;
  quoteMismatches: number;

  // Issues list
  issues: ComplianceIssue[];

  // Processing metadata
  processingTimeMs?: number;
  errorMessage?: string;
}

// Quote line item extracted from vendor quote
export interface QuoteLineItem {
  partName: string;
  partNumber?: string;
  sku?: string;
  make?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
}

// Result of matching a quote line to BOM items
export interface QuoteLineMatch {
  quoteLineItem: QuoteLineItem;
  bomItemId?: string;
  bomItemName?: string;
  matchScore: number;        // 0-100
  matchReasons: string[];    // Why this match was made
  mismatches: string[];      // What doesn't match
}

// Result of analyzing a single vendor quote
export interface QuoteAnalysisResult {
  documentId: string;
  documentName: string;
  totalLineItems: number;
  lineMatches: QuoteLineMatch[];
  unmatchedQuoteLines: number;
  unmatchedBOMItems: string[];  // Item IDs not matched to any quote line
}

// Request to run compliance check
export interface ComplianceCheckRequest {
  projectId: string;
  bomItems: BOMItem[];
  vendorQuotes: {
    documentId: string;
    documentName: string;
    extractedText: string;
  }[];
  settings: {
    validSKUPatterns?: string[];      // Regex patterns for valid SKUs
    requiredFields?: (keyof BOMItem)[];
    existingMakes: string[];
    existingCategories: string[];
  };
}

// Response from compliance check
export interface ComplianceCheckResponse {
  success: boolean;
  report: ComplianceReport;
  quoteAnalysis?: QuoteAnalysisResult[];
}

// Request to trigger spec sheet search
export interface SpecSearchRequest {
  bomItemId: string;
  projectId: string;
  itemName: string;
  make?: string;
  sku?: string;
  userId: string;
}

// Response from spec search trigger
export interface SpecSearchResponse {
  success: boolean;
  searchId: string;
  status: 'triggered' | 'completed' | 'failed' | 'not_found' | 'not_configured';
  specificationUrl?: string;
  documentId?: string;
  errorMessage?: string;
  message?: string;
}

// Status of an ongoing spec search
export interface SpecSearchStatus {
  bomItemId: string;
  status: 'searching' | 'found' | 'not_found' | 'error';
  specificationUrl?: string;
  documentId?: string;
  errorMessage?: string;
}

// Helper function to get severity color
export function getSeverityColor(severity: ComplianceSeverity): string {
  switch (severity) {
    case 'error':
      return 'destructive';
    case 'warning':
      return 'warning';
    case 'info':
      return 'secondary';
    default:
      return 'secondary';
  }
}

// Helper function to get issue type label
export function getIssueTypeLabel(type: ComplianceIssueType): string {
  switch (type) {
    case 'name-format':
      return 'Name Format';
    case 'invalid-sku':
      return 'Invalid SKU';
    case 'description-mismatch':
      return 'Description Mismatch';
    case 'quote-mismatch':
      return 'Quote Mismatch';
    case 'missing-quote':
      return 'Missing Quote';
    case 'missing-field':
      return 'Missing Field';
    case 'duplicate-item':
      return 'Duplicate Item';
    case 'price-mismatch':
      return 'Price Mismatch';
    case 'quantity-mismatch':
      return 'Quantity Mismatch';
    default:
      return type;
  }
}
