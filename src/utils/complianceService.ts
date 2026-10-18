/**
 * Compliance Service
 * Frontend service for AI compliance checking and spec sheet search
 */

import { BOMItem, BOMCategory } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import {
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ComplianceReport,
  SpecSearchRequest,
  SpecSearchResponse
} from '@/types/compliance';

// Firebase Functions URLs
const FUNCTIONS_BASE_URL = 'https://us-central1-visionbomtracker.cloudfunctions.net';
const pendingSpecSearchOperations = new Map<string, string>();
const SPEC_SEARCH_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function specSearchOperationKey(request: Pick<SpecSearchRequest, 'userId' | 'projectId' | 'bomItemId'>): string {
  return `bom:spec-search:pending:${encodeURIComponent(request.userId)}:${encodeURIComponent(request.projectId)}:${encodeURIComponent(request.bomItemId)}`;
}

function getPendingSpecSearchOperation(key: string): string | undefined {
  const inMemory = pendingSpecSearchOperations.get(key);
  if (inMemory) return inMemory;

  try {
    const stored = globalThis.localStorage?.getItem(key) || undefined;
    if (stored && SPEC_SEARCH_OPERATION_ID.test(stored)) {
      pendingSpecSearchOperations.set(key, stored);
      return stored;
    }
    if (stored) globalThis.localStorage?.removeItem(key);
  } catch {
    // Fall back to this page's pending-operation cache if browser storage is unavailable.
  }
  return undefined;
}

function setPendingSpecSearchOperation(key: string, operationId: string): void {
  pendingSpecSearchOperations.set(key, operationId);
  try {
    globalThis.localStorage?.setItem(key, operationId);
  } catch {
    // Keep the operation ID in memory so a retry in this page is still idempotent.
  }
}

function clearPendingSpecSearchOperation(key: string, operationId: string): void {
  if (pendingSpecSearchOperations.get(key) === operationId) pendingSpecSearchOperations.delete(key);
  try {
    if (globalThis.localStorage?.getItem(key) === operationId) globalThis.localStorage.removeItem(key);
  } catch {
    // The terminal result is still returned; inaccessible browser storage is harmless.
  }
}

function isTerminalSpecSearchState(state: string): boolean {
  return ['completed', 'not_found', 'failed', 'conflict', 'project_not_found', 'item_not_found', 'bom_not_found'].includes(state);
}

/**
 * Run AI compliance check on BOM items
 */
export async function runComplianceCheck(
  projectId: string,
  categories: BOMCategory[],
  vendorQuotes: ProjectDocument[],
  settings?: {
    existingMakes?: string[];
    existingCategories?: string[];
  }
): Promise<ComplianceCheckResponse> {
  // Flatten categories to get all items
  const bomItems = categories.flatMap(cat => cat.items);

  // Prepare vendor quotes with file URLs and linked BOM items
  // The backend will download and parse PDFs using pdf-parse and OpenAI
  const quotesWithText = vendorQuotes
    .filter(doc => doc.type === 'vendor-quote')
    .map(doc => ({
      documentId: doc.id,
      documentName: doc.name,
      fileUrl: doc.url, // Firebase Storage URL for PDF parsing
      linkedBOMItems: doc.linkedBOMItems || [] // Pass linked BOM items for quote validation
    }));

  const requestBody: ComplianceCheckRequest = {
    projectId,
    bomItems,
    vendorQuotes: quotesWithText,
    settings: {
      existingMakes: settings?.existingMakes || [],
      existingCategories: settings?.existingCategories || []
    }
  };

  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/runComplianceCheck`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Compliance check failed:', error);
    throw error;
  }
}

/**
 * Trigger spec sheet search for a BOM item
 */
export async function triggerSpecSearch(
  request: SpecSearchRequest
): Promise<SpecSearchResponse> {
  try {
    if (!request.userId) throw new Error('You must be signed in to search for a specification sheet.');

    const operationKey = specSearchOperationKey(request);
    const operationId = getPendingSpecSearchOperation(operationKey) || crypto.randomUUID();
    setPendingSpecSearchOperation(operationKey, operationId);
    const call = httpsCallable<
      { project_id: string; item_id: string; operation_id: string; expected_actor_uid: string },
      { ok: boolean; operation_id?: string; state: string; specificationUrl?: string | null; error?: string }
    >(functions, 'nativeSpecSearchOperation');
    const { data } = await call({
      project_id: request.projectId,
      item_id: request.bomItemId,
      operation_id: operationId,
      expected_actor_uid: request.userId,
    });

    if (isTerminalSpecSearchState(data.state)) {
      clearPendingSpecSearchOperation(operationKey, operationId);
    }

    const completed = data.state === 'completed' || data.state === 'not_found';
    return {
      success: data.ok && completed,
      searchId: data.operation_id || operationId,
      status: completed ? 'completed' : 'failed',
      ...(data.specificationUrl ? { specificationUrl: data.specificationUrl } : {}),
      ...(!data.ok || !completed ? { errorMessage: data.error || data.state || 'Search failed' } : {}),
    };
  } catch (error) {
    console.error('Spec search trigger failed:', error);
    throw error;
  }
}

/**
 * Apply a compliance fix to a BOM item
 * Returns the updated item
 */
export function applyComplianceFix(
  item: BOMItem,
  field: keyof BOMItem,
  value: string | number
): Partial<BOMItem> {
  return {
    [field]: value,
    updatedAt: new Date()
  };
}

/**
 * Get severity badge color for UI
 */
export function getSeverityBadgeVariant(severity: string): 'destructive' | 'warning' | 'secondary' | 'default' {
  switch (severity) {
    case 'error':
      return 'destructive';
    case 'warning':
      return 'warning' as 'destructive'; // shadcn doesn't have warning, use custom styling
    case 'info':
      return 'secondary';
    default:
      return 'default';
  }
}

/**
 * Get issue type icon
 */
export function getIssueTypeIcon(type: string): string {
  switch (type) {
    case 'name-format':
      return 'Type';
    case 'invalid-sku':
      return 'Hash';
    case 'description-mismatch':
      return 'FileText';
    case 'quote-mismatch':
      return 'FileWarning';
    case 'missing-quote':
      return 'FileX';
    case 'missing-field':
      return 'AlertCircle';
    case 'duplicate-item':
      return 'Copy';
    case 'price-mismatch':
      return 'DollarSign';
    case 'quantity-mismatch':
      return 'Hash';
    default:
      return 'AlertTriangle';
  }
}

/**
 * Format processing time for display
 */
export function formatProcessingTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Calculate compliance score from report
 * Score is 100 - (weighted issues / total items * 100)
 */
export function calculateComplianceScore(report: ComplianceReport): number {
  if (report.totalItemsChecked === 0) return 100;

  // Weight issues by severity
  const weightedIssues =
    (report.issuesBySeverity.error || 0) * 3 +
    (report.issuesBySeverity.warning || 0) * 1.5 +
    (report.issuesBySeverity.info || 0) * 0.5;

  // Calculate score (max 100, min 0)
  const score = Math.max(0, 100 - (weightedIssues / report.totalItemsChecked) * 20);
  return Math.round(score);
}

/**
 * Get compliance score color
 */
export function getComplianceScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

/**
 * Group issues by BOM item for display
 */
export function groupIssuesByItem(report: ComplianceReport): Map<string, typeof report.issues> {
  const grouped = new Map<string, typeof report.issues>();

  report.issues.forEach(issue => {
    const existing = grouped.get(issue.bomItemId) || [];
    existing.push(issue);
    grouped.set(issue.bomItemId, existing);
  });

  return grouped;
}

/**
 * Filter issues by type and/or severity
 */
export function filterIssues(
  issues: ComplianceReport['issues'],
  filters: {
    types?: string[];
    severities?: string[];
    searchQuery?: string;
  }
): ComplianceReport['issues'] {
  return issues.filter(issue => {
    // Filter by type
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(issue.issueType)) return false;
    }

    // Filter by severity
    if (filters.severities && filters.severities.length > 0) {
      if (!filters.severities.includes(issue.severity)) return false;
    }

    // Filter by search query
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      const matchesName = issue.bomItemName.toLowerCase().includes(query);
      const matchesMessage = issue.message.toLowerCase().includes(query);
      const matchesDetails = issue.details.toLowerCase().includes(query);
      if (!matchesName && !matchesMessage && !matchesDetails) return false;
    }

    return true;
  });
}
