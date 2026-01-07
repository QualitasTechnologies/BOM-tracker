# Project Intelligence Service - Specification

## Document Info
- **Created**: January 6, 2026
- **Last Updated**: January 7, 2026
- **Status**: Draft v3
- **Author**: Raghava Kashyapa / Claude

---

# PART I: THE PROBLEM & VALUE

## 1. Business Problem

### The Reality Today

Projects run for months. Daily standups happen, decisions are made, blockers arise, commitments are given. But this information disappears into the void.

When a customer asks "why is this delayed?":
- Team scrambles to piece together what happened
- Only recent events are remembered
- Warning signs from weeks ago are forgotten
- Sometimes blame is taken for delays that weren't internal

### Root Causes

1. **Project Amnesia** - Critical information lives in people's heads and is never captured
2. **Pattern Blindness** - Same tasks stretch for weeks, but no one notices the repetition
3. **Commitment Drift** - Engineers say "I'll finish by Friday," miss it, and no one tracks this
4. **Communication Gap** - Clients feel out of the loop; updates are inconsistent or missed

### The Cost

- Delays escalate into crises (no early warning)
- Poor estimation repeats (no pattern learning)
- Customer trust erodes (reactive, not proactive communication)
- Time wasted reconstructing history during disputes

---

## 2. Value Proposition

A system that captures project activity, surfaces patterns, and generates world-class client communication.

### For Internal Team (CEO, Managers)

| Insight Type | Example | Action Enabled |
|--------------|---------|----------------|
| Stuck Task | "PCB routing discussed 7 consecutive days" | Intervene before crisis |
| Missed Commitment | "John committed Tuesday, still open Friday" | Address accountability |
| Estimation Pattern | "Your PCB tasks take 2.3x estimated time" | Improve future estimates |
| Recurring Blocker | "Waiting on client approval - 4th time this month" | Escalate or change process |

### For Clients (CEO, PM)

| Output | Value |
|--------|-------|
| Weekly Status Update | Professional, consistent communication that builds trust |
| Health Dashboard | At-a-glance project status without asking |
| Proactive Alerts | Know about challenges before they become surprises |
| Complete History | "What happened with X?" answered instantly |

### Outcomes

- **Early Intervention** - Problems surfaced before they become crises
- **Better Estimation** - Learn from historical patterns
- **Proactive Communication** - Know about delays before customers do
- **Client Delight** - Professional, consistent updates that differentiate your service

---

## 3. The Dual Audience

This system serves two distinct audiences with different needs:

| Audience | What They Need | Format |
|----------|----------------|--------|
| **Internal** (CEO, Managers) | Raw patterns, accountability, suggested questions | Daily Briefing, Alerts |
| **External** (Client CEO, PM) | Confidence, progress narrative, no surprises | Weekly Status Update |

**Key Insight:** Same underlying data, different presentations.
- Internal = raw truth, accountability focus
- External = professional narrative, confidence focus

### Client Audience Layers

For enterprise clients, there are typically two stakeholders:

| Role | What They Want | Update Style |
|------|----------------|--------------|
| **Client CEO/VP** | High-level health, confidence, no surprises | One-liner + health indicator |
| **Client PM** | Enough detail to report upward, track progress | Full weekly update |

The system generates layered updates that serve both.

---

# PART II: SYSTEM ARCHITECTURE

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PROJECT INTELLIGENCE SERVICE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       CONTEXT LAYER                               │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │   │
│  │  │   Project   │ │  BOM Data   │ │  Documents  │ │  Calendar  │  │   │
│  │  │   Context   │ │  & Status   │ │  & Specs    │ │  & Holidays│  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│  ┌─────────────────────────────────┼────────────────────────────────┐   │
│  │                       INPUT LAYER                                 │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │   │
│  │  │  Meeting    │ │   Daily     │ │   Future    │                 │   │
│  │  │ Transcripts │ │  Check-ins  │ │   Inputs    │                 │   │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘                 │   │
│  └─────────┼───────────────┼───────────────┼────────────────────────┘   │
│            └───────────────┼───────────────┘                             │
│                            ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    PROCESSING LAYER                               │   │
│  │                                                                   │   │
│  │   Transcripts ──► EXTRACTION ──► Activities ──► CONSOLIDATION    │   │
│  │                                                         │         │   │
│  │                                                         ▼         │   │
│  │                                                   Developments    │   │
│  │                                                         │         │   │
│  │                                                         ▼         │   │
│  │                                           ┌─────────────────────┐ │   │
│  │                                           │ HUMAN REVIEW (HIL)  │ │   │
│  │                                           │ Approve/Edit/Delete │ │   │
│  │                                           └──────────┬──────────┘ │   │
│  └──────────────────────────────────────────────────────┼───────────┘   │
│                                                          │               │
│  ┌───────────────────────────────────────────────────────┼──────────┐   │
│  │                    INTELLIGENCE LAYER                  │          │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │          │   │
│  │  │   Pattern    │ │  Commitment  │ │   Learning   │◄──┘          │   │
│  │  │  Detection   │ │   Tracking   │ │    Engine    │ (feedback)   │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│  ┌─────────────────────────────────┼────────────────────────────────┐   │
│  │                       OUTPUT LAYER                                │   │
│  │         ┌───────────────────────┼───────────────────┐            │   │
│  │         ▼                       ▼                   ▼            │   │
│  │  ┌─────────────┐         ┌─────────────┐     ┌─────────────┐    │   │
│  │  │   Weekly    │         │    Daily    │     │  Critical   │    │   │
│  │  │   Client    │         │  Briefing   │     │   Alerts    │    │   │
│  │  │   Update    │         │ (Internal)  │     │             │    │   │
│  │  └─────────────┘         └─────────────┘     └─────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Context Layer

### Purpose

Extraction quality depends on context. The more the system knows about a project, the better it can:
- Attribute activities to the correct project
- Understand technical terms and jargon
- Assess timeline impacts
- Generate client-appropriate summaries

### 5.1 Project Context

Basic project information that guides extraction:

```yaml
project: Raize Labz - Initial Machines
client: APIT
objective: "Ship grain analyzer with 90% accuracy by Nov 30"

aliases:
  - APIT
  - "grain analyzer"
  - "rice project"

team:
  - name: Anandha Lakshmi
    role: lead
  - name: Royce
    role: engineer

client_contacts:
  - name: Shashisar
    aliases: [SKT, "Shashi sir"]
  - name: Pradeep
  - name: Deependra

vendors:
  - Hikrobot (cameras)
  - Sumotech (lighting)

keywords:
  - tracking
  - object detection
  - DeepStream
  - ByteTrack
  - NvDCF

# Learned from corrections
learned_terms:
  - "tracker" → this project
  - "Eagle Eye" → internal analysis tool

preferred_tone: concise, business-focused
```

### 5.2 BOM & Procurement Data

Integration with BOM Tracker provides:

| Data | Use in Intelligence |
|------|---------------------|
| BOM items and status | "Waiting on Hikrobot camera" → blocker attribution |
| Vendor lead times | Expected arrival vs. actual → delay detection |
| Procurement blockers | Auto-surface supply chain issues |
| Project costs | Budget context for decisions |

**Integration**: Via Firestore shared collections or MCP server.

### 5.3 Project Documents & Emails

Additional context from project artifacts:

| Document Type | Value |
|---------------|-------|
| **Proposal/SOW** | Original scope, deliverables, timeline commitments |
| **Technical Specs** | What "done" looks like, acceptance criteria |
| **Meeting Notes** | Historical decisions, client preferences |

**Email Context** (Important):

Emails are a critical context source - many decisions are made via email, not meetings.

| Email Source | What's Extracted |
|--------------|------------------|
| Sent by team | Commitments made, decisions communicated |
| Sent by client | Requirements, approvals, concerns |
| Received from vendors | Quotes, timelines, blockers |

**Email Preprocessing**: Emails are NOT ingested raw. They are:
1. Filtered to project-relevant threads only
2. Parsed for decisions, commitments, and blockers
3. Summarized into structured context
4. Linked to the relevant project

This prevents noise (spam, CC chains, newsletters) while capturing decision history.

**Implementation Options**:
1. **Document Upload** - Manual upload to project, indexed for context
2. **MCP Integration** - Connect to Google Drive, SharePoint, Gmail, etc.
3. **RAG Pipeline** - Embed documents, retrieve relevant context per query
4. **Email Connector** - Periodic sync from Gmail/Outlook with preprocessing

### 5.4 Calendar & Holiday Awareness

Timeline intelligence requires knowing:

| Data | Use |
|------|-----|
| **Company Holidays** | Adjust expected delivery dates |
| **Client Holidays** | Know when client won't respond |
| **Team PTO** | Factor into capacity/commitment |
| **Key Dates** | Client deadlines, demos, milestones |

**Example Impact**:
```
Commitment: "I'll have it done by Friday"
Context: Thursday and Friday are holidays
System: Flags as unrealistic, suggests Monday
```

**Integration**: Google Calendar API or manual calendar configuration.

### 5.5 Context Data Model

```typescript
interface ProjectContext {
  id: string;
  projectId: string;

  // Basic info
  projectName: string;
  client: string;
  objective: string;

  // Recognition
  aliases: string[];
  keywords: string[];
  learnedTerms: { term: string; mapsTo: string }[];

  // People
  team: { name: string; role: string; aliases?: string[] }[];
  clientContacts: { name: string; aliases?: string[] }[];

  // Vendors
  vendors: { name: string; context?: string }[];

  // Documents (references)
  linkedDocuments: {
    type: 'proposal' | 'spec' | 'sow' | 'other';
    name: string;
    url?: string;
    summary?: string; // AI-generated summary for context
  }[];

  // Calendar
  holidays: { date: string; description: string }[];
  keyDates: { date: string; description: string; type: 'milestone' | 'demo' | 'deadline' }[];

  // Preferences (learned)
  preferredTone: 'concise' | 'detailed' | 'technical';
  detailLevel: 'high' | 'medium' | 'low';

  // Metadata
  lastUpdated: string;
  updatedBy: string;
}
```

---

## 6. Input Layer

### 6.1 Meeting Transcripts

**Source**: Daily standups, project meetings, client calls - any meeting with a transcript.

**Current Implementation** (BOM Tracker):
- Transcript paste/upload dialog
- GPT-based activity extraction
- Project attribution with learning
- Activity timeline display

**Extraction Targets**:

| Type | Example | Why It Matters |
|------|---------|----------------|
| Progress | "Finished the schematic review" | Track what's actually done |
| Blocker | "Waiting on vendor quote" | Identify delays, attribution |
| Commitment | "I'll have it done by Tuesday" | Track accountability |
| Decision | "We decided to use vendor X" | Document reasoning |
| Risk | "This might take longer than expected" | Early warning capture |
| Timeline Impact | "This pushes us back a week" | Delay tracking |

**Attribution** - Each extracted item captures:
- **Who** said it
- **About what** project/task
- **When** it was said
- **Category**: Internal-Team, Internal-Process, External-Client, External-Vendor

### 6.2 Intelligent Daily Check-ins

**Purpose**: Capture information that doesn't surface in meetings.

**Design Principles**:

1. **Fact-Finding, Not Interrogation**
   - Bad: "Why isn't this done yet?"
   - Good: "What's the current state of the power supply design?"

2. **Specific, Not Generic**
   - Bad: "Any blockers?"
   - Good: "You mentioned waiting on a vendor quote Monday. Has it arrived?"

3. **Learning Over Time**
   - Week 1: "What's the status of Task X?"
   - Week 4: "Task X is a PCB layout. These typically take you 2x estimated. Is Friday realistic?"

**Check-in Flow**:
```
1. System reviews engineer's active tasks
2. System reviews recent history & patterns
3. System generates 3-5 specific questions
4. Engineer answers (mobile-friendly, <2 min)
5. Responses stored + fed to processing layer
```

**Question Categories**:
1. Task Status - Current state of specific active tasks
2. Completion Capture - What was actually finished today
3. Blocker Probe - What's waiting on something/someone
4. Commitment Follow-up - Status on previous commitments
5. Finish Line Clarity - "What does 'done' look like for this?"

### 6.3 Email Threads (Phase 2+)

**Source**: Client emails, vendor correspondence, internal project emails.

**Preprocessing Pipeline** (emails are never raw-ingested):
```
Email Thread → Filter (project-relevant only)
            → Parse (extract decisions, commitments, blockers)
            → Summarize (structured context)
            → Store (linked to project)
```

**What Gets Extracted**:
- Decisions made ("Let's go with Vendor X")
- Commitments given ("We'll deliver by Friday")
- Client concerns ("The timeline seems aggressive")
- Approvals received ("Approved to proceed")
- Blockers identified ("Waiting on your approval")

**What Gets Filtered Out**:
- CC-only threads (no active participation)
- Newsletters, automated notifications
- Non-project correspondence

**Context Horizon**: ~3-6 months active. Older emails archived but searchable.

### 6.4 Future Inputs

Potential future integrations:
- Chat messages (Slack, WhatsApp)
- Commit messages (development activity)
- Task management updates (Jira, Linear)

---

## 7. Processing Layer

### 7.1 Extraction: Transcript → Activities

Raw transcript is processed to extract structured Activities:

```typescript
interface Activity {
  id: string;
  source: 'transcript' | 'checkin' | 'manual';
  sourceId: string;
  projectId: string;

  type: 'progress' | 'blocker' | 'decision' | 'commitment' | 'risk' | 'note';
  summary: string;
  rawText?: string;

  // Attribution
  personId?: string;
  personName?: string;
  attribution?: 'Internal-Team' | 'Internal-Process' | 'External-Client' | 'External-Vendor';

  // Timestamps
  activityDate: Date;
  extractedAt: Date;

  // AI confidence
  confidence: number;
}
```

### 7.2 Consolidation: Activities → Developments

**The Problem**: 6 activities/meeting × 20 meetings/month = 120 activities = data dump

**The Solution**: Consolidate into **Developments** - meaningful changes clients care about.

```typescript
interface Development {
  id: string;
  projectId: string;

  // Classification
  type: 'achievement' | 'blocker' | 'decision' | 'risk' | 'milestone' | 'progress';
  status: 'active' | 'resolved' | 'superseded';
  importance: 'critical' | 'high' | 'medium' | 'low';

  // Content (client-ready)
  title: string;              // "Tracking System Performance Gap"
  summary: string;            // 2-3 sentences, client-readable
  technicalContext?: string;  // Optional deeper detail

  // For blockers/risks
  impact?: string;
  mitigation?: string;

  // For decisions
  rationale?: string;

  // Timeline
  firstReported: string;
  lastUpdated: string;
  resolvedDate?: string;

  // Lineage
  parentId?: string;          // If update to previous development
  relatedIds?: string[];

  // Source evidence
  sourceActivities: {
    activityId: string;
    transcriptId: string;
    timestamp: string;
    speaker: string;
    excerpt: string;
  }[];

  // Review tracking
  humanReviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
}
```

**Consolidation Rules**:

| Signal | Example | Result |
|--------|---------|--------|
| Same topic, same meeting | 3 excerpts about tracking | Merge into single Development |
| Q&A exchange | Question + Answer + Confirmation | Single Development |
| Problem + Commitment | "Tracker failing" + "Will fix by Friday" | One Blocker with mitigation |

**Target**: 5-7 Developments per week per project (not 50 activities)

### 7.3 Human-in-the-Loop Review

Every Development goes through human review before becoming "official":

```
┌─────────────────────────────────────────────────────────────┐
│ DEVELOPMENT REVIEW                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Title: Tracking System Performance Gap                      │
│ Type: Blocker                                               │
│ Summary: Object detection working but tracking failing...   │
│                                                             │
│ [✓ Approve]  [✎ Edit]  [🗑 Delete]  [🔗 Merge with...]     │
│                                                             │
│ Quick fixes:                                                │
│ ○ Wrong project → [dropdown]                                │
│ ○ Wrong type → [dropdown]                                   │
│ ○ Too technical → [Auto-simplify]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Goal**: <30 seconds per item review.

---

## 8. Intelligence Layer

### 8.1 Pattern Detection

**Stuck Task Detection**:
```
IF task mentioned in >= 3 consecutive days
   AND no completion recorded
   AND status unchanged
THEN flag as "stuck"

Severity = days_stuck / estimated_duration
```

**Commitment Tracking**:
```
EXTRACT commitments: "I'll have X done by [DATE]"
STORE: who, what, promised_date
ON promised_date + 1:
   CHECK: completion recorded?
   IF no: flag as "commitment miss"
```

**Estimation Variance**:
```
FOR each completed task:
   variance = actual_duration / estimated_duration
   STORE by: engineer, task_type, project

AGGREGATE patterns:
   - Engineer average variance
   - Task type average variance
```

**Recurring Blocker Detection**:
```
CLUSTER blockers by semantic similarity
IF same blocker type appears 3+ times in 30 days:
   FLAG as "recurring blocker"
   ATTRIBUTE: internal vs external
```

### 8.2 Learning Engine

**What It Learns**:
1. Engineer patterns - Who underestimates, by how much, on what
2. Task type patterns - Which categories consistently take longer
3. Language patterns - Phrases that precede missed deadlines
4. Project patterns - What terminology maps to which project

**Learning Sources**:

| User Action | System Learns |
|-------------|---------------|
| Deletes Development | "This pattern = noise" → filter similar |
| Merges Developments | "These topics = same thing" → consolidate similar |
| Edits summary | "This tone/style preferred" → adjust generation |
| Changes project | "Term X = Project Y" → add to project context |
| Changes type | "This pattern = [type]" → improve classification |

**Feedback Loop**:
```
Extraction → Human Review → Corrections → Learning → Better Extraction
```

---

## 9. Output Layer

### 9.1 Weekly Client Status Update

**Purpose**: Professional, client-ready update that builds trust.

**Format**:
```
┌────────────────────────────────────────────────────────────────┐
│        PROJECT STATUS UPDATE - [Project Name]                   │
│        Week of [Date Range]                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HEALTH: 🟢 On Track | 🟡 Needs Attention | 🔴 At Risk          │
│  ───────────────────────────────────────────────────────────── │
│  [One sentence executive summary]                               │
│                                                                 │
│  THIS WEEK'S PROGRESS                                           │
│  ───────────────────────────────────────────────────────────── │
│  ✅ [Achievement 1 - client-meaningful language]                │
│  ✅ [Achievement 2]                                             │
│                                                                 │
│  ACTIVE CHALLENGES                                              │
│  ───────────────────────────────────────────────────────────── │
│  ⚠️ [Challenge] - [Impact] - [What we're doing about it]       │
│                                                                 │
│  KEY DECISIONS                                                  │
│  ───────────────────────────────────────────────────────────── │
│  📋 [Decision made] - [Rationale in client terms]              │
│                                                                 │
│  WHAT'S NEXT                                                    │
│  ───────────────────────────────────────────────────────────── │
│  → [Next week's focus areas]                                   │
│                                                                 │
│  TIMELINE STATUS                                                │
│  ───────────────────────────────────────────────────────────── │
│  | Milestone        | Target   | Status      |                 │
│  | [Milestone 1]    | [Date]   | 🟢 On Track |                 │
│                                                                 │
│  NEED FROM YOU                                                  │
│  ───────────────────────────────────────────────────────────── │
│  → [Pending client actions/decisions]                          │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Delta Detection** - Each update shows what CHANGED:
- New this week: Achievements, blockers, decisions
- Resolved: Items that were open, now closed
- Status changes: Milestone dates moved, health changed
- Escalations: Items that increased in severity

**Tone Translation** - Engineer-speak becomes client-speak:

| Engineer Says | Client Update Says |
|---------------|-------------------|
| "NvDCF tracker with IoU 0.3 got 67%" | "Testing tracking approaches - current best at 67%, targeting 90%" |
| "Tried ByteTrack, didn't work" | "Evaluated multiple solutions, narrowing down to best approach" |
| "Waiting on Pradeep's review" | "Internal review in progress" |

### 9.2 Daily Briefing (Internal)

**Purpose**: Before standup, manager has insights to ask the right questions.

**Format**:
```
┌────────────────────────────────────────────────────────┐
│           DAILY BRIEFING - January 6, 2026             │
│                Project: Customer XYZ                    │
├────────────────────────────────────────────────────────┤
│                                                         │
│  🔴 CRITICAL (needs immediate attention)                │
│  • Power supply design - discussed 7 consecutive       │
│    days with no progress. Priya owns this.             │
│    → Ask: "What's blocking the power supply?"          │
│                                                         │
│  ⚠️ WARNING (trending negative)                         │
│  • PCB routing - 4 days in progress, estimated 2.      │
│    Pattern: John's PCB tasks average 2.1x estimates.   │
│    → Ask: "Is Friday still realistic for routing?"     │
│                                                         │
│  📋 COMMITMENT CHECK                                    │
│  • John: "schematic done by Monday" (Jan 3)            │
│    Today is Jan 6. No completion recorded.             │
│                                                         │
│  ✅ COMPLETED SINCE LAST STANDUP                        │
│  • BOM finalization (Priya) - done yesterday           │
│                                                         │
│  📊 PROJECT HEALTH                                      │
│  • Timeline: 3 days behind (was 1 day Monday)          │
│  • Tasks on track: 4 of 7                              │
│  • Open blockers: 2 (external-vendor)                  │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### 9.3 Critical Alerts

**Purpose**: Real-time notification when patterns cross thresholds.

| Pattern | Threshold | Alert |
|---------|-----------|-------|
| Stuck Task | 5+ consecutive days | "Task X stuck for 5 days" |
| Commitment Miss | 2+ days past date | "John's commitment overdue" |
| Repeat Blocker | 3+ occurrences | "Vendor delays - 3rd time" |
| Estimation Blow | 3x+ original | "PCB layout at 3x estimate" |

---

# PART III: KEY DESIGN DECISIONS

## 10. Hierarchical Objective Tracking

### The Problem

Engineers work on tasks with fuzzy finish lines. "Make progress on tracking" isn't measurable.

### The Solution

Track objectives hierarchically, flag when lower levels are fuzzy.

```
PROJECT OBJECTIVE (North Star - clear finish line)
│   "Ship grain analyzer to APIT by Nov 30"
│
├── MILESTONE (should have clear criteria)
│   │   "Tracking system at 90% accuracy"
│   │
│   └── TASK (may discover sub-tasks)
│       │   "Evaluate ByteTrack approach"
│       │
│       └── SUB-TASK (discovered during work)
│           "Configure IoU threshold parameters"
```

### Fuzzy Finish Line = Risk Signal

```
Engineer: "I'm making progress on tracking"
System: "What does 'done' look like for this task?"
Engineer: "Not sure exactly - maybe 80%? 90%?"
           ↓
    🚨 RISK SIGNAL → Bubbles to CEO
    "Tracking task has unclear completion criteria"
           ↓
    CEO crystallizes: "Done = 90% accuracy on 500-grain test"
```

---

## 11. Feedback Loop Design

### Critical Failure Modes

Focus feedback on the three highest-impact failures:

| Failure Mode | Impact | Feedback Action |
|--------------|--------|-----------------|
| **Over-extraction** | Noise pollutes insights | "Delete - not relevant" |
| **Under-consolidation** | Data dump, not intelligence | "Merge these" |
| **Wrong tone/detail** | Client communication fails | "Rewrite as: [text]" |

### Context Auto-Enrichment

Feedback automatically enriches project context:

```yaml
# Auto-added from corrections
project: Raize Labz - Initial Machines
learned_terms:
  - "tracker" → this project
  - "NvDCF" → this project
  - "SKT" → client contact (alias for Shashisar)
preferred_tone: concise, business-focused
```

---

## 12. Engineer Value Proposition

### The Adoption Challenge

Engineers resist check-ins because they feel like surveillance.

### The Reframe: "Your Work Diary That Writes Itself"

| Pain Point Today | System Solves It |
|------------------|------------------|
| "What did I do this quarter?" | Auto-generated accomplishment summary |
| "Why did this take 3 weeks?" | Timeline showing approaches tried, pivots made |
| "Explain this to the new person" | Complete context of what was tried |
| "I already said this in standup" | "My status is captured, check the system" |

### The Message

> "This system captures your work so YOU don't have to explain yourself repeatedly.
> Every approach you try, every blocker you hit - it's recorded.
> Next time someone asks 'why did this take so long?', you show them the timeline.
> It PROTECTS you by creating a record of your effort and problem-solving."

---

## 13. System Identity: The Company Twin

### What This System Is

This is not a personal assistant or an individual's tool. It is a **Company + Role Twin**:

| Aspect | Meaning |
|--------|---------|
| **Company Twin** | Captures institutional knowledge, not individual quirks |
| **Role Twin** | Embodies "what the CEO function needs" - transferable to future leadership |
| **Not Personal** | Learns "how this company communicates" not "how Raghava writes" |

### Implications

1. **Institutional Memory** - Knowledge survives personnel changes
2. **Consistent Voice** - Company communication style, not individual style
3. **Transferable** - New CEO inherits the system's learned patterns
4. **Scalable** - Can extend to PM roles, team leads (same architecture, different scope)

### Trust Progression

The system earns autonomy over time, but never acts without oversight:

| Stage | System Does | Human Does | Timeline |
|-------|-------------|------------|----------|
| **Infant** | Draft everything | Review 100%, heavy edits | Phase 0-1 |
| **Junior** | Draft + suggest actions | Review 80%, light edits | Phase 2-3 |
| **Trusted** | Send routine updates | Review exceptions only | Phase 4+ |
| **Partner** | Flag patterns, recommend | Override when wrong | Long-term |

**Design Principle**: Start with (Infant), design for (Trusted), never promise full autonomy.

The human-in-the-loop is permanent by design. The system drafts; humans approve. This ensures:
- Accountability remains with people
- Edge cases are caught
- The system learns from corrections
- Trust is earned, not assumed

---

# PART IV: IMPLEMENTATION

## 14. Phased Rollout

### Phase 0: Foundation (Week 1-2)
**Goal**: Basic extraction working, data flowing

- [ ] Enhance transcript extraction with commitment detection
- [ ] Store Activities with proper attribution
- [ ] Basic project context with aliases
- [ ] Manual review UI (approve/edit/delete)

**Success**: Extract activities from transcript with >60% accuracy

### Phase 1: Client Updates (Week 3-4)
**Goal**: Generate client-ready weekly updates

- [ ] Development data model
- [ ] Consolidation prompt (Activities → Developments)
- [ ] Weekly update generation prompt
- [ ] Preview/edit UI before sending
- [ ] Email integration

**Success**: Weekly update generated in <10 min (including review)

### Phase 2: Context Integration (Week 5-6)
**Goal**: Rich context improves extraction

- [ ] BOM Tracker data integration
- [ ] Document upload and indexing
- [ ] Holiday calendar integration
- [ ] Context-aware extraction prompts

**Success**: Extraction accuracy improves to >75%

### Phase 3: Check-ins (Week 7-8)
**Goal**: Active capture from engineers

- [ ] Check-in data model
- [ ] Question generation (task-specific)
- [ ] Mobile-friendly check-in UI
- [ ] Check-in responses → Activities

**Success**: >70% check-in completion rate

### Phase 4: Intelligence (Week 9-12)
**Goal**: Pattern detection and learning

- [ ] Stuck task detection
- [ ] Commitment tracking
- [ ] Daily briefing generation
- [ ] Feedback loop for learning

**Success**: Daily briefing surfaces 1-2 actionable insights

### Phase 5: Polish (Ongoing)
- Semantic search (vector store)
- Advanced alerts
- Engineer accomplishment reports
- Client portal (optional)

---

## 15. Success Metrics

### Phase 0-1 Metrics (Extraction & Updates)
- Activity extraction accuracy: >60% (MVP), >80% (target)
- Consolidation ratio: 5-7 developments per 20 activities
- Human edit rate: <40% of items need editing
- Time to generate update: <10 minutes including review

### Phase 2+ Metrics (Full System)
- Check-in completion: >70%
- Stuck task early detection: catch 80% before crisis
- Client feedback on updates: >4/5 "useful" rating
- Updates sent on schedule: >90%

### Qualitative
- CEO feels "prepared" for client calls
- Engineers feel system "protects" them, not surveils
- Clients say they feel "informed" and "confident"

---

## 16. Open Questions

1. **Check-in timing**: Morning (plan) or evening (report)?
2. **Multi-project engineers**: How to handle people on 3+ projects?
3. **Client update cadence**: Weekly standard, but configurable per client?
4. **Alert fatigue**: How many alerts per day is too many?
5. **Document context**: How deep to index (summary only vs. full RAG)?

---

## 17. Technical Architecture Decisions

### LLM Strategy
- **Approach**: LLM-native with RAG (not fine-tuned)
- **Rationale**: Ride the wave of improving models, minimal proprietary dependency
- **Models**: OpenAI GPT-4/5 or Anthropic Claude for extraction/generation

### Storage
- **Primary**: Firestore for structured data (Activities, Developments, Context)
- **Vector** (future): Pinecone or similar for semantic search
- **Files**: Firebase Storage for uploaded documents

### Integration
- **BOM Tracker**: Shared Firestore collections
- **Calendar**: Google Calendar API
- **Documents**: MCP server or direct upload
- **Email**: SendGrid for update delivery

---

## Appendix A: Name Candidates

| Name | Vibe |
|------|------|
| Project Pulse | Health monitoring |
| Clarity | Seeing through the noise |
| Chronicle | Historical record |
| Sentinel | Watchful guardian |
| Momentum | Tracking progress |

**Current working name**: Project Intelligence Service

---

*This specification is a living document. Update as implementation reveals new insights.*
