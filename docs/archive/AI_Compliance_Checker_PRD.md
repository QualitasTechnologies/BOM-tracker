# AI Compliance Checker - Feature Specification

## Overview

An AI-powered compliance checker for BOM items that validates data quality, matches vendor quotes to items, and enables spec sheet discovery via n8n integration.

## User Requirements Summary

- **Trigger:** Manual only (click "Compliance Check" button)
- **Quote Matching:** Fuzzy AI matching + SKU verification
- **Spec Search:** Per-item trigger via search icon, uses n8n workflow
- **Fixes:** Suggestions with one-click "Apply Fix" buttons
- **Export:** None needed (view-only in app)

---

## Data Model Changes

### 1. New Fields on BOMItem (`src/types/bom.ts`)

```typescript
export interface BOMItem {
  // ... existing fields ...
  specificationUrl?: string;        // Original source URL where spec was found
  linkedSpecDocumentId?: string;    // Reference to downloaded spec sheet document
}
```

### 1.1 New Document Type (`src/types/projectDocument.ts`)

```typescript
// Update DocumentType to include spec-sheet
export type DocumentType = 'vendor-quote' | 'outgoing-po' | 'customer-po' | 'vendor-invoice' | 'spec-sheet';

export interface ProjectDocument {
  // ... existing fields ...
  sourceUrl?: string;  // For spec-sheets: original URL where document was found
}
```

### 2. New Types (`src/types/compliance.ts`)

```typescript
export type ComplianceIssueType =
  | 'name-format'           // Name doesn't follow standard format
  | 'invalid-sku'           // SKU code malformed
  | 'description-mismatch'  // Description inconsistent
  | 'quote-mismatch'        // Quote doesn't match BOM item
  | 'missing-quote'         // Item has no linked quote
  | 'missing-field'         // Required field empty
  | 'duplicate-item';       // Potential duplicate

export type ComplianceSeverity = 'error' | 'warning' | 'info';

export interface ComplianceFix {
  type: 'update-field' | 'link-document' | 'add-spec-url';
  field?: keyof BOMItem;
  suggestedValue?: string | number;
  documentId?: string;
  description: string;
}

export interface ComplianceIssue {
  id: string;
  bomItemId: string;
  bomItemName: string;
  issueType: ComplianceIssueType;
  severity: ComplianceSeverity;
  message: string;
  details: string;
  currentValue?: string;
  suggestedFix?: ComplianceFix;
  confidence?: number;  // 0-100 for AI issues
}

export interface ComplianceReport {
  id: string;
  projectId: string;
  createdAt: Date;
  status: 'running' | 'completed' | 'failed';

  // Summary
  totalItemsChecked: number;
  itemsWithIssues: number;
  totalIssues: number;
  issuesByType: Record<ComplianceIssueType, number>;
  issuesBySeverity: Record<ComplianceSeverity, number>;

  // Quote analysis
  quotesAnalyzed: number;
  quotesMatched: number;

  issues: ComplianceIssue[];
  processingTimeMs?: number;
}

export interface QuoteLineMatch {
  quoteLineItem: {
    partName: string;
    partNumber?: string;
    make?: string;
    quantity: number;
    unitPrice: number;
  };
  bomItemId?: string;
  matchScore: number;  // 0-100
  mismatches: string[];
}
```

---

## Firebase Functions

### 1. `runComplianceCheck` (New)

**Endpoint:** `POST /runComplianceCheck`

**Request:**
```typescript
{
  projectId: string;
  bomItems: BOMItem[];
  vendorQuotes: {
    documentId: string;
    documentName: string;
    extractedText: string;  // From PDF parsing
  }[];
  settings: {
    existingMakes: string[];
    existingCategories: string[];
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  report: ComplianceReport;
}
```

**AI Prompt Strategy:**
- Validate item names (proper format, no excessive abbreviations)
- Check SKU patterns (alphanumeric with dashes/underscores)
- Verify descriptions are meaningful
- Parse quote text and match line items to BOM using:
  - SKU exact match (high score)
  - Name fuzzy match (medium score)
  - Make/quantity correlation (low score)
- Flag mismatches in quantity, price (>15% deviation), specs

### 2. `triggerSpecSearch` (New)

**Endpoint:** `POST /triggerSpecSearch`

**Request:**
```typescript
{
  bomItemId: string;
  projectId: string;
  itemName: string;
  make?: string;
  sku?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  searchId: string;  // For tracking async result
  status: 'triggered';
}
```

**Implementation:** Calls n8n webhook, n8n updates Firestore directly on completion.

---

## n8n Workflow Design

### Spec Sheet Search Workflow

**Trigger:** Webhook from Firebase Function

**Data Flow:**
```
Web App → Firebase Function → n8n Webhook
                                   ↓
                            Web Search (Google)
                                   ↓
                            Download PDF
                                   ↓
                            Upload to Firebase Storage
                                   ↓
                            Create ProjectDocument in Firestore
                                   ↓
                            Update BOM item with linkedSpecDocumentId
                                   ↓
Web App ← Real-time Firestore listener sees update
```

**Steps:**
1. **Webhook** - Receive `{ bomItemId, itemName, make, sku, projectId, userId }`
2. **Build Query** - Format: `"{itemName}" "{make}" datasheet specification filetype:pdf`
3. **Google Custom Search** - Call search API for PDF results
4. **Filter Results** - Score relevance, select best spec sheet
5. **HTTP Request** - Download PDF from source URL
6. **Firebase Storage** - Upload PDF to `projects/{projectId}/documents/spec-sheets/{timestamp}_{filename}`
7. **Firestore Write** - Create ProjectDocument record:
   ```json
   {
     "id": "auto-generated",
     "projectId": "{projectId}",
     "name": "{itemName} - Specification Sheet",
     "url": "{storage download URL}",
     "type": "spec-sheet",
     "uploadedAt": "{timestamp}",
     "uploadedBy": "{userId}",
     "linkedBOMItems": ["{bomItemId}"],
     "sourceUrl": "{original web URL}",
     "fileSize": "{bytes}"
   }
   ```
8. **Firestore Update** - Update BOM item:
   ```json
   {
     "linkedSpecDocumentId": "{documentId}",
     "specificationUrl": "{original web URL}"
   }
   ```
9. **Error Handler** - Log failures, update item with error status

**Webhook URL:** Configure in environment as `N8N_SPEC_SEARCH_WEBHOOK`

**n8n Nodes Required:**
- Webhook trigger
- HTTP Request (Google Custom Search)
- Code node (filter/score results)
- HTTP Request (download PDF)
- Firebase Storage node (upload)
- Firebase Firestore node (create document)
- Firebase Firestore node (update BOM item)

---

## UI Components

### 1. ComplianceChecker (`src/components/BOM/ComplianceChecker.tsx`)

**Location:** Button in BOM page toolbar (next to "Create PR")

**Features:**
- "Run Compliance Check" button
- Progress indicator during analysis
- Full-screen dialog showing:
  - Summary cards (items checked, issues found by severity)
  - Filterable issues list (by type, severity)
  - Each issue shows: item name, problem, current value, suggested fix
  - "Apply Fix" button per issue

### 2. IssueCard (`src/components/BOM/compliance/IssueCard.tsx`)

**Features:**
- Severity badge (red/yellow/blue)
- Issue message and details
- Current vs suggested value diff
- "Apply Fix" button with loading state
- Link to jump to affected item

### 3. SpecSearchButton (inline in BOMPartRow)

**Features:**
- Search icon on each component row (not services)
- Click triggers n8n search
- Loading spinner during search
- Shows spec URL link when found
- Tooltip: "Search for specification sheet"

---

## Integration Points

### BOM.tsx Changes
1. Add "Compliance Check" button to toolbar
2. Add ComplianceChecker dialog state
3. Pass `onFixApplied` callback to update items

### BOMPartRow.tsx Changes
1. Add SpecSearchButton for components
2. Display specificationUrl as link when available
3. Add loading state for search

### projectFirestore.ts Changes
1. Update `sanitizeBOMItemForFirestore` to include `specificationUrl`

---

## Implementation Phases

### Phase 1: Data Models (1 day)
- [ ] Create `src/types/compliance.ts`
- [ ] Add `specificationUrl` to BOMItem in `src/types/bom.ts`
- [ ] Update sanitization function

### Phase 2: Compliance Check Function (2-3 days)
- [ ] Add `runComplianceCheck` to `functions/index.js`
- [ ] Implement item validation logic
- [ ] Implement AI quote matching with GPT-4o-mini
- [ ] Test with sample data

### Phase 3: n8n Spec Search (1-2 days)
- [ ] Create n8n workflow with Google Custom Search
- [ ] Add `triggerSpecSearch` Firebase Function
- [ ] Configure webhook and Firestore update
- [ ] Test end-to-end

### Phase 4: Compliance UI (2-3 days)
- [ ] Create ComplianceChecker.tsx component
- [ ] Create IssueCard.tsx component
- [ ] Integrate into BOM.tsx toolbar
- [ ] Implement fix application logic

### Phase 5: Spec Search UI (1 day)
- [ ] Add search icon to BOMPartRow
- [ ] Handle loading/success/error states
- [ ] Display spec URL link

### Phase 6: Testing & Polish (1 day)
- [ ] Test with real BOM data
- [ ] Handle edge cases
- [ ] UI polish

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/bom.ts` | Add `specificationUrl`, `linkedSpecDocumentId` fields |
| `src/types/projectDocument.ts` | Add `'spec-sheet'` to DocumentType, add `sourceUrl` field |
| `src/types/compliance.ts` | New file - all compliance types |
| `functions/index.js` | Add `runComplianceCheck`, `triggerSpecSearch` |
| `src/utils/complianceService.ts` | New file - frontend service calls |
| `src/utils/projectFirestore.ts` | Update sanitization for new fields |
| `src/components/BOM/ComplianceChecker.tsx` | New file - main component |
| `src/components/BOM/compliance/IssueCard.tsx` | New file |
| `src/components/BOM/ProjectDocuments.tsx` | Add spec-sheet section |
| `src/pages/BOM.tsx` | Add toolbar button, dialog, real-time listener |
| `src/components/BOM/BOMPartRow.tsx` | Add spec search button, show linked spec |

---

## Environment Variables Needed

```
# Firebase Function secrets
N8N_SPEC_SEARCH_WEBHOOK=https://your-n8n.com/webhook/spec-search
N8N_API_KEY=xxx

# n8n workflow
GOOGLE_CUSTOM_SEARCH_API_KEY=xxx
GOOGLE_CUSTOM_SEARCH_CX=xxx
```

---

## Success Criteria

1. User can run compliance check and see all issues in a clear report
2. AI matches vendor quotes to BOM items with >80% accuracy
3. One-click fixes work for field updates
4. Spec search finds datasheets for common OEM parts (Keyence, Omron, etc.)
5. All operations complete within reasonable time (<30s for compliance, <10s for spec search)
