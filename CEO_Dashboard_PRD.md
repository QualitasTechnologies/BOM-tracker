# CEO Engineering Dashboard - Product Requirements Document (PRD)

## Document Version
- Version: 1.1
- Date: 2025-10-15
- Status: Draft
- Owner: CEO

---

## Executive Summary

This dashboard provides the CEO with real-time visibility into engineering project health, focusing on budget tracking, timeline adherence, and early warning signals for process maturity issues (poor planning, scope creep, estimation accuracy).

**Design Philosophy:**
- Exception-based: Surface problems automatically
- Root cause visibility: Not just "what" but "why"
- Actionable: Every metric leads to a specific management action
- Historical transparency: Track delays with reasons for client/CEO review
- Phase 1 focus: Building basic project discipline before optimization

---

## Problem Statement

### Current State
- Team uses inconsistent project planning approaches
- Task granularity varies wildly by project owner
- Estimates are frequently inaccurate (300-1000% variance)
- Scope creep happens without visibility
- CEO learns about problems too late (after budget exhausted or deadline missed)
- No systematic way to track which projects are at risk
- **When delays happen, no historical record of why or when issues started**
- **Clients and CEO only remember recent events, lose track of delay root causes**

### Desired State
- CEO can see all project health in 1-minute scan
- Early warning system flags problems before they become critical
- Clear visibility into why projects go over budget or miss deadlines
- **Complete delay history with reasons - shareable with clients**
- Track patterns (which engineers estimate poorly, which project types have issues)
- Build team discipline around check-ins, planning, and estimation
- Projects grouped by category (Internal vs Customer projects)

---

## User Personas

### Primary User: CEO
- **Needs**: High-level project portfolio health, exception-based alerts, actionable insights, delay history for client discussions
- **Usage Pattern**: Quick daily scan (1 minute), weekly deep dive (15-30 minutes)
- **Technical Skill**: Non-technical, needs simple visual interface
- **Key Question**: "Which projects need my attention and why? What caused these delays?"

### Secondary Users: Project Owners
- **Needs**: Status of own projects, understand what CEO sees
- **Usage Pattern**: Weekly review before CEO meetings
- **Key Question**: "Is my project flagged as at-risk?"

### Tertiary Users: Clients
- **Needs**: Understand why their project is delayed
- **Usage Pattern**: Occasional review when CEO shares project status
- **Key Question**: "Why is my project late and was it our fault or yours?"

---

## Goals & Success Criteria

### Goals
1. Provide CEO with **1-minute project health snapshot**
2. Surface at-risk projects automatically (no manual hunting)
3. Build team discipline around check-ins, planning, and estimation
4. Enable root cause analysis for budget/timeline issues
5. **Maintain historical delay timeline with attributions for client/CEO transparency**
6. Track improvement over time (estimation accuracy, on-time delivery)
7. Group projects by category (Internal/Customer) for better organization

### Success Criteria (6 months post-launch)
- 30% reduction in project budget overruns
- 25% reduction in project timeline delays
- Estimation variance improves from >400% to <150%
- **>95% of delays have documented reasons and attribution**
- Check-in compliance >90% across team

---

## Dashboard Requirements

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

- Team members will submit check-ins at least daily (ideally twice daily)
- Project owners will define milestones during project planning with estimated duration (calendar days, not budgeted hours)
- Project owners will log delays with reasons when they occur (enforced by system)
- Hourly rates are known and set per person
- Projects are budgeted at project level (not milestone level)
- Database infrastructure exists or can be set up
- Team has capacity to build this dashboard (or vendor will be hired)
- Check-ins will be collected via AI chat assistant
- No formal change approval process exists
- Starting fresh with new projects (no historical data import)

---

## Success Metrics

### Data Quality Metrics
- Check-in compliance rate (target: >90%)
- % of projects with complete milestone plans (target: >80%)
- % of milestones with time estimates (target: >90%)
- **% of delays with documented reasons + attribution (target: >95%)**

### Business Impact Metrics (6 months post-launch)
- Reduction in project budget overruns (target: -30%)
- Reduction in project timeline delays (target: -25%)
- Improvement in estimation accuracy (target: milestone variance <150%, task variance <100%)
- Increase in on-time project delivery (target: >80%)
- **Reduction in client disputes over delays** (target: qualitative feedback)

---

## Out of Scope for Phase 1

- Predictive analytics (ML model to predict project risk)
- Mobile app for CEO
- Team performance dashboard (individual engineer KPIs)
- Client-facing dashboard
- Advanced reporting (quarterly PDF exports)
- Calendar integration
- Slack/Teams notifications
- **Delay history export to PDF**
- **Initial planning vs mid-project task estimation differentiation**
- Real-time refresh (on-demand or 1-minute polling is sufficient)
- Milestone-level budget tracking
- Formal change approval workflows

---

## Approval Sign-off

- [ ] CEO Review and Approval
- [ ] Technical Lead Review
- [ ] Data Team Review
- [ ] Ready for Design & Prototyping

---

**End of PRD**
