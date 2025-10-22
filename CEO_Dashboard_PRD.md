# CEO Engineering Dashboard - Product Requirements Document (PRD)

## Document Version
- Version: 2.0
- Date: 2025-10-22
- Status: Draft - Phase 1 Detailed
- Owner: CEO

---

## Executive Summary

This dashboard provides the CEO with comprehensive visibility into engineering operations, starting with foundational compliance and time tracking, then building toward advanced project health analytics.

**Phased Approach:**

**Phase 1 (CURRENT PRIORITY): Compliance & Time Tracking**
- Ensure 100% team adoption of daily time logging
- Enable accurate task-level and project-level cost tracking
- Build foundation for all future analytics
- Timeline: 8 weeks

**Phase 2+: Advanced Project Health Analytics**
- Project health monitoring with early warning signals
- Delay history and attribution tracking
- Estimation accuracy analysis
- Root cause visibility for budget/timeline issues
- Timeline: TBD after Phase 1 completion

**Design Philosophy:**
- Foundation first: Get accurate data before building analytics
- Compliance before optimization: Team discipline enables insights
- Exception-based: Surface problems automatically
- Root cause visibility: Not just "what" but "why"
- Actionable: Every metric leads to a specific management action
- Historical transparency: Track delays with reasons for client/CEO review
- Immutable audit trail: Time logs cannot be edited once submitted

---

## Problem Statement

### Current State
- **No systematic time tracking** - Cannot measure true project costs
- **Team doesn't log time consistently** - Data is incomplete or missing
- **No visibility into where time is spent** - CEO cannot see task-level costs
- Team uses inconsistent project planning approaches
- Task granularity varies wildly by project owner
- Estimates are frequently inaccurate (300-1000% variance)
- Scope creep happens without visibility
- CEO learns about problems too late (after budget exhausted or deadline missed)
- No systematic way to track which projects are at risk
- When delays happen, no historical record of why or when issues started
- Clients and CEO only remember recent events, lose track of delay root causes

### Desired State - Phase 1
- **100% daily compliance** - Every team member logs time every day
- **Accurate cost tracking** - CEO can see task-level and project-level costs in real-time
- **ClickUp integration** - Seamless sync with existing project management tool
- **Automated cost allocation** - Proportional distribution based on time logged
- **CEO compliance monitoring** - Instant visibility into who has/hasn't logged time
- **Immutable audit trail** - Once logged, time entries cannot be changed

### Desired State - Phase 2+
- CEO can see all project health in 1-minute scan
- Early warning system flags problems before they become critical
- Clear visibility into why projects go over budget or miss deadlines
- Complete delay history with reasons - shareable with clients
- Track patterns (which engineers estimate poorly, which project types have issues)
- Build team discipline around check-ins, planning, and estimation
- Projects grouped by category (Internal vs Customer projects)

---

## User Personas

### Phase 1 Primary User: Team Members (Engineers, Developers)
- **Needs**: Quick, simple way to log daily time with minimal friction
- **Usage Pattern**: End-of-day time logging (5 minutes per day), occasional mid-day check-ins
- **Technical Skill**: Technical users, comfortable with web interfaces
- **Key Question**: "What did I work on today and how long did it take?"

### Phase 1 Secondary User: CEO
- **Needs**: Real-time compliance monitoring, accurate cost visibility at task/project level
- **Usage Pattern**: Daily compliance check (1 minute), weekly cost review (15 minutes)
- **Technical Skill**: Non-technical, needs simple visual interface
- **Key Question**: "Who has logged time today? Where are we spending money?"

### Phase 2+ Primary User: CEO
- **Needs**: High-level project portfolio health, exception-based alerts, actionable insights, delay history for client discussions
- **Usage Pattern**: Quick daily scan (1 minute), weekly deep dive (15-30 minutes)
- **Technical Skill**: Non-technical, needs simple visual interface
- **Key Question**: "Which projects need my attention and why? What caused these delays?"

### Phase 2+ Secondary Users: Project Owners
- **Needs**: Status of own projects, understand what CEO sees
- **Usage Pattern**: Weekly review before CEO meetings
- **Key Question**: "Is my project flagged as at-risk?"

### Phase 2+ Tertiary Users: Clients
- **Needs**: Understand why their project is delayed
- **Usage Pattern**: Occasional review when CEO shares project status
- **Key Question**: "Why is my project late and was it our fault or yours?"

---

## Goals & Success Criteria

### Phase 1 Goals
1. **100% daily compliance** - Every team member logs time every day
2. **Accurate cost tracking** - CEO can see task-level and project-level costs
3. **System adoption** - Dashboard becomes the single source of truth for time/cost data
4. **Accountability** - Immutable time logs create audit trail
5. **Simplicity** - Workflow takes < 5 minutes per day

### Phase 1 Success Criteria (30 days post-launch)
- ✅ **>95% daily compliance** - Team logs time 6-7 days per week
- ✅ **100% task coverage** - All work hours logged against ClickUp tasks
- ✅ **Minimum 7H logged daily** - Work + Leave ≥ 7 hours
- ✅ **CEO visibility** - Real-time view of who has/hasn't logged time
- ✅ **Cost accuracy** - Task-level costs available for all logged time

### Phase 2+ Goals
1. Provide CEO with **1-minute project health snapshot**
2. Surface at-risk projects automatically (no manual hunting)
3. Build team discipline around check-ins, planning, and estimation
4. Enable root cause analysis for budget/timeline issues
5. **Maintain historical delay timeline with attributions for client/CEO transparency**
6. Track improvement over time (estimation accuracy, on-time delivery)
7. Group projects by category (Internal/Customer) for better organization

### Phase 2+ Success Criteria (6 months post-Phase 2 launch)
- 30% reduction in project budget overruns
- 25% reduction in project timeline delays
- Estimation variance improves from >400% to <150%
- **>95% of delays have documented reasons and attribution**
- Check-in compliance maintained at >90% across team

---

# PHASE 1: COMPLIANCE & TIME TRACKING (HIGHEST PRIORITY)

## Phase 1 Overview

**Priority:** HIGHEST - Must be completed before Phase 2+ features

**Goal:** Ensure 100% team adoption of daily time logging to enable accurate project cost tracking at task-level granularity.

**Core Problem:**
- Without accurate time tracking, CEO cannot measure true project costs
- Team members must build habit of daily check-ins
- Every hour of work must be accounted for (no "untracked" time)

**Scope:**
- Daily time logging workflow
- ClickUp task integration
- Automatic cost allocation
- Compliance monitoring
- Leave tracking

**Timeline:** 8 weeks total
- Weeks 1-2: Core time logging functionality
- Weeks 3-4: Automation & cost tracking
- Weeks 5-6: CEO dashboards & polish
- Weeks 7-8: Testing & refinement

**Out of Scope for Phase 1:**
- Project creation/editing (ClickUp is source of truth)
- Subtask hierarchy management
- Historical data import
- Advanced reporting and analytics
- Mobile app
- Notifications/reminders
- Time log editing/deletion (immutable by design)

---

## Phase 1 Core Principles

1. **Every hour must be accounted for** - Work OR Leave, no exceptions
2. **ClickUp is source of truth** for projects and tasks
3. **Dashboard is source of truth** for time logs and costs
4. **Immutable logs** - Once submitted, cannot be edited (ensures integrity)
5. **Proportional cost allocation** - Daily cost distributed by time percentage
6. **Hard blocks over soft warnings** - Prevent invalid submissions rather than allowing with warnings
7. **Minimal friction** - Fetch data on-demand, allow multiple submissions per day

---

## Phase 1 User Workflows

### Workflow 1: Standard End-of-Day Time Logging

**Trigger:** User has worked during the day and needs to log time

**Steps:**

1. **User opens dashboard** (end of day or mid-day)

2. **System fetches from ClickUp** (on-demand):
   - All projects (no local project creation allowed)
   - All tasks with status in: TODO, In Progress, In Review, Testing, Blocked
   - For each task: Name, Status, Due Date, Last 10 comments
   - Tasks are grouped by project

3. **User selects task(s)** worked on today

4. **For each task, user enters:**
   - Hours spent (decimal format: 1.5, 2.25, etc.)
   - Comments/updates (mandatory): What was accomplished
   - System validates:
     - ✅ Comments ≥ 20 characters minimum
     - ✅ Comments contain meaningful text (AI validation, not gibberish like "asdfasdf")
     - ✅ Hours > 0
     - ✅ Task has due date (if not, HARD BLOCK - see Workflow 3)

5. **System shows running total** of hours logged for the day
   - Display: "Total logged today: 6.5H (Need 0.5H more to reach 7H minimum)"

6. **User clicks "Submit" when done**

7. **System validates total hours:**
   - If Work Hours + Leave Hours ≥ 7H → ✅ Accept submission
   - If Work Hours + Leave Hours < 7H → ❌ Block submission, prompt: "You must add Leave to make up the shortfall"

8. **System processes submission:**
   - Store time logs in Firebase (immutable)
   - For each task logged:
     - If task status = TODO → Auto-activate task (see Workflow 2)
     - If task has no start date → Set start date = today
   - Calculate proportional cost allocation
   - Update daily compliance status

9. **System displays confirmation:**
   - "Time logged successfully! Total: 8H across 3 tasks"
   - Show breakdown:
     - Project A, Task 1: 4H (50% of day)
     - Project A, Task 2: 2H (25% of day)
     - Project B, Task 3: 2H (25% of day)

10. **User can view all logs** for the day/week in the dashboard

---

### Workflow 2: Automatic Task Activation

**Trigger:** User logs time against a task with status = "TODO"

**System Behavior:**

1. **Detect TODO task** being logged
2. **Update task in ClickUp via API:**
   - Change status: "TODO" → "In Progress"
   - Set start date = today (if not already set)
3. **Store activation record** in Firebase:
   - Task ID
   - Activated by: User ID
   - Activated on: Date
   - Reason: Time logged
4. **Display confirmation** to user:
   - "Task 'Setup Database Schema' has been activated and start date set to Oct 22, 2025"

---

### Workflow 3: Task Without Due Date (Hard Block)

**Trigger:** User attempts to log time against task without due date

**Steps:**

1. **User selects task** and enters hours/comments

2. **System validates task** before allowing submission

3. **System detects missing due date** → Show error:
   ```
   ❌ Cannot log time: Task has no due date

   Task: "Setup Database Schema"

   Please add a due date in ClickUp before logging time.
   This is required for delay tracking and compliance.

   [Open Task in ClickUp] [Cancel]
   ```

4. **User clicks "Open Task in ClickUp"** → Opens task in new tab

5. **User adds due date in ClickUp**

6. **User returns to dashboard**, clicks "Refresh Tasks" button

7. **System re-fetches tasks from ClickUp** (with updated due date)

8. **User can now log time** against the task

---

### Workflow 4: Adding Leave

**Trigger:** User has shortfall in work hours and needs to add leave

**Steps:**

1. **User logs work hours** (e.g., 6H across tasks)

2. **User clicks "Add Leave" button**

3. **System shows leave entry form:**
   - Date: Oct 22, 2025 (Auto-filled, read-only)
   - Hours: [Dropdown: 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, ...]
   - Leave Type: [Dropdown: Sick Leave, Vacation, Personal, Casual, Other]
   - Reason/Notes: [Optional text field]

4. **User fills:**
   - Hours: 2
   - Leave Type: Sick Leave
   - Reason: "Doctor appointment"

5. **System validates:**
   - ✅ Hours > 0
   - ✅ Leave type selected

6. **System stores leave entry** in Firebase

7. **System updates running total:**
   - "Total logged today: 8H (6H work + 2H leave)"

8. **Leave is included in cost allocation** (proportional to hours)

---

### Workflow 5: CEO Compliance Monitoring

**Trigger:** CEO wants to check who has/hasn't logged time

**Steps:**

1. **CEO opens "Compliance Dashboard"** section

2. **System displays daily compliance view:**
   ```
   Daily Compliance - Oct 22, 2025

   ✅ Rahul Kumar - 8H logged (6H work + 2H leave)
       Last log: Today at 6:45 PM
       Projects: BOM Tracker (4H, 50%), Client Portal (2H, 25%)
       Cost: ₹5,000 distributed

   ✅ Priya Singh - 7H logged (7H work)
       Last log: Today at 5:30 PM
       Projects: BOM Tracker (5H, 71%), Internal (2H, 29%)

   ⚠️ Amit Patel - 4H logged (in progress)
       Last log: Today at 2:15 PM
       Projects: BOM Tracker (4H)
       Status: Needs to log 3H more

   ❌ Ravi Sharma - Not logged yet
       Last log: Oct 21 at 6:00 PM
   ```

3. **System displays weekly compliance summary:**
   ```
   Weekly Compliance - Oct 16-22, 2025

   ✅ Rahul Kumar - 7/7 days logged (100%)
   ✅ Priya Singh - 7/7 days logged (100%)
   ⚠️ Amit Patel - 6/7 days logged (86%)
   ❌ Ravi Sharma - 3/7 days logged (43%)
   ```

4. **CEO can filter by:**
   - Compliance status (All / Compliant / Non-Compliant)
   - Date range
   - Team member

---

### Workflow 6: CEO Cost Tracking (Task & Project Level)

**Trigger:** CEO wants to see costs for projects/tasks

**Steps:**

1. **CEO navigates to "Cost Tracking"** section

2. **System displays project-level costs:**
   ```
   Project Costs - This Week (Oct 16-22, 2025)

   Project Name       | Total Hours | Total Cost | % of Total
   -------------------|-------------|------------|------------
   BOM Tracker        | 120H        | ₹75,000    | 45%
   Client Portal      | 80H         | ₹50,000    | 30%
   Internal Projects  | 40H         | ₹25,000    | 15%
   Leave              | 16H         | ₹10,000    | 10%
   ```

3. **CEO can drill down into project** → See task-level costs:
   ```
   BOM Tracker - Task Costs (This Week)

   Task Name              | Total Hours | Total Cost | Status
   -----------------------|-------------|------------|------------
   Setup Database Schema  | 24H         | ₹15,000    | In Progress
   API Integration        | 18H         | ₹11,250    | In Progress
   Bug Fix #123           | 12H         | ₹7,500     | Completed
   ```

4. **CEO can filter by:**
   - Date range (This Week / This Month / Custom)
   - Project
   - Team member

---

## Phase 1 System Behavior & Automation Rules

### Rule 1: Task Fetching
- Fetch tasks from ClickUp **on-demand** when user opens dashboard
- Show tasks with status: TODO, In Progress, In Review, Testing, Blocked
- Hide tasks with status: Completed, Cancelled, Not Started
- Group tasks by project
- Display last 10 comments per task (popup/tooltip)

### Rule 2: Task Activation
- When user logs time against TODO task:
  - Update ClickUp status: TODO → In Progress
  - Set start date = today (if not set)
  - Record activation in Firebase

### Rule 3: Start Date Setting
- If task has no start date when first time is logged:
  - Set start date = today (date of time log submission)
- Do NOT backdate start date to previous days

### Rule 4: Due Date Requirement
- **Hard Block:** Cannot log time against task without due date
- User must add due date in ClickUp first
- System checks due date before allowing time log submission

### Rule 5: Multiple Logs Per Day
- User can submit multiple time logs throughout the day
- All logs are additive
- Dashboard shows all individual logs for the day/week
- Running total updates with each submission

### Rule 6: Immutable Logs
- Once submitted, time logs CANNOT be edited or deleted
- Ensures data integrity and audit trail
- If user makes mistake, must contact admin/CEO for correction (manual process)

### Rule 7: Cost Calculation
- Daily cost per user fetched from Google Spreadsheet (external source)
- Cost distributed proportionally across ALL logged hours (work + leave)
- Calculated at:
  - Task level: (hours on task / total hours) × daily cost
  - Project level: Sum of task costs for that project
- Updated real-time with each time log submission

### Rule 8: Compliance Check
- Daily minimum: 7H (work + leave)
- System blocks submission if < 7H and prompts to add leave
- Compliance status calculated at end of each day:
  - ✅ Compliant: Work + Leave ≥ 7H
  - ⚠️ Partial: Some hours logged but < 7H total (shouldn't happen due to hard block)
  - ❌ Non-Compliant: No time logged for the day

---

## Phase 1 Validation & Compliance Rules

### Time Log Validation

| Field | Validation Rule | Error Message |
|-------|----------------|---------------|
| Hours | Must be > 0 | "Hours must be greater than 0" |
| Hours | Must be decimal (e.g., 1.5, 2.25) | "Enter hours in decimal format (e.g., 1.5)" |
| Comments | Minimum 20 characters | "Comments must be at least 20 characters" |
| Comments | AI check for meaningful text | "Please enter meaningful comments (not random characters)" |
| Task Due Date | Must exist in ClickUp | "Task has no due date. Please add due date in ClickUp first." |
| Daily Total | Work + Leave ≥ 7H | "You must log at least 7 hours total. Add leave to make up the shortfall." |

### Leave Entry Validation

| Field | Validation Rule | Error Message |
|-------|----------------|---------------|
| Hours | Must be > 0 | "Hours must be greater than 0" |
| Leave Type | Must be selected | "Please select a leave type" |
| Reason/Notes | Optional | N/A |

### Comments AI Validation

**Purpose:** Ensure meaningful updates, not gibberish

**Method:**
- Use simple AI check (GPT-4 or similar)
- Prompt: "Is this a meaningful work update or gibberish? Reply with YES or NO. Text: {user_comment}"
- If NO → Block submission with error: "Please enter meaningful comments describing what you accomplished"

**Examples:**
- ✅ Valid: "Implemented user authentication API with JWT tokens"
- ✅ Valid: "Fixed database connection timeout issue in production"
- ✅ Valid: "Reviewed PR and provided feedback on code structure"
- ❌ Invalid: "asdfasdf"
- ❌ Invalid: "work done"
- ❌ Invalid: "............"

---

## Phase 1 Cost Calculation Logic

### Proportional Distribution Formula

**Given:**
- User's daily cost: `D` (fetched from Google Spreadsheet)
- Total hours logged for the day: `H_total` (work + leave)
- Hours logged on Task `i`: `H_i`

**Task Cost Calculation:**
```
Cost_i = (H_i / H_total) × D
```

**Project Cost Calculation:**
```
Cost_project = Σ Cost_i for all tasks in project
```

### Example 1: Single Project, Multiple Tasks

**User:** Rahul Kumar
**Daily Cost:** ₹5,000
**Time Logged:**
- Task A (BOM Tracker): 4H
- Task B (BOM Tracker): 2H
- Task C (BOM Tracker): 2H
- **Total:** 8H

**Cost Distribution:**
- Task A: (4H / 8H) × ₹5,000 = 50% × ₹5,000 = **₹2,500**
- Task B: (2H / 8H) × ₹5,000 = 25% × ₹5,000 = **₹1,250**
- Task C: (2H / 8H) × ₹5,000 = 25% × ₹5,000 = **₹1,250**
- **Project Total:** ₹5,000 (100% on BOM Tracker)

### Example 2: Multiple Projects, Multiple Tasks

**User:** Priya Singh
**Daily Cost:** ₹6,000
**Time Logged:**
- Task A (BOM Tracker): 3H
- Task B (BOM Tracker): 1H
- Task C (Client Portal): 2H
- **Total:** 6H

**Cost Distribution:**
- Task A: (3H / 6H) × ₹6,000 = 50% × ₹6,000 = **₹3,000**
- Task B: (1H / 6H) × ₹6,000 = 16.7% × ₹6,000 = **₹1,000**
- Task C: (2H / 6H) × ₹6,000 = 33.3% × ₹6,000 = **₹2,000**

**Project Totals:**
- BOM Tracker: ₹3,000 + ₹1,000 = **₹4,000 (66.7%)**
- Client Portal: **₹2,000 (33.3%)**

### Example 3: Work + Leave

**User:** Amit Patel
**Daily Cost:** ₹5,500
**Time Logged:**
- Task A (BOM Tracker): 4H
- Task B (Internal): 2H
- Leave (Sick): 2H
- **Total:** 8H

**Cost Distribution:**
- Task A: (4H / 8H) × ₹5,500 = 50% × ₹5,500 = **₹2,750**
- Task B: (2H / 8H) × ₹5,500 = 25% × ₹5,500 = **₹1,375**
- Leave: (2H / 8H) × ₹5,500 = 25% × ₹5,500 = **₹1,375**

**Project Totals:**
- BOM Tracker: **₹2,750 (50%)**
- Internal: **₹1,375 (25%)**
- Leave: **₹1,375 (25%)** ← Tracked separately in "Leave/Overhead" category

---

## Phase 1 ClickUp Integration Specifications

### API Endpoints Required

**1. Fetch Projects**
- Endpoint: `GET /team/{team_id}/space`
- Purpose: Get all active projects
- When: On user dashboard load
- Filter: Only active projects

**2. Fetch Tasks**
- Endpoint: `GET /list/{list_id}/task` or `GET /team/{team_id}/task`
- Purpose: Get all tasks for display
- When: On user dashboard load
- Filter: Status IN (TODO, In Progress, In Review, Testing, Blocked)

**3. Fetch Task Comments**
- Endpoint: `GET /task/{task_id}/comment`
- Purpose: Display context for user
- When: On user click/hover (lazy load)
- Limit: Last 10 comments

**4. Update Task Status**
- Endpoint: `PUT /task/{task_id}`
- Purpose: Auto-activate TODO tasks
- When: User logs time against TODO task
- Payload: `{"status": "In Progress"}`

**5. Update Task Start Date**
- Endpoint: `PUT /task/{task_id}`
- Purpose: Set start date on first time log
- When: User logs time against task with no start date
- Payload: `{"start_date": "2025-10-22"}`

### ClickUp Sync Strategy

**Sync Method:** On-demand (not periodic background sync)

**Reason:**
- Simpler implementation
- Reduces API rate limit issues
- User sees fresh data when they need it
- No stale data issues

**Refresh Triggers:**
- User opens dashboard
- User clicks "Refresh Tasks" button
- After updating task in ClickUp and returning to dashboard

**Rate Limiting:** ClickUp allows 100 requests per minute - batch requests where possible

---

## Phase 1 Firebase Collections

### Collection 1: Users

```typescript
interface User {
  id: string; // Firebase Auth UID
  email: string;
  name: string;
  clickupUserId: string; // For mapping to ClickUp
  dailyRate: number; // Fetched from Google Spreadsheet, cached here
  role: 'admin' | 'user' | 'ceo';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Collection 2: Projects (Synced from ClickUp)

```typescript
interface Project {
  id: string; // ClickUp Project/List ID
  name: string;
  clickupId: string;
  status: 'Active' | 'Archived';
  lastSyncedAt: Date;
}
```
**Note:** Read-only from ClickUp, no local creation/editing

### Collection 3: Tasks (Synced from ClickUp)

```typescript
interface Task {
  id: string; // ClickUp Task ID
  clickupId: string;
  name: string;
  projectId: string; // Reference to Projects collection
  status: string; // ClickUp status
  dueDate?: Date;
  startDate?: Date;
  assignees: string[];
  lastSyncedAt: Date;
}
```
**Note:** Read-only from ClickUp (except status and startDate updates)

### Collection 4: TimeLogs

```typescript
interface TimeLog {
  id: string;
  userId: string;
  date: Date; // Which day (YYYY-MM-DD)
  taskId: string;
  projectId: string;
  hoursLogged: number;
  comments: string; // What was accomplished

  // Cost calculations
  percentageOfDay: number; // hoursLogged / totalHoursForDay
  costAllocated: number; // percentageOfDay × userDailyRate

  // Metadata
  loggedAt: Date; // Timestamp of submission
  taskWasActivated: boolean;
  startDateUpdated: boolean;

  // Immutability
  canEdit: boolean; // Always false
  canDelete: boolean; // Always false
}
```

### Collection 5: LeaveEntries

```typescript
interface LeaveEntry {
  id: string;
  userId: string;
  date: Date; // YYYY-MM-DD
  hours: number;
  leaveType: 'Sick Leave' | 'Vacation' | 'Personal' | 'Casual' | 'Other';
  reason?: string;

  // Cost calculations
  percentageOfDay: number;
  costAllocated: number;

  // Metadata
  loggedAt: Date;
  canEdit: boolean; // Always false
  canDelete: boolean; // Always false
}
```

### Collection 6: DailyCompliance (Aggregated)

```typescript
interface DailyCompliance {
  id: string; // Format: {userId}_{YYYY-MM-DD}
  userId: string;
  date: Date;

  // Hours breakdown
  totalWorkHours: number;
  totalLeaveHours: number;
  totalHours: number;

  // Compliance
  meetsMinimum: boolean; // totalHours >= 7
  complianceStatus: 'Compliant' | 'Partial' | 'Non-Compliant';

  // Cost tracking
  dailyRate: number;
  totalCostDistributed: number;

  // Metadata
  lastLogAt: Date;
  logCount: number;
  calculatedAt: Date;
}
```

### Collection 7: ProjectCosts (Aggregated)

```typescript
interface ProjectCost {
  id: string; // Format: {projectId}_{period}_{date}
  projectId: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate: Date;
  endDate: Date;

  totalHours: number;
  totalCost: number;
  percentageOfTotal: number;

  userContributions: {
    userId: string;
    hours: number;
    cost: number;
  }[];

  lastUpdated: Date;
}
```

### Collection 8: TaskCosts (Aggregated)

```typescript
interface TaskCost {
  id: string; // Format: {taskId}_{period}_{date}
  taskId: string;
  projectId: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate: Date;
  endDate: Date;

  totalHours: number;
  totalCost: number;

  userContributions: {
    userId: string;
    hours: number;
    cost: number;
  }[];

  lastUpdated: Date;
}
```

---

## Phase 1 Google Spreadsheet Integration

**Purpose:** Fetch user daily rates (employee cost per day)

**Spreadsheet Structure:**
```
| User Email          | Daily Rate | Effective Date |
|---------------------|------------|----------------|
| rahul@company.com   | 5000       | 2025-01-01     |
| priya@company.com   | 6000       | 2025-01-01     |
| amit@company.com    | 5500       | 2025-01-01     |
```

**Sync Strategy:**
- Fetch on user dashboard load
- Cache in Firebase Users collection
- Refresh once per day (background job)

**API:** Google Sheets API v4

---

## Phase 1 Implementation Priority

### Phase 1A: Core Time Logging (Week 1-2)
1. ClickUp integration (fetch projects, tasks)
2. User time logging UI
3. Basic validation (hours > 0, comments min length)
4. Firebase data storage (TimeLogs collection)
5. Leave entry functionality

### Phase 1B: Automation & Cost Tracking (Week 3-4)
6. Auto-activate TODO tasks
7. Cost calculation logic
8. Google Spreadsheet integration (daily rates)
9. Daily compliance aggregation
10. CEO compliance dashboard (basic view)

### Phase 1C: CEO Dashboards & Polish (Week 5-6)
11. CEO cost tracking dashboard
12. Project/task cost drill-down
13. Weekly compliance summary
14. Comments AI validation
15. ClickUp comments display
16. Hard block for tasks without due date

### Phase 1D: Testing & Refinement (Week 7-8)
17. End-to-end testing
18. Performance optimization
19. Bug fixes
20. User training and onboarding
21. Documentation

---

# PHASE 2+: CEO PROJECT HEALTH DASHBOARD

**Note:** The following requirements are for Phase 2 and beyond. They depend on Phase 1 time tracking data being available and accurate.

---

## Phase 2+ Dashboard Requirements

## Section 1: Summary View

### Purpose
Quick snapshot of overall engineering portfolio health (for 1-minute scan)

### Requirements

**R1.1: Project Category Grouping**
- Group projects by category:
  - Customer Projects
  - Internal Projects
- Display counts per category
- Allow filtering by category
- Default view: Show all categories

**R1.2: Active Projects Count**
- Display total number of active projects (across all categories)
- Display count per category

**R1.3: Critical Projects Count**
- Display count of projects with critical issues (over budget, missed deadline, no activity >48h on active milestone)
- Color: Red background when count > 0
- Clickable: Filter table to show only critical projects

**R1.4: Warning Projects Count**
- Display count of projects with warning flags (falling behind, 90% budget consumed, active milestone stagnant)
- Color: Yellow/amber background when count > 0
- Clickable: Filter table to show only warning projects

**R1.5: On Track Projects Count**
- Display count of projects with no flags
- Color: Green background

**R1.6: Weekly Activity Summary with Delta**
- Show key metrics for the week WITH comparison to previous week:

**Format:**
```
This Week (vs Last Week):
• New tasks added: 12 across 5 projects (+3 from last week)
• Stagnant projects: 2 (-1 from last week) ✓
• Budget overruns: 2 (no change)
• Delays logged: 4 days total across 3 projects (+7 days from last week) ⚠️
```

**Metrics:**
- **New tasks added**: Count this week vs last week, show delta
- **Stagnant projects**: Count this week vs last week, show delta
- **Budget overruns**: Count this week vs last week, show delta
- **Delays logged**: Total days of delay logged this week vs last week, show delta
- **Check-in updates**: Total check-ins submitted this week vs last week

**Delta Indicators:**
- Green ✓ for improvements (fewer stagnant projects, fewer delays)
- Red ⚠️ for deterioration (more delays, more overruns)
- No indicator for neutral changes

---

## Section 2: Project Health Table

### Purpose
Main view showing all active projects with key health indicators

### Requirements

**R2.1: Project Column**
- Display project name
- Display project category badge (Internal/Customer)
- Clickable to open detailed view
- Sortable alphabetically

**R2.2: Owner Column**
- Display project owner's name
- Sortable alphabetically

**R2.3: Budget Status Column**
- Display: "Actual Spent / Budgeted Amount (% consumed)"
  - Example: "₹8L / ₹10L (80%)"
- Visual progress bar showing % consumed
- Color coding:
  - Green: 0-75%
  - Yellow: 76-90%
  - Red: 91-100%
  - Dark Red: >100%
- Sortable by % consumed
- Clickable to open detail view at budget section

**R2.4: Timeline Status Column**
- Display: "Days Elapsed / Total Days (% timeline consumed)"
  - Example: "45d / 60d (75%)"
- Visual progress bar showing % timeline consumed
- Color coding based on timeline vs completion alignment:
  - Green: On pace or ahead
  - Yellow: Falling behind by 10-25%
  - Red: Falling behind by >25% or past deadline
- Sortable by % timeline consumed
- Clickable to open detail view at timeline section

**R2.5: Last Activity Column**
- Display time since last check-in for this project
  - Examples: "2 hours ago", "Yesterday at 3:15 PM", "3 days ago"
- Color coding:
  - Green: < 8 hours
  - Yellow: 8-24 hours
  - Red: > 24 hours
- Warning icon (⚠️) if >24 hours
- Critical icon (🔴) if >48 hours
- Sortable by most recent activity

**R2.6: Red Flags Column**
- Display auto-generated alerts for project issues
- Maximum 3 flags shown in table, with "... +X more" if additional flags exist
- Flag types (priority order):
  - 🔴 Critical: Over budget, missed deadline, no activity >48h on active milestone
  - ⚠️ Warning: Falling behind schedule, new tasks added, active milestone stagnant, poor estimation, repeated blocker, 90% budget consumed, delay not logged
- Each flag shows brief description
- Sortable by flag severity (critical first)

**R2.7: Table Features**
- **Sorting**: All columns sortable, default sort by flag severity
- **Filtering**:
  - By project category (All/Customer/Internal)
  - By status (All/Critical/Warning/On Track)
  - By project status (Active/Completed/On Hold)
- **Search**: Text search by project name or owner name
- **Pagination**: 10/25/50/All options
- **Export**: Export current view to CSV
- **Manual Refresh**: Button to manually refresh dashboard data

---

## Section 3: Project Detail View

### Purpose
Deep dive into single project to understand root causes of issues and historical delay timeline

### Trigger
Click on project name in main table

### Display Format
Modal overlay or slide-in panel (right side, 70% screen width)

---

### Section 3.1: Budget Burn Analysis

**R3.1.1: Project Budget Summary**
- Display:
  - Total project budget
  - Amount spent to date
  - Amount remaining
  - Daily/weekly burn rate
  - Projected days until budget exhausted
  - Comparison: Days until budget exhausted vs days until target deadline

**R3.1.2: Budget Status**
- Simple indicator:
  - Green: Under budget and on track
  - Yellow: >90% budget consumed
  - Red: Over budget
- Show variance: Amount over/under budget

**Note:** Milestone-level budget tracking is NOT included in Phase 1. Only project-level budget tracking.

---

### Section 3.2: Timeline Tracking & Delay History

**R3.2.1: Timeline Summary**
- Display:
  - Project start date
  - Original target end date
  - Current target end date (if changed)
  - Current date
  - Days elapsed (and % of total timeline)
  - Days remaining
  - Overall progress % (weighted average of milestone completion)
  - Status: On track / Falling behind / Ahead / Past deadline
  - Gap: Difference between timeline % and progress %
  - **Total cumulative delay: X days**

**R3.2.2: Milestone Timeline Breakdown**
- For each milestone, display:
  - Milestone name
  - Planned start and end dates
  - Current planned end date (if changed from original)
  - Actual start and end dates (if started/completed)
  - Progress % (for in-progress milestones)
  - Status (Not Started/In Progress/Completed/Blocked)
  - Days variance (current vs original plan)
  - **Delay attribution (if delayed): Internal-Team / Internal-Process / External-Client / External-Vendor / External-Other**
  - **Delay reason (free text explanation)**
  - Current blocker (if any)
- For in-progress milestones:
  - Projected end date based on current progress rate
  - Projected delay

**R3.2.3: Delay History Timeline (Critical Requirement)**

**Purpose:** Provide chronological history of all delays for CEO/client review

**Display Format:** Timeline view showing when delays occurred and why

**Example:**
```
Delay History for ITC Vision System Project

Original Target End Date: Mar 1, 2025
Current Target End Date: Mar 22, 2025
Total Delay: 21 days

Timeline of Changes:

Jan 15, 2025 - "Setup & Planning" milestone delayed
  Original target: Jan 10 → New target: Jan 15
  Delay: +5 days
  Reason: "Client delayed requirements sign-off by 1 week. We sent requirements
          document on Jan 3, client scheduled review meeting for Jan 12,
          final approval received Jan 14."
  Attribution: External - Client
  Logged by: Rahul Kumar
  Impact: Project end date → Mar 6, 2025 (+5 days)

Feb 8, 2025 - "Hardware Integration" milestone delayed
  Original target: Feb 20 → New target: Feb 28
  Delay: +8 days
  Reason: "Camera mounting brackets required custom fabrication not in original
          scope. Client requested higher precision mounts after seeing prototype
          on Jan 28. Custom brackets ordered Feb 1, delivery delayed to Feb 10."
  Attribution: External - Client scope change
  Logged by: Rahul Kumar
  Impact: Project end date → Mar 14, 2025 (+13 days total)

Feb 20, 2025 - "Hardware Integration" milestone delayed again
  Previous target: Feb 28 → New target: Mar 7
  Additional delay: +7 days
  Reason: "Engineer underestimated cable routing complexity in tight spaces.
          Original estimate was 8 hours, actual took 30 hours. Required custom
          cable lengths and multiple iterations to achieve clean routing."
  Attribution: Internal - Team (poor estimation)
  Logged by: Rahul Kumar
  Impact: Project end date → Mar 21, 2025 (+20 days total)

Feb 25, 2025 - "Testing & Deployment" milestone delayed
  Original target: Mar 1 → New target: Mar 22
  Delay: +21 days
  Reason: "Client site not ready for installation. HVAC and electrical work
          delayed by 3 weeks due to contractor scheduling issues on client side."
  Attribution: External - Client dependency
  Logged by: Rahul Kumar
  Impact: Project end date → Mar 22, 2025 (+21 days total)
```

**R3.2.3.1: Delay Entry Requirements**
Each delay entry must capture:
- Date delay was identified/logged
- What changed (milestone name, original date, new date)
- Delay amount (days)
- Reason (free text, required, minimum 20 characters)
- Attribution category (required):
  - Internal - Team (poor estimation, skill gaps, resource issues)
  - Internal - Process (lack of planning, scope not defined)
  - External - Client (delayed approvals, site not ready, scope changes)
  - External - Vendor (parts delayed, third-party service delays)
  - External - Other (weather, regulatory, unforeseen)
- Who logged it (auto-captured)
- Cumulative impact on project end date

**R3.2.3.2: Delay History Filtering & Views**
- View all delays (chronological)
- Filter by attribution (show only client-caused delays, only internal delays)
- Filter by milestone
- Summary view showing total delays by attribution category

**R3.2.3.3: Delay Summary Stats**
- Total project delay: X days
- Breakdown by attribution:
  - Client-caused delays: X days (Y%)
  - Vendor-caused delays: X days (Y%)
  - Internal delays: X days (Y%)
- Most common delay reason category
- Average delay per milestone

**R3.2.4: Timeline Alerts**
- Highlight milestones that finished late
- Highlight milestones projected to finish late
- Flag active milestones not started with <20% timeline remaining
- Show compounding delays (each milestone slipping further)
- **Alert if milestone delayed but no reason logged**

**R3.2.5: Mandatory Delay Logging**
- System detects when:
  - Milestone end date is changed
  - Milestone completes past planned end date
  - Project target end date is changed
- Triggers prompt to project owner: "This milestone/project is delayed. Please provide reason and attribution."
- Cannot save change without entering reason (minimum 20 characters) and attribution

---

### Section 3.3: Planning Health Indicators

**R3.3.1: Scope Creep / New Tasks Added**
- Display all tasks/milestones added after project kickoff
- For each new item, show:
  - Name
  - Date added
  - Who added it
  - Reason for addition
  - Estimated hours/days (if provided)
  - Timeline impact (if logged)
- Summary stats:
  - Total new items added
  - Total estimated hours added
  - Total timeline impact
  - Items missing reason/justification

**R3.3.2: Estimation Accuracy**

**Purpose:** Track estimation accuracy at both milestone and task levels

**R3.3.2a: Milestone-Level Estimation Accuracy**
- Display all completed milestones with original time estimates
- For each milestone, show:
  - Milestone name
  - Original estimated duration (calendar days, set during planning)
  - Actual duration (calendar days from start to completion)
  - Variance (% difference)
  - Who estimated (project owner)
  - Who worked on it (team members)
- Color coding:
  - Green: Variance ≤50%
  - Yellow: Variance 50-200%
  - Red: Variance >200%

**R3.3.2b: Task-Level Estimation Accuracy**
- Display all completed tasks with estimates
- For each task, show:
  - Task name
  - Estimated hours
  - Actual hours (sum of check-in hours for this task)
  - Variance (% difference)
  - Who estimated
  - Who completed it
  - Parent milestone
- Color coding:
  - Green: Variance ≤50%
  - Yellow: Variance 50-200%
  - Red: Variance >200%

**R3.3.2c: Estimation Pattern Analysis**
- Summary stats:
  - Average variance for milestones
  - Average variance for tasks
  - Worst estimates (highest variance)
  - Best estimates (lowest variance)
  - Engineer/owner with highest/lowest average variance
- Pattern breakdown:
  - By engineer (who estimates well, who doesn't)
  - By task type (hardware/software/documentation/testing)
  - By milestone type

**Note:** Initial planning vs mid-project differentiation is OUT OF SCOPE for Phase 1.

**R3.3.3: Stagnant Milestones/Tasks**

**Purpose:** Flag only ACTIVE work that has stalled, not future work

**R3.3.3a: Active Milestone Stagnation**
- Flag milestones that are:
  - Status = "In Progress" OR
  - Status = "Not Started" AND current date > planned start date
- AND:
  - No check-ins logged for >48 hours

**Stagnation Rules:**
- **Active milestone** = In Progress OR (Not Started AND current date > planned start date)
- **Stagnant** = Last check-in >48 hours ago for active milestones
- **Not flagged** = Future milestones (planned start date not yet reached)

**Display for each stagnant active milestone:**
- Milestone name
- Status (In Progress X% / Not Started but overdue)
- Planned start date
- Days overdue (if not started and past planned start date)
- Last activity date
- Last check-in note
- Days since last activity
- Alert severity:
  - 🔴 Critical: >7 days stagnant OR not started and >7 days past planned start date
  - ⚠️ Warning: 2-7 days stagnant OR not started and 2-7 days past planned start date

**R3.3.3b: Active Task Stagnation**
- Same logic as milestones
- Flag tasks that are:
  - Status = "In Progress" OR
  - Status = "Not Started" AND expected start has passed
- AND:
  - No check-ins logged for >48 hours

**R3.3.3c: Stagnation Summary**
- Total active milestones stagnant: X
- Total active tasks stagnant: Y
- Longest stagnant item: "Milestone ABC" (14 days)
- Team member with most stagnant items

**R3.3.4: Repeated Blockers**
- Identify blockers mentioned in 3+ check-ins over 3+ days
- For each repeated blocker, display:
  - Blocker description
  - First reported date
  - Number of times reported
  - Days unresolved
  - Who is blocked
  - Related milestone/task
  - Attribution category (Internal/External/Client/Vendor)
  - Suggested action (e.g., "Escalate to client")
- Color coding:
  - Red: >5 days unresolved or >5 occurrences
  - Yellow: 3-5 days unresolved or 3-5 occurrences

---

### Section 3.4: Action Panel

**R3.4.1: Quick Actions**

Provide buttons for common CEO actions:

**Button 1: Mark Blocker Resolved**
- Opens dialog to select which blocker is resolved
- Prompts for resolution note
- Saves resolution and removes blocker from active list

**Example:**
```
Dialog: Mark Blocker as Resolved

Select Blocker: [Dropdown: "Waiting for client approval on camera placement"]
Resolution Note: [Text box: "Client approved placement on Feb 15. Proceeding with installation."]
[Save] [Cancel]
```

**Button 2: Add CEO Note**
- Opens text box to add private CEO comment/note to project
- Note visible to project owner
- Timestamped and attributed to CEO

**Example:**
```
Dialog: Add CEO Note to Project

Note: [Text box: "Discussed with client. They acknowledged delays on their side.
       Proceeding with adjusted timeline."]
[Save] [Cancel]
```

**Button 3: Request Update**
- Sends notification to project owner requesting immediate check-in
- Records that update was requested
- Tracks when owner responds

**Example:**
```
Dialog: Request Update from Project Owner

Send to: Rahul Kumar
Message: [Auto-filled: "CEO has requested an immediate project update.
         Please submit a check-in with current status."]
[Send Request] [Cancel]

System logs: "CEO requested update on Feb 15, 2025 at 3:45 PM"
```

**Button 4: Change Status**
- Manually override project status
- Options: Active / On Hold / Completed
- Prompts for reason if changing to "On Hold"

**Example:**
```
Dialog: Change Project Status

Current Status: Active
New Status: [Dropdown: On Hold]
Reason: [Text box: "Client site not ready. Pausing project until site preparation complete."]
[Save] [Cancel]
```

**Button 5: Close**
- Close detail view, return to main table

---

## Flag Logic & Definitions

### Critical Flags (🔴)
- **Over Budget**: Actual spent > budgeted amount
- **Missed Deadline**: Current date > target end date AND status != Completed
- **No Activity on Active Milestone**: Active milestone (in progress or overdue to start) has last check-in >48 hours ago
- **Budget Critical**: >90% budget consumed with >15% timeline remaining

### Warning Flags (⚠️)
- **Falling Behind**: Timeline elapsed % > work complete % + 10%
- **New Tasks Added**: Tasks/milestones added in last 7 days post-kickoff
- **Active Milestone Stagnant**: Active milestone has last check-in 24-48 hours ago
- **Poor Estimation**: Completed milestones/tasks show >200% average variance
- **Repeated Blocker**: Same blocker reported 3+ times over 3+ days
- **Budget Warning**: >90% budget consumed
- **Delay Not Logged**: Milestone delayed but no reason/attribution entered

### Flag Priority
1. Critical flags displayed first
2. Warning flags second
3. Maximum 3 flags in table view, click for full list

---

## Data Requirements

### Project Core Data
- Project name, owner
- **Project category**: Internal / Customer
- Start date
- **Original target end date** (never changes)
- **Current target end date** (updates when project delayed)
- Actual end date
- Budgeted amount
- Project status (Active/Completed/On Hold/Planning)
- Kickoff date (for scope creep tracking)

### Milestone Data
- Milestone name, description
- **Original planned start/end dates** (set during planning, never change)
- **Current planned start/end dates** (update if milestone delayed)
- Actual start/end dates
- **Original estimated duration (calendar days)**
- Completion percentage
- Status (Not Started/In Progress/Completed/Blocked)
- Creation timestamp (to identify new additions)

### Task Data
- Task name, description
- Estimated hours
- Assigned to (user)
- Status and completion %
- Creation timestamp

### Check-in Data
- User, project, milestone, task
- Timestamp
- Hours spent
- Updated milestone/task completion %
- What was accomplished (free text)
- Blocker description (if any)
- Blocker category (Internal/External/Client/Vendor)

### Delay Tracking Data (Critical)
- **Delay log entries:**
  - Date delay was logged
  - What changed (milestone/project name)
  - Original date/target
  - New date/target
  - Delay amount (days)
  - **Reason (free text, required, min 20 chars)**
  - **Attribution (enum, required): Internal-Team / Internal-Process / External-Client / External-Vendor / External-Other**
  - Who logged it (auto-captured user)
  - Related milestone/task ID
  - Cumulative impact on project end date

### Change Tracking Data
- What changed (scope/budget/timeline)
- When change was made
- Who requested/made change
- Reason/justification
- Timeline impact
- Attribution (Internal/External/Client/Vendor)

### User Data
- Name, email, role
- Hourly rate (per person, for cost calculations)

### CEO Notes Data
- Project ID
- Note text
- Timestamp
- Created by (CEO)

---

## User Workflows

### Workflow 1: Project Owner Logs Delay

**Trigger:** Milestone end date needs to be changed OR milestone completed past deadline

**Steps:**
1. System detects delay (milestone end date changed OR actual end > planned end)
2. System prompts project owner: "This milestone is delayed. Please provide details."
3. Form appears:
   - What changed: [Auto-filled: Milestone name, old date, new date, delay amount]
   - **Reason**: [Free text, required, min 20 chars, placeholder: "Explain in detail why this delay occurred"]
   - **Attribution**: [Dropdown, required: Internal-Team / Internal-Process / External-Client / External-Vendor / External-Other]
   - Supporting notes: [Optional, additional context]
4. Project owner fills reason + attribution
5. System saves delay log entry
6. System updates delay history timeline
7. System recalculates project end date impact

**Validation:**
- Cannot save without reason (min 20 chars)
- Cannot save without attribution
- System warns if attribution = "Internal" and reason mentions client/vendor

### Workflow 2: CEO Reviews Delay History with Client

**Trigger:** Client asks "Why is the project 3 weeks late?"

**Steps:**
1. CEO opens project detail view
2. CEO navigates to "Delay History Timeline" section
3. CEO reviews chronological list of all delays
4. CEO filters to show only "External - Client" delays
5. System shows: "Client-caused delays: 18 days out of 21 total days"
6. CEO uses this information in client discussion

**Expected Outcome:**
- Transparent, factual conversation
- Client sees their delays contributed significantly
- CEO can justify additional time/cost if needed

### Workflow 3: CEO Identifies Estimation Pattern

**Trigger:** Weekly dashboard review

**Steps:**
1. CEO opens project detail view for completed project
2. CEO navigates to "Estimation Accuracy" section
3. CEO sees milestone-level estimates were off by 300%
4. CEO drills into task-level estimates
5. CEO sees: Engineer Rahul has 600% avg variance on hardware tasks
6. **CEO Action**: Schedule estimation training for Rahul, especially for hardware tasks

### Workflow 4: CEO Performs 1-Minute Health Check

**Trigger:** Daily morning routine

**Steps:**
1. CEO opens dashboard
2. CEO scans Summary View (10 seconds):
   - 8 active projects
   - 2 critical (red)
   - 3 warning (yellow)
   - 3 on track (green)
   - Weekly delta: +7 days delays logged ⚠️
3. CEO clicks "Critical" filter (5 seconds)
4. CEO sees 2 critical projects in table:
   - "Pharma Line Inspection" - Over budget (125%)
   - "Automotive QC" - No activity for 3 days
5. CEO clicks "Pharma Line Inspection" (10 seconds)
6. CEO sees delay history: 3 delays totaling 15 days, all attributed to "Internal - Team"
7. **CEO Action**: Schedule meeting with project owner to discuss budget overrun and delays (30 seconds)

**Total time: ~1 minute**

---

## Assumptions

### Phase 1 Assumptions
- **ClickUp is already being used** - Team manages projects and tasks in ClickUp
- **Daily rates available** - Employee daily rates accessible via Google Spreadsheet
- **Team will log time daily** - Minimum 7H per day (work + leave)
- **ClickUp API access** - Valid API key with read/write permissions
- **Firebase infrastructure** - Already set up for BOM Tracker project
- **Google Sheets API access** - For fetching daily rates
- **OpenAI API access** - For comments validation (AI gibberish check)
- **No historical time data import** - Starting fresh with new time logs
- **Time logs are immutable** - Once submitted, cannot be edited (by design)
- **All time must be against ClickUp tasks** - No "general" time entries allowed

### Phase 2+ Assumptions
- Phase 1 time tracking data is accurate and complete
- Team members submit check-ins daily
- Project owners define milestones during planning with estimated duration
- Project owners log delays with reasons when they occur (enforced by system)
- Projects are budgeted at project level (not milestone level)
- No formal change approval process exists

---

## Success Metrics

### Phase 1 Success Metrics (30 days post-launch)

**Data Quality Metrics:**
- Daily compliance rate: >95% (team members log time 6-7 days per week)
- Task coverage: 100% (all work hours logged against ClickUp tasks)
- Minimum hours met: >95% of days have ≥7H logged
- Comments quality: >90% pass AI validation on first attempt

**Adoption Metrics:**
- Time to log: <5 minutes average per day per user
- User satisfaction: >80% positive feedback on ease of use
- CEO engagement: CEO checks compliance dashboard daily

**Cost Tracking Metrics:**
- Cost allocation accuracy: 100% (all daily costs distributed)
- Project cost visibility: CEO can see task-level costs within 1 minute
- Leave tracking: >95% of shortfall days have leave logged

### Phase 2+ Success Metrics (6 months post-Phase 2 launch)

**Data Quality Metrics:**
- % of projects with complete milestone plans (target: >80%)
- % of milestones with time estimates (target: >90%)
- % of delays with documented reasons + attribution (target: >95%)

**Business Impact Metrics:**
- Reduction in project budget overruns (target: -30%)
- Reduction in project timeline delays (target: -25%)
- Improvement in estimation accuracy (target: milestone variance <150%, task variance <100%)
- Increase in on-time project delivery (target: >80%)
- Reduction in client disputes over delays (target: qualitative feedback)

---

## Out of Scope

### Out of Scope for Phase 1 (Compliance & Time Tracking)

**Project Management Features:**
- Project creation/editing in dashboard (ClickUp is source of truth)
- Task creation in dashboard (must use ClickUp)
- Subtask hierarchy management
- Milestone tracking
- Sprint planning
- Gantt charts

**Time Tracking Features:**
- Time log editing/deletion (immutable by design)
- Retroactive time logging (cannot log for previous days)
- Timer functionality (start/stop timer)
- Billable vs non-billable tracking
- Client invoicing
- Overtime tracking

**Integrations:**
- Slack/Teams notifications
- Email reminders
- Calendar integration
- Jira, Asana, Trello integration
- Time tracking tools (Toggl, Harvest)
- Accounting software (QuickBooks, Xero)

**Advanced Features:**
- Mobile app
- Approval workflows for time logs
- Manager review/sign-off
- Custom reports builder
- PDF exports
- Scheduled reports
- Data visualization (charts/graphs beyond basic)
- Predictive analytics
- Historical data import

**User Management:**
- Advanced team structure (departments, managers)
- Permission levels beyond admin/user/CEO

**Configuration:**
- Weekend/holiday calendar
- Working days configuration
- Custom validation rules
- Multi-currency support

### Out of Scope for Phase 2+ (Moved to Future Phases)

- Predictive analytics (ML model to predict project risk)
- Mobile app for CEO
- Team performance dashboard (individual engineer KPIs)
- Client-facing dashboard
- Advanced reporting (quarterly PDF exports)
- Delay history export to PDF
- Initial planning vs mid-project task estimation differentiation
- Real-time refresh (on-demand or 1-minute polling is sufficient)
- Formal change approval workflows

---

## Approval Sign-off

### Phase 1 Approval
- [ ] CEO Review and Approval - Phase 1 Requirements
- [ ] Technical Lead Review - ClickUp Integration Feasibility
- [ ] Development Team Review - Implementation Timeline
- [ ] Ready for Phase 1 Development

### Phase 2+ Approval (Future)
- [ ] CEO Review - Phase 2+ Requirements
- [ ] Technical Lead Review - Data Model Extensions
- [ ] Ready for Phase 2 Design & Prototyping

---

## Document Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 2.0 | 2025-10-22 | Added comprehensive Phase 1: Compliance & Time Tracking requirements. Restructured document to show phased approach. Updated assumptions, success metrics, and out-of-scope sections. | CEO |
| 1.1 | 2025-10-15 | Initial Phase 2+ CEO Dashboard requirements | CEO |

---

**End of PRD - Version 2.0**
