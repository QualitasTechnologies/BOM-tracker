# CRM / Pre-Sales Module PRD

## Overview

Replace ClickUp deal tracking with an integrated CRM module in BOM Tracker. This creates a seamless flow from lead → deal → won project → BOM management.

**Goal:** Single source of truth for sales pipeline that converts directly into active projects.

**Key Insight:** Move "Planning" from Projects into CRM. Deals in PROPOSAL stage build a draft BOM for cost estimation and proposal generation. When won, this becomes the actual project BOM.

**Keep:**
- HubSpot for contacts and email tracking only
- Google Drive as document storage (app pulls from Drive, uploads go to Drive)
- **Existing Client model** (Settings → Client Management) - extend with CRM fields

**Replace:**
- ClickUp deal tracking entirely
- Project "Planning" status (now happens in CRM)

**Reuse:**
- Existing `clients` collection - add CRM fields (industry, segment, driveFolderId)
- Clients continue to link to Projects as before
- No duplicate company data

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BOM TRACKER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CRM MODULE (Pre-Sales)                                                      │
│  ══════════════════════                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │   NEW    │───▶│ QUALIFY  │───▶│ PROPOSAL │───▶│NEGOTIATE │              │
│  └──────────┘    └──────────┘    └────┬─────┘    └──────────┘              │
│                                       │                  │                  │
│                                       │                  │                  │
│                              ┌────────▼────────┐         │                  │
│                              │   DRAFT BOM     │         │                  │
│                              │ (for proposals) │         │                  │
│                              └────────┬────────┘         │                  │
│                                       │                  │                  │
│                                       ▼                  ▼                  │
│                                 ┌──────────┐      ┌─────────┐              │
│                                 │   WON    │      │  LOST   │──▶ Archive   │
│                                 └────┬─────┘      └─────────┘              │
│  ───────────────────────────────────│────────────────────────────────────  │
│                                      │                                      │
│  PROJECT MODULE (Execution)          │ Auto-convert                         │
│  ══════════════════════════          ▼                                      │
│                              ┌───────────────┐                              │
│                              │  PROCUREMENT  │ ◀── Draft BOM becomes        │
│                              │   + BOM       │     actual BOM               │
│                              └───────┬───────┘                              │
│                                      │                                      │
│                                      ▼                                      │
│                              ┌───────────────┐                              │
│                              │    ONGOING    │                              │
│                              │ (In Progress) │                              │
│                              └───────┬───────┘                              │
│                                      │                                      │
│                                      ▼                                      │
│                              ┌───────────────┐                              │
│                              │   COMPLETED   │                              │
│                              └───────────────┘                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Google Drive API
                                      ▼
                            ┌──────────────────┐
                            │   Google Drive   │
                            │  (Doc Storage)   │
                            └──────────────────┘
```

**Key Flow:**
1. Deal created in NEW stage
2. Qualify the opportunity
3. In PROPOSAL stage → Build **Draft BOM** for cost estimation
4. Generate proposals using Draft BOM pricing
5. Negotiate terms
6. **WON** → Auto-create Project with:
   - Status: PROCUREMENT
   - BOM: Copied from Draft BOM
   - Customer PO uploaded
7. Project proceeds: PROCUREMENT → ONGOING → COMPLETED

---

## Data Model

### Client Collection (Extended)

**Reusing existing Client model** from Settings → Client Management. We extend it with CRM fields.

```typescript
// Existing fields (already in BOM Tracker)
interface Client {
  id: string;
  company: string;                 // "Royal Enfield"
  email: string;
  phone: string;
  address: string;
  contactPerson: string;           // Primary contact (legacy)
  notes?: string;
  logo?: string;
  logoPath?: string;
  createdAt: Date;
  updatedAt: Date;

  // NEW CRM fields (to be added)
  industry?: string;               // "Automotive", "FMCG", etc.
  website?: string;
  segment?: 'enterprise' | 'mid-market' | 'smb';
  crmStatus?: 'prospect' | 'active' | 'inactive';  // Separate from "client status"

  // Google Drive Integration
  driveFolderId?: string;          // Account-level folder in Drive
  driveFolderUrl?: string;

  // External Links (reference only)
  hubspotCompanyId?: string;

  // Computed/cached for quick display
  totalDeals?: number;
  wonDeals?: number;
  totalRevenue?: number;
}
```

### Contact Collection (NEW - Multiple Contacts per Client)

**Path:** `/contacts` (top-level collection for easier cross-client search)

Supplements (doesn't replace) the legacy `contactPerson` field.

```typescript
// Stored as: contacts/{contactId}
interface Contact {
  id: string;
  clientId: string;                // Parent client (for filtering)

  // Contact Info
  name: string;                    // "Raghav Sharma"
  designation: string;             // "Project Manager"
  email: string;
  phone: string;

  // Role
  isPrimary: boolean;              // Primary contact for client
  department?: string;             // "Engineering", "Procurement"

  // External Links
  hubspotContactId?: string;       // For reference only

  // Tracking
  createdAt: Date;
  updatedAt: Date;
}
```

### Deal Collection

```typescript
interface Deal {
  id: string;

  // Basic Info
  name: string;                    // "Safety & MOP Vision AI"
  description: string;             // Project scope description

  // Client & Contacts (uses existing Client model)
  clientId: string;                // Parent client (from Settings → Clients)
  assignedContactIds: string[];    // Contacts from this client assigned to deal

  // Pipeline
  stage: DealStage;
  probability: number;             // 0-100% win probability
  expectedValue: number;           // Estimated deal value
  currency: 'INR' | 'USD' | 'EUR'; // Default: INR
  expectedCloseDate: Date;

  // Source & Assignment
  source: DealSource;
  assigneeId: string;              // Sales team member

  // Google Drive Integration
  driveFolderId: string;           // Google Drive folder ID
  driveFolderUrl: string;          // Direct link to folder

  // Draft BOM (for proposals - built during PROPOSAL stage)
  hasDraftBOM: boolean;            // Whether draft BOM exists
  draftBOMTotalCost: number;       // Calculated total for quick reference

  // Linked Entities
  linkedProposalIds: string[];     // Proposals created for this deal
  convertedProjectId?: string;     // Set when deal is won

  // Current Next Step (single action)
  nextStep: {
    action: string;                // "Send revised proposal"
    dueDate?: Date;
    assigneeId: string;
  } | null;

  // Tracking
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  closedAt?: Date;
  lastActivityAt: Date;            // Last log entry timestamp

  // Lost Deal Info
  lostReasonCategory?: LostReasonCategory;  // For analysis
  lostReasonDetails?: string;               // Freetext explanation

  // Archive
  isArchived: boolean;             // For lost deals
  archivedAt?: Date;
}

type LostReasonCategory =
  | 'price'           // Too expensive
  | 'competition'     // Lost to competitor
  | 'timing'          // Bad timing / delayed
  | 'budget'          // Client budget cut
  | 'requirements'    // Couldn't meet requirements
  | 'no-response'     // Client went silent
  | 'internal'        // Client internal decision
  | 'other';          // Other reason

type DealStage =
  | 'new'           // Just received, not yet qualified
  | 'qualification' // Understanding requirements, budget, timeline
  | 'proposal'      // Preparing/sent proposal
  | 'negotiation'   // Price/terms discussion
  | 'won'           // Deal closed - auto-creates project
  | 'lost';         // Deal lost - capture reason

type DealSource =
  | 'organic'       // Inbound inquiry
  | 'referral'      // Customer/partner referral
  | 'exhibition'    // Trade show/exhibition
  | 'cold-outreach' // Sales prospecting
  | 'repeat'        // Existing customer new project
  | 'tender';       // RFQ/Tender response
```

### Draft BOM (Subcollection of Deal)

Draft BOM is built during the PROPOSAL stage for cost estimation and proposal generation.
When deal is WON, this converts to the actual project BOM.

**Storage:** Follows same pattern as Project BOM for consistency.

```typescript
// Stored as: deals/{dealId}/draftBOM/data (single document with categories)
// Path mirrors: projects/{projectId}/bom/data

interface DraftBOMData {
  categories: DraftBOMCategory[];
}

interface DraftBOMCategory {
  name: string;                    // Uses canonical categories from Settings
  items: DraftBOMItem[];
  isExpanded: boolean;
}

interface DraftBOMItem {
  id: string;

  // Item Info (same as Project BOM)
  name: string;                    // "Industrial Camera - Basler ace2"
  description?: string;
  category: string;                // Must match canonical categories from Settings
  itemType: 'component' | 'service';

  // Quantity & Pricing
  quantity: number;                // For services: duration in days
  estimatedUnitPrice: number;      // Estimated cost (may not have exact quotes yet)
  // Note: No vendor at this stage - just estimated pricing

  // For Proposals (customer-facing)
  includeInProposal: boolean;      // Include this line item in proposal
  proposalDescription?: string;    // Customer-facing description
  proposalUnitPrice?: number;      // Price to quote customer (with margin)

  // Tracking
  createdAt: Date;
  updatedAt: Date;
}
```

**Draft BOM → Project BOM Field Mapping:**

| Draft BOM Field | Project BOM Field | Notes |
|-----------------|-------------------|-------|
| `name` | `name` | Direct copy |
| `description` | `description` | Direct copy |
| `category` | `category` | Direct copy (canonical) |
| `itemType` | `itemType` | Direct copy |
| `quantity` | `quantity` | Direct copy |
| `estimatedUnitPrice` | `price` | Becomes initial price |
| *(none)* | `status` | Set to `'not-ordered'` |
| *(none)* | `vendors` | Empty array `[]` |
| *(none)* | `finalizedVendor` | `undefined` |

**Draft BOM vs Project BOM:**

| Aspect | Draft BOM (CRM) | Project BOM |
|--------|-----------------|-------------|
| Purpose | Cost estimation, proposals | Actual procurement |
| Pricing | Estimated only | Finalized with vendor quotes |
| Vendor | None | Finalized vendor |
| Status tracking | No | Yes (Ordered, Received, etc.) |
| Inward tracking | No | Yes |
| Categories | Canonical (from Settings) | Canonical (from Settings) |

### Project Model Updates (for CRM Integration)

Add these fields to existing Project model:

```typescript
interface Project {
  // ... existing fields ...

  // NEW: CRM Integration
  sourceDealId?: string;           // Link back to originating deal (if converted)
  driveFolderUrl?: string;         // Google Drive folder (inherited from deal)
}
```

### Assignee Reference

All `assigneeId` fields use **Firebase Auth UID** (the user's unique ID from authentication).

```typescript
// Example
assigneeId: "abc123xyz"  // Firebase Auth UID, not email or display name
```

### Deal Activity Log (Flat History)

Instead of multiple pending tasks, each deal has:
1. **One "Next Step"** - The current action to take
2. **Activity Log** - Flat history of all completed steps (for timeline analysis)

```typescript
// Next Step is embedded in Deal
interface Deal {
  // ... other fields ...

  // Current Action (single next step)
  nextStep: {
    action: string;              // "Send revised proposal"
    dueDate?: Date;              // Optional target date
    assigneeId: string;          // Who should do it
  } | null;
}

// Activity Log - append-only history for analysis
interface ActivityLogEntry {
  id: string;
  dealId: string;

  // What happened
  action: string;                  // "Sent proposal v1"
  type: ActivityType;

  // When
  completedAt: Date;
  durationInStage?: number;        // Days spent before this action

  // Who
  completedBy: string;

  // Context
  notes?: string;
  stageAtTime: DealStage;          // Stage when action was taken

  // For analysis
  createdAt: Date;
}

type ActivityType =
  | 'call'          // Phone call
  | 'meeting'       // In-person or video meeting
  | 'email'         // Email sent
  | 'demo'          // Product demonstration
  | 'proposal'      // Proposal sent
  | 'follow-up'     // Follow-up completed
  | 'stage-change'  // Deal moved to new stage
  | 'note';         // General update
```

**Analysis Use Cases:**
- Average time per stage (where deals get stuck)
- Activity frequency by stage
- Time from first contact to close
- Deals with no activity in X days

### Proposal Collection (Pre-Project Quotes)

**Path:** `deals/{dealId}/proposals/{proposalId}` (subcollection of Deal)

```typescript
// Stored as: deals/{dealId}/proposals/{proposalId}
interface Proposal {
  id: string;
  dealId: string;

  // Proposal Info
  name: string;                    // "Vision Inspection System Proposal v1"
  version: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'revised';

  // Financials
  totalValue: number;
  currency: string;
  validUntil: Date;

  // Line Items (simplified BOM preview)
  lineItems: ProposalLineItem[];

  // Documents
  proposalDocUrl: string;          // Google Drive link to PDF

  // Tracking
  sentAt?: Date;
  respondedAt?: Date;
  createdAt: Date;
  createdBy: string;
}

interface ProposalLineItem {
  id: string;
  description: string;
  category: 'hardware' | 'software' | 'services' | 'integration';
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}
```

---

## Features & UI

### 1. Pipeline Dashboard

**Route:** `/crm` or `/deals`

```
┌─────────────────────────────────────────────────────────────────┐
│  Sales Pipeline                              [+ New Deal]       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐ │
│  │   NEW   │  │ QUALIFY │  │PROPOSAL │  │NEGOTIATE│  │  WON  │ │
│  │  ₹45L   │  │  ₹120L  │  │  ₹80L   │  │  ₹200L  │  │ ₹150L │ │
│  │ 5 deals │  │ 8 deals │  │ 4 deals │  │ 3 deals │  │2 deals│ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └───────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Deal Cards (Kanban or Table View)                           ││
│  │                                                              ││
│  │ ┌──────────────────┐ ┌──────────────────┐                   ││
│  │ │ Royal Enfield    │ │ Kellanova        │                   ││
│  │ │ Safety Vision AI │ │ Cereal Inspection│                   ││
│  │ │ ₹25L | Due: Jan 5│ │ ₹40L | Due: Jan 8│                   ││
│  │ │ 👤 RK           │ │ 👤 MS            │                   ││
│  │ │ → Send proposal  │ │ → Schedule demo  │  (next step)      ││
│  │ │ 🕐 2 days ago    │ │ ⚠️ 5 days ago    │  (last activity)  ││
│  │ └──────────────────┘ └──────────────────┘                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Pipeline summary with total value per stage
- **Weighted pipeline value** (value × probability): ₹25L × 70% = ₹17.5L weighted
- Kanban drag-and-drop OR table view toggle
- Filter by: Assignee, Client, Date range, Source
- Search across deal names and clients
- **Stale deal highlighting** (no activity in 7+ days) - yellow warning indicator
- **Re-open archived deals** - restore lost deals back to pipeline if opportunity returns
- **Duplicate deal** - copy deal for similar opportunities with same client

### 2. Deal Detail Page

**Route:** `/deals/:dealId`

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back   Royal Enfield - Safety & MOP Vision AI                 │
│          Stage: [PROPOSAL ▼]   Probability: [70% ▼]             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────┐ ┌─────────────────────────────┐ │
│ │ DEAL INFO                   │ │ CUSTOMER                    │ │
│ │ Expected Value: ₹25,00,000  │ │ Royal Enfield               │ │
│ │ Expected Close: Jan 15, 2025│ │ Raghav Sharma (PM)          │ │
│ │ Source: Organic             │ │ +91 98765 43210             │ │
│ │ Assignee: RK                │ │ raghav@royalenfield.com     │ │
│ │ Created: Dec 10, 2024       │ │ [View in HubSpot ↗]         │ │
│ └─────────────────────────────┘ └─────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📁 DOCUMENTS                              [Open Drive ↗]    │ │
│ │                                                              │ │
│ │ 📄 RFQ_RoyalEnfield_Dec2024.pdf          Dec 10            │ │
│ │ 📄 Technical_Requirements.docx            Dec 12            │ │
│ │ 📄 Proposal_v1.pdf                        Dec 18            │ │
│ │                                                              │ │
│ │ [+ Upload to Drive]                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🎯 NEXT STEP                                                │ │
│ │                                                              │ │
│ │ ┌────────────────────────────────────────────────────────┐  │ │
│ │ │ Send revised proposal                    Due: Dec 26   │  │ │
│ │ │ Assigned to: RK                     [✓ Complete Step]  │  │ │
│ │ └────────────────────────────────────────────────────────┘  │ │
│ │                                            [Edit] [Clear]   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📜 ACTIVITY LOG                           [+ Log Activity]  │ │
│ │                                                              │ │
│ │ Dec 20  Demo completed                    👤 MS  PROPOSAL  │ │
│ │         "Client impressed with accuracy metrics"            │ │
│ │ Dec 18  Sent proposal v1                  👤 RK  PROPOSAL  │ │
│ │ Dec 15  Requirements discovery call       👤 RK  QUALIFY   │ │
│ │ Dec 12  Stage changed to QUALIFICATION    👤 RK  NEW       │ │
│ │ Dec 10  Deal created                      👤 RK  NEW       │ │
│ │                                                              │ │
│ │ [Show more...]                                              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📑 PROPOSALS                              [+ New Proposal]  │ │
│ │                                                              │ │
│ │ Proposal v1 - ₹25,00,000    Sent Dec 18    Status: Pending │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Mark as Won - Create Project]        [Mark as Lost]        │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Deal → Project Conversion

When "Mark as Won" is clicked:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎉 Convert Deal to Project                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Deal: Royal Enfield - Safety & MOP Vision AI                    │
│ Value: ₹25,00,000                                               │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PROJECT DETAILS                                              │ │
│ │                                                              │ │
│ │ Project ID:    [RE-VIS-001        ]  (auto-generated)       │ │
│ │ Project Name:  [Royal Enfield Safety Vision AI    ]         │ │
│ │ Client:        [Royal Enfield ▼]     (from deal)            │ │
│ │ PO Value:      [₹25,00,000    ]      (from deal)            │ │
│ │ Deadline:      [2025-03-15    ]                              │ │
│ │                                                              │ │
│ │ ☑ Copy proposal line items to BOM (as draft)                │ │
│ │ ☑ Link deal documents to project                            │ │
│ │ ☐ Notify team members                                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│              [Cancel]                    [Create Project →]     │
└─────────────────────────────────────────────────────────────────┘
```

**Conversion Actions:**
1. Create new Project with status **"Procurement"**
2. Set PO Value from deal expected value
3. Link Customer to existing client (already linked via `clientId`)
4. Copy Draft BOM items to Project BOM (with field mapping - see below)
5. Link Google Drive folder to project (`driveFolderUrl`)
6. Update deal with `convertedProjectId`
7. Update project with `sourceDealId` (bidirectional link)

### 4. Client Management (Enhanced)

**Route:** `/clients` (extends existing Settings → Client Management)

Enhanced client list with CRM fields:
- Company name, industry, segment (NEW CRM fields)
- Total deals, win rate (NEW computed fields)
- Contacts list (NEW - multiple contacts per client)
- Link to HubSpot company page (reference only)
- Google Drive folder link (NEW)

### 5. Google Drive Integration

**Folder Hierarchy:**
```
📁 Qualitas Sales/                      ← Root (configured in settings)
  📁 Royal Enfield/                     ← Client folder (auto-created)
    📁 Safety Vision AI/                ← Deal folder (auto-created)
      📄 RFQ_Dec2024.pdf
      📄 Proposal_v1.pdf
    📁 Assembly Line QC/                ← Another deal
      📄 Requirements.docx
  📁 Kellanova/                         ← Another client
    📁 Cereal Inspection/
      📄 ...
```

**Auto-Creation Flow:**
1. **New/Existing Client** (when adding CRM fields) → Create `📁 {company}/` under root
2. **New Deal** → Create `📁 {dealName}/` under client folder

**Implementation:**

```typescript
// Google Drive Service
interface DriveService {
  // Create folder for client (company) - called when adding CRM fields to existing client
  createClientFolder(companyName: string): Promise<{folderId: string, folderUrl: string}>;

  // Create subfolder for new deal (under client folder)
  createDealFolder(clientFolderId: string, dealName: string): Promise<{folderId: string, folderUrl: string}>;

  // List files in folder
  listFiles(folderId: string): Promise<DriveFile[]>;

  // Upload file to folder
  uploadFile(folderId: string, file: File): Promise<DriveFile>;

  // Get shareable link
  getShareableLink(fileId: string): string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  thumbnailLink?: string;
  createdTime: Date;
  modifiedTime: Date;
}
```

**Settings Required:**
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` - The "Qualitas Sales" folder ID
- `GOOGLE_DRIVE_ROOT_FOLDER_URL` - Direct link for quick access

**Google Drive OAuth Strategy:**

Option A: **User OAuth (Recommended)**
1. User provides root folder URL in Settings (one-time setup)
2. OAuth scope: `drive.readonly` + `drive.file`
   - `drive.readonly` → Read ALL files in the folder (including existing)
   - `drive.file` → Create new folders/files
3. App reads/displays all nested files within root folder
4. App creates client/deal subfolders as needed

Option B: **Service Account (Alternative)**
1. Create Google Cloud service account
2. User shares root folder with service account email
3. Service account has full access to shared folder
4. No user OAuth needed (simpler UX, but requires folder sharing setup)

**Fallback:** If Drive API fails → Deal can still be created, folder linked manually later

---

## Implementation Phases

### Phase 1: Core CRM + Google Drive (Week 1-2)
1. **Google OAuth Setup** - Enable Drive API access (do first!)
2. **Data Models**:
   - Extend existing `Client` model with CRM fields (industry, segment, driveFolderId, etc.)
   - Create new `contacts` collection (multiple contacts per client)
   - Create `deals` collection (linked to clients)
   - Create `activityLog` collection
   - Create `draftBOM` subcollection under deals
3. **Client CRM Enhancement** - Add CRM fields to existing clients, Drive folder auto-creation
4. **Contact Management** - Add contacts to clients (separate from legacy `contactPerson`)
5. **Deal CRUD** - Create deals under clients, auto-create subfolder in Drive
6. **Deal-Contact Assignment** - Assign contacts from parent client to deals
7. **Pipeline Dashboard** - Kanban/table view with stage filters
8. **Navigation** - Add CRM to sidebar

### Phase 1.1: n8n Sales Automation Integration

**Goal:** When n8n's "Sales Automation - Agentic" workflow processes a new sales lead email, automatically create a Deal in BOM Tracker Firestore (in addition to ClickUp).

**Current n8n Workflow:**
```
Gmail Trigger → Intent Classification → Duplicate Check → AI Sales Orchestrator → ClickUp Task
```

**Data Available from AI Orchestrator:**
| Field | Example | Maps to Deal Field |
|-------|---------|-------------------|
| `SENDER_EMAIL` | john@acme.com | Used for contact lookup |
| `CONTACT_NAME` | John Smith | Used for contact creation |
| `COMPANY_NAME` | Acme Industries | Used for client lookup/creation |
| `PROJECT_NAME` | Acme - Defect Detection | `deal.name` |
| `EMAIL_SUBJECT` | Inquiry about vision system | `deal.description` |
| `INQUIRY_SUMMARY` | Looking for defect detection... | `deal.description` (appended) |

**Implementation Steps:**

1. **Add Firestore Node to n8n Workflow**
   - Add after "Create a task" node (parallel execution)
   - Use n8n's Firebase/Firestore node or HTTP Request to Firebase REST API

2. **Client Lookup/Creation Logic (in n8n Code node)**
   ```javascript
   // Pseudo-code for n8n Code node
   const companyName = $json.output.COMPANY_NAME;

   // 1. Search existing clients by company name (fuzzy match)
   // 2. If found → use existing clientId
   // 3. If not found → create new client with:
   //    - company: COMPANY_NAME
   //    - contactPerson: CONTACT_NAME
   //    - email: SENDER_EMAIL
   //    - crmStatus: 'prospect'
   ```

3. **Deal Creation Payload**
   ```javascript
   const dealData = {
     name: $json.output.PROJECT_NAME,
     description: `${$json.output.EMAIL_SUBJECT}\n\n${$json.output.INQUIRY_SUMMARY}`,
     clientId: clientId, // from lookup/creation
     assignedContactIds: [],
     stage: 'new',
     probability: 20, // Default for new inbound leads
     expectedValue: 0, // To be filled manually
     currency: 'INR',
     expectedCloseDate: new Date(Date.now() + 30*24*60*60*1000), // +30 days
     source: 'organic', // Inbound email
     assigneeId: 'default-sales-user-uid', // Configure in n8n
     hasDraftBOM: false,
     draftBOMTotalCost: 0,
     nextStep: {
       action: 'Qualify lead - review email and respond',
       dueDate: new Date(Date.now() + 2*24*60*60*1000), // +2 days
       assigneeId: 'default-sales-user-uid'
     },
     createdAt: new Date(),
     createdBy: 'n8n-automation',
     updatedAt: new Date(),
     lastActivityAt: new Date(),
     isArchived: false
   };
   ```

4. **Log Initial Activity**
   ```javascript
   const activityLog = {
     action: 'Deal auto-created from inbound email',
     type: 'note',
     completedAt: new Date(),
     completedBy: 'n8n-automation',
     stageAtTime: 'new',
     notes: `Source email: ${$json.output.SENDER_EMAIL}\nSubject: ${$json.output.EMAIL_SUBJECT}`
   };
   ```

5. **Firebase Authentication for n8n**
   - Option A: Use Firebase Admin SDK service account in n8n
   - Option B: Create a dedicated "automation" user in Firebase Auth
   - Option C: Use Firebase REST API with API key (less secure, not recommended)

**n8n Workflow Modification:**

```
                                    ┌─────────────────┐
                                    │  Create ClickUp │
Gmail → Intent → Duplicate → AI → If│     Task        │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │ Lookup/Create   │ (NEW)
                                    │    Client       │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │ Create Firestore│ (NEW)
                                    │     Deal        │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Log Activity   │ (NEW)
                                    └─────────────────┘
```

**Configuration Required:**
- Firebase service account JSON (store in n8n credentials)
- Default assignee UID for auto-created deals
- Firestore project ID: `visionbomtracker`

**Duplicate Prevention:**
- Before creating deal, check if deal with same `SENDER_EMAIL` exists in last 7 days
- Use ClickUp's existing duplicate check as primary (already in workflow)
- Add secondary Firestore check for safety

**Error Handling:**
- If Firestore creation fails, still allow ClickUp task creation
- Log error to existing error notification flow
- Add flag to ClickUp task indicating Firestore sync failed

### Phase 2: Draft BOM & Proposals (Week 3)
1. **Draft BOM Builder** - Add/edit items for cost estimation
2. **Draft BOM Categories** - Hardware, Software, Services, Integration
3. **Cost Summary** - Total estimated cost, margin calculator
4. **Proposal Line Items** - Customer-facing descriptions and pricing
5. **Drive File Listing** - Display files from deal's Drive folder
6. **Drive File Upload** - Upload through app to Drive folder

### Phase 3: Deal Details & Activity (Week 4)
1. **Deal Detail Page** - Full page with contacts, BOM, files, activity
2. **Next Step** - Single current action per deal
3. **Activity Log** - Flat history log with timestamps and stage tracking
4. **Archive/Restore** - Archive lost deals, view archived
5. **Email Notifications** - Notify on stage changes
6. **Stale Deal Alerts** - Highlight deals with no recent activity

### Phase 4: Deal → Project Conversion (Week 5)
1. **Update Project Statuses** - Add "Procurement", remove "Planning"
2. **Conversion Flow** - "Mark as Won" dialog with project setup
3. **BOM Conversion** - Draft BOM → Project BOM (copy items)
4. **Data Transfer** - Client (already linked), PO value, Drive links
5. **Linking** - Bidirectional link between deal and project

---

## Project Status Migration

**Current Statuses:**
- Planning → Ongoing → Delayed → Completed

**New Statuses (after CRM):**
- Procurement → Ongoing → Delayed → Completed

| Old Status | New Status | Notes |
|------------|------------|-------|
| Planning | *(removed)* | Now handled in CRM PROPOSAL stage |
| *(new)* | Procurement | First stage after deal won, ordering parts |
| Ongoing | Ongoing | In progress, parts being received |
| Delayed | Delayed | Behind schedule |
| Completed | Completed | Project finished |

**Migration:** Existing "Planning" projects either:
1. Move back to CRM as deals (if not started)
2. Change to "Procurement" status (if work started)

---

## Navigation Updates

```
Sidebar:
├── Dashboard (existing)
├── Projects (existing)
├── ─────────────────
├── 🎯 Sales Pipeline    ← NEW
│   ├── All Deals
│   ├── My Deals
│   └── Clients          ← Enhanced client list with CRM view
├── ─────────────────
├── Cost Analysis (existing)
├── Time Tracking (existing)
├── Settings (existing)
    └── Client Management ← Existing, add CRM fields here
```

---

## Migration Plan

### From ClickUp

1. **Export ClickUp Data**
   - Export deals as CSV
   - Note Drive folder links

2. **Import to BOM Tracker**
   - Match companies to existing Clients (or create new)
   - Add CRM fields to matched clients
   - Create deals with stage mapping
   - Link existing Drive folders

3. **Validation**
   - Verify deal counts match
   - Check Drive links work
   - Confirm activities migrated

### Data Mapping

| ClickUp Field | BOM Tracker Field |
|---------------|-------------------|
| Name | deal.name |
| Customer | client.company (match existing or create) |
| Customer Name | contact.name (create in contacts collection) |
| Contact Number | contact.phone |
| Deal Stage | deal.stage |
| Assignee | deal.assigneeId |
| Due date | deal.expectedCloseDate |
| Drive link | deal.driveFolderUrl + client.driveFolderUrl |
| Deal Source | deal.source |
| Subtasks | activityLog entries |

---

## Security & Permissions

| Role | Deals | Customers | Conversion |
|------|-------|-----------|------------|
| Admin | Full CRUD | Full CRUD | Can convert |
| Sales | Own deals + view all | View all | Can convert own |
| Viewer | View only | View only | No |

---

## Success Metrics

1. **Adoption** - 100% deals tracked in BOM Tracker (0 in ClickUp)
2. **Conversion Rate** - Deals → Projects conversion tracked
3. **Time Saved** - Reduced context switching between tools
4. **Data Quality** - All deals have Drive links, customer info

---

## Design Decisions (Confirmed)

| Question | Decision |
|----------|----------|
| Client data model | **Reuse existing Client** from Settings → extend with CRM fields |
| Contacts model | **Top-level `/contacts`** collection - multiple contacts per client (legacy `contactPerson` preserved) |
| Contacts path | Top-level for easier cross-client search |
| Proposals path | **Subcollection** `deals/{id}/proposals` - scoped to deal |
| Draft BOM storage | **Subcollection** `deals/{id}/draftBOM/data` - mirrors Project BOM structure |
| Assignee reference | Firebase Auth UID |
| Lost deals handling | Archive with option to view archived + **re-open** capability |
| Lost reason | Category enum + freetext details |
| Currency | Support INR/USD/EUR (default INR) |
| Weighted pipeline | Yes - show probability-weighted values |
| Stale deal threshold | **7 days** no activity → yellow warning |
| Deal duplication | Yes - copy deal for similar opportunities |
| Email notifications | Yes - notify on stage changes (SendGrid, details TBD) |
| Drive integration | User grants folder access, app reads all nested files + creates subfolders |
| Drive OAuth scope | `drive.readonly` + `drive.file` OR service account |
| Drive fallback | Deal can exist without folder, link manually later |
| Approval workflow | Not yet (future consideration) |
| Activity tracking | Simple: ONE next step + flat activity log (no calendar/multi-task) |
| Field change audit | Not yet (future consideration) |
| Search | Basic field filtering for now, full-text later |
| Reports | Not yet (future consideration) |

## Key Simplifications

1. **Single Next Step** - No complex task management. One action at a time.
2. **Flat Activity Log** - Append-only history for timeline analysis (where deals get stuck)
3. **No Calendar** - Just due dates on deals and next steps
4. **No Proposal Approval** - Simple proposal tracking for now
5. **Drive as Storage** - No migration, just integration
6. **Reuse Client Model** - No duplicate company data, single source of truth

## Backward Compatibility

**Existing Clients:**
- All existing clients continue to work for Projects
- New CRM fields are optional (added progressively)
- `contactPerson` field preserved as legacy (single contact)
- Projects continue to link to same client records

**Migration Path:**
1. Add optional CRM fields to Client model (no breaking changes)
2. Existing clients can be "enhanced" with CRM fields as deals are created
3. When creating a deal for existing client, prompt to create Drive folder if not exists
4. New `contacts` collection supplements (doesn't replace) legacy `contactPerson`

---

---

## Implementation Status

### Completed (December 2024)

**Phase 1 - Core Pipeline:**
- [x] Pipeline Dashboard (Kanban + Table views)
- [x] Deal CRUD (Create, Read, Update, Delete)
- [x] Deal Detail Page with all sections
- [x] Activity Logging with type badges
- [x] Next Step management (Set, Edit, Complete, Clear)
- [x] Stage and Probability selectors
- [x] Stale deal warnings (7+ days no activity)
- [x] Mark as Lost with reason categories
- [x] Archive/Restore deals
- [x] Deal duplication
- [x] Edit Deal functionality
- [x] CRM Access Control (admin auto-access, user toggle in Settings)
- [x] Sidebar navigation with CRM access check
- [x] Client logo display in Deal Detail

### Next Phase - Priority Features

**Priority 1: Contact Management (Phase 1 completion)**
- [ ] Create `contacts` collection in Firestore
- [ ] Contact CRUD in client management
- [ ] Assign contacts to deals
- [ ] Display assigned contacts in Deal Detail
- [ ] Primary contact indicator

**Priority 2: Google Drive Integration**
- [ ] Drive OAuth setup (Settings configuration)
- [ ] Auto-create client folders
- [ ] Auto-create deal subfolders
- [ ] Display Drive files in Deal Detail
- [ ] Upload files to Drive from deal page
- [ ] Manual folder linking fallback

**Priority 3: Draft BOM Builder (Phase 2)**
- [ ] Create `draftBOM` subcollection under deals
- [ ] Draft BOM items CRUD
- [ ] Category-based organization
- [ ] Cost estimation calculations
- [ ] Proposal pricing (with margins)
- [ ] "Include in Proposal" toggle per item

**Priority 4: Deal → Project Conversion (Phase 4)**
- [ ] "Mark as Won" conversion dialog
- [ ] Project creation with status "Procurement"
- [ ] Draft BOM → Project BOM conversion
- [ ] Bidirectional linking (deal ↔ project)
- [ ] Drive folder inheritance

### Future Considerations
- Email notifications (SendGrid)
- Full-text search
- Analytics and reports
- Field change audit trail
- Proposal approval workflow

---

*Document Version: 1.4*
*Created: December 26, 2024*
*Updated: December 27, 2024 - Added implementation status and priority roadmap*
