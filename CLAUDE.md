# BOM TRACKER - PRODUCT ROADMAP

## ✅ COMPLETED FEATURES

### 🔐 Authentication & User Management
- Google OAuth Integration
- Email/Password Authentication  
- Responsive Header with user profile
- Protected Routes

### ⚙️ Settings Management
- Client Management (add, edit, delete with validation)
- Vendor Management (supplier database with payment terms, lead times, categories)
  - CSV import/export with duplicate detection and preview
  - Search and category filtering
  - Automatic change detection and merge preview
- BOM Settings (configurable categories, approval workflows)
- Firebase real-time sync

### 🤖 AI-Powered BOM Import
- OpenAI GPT-4o-mini Integration
- File upload (PDF, DOCX, TXT) and text input
- Automatic part extraction with quantities
- Secure Firebase Functions backend
- Fallback keyword-based analysis

### 🔧 BOM Management
- Part ID removal (simplified structure)
- Fixed vendor integration
- Lead time optimization
- Purchase Request system (SendGrid email integration)
- CSV export/import with makes field support and pricing columns
- **Flattened UI Design** (Nov 2025)
  - Removed nested detail panels (BOMPartDetails component eliminated - 880 lines)
  - Inline editing for all fields including price
  - Total cost calculation display (unit price × quantity)
  - Compact category cards with inline item management
  - 80% code reduction through flattened architecture
- **Optimized Header** (Nov 2025)
  - Sticky header with financial metrics (50% space reduction)
  - Real-time total BOM cost calculation
  - Pricing progress tracking (items priced / total items)
  - Color-coded completion badges
- **Centralized Document Management** (Nov 2025)
  - Project-level document organization (Vendor Quotes, POs Outgoing, Customer PO)
  - Document linking to multiple BOM items
  - Visual indicators for linked documents on items (📄×3 badges)
  - Firebase Storage integration with metadata tracking
  - Collapsible UI for space optimization
- **Services Tracking Module** (Nov 2025)
  - Unified data model for both components and services
  - Services tracked by duration (days, 0.5 minimum) and rate per day (₹/day)
  - Item type selector in add dialog (Component/Service)
  - Conditional field display (hide make/SKU/vendor fields for services)
  - Updated labels: "Duration" vs "Qty", "Rate" vs "Unit", with "days" suffix
  - Total cost calculation: duration × rate (same formula as quantity × price)
  - CSV export includes Item Type column with appropriate units
  - Backward compatible (existing items default to 'component')
  - Financial aggregation: Total project cost = Components + Services
- **Canonical Category Management** (Nov 2025)
  - Single source of truth: Categories defined in Settings → Default Categories
  - Category validation: New parts must use canonical categories only
  - Category alignment UI: Warning banner for mismatched categories
  - Merge functionality: Realign project categories to canonical categories
  - Performance optimized: useMemo/useCallback for computed values
  - Prevents category sprawl across projects
  - Clear error messages guide users to Settings when needed
  - Shows mismatched categories with item counts for easy decision-making

### 📊 Analytics & Dashboards
- KPI Dashboard with real-time metrics
- Project cost tracking and visualization
- Profit/Loss analysis gauges

## 🚧 PENDING FEATURES

### 🎯 Immediate Next - PRIORITY

#### 📊 CEO Dashboard & Project KPI System (HIGHEST PRIORITY)
See CEO_Dashboard_PRD.md for complete specifications

**Phase 1: Data Model & Infrastructure (Week 1-2)**
1. **Project Tracking Enhancement**
   - Add project category (Internal/Customer)
   - Implement original vs current target end dates
   - Add project kickoff date tracking
   - Extend budget tracking with burn rate calculations

2. **Milestone System Implementation**
   - Create milestone data model with original/current planned dates
   - Add milestone estimated duration (calendar days)
   - Implement status tracking (Not Started/In Progress/Completed/Blocked)
   - Add progress percentage tracking

3. **Delay Tracking System** (Critical)
   - Build delay log collection system
   - Mandatory fields: Reason (min 20 chars), Attribution (Internal/External categories)
   - Timeline impact calculations
   - Cumulative delay tracking
   - Automatic prompts when dates change

4. **Check-in System Enhancement**
   - Hours spent tracking per task/milestone
   - Blocker reporting with categorization
   - Link check-ins to projects/milestones/tasks

**Phase 2: Dashboard Core (Week 3-4)**
5. **Summary View**
   - Active/Critical/Warning/On Track project counts
   - Weekly activity summary with week-over-week deltas
   - Project category grouping and filtering

6. **Project Health Table**
   - Budget status with burn visualization
   - Timeline status with alignment checking
   - Last activity monitoring
   - Auto-generated red flag system (Critical 🔴 / Warning ⚠️)
   - Sorting, filtering, search, pagination, CSV export

**Phase 3: Project Detail View (Week 5-6)**
7. **Budget Burn Analysis**
   - Project budget summary with burn rate
   - Projected days until budget exhausted
   - Budget vs timeline alignment analysis

8. **Timeline & Delay History** (Critical for client communication)
   - Timeline summary with gap analysis
   - Milestone timeline breakdown
   - **Delay History Timeline** - Chronological view of all delays with reasons and attribution
   - Filter by attribution to show client vs internal delays
   - Summary stats by delay category

9. **Planning Health Indicators**
   - Scope creep tracking (new tasks added post-kickoff)
   - Estimation accuracy (milestone and task level)
   - Pattern analysis by engineer/task type
   - Active milestone/task stagnation detection
   - Repeated blocker identification

10. **CEO Action Panel**
    - Mark blocker resolved
    - Add CEO notes
    - Request updates from project owners
    - Change project status

**Phase 4: Workflows & Automation (Week 7)**
11. **Automated Delay Logging**
    - Detect milestone/project date changes
    - Prompt for reason + attribution (mandatory)
    - Validate input (min 20 chars)
    - Recalculate project end date impact

12. **Stagnation Detection & Alerts**
    - Monitor active milestones for 48h+ inactivity
    - Auto-flag stagnant items
    - Notification system

**Phase 5: Analytics (Week 8)**
13. **Estimation Pattern Analysis**
    - Engineer-specific variance tracking
    - Task type variance analysis
    - Best/worst estimation identification

14. **Delay Analytics**
    - Total delays by attribution
    - Client vs internal delay breakdown
    - Most common delay reasons

---

#### 🔧 BOM & Services System Features

15. **Quotation Parser** - AI-powered PDF quotation parsing and vendor matching (IN PROGRESS)
16. **Advanced Export** - PDF reports, purchase orders
17. **Approval Workflows** - Multi-stage BOM approval process
18. **User Management Testing** - Validate RBAC and permission matrix
19. **Vendor Performance Metrics** - Track vendor reliability, pricing trends, delivery accuracy

### 👥 User Management System Status
🔧 **NEEDS TESTING**: User management system implemented but requires proper testing
- ✅ User Permission System - Admin vs regular user roles implemented
- ✅ User Approval Workflow - Admin approval system implemented
- 🧪 Role-Based Access Control (RBAC) - **NEEDS PROPER TESTING** - Firebase Custom Claims implemented but not fully tested
- ✅ Admin Dashboard - User management functions implemented
- 🧪 Permission Matrix - **NEEDS TESTING** - Project-level and feature-level restrictions need validation

## 🔮 PLANNED FEATURES

### 👥 Advanced User Management
- **Role-Based Access Control (RBAC)**
  - Admin users: Full system access, user management, settings configuration
  - Regular users: Limited access to projects and BOM operations
  - View-only users: Read-only access for stakeholders
- **User Registration Approval**
  - New user requests go to admin approval queue
  - Email notifications for pending approvals
  - Admin dashboard for user management
- **Permission Matrix**
  - Project-level permissions (owner, editor, viewer)
  - Feature-level restrictions (import, export, delete)
  - Settings access control (only admins can modify)

### 📊 Analytics & Reporting (Enhanced by CEO Dashboard)
- ✅ Project cost trends and budget tracking - **Being implemented in CEO Dashboard Phase 1-3**
- ✅ Timeline tracking with delay attribution - **Core feature of CEO Dashboard**
- ✅ Estimation accuracy tracking - **Implemented in CEO Dashboard Phase 3**
- ✅ Project health indicators - **Core feature of CEO Dashboard**
- Vendor performance metrics and scorecards
- User activity logs and audit trails
- Profit/Loss analysis enhancements
- Custom report builder

### 🤖 Intelligent Part Automation (n8n Integration)
- **Automatic Spec Sheet Scraping** - When BOM parts are added, trigger n8n workflows to find and download spec sheets from the internet
- **Backend Trigger System** - Firebase Functions will call n8n workflows for automated data enrichment
- **Part Data Enhancement** - Automatically populate part specifications, dimensions, electrical characteristics
- **Image Scraping** - Find and store product images for visual BOM identification
- **Price Monitoring** - Automated price tracking from supplier websites
- **Availability Checking** - Real-time stock status from vendor APIs via n8n flows

#### n8n Workflow Architecture
- **BOM Part Added Trigger** → Firebase Function → n8n HTTP Request
- **Web Scraping Workflows** → Part number search across manufacturer websites
- **Data Validation** → AI verification of scraped data accuracy
- **Storage Integration** → Automatic file storage in Firebase Storage
- **Update Notifications** → Real-time updates to frontend when data is enriched

### 🔧 Technical Improvements
- Bundle optimization for faster loading
- Enhanced data validation and security
- Improved error handling and user feedback
- Mobile responsiveness enhancements

---

## 🛠️ DEVELOPMENT GUIDELINES

### Code Standards
- Follow existing TypeScript patterns
- Use shadcn-ui components consistently
- Implement proper error boundaries
- Add loading states for async operations

### Testing Requirements
- Unit tests for new components
- Integration tests for Firebase operations
- End-to-end tests for critical workflows
- Performance testing for large data operations

### CEO Dashboard Specific Requirements
- **Data Model First**: Implement complete data models before UI
- **Mandatory Delay Logging**: Cannot save milestone date changes without reason + attribution
- **Real-time Calculations**: All KPIs must calculate in real-time from source data
- **Exception-Based Design**: Surface problems automatically, don't make CEO hunt
- **Historical Transparency**: Never delete delay history, maintain complete audit trail
- **Client-Shareable**: Delay history must be presentable to clients

### Deployment Process
1. Test locally with Firebase emulators
2. Deploy Firebase Functions for backend services
3. Test n8n workflow integrations
4. Deploy to production via Lovable platform

---

## 📋 CEO DASHBOARD DATA REQUIREMENTS

### New Firebase Collections Needed

**1. Milestones Collection**
```typescript
interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  // Planning dates (never change after initial planning)
  originalPlannedStartDate: Date;
  originalPlannedEndDate: Date;
  originalEstimatedDuration: number; // calendar days
  // Current dates (updated when delayed)
  currentPlannedStartDate: Date;
  currentPlannedEndDate: Date;
  // Actual dates
  actualStartDate?: Date;
  actualEndDate?: Date;
  // Status
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  completionPercentage: number;
  // Metadata
  createdAt: Date;
  createdBy: string;
}
```

**2. Delay Logs Collection** (Critical)
```typescript
interface DelayLog {
  id: string;
  projectId: string;
  milestoneId?: string;
  // What changed
  changeType: 'milestone' | 'project';
  itemName: string;
  originalDate: Date;
  newDate: Date;
  delayDays: number;
  // Why it changed (required fields)
  reason: string; // min 20 chars
  attribution: 'Internal-Team' | 'Internal-Process' | 'External-Client' | 'External-Vendor' | 'External-Other';
  supportingNotes?: string;
  // Impact
  cumulativeProjectDelay: number; // total days project delayed
  // Metadata
  loggedAt: Date;
  loggedBy: string;
}
```

**3. Check-ins Collection**
```typescript
interface CheckIn {
  id: string;
  userId: string;
  projectId: string;
  milestoneId?: string;
  taskId?: string;
  // Time tracking
  timestamp: Date;
  hoursSpent: number;
  // Progress
  whatAccomplished: string;
  updatedCompletionPercentage?: number;
  // Blockers
  blockerDescription?: string;
  blockerCategory?: 'Internal-Team' | 'Internal-Process' | 'External-Client' | 'External-Vendor';
}
```

**4. Project Updates** (extend existing Project model)
```typescript
interface Project {
  // ... existing fields ...
  // New fields for CEO Dashboard
  category: 'Internal' | 'Customer';
  kickoffDate: Date;
  originalTargetEndDate: Date; // never changes
  currentTargetEndDate: Date; // updates when delayed
  budgetedAmount: number;
  // Calculated fields (computed in real-time)
  totalSpent?: number; // sum of hours * hourly rates
  budgetPercentConsumed?: number;
  timelinePercentConsumed?: number;
  progressPercentage?: number;
  cumulativeDelayDays?: number;
}
```

**5. CEO Notes Collection**
```typescript
interface CeoNote {
  id: string;
  projectId: string;
  noteText: string;
  createdAt: Date;
  createdBy: string; // CEO user ID
  visibleToProjectOwner: boolean;
}
```

**6. Blockers Collection** (for repeated blocker tracking)
```typescript
interface Blocker {
  id: string;
  projectId: string;
  milestoneId?: string;
  taskId?: string;
  description: string;
  category: 'Internal-Team' | 'Internal-Process' | 'External-Client' | 'External-Vendor';
  firstReportedDate: Date;
  reportCount: number;
  lastReportedDate: Date;
  resolved: boolean;
  resolvedDate?: Date;
  resolutionNote?: string;
}
```

### KPI Calculation Logic

**Budget Burn Rate**
- Daily burn rate = Total spent / Days elapsed
- Projected days until budget exhausted = Budget remaining / Daily burn rate
- Status: Compare projected days to days remaining in timeline

**Timeline Alignment**
- Timeline % = Days elapsed / Total project days
- Progress % = Weighted average of milestone completion
- Gap = Timeline % - Progress %
- Status: Green if gap < 10%, Yellow if 10-25%, Red if > 25%

**Stagnation Detection**
- Active milestone = (Status = "In Progress") OR (Status = "Not Started" AND current date > planned start date)
- Stagnant = Active milestone AND last check-in > 48 hours ago
- Not flagged = Future milestones (planned start date not reached)

**Estimation Variance**
- Milestone variance = (Actual duration - Estimated duration) / Estimated duration * 100%
- Task variance = (Actual hours - Estimated hours) / Estimated hours * 100%
- Color: Green ≤50%, Yellow 50-200%, Red >200%

**Red Flag Logic**
- Critical 🔴: Over budget, missed deadline, no activity >48h on active milestone, budget >90% with >15% timeline remaining
- Warning ⚠️: Falling behind, new tasks added, active milestone stagnant 24-48h, poor estimation >200%, repeated blocker 3+ times, delay not logged

---

*This roadmap serves as the single source of truth for development priorities and feature planning.*