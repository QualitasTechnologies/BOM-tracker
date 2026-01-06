# Project Intelligence Service - Specification

## Document Info
- **Created**: January 6, 2026
- **Status**: Draft
- **Author**: Raghava Kashyapa / Claude

---

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
4. **Unasked Questions** - The right follow-up questions don't get asked because managers don't remember the history

### The Cost
- Delays escalate into crises (no early warning)
- Poor estimation repeats (no pattern learning)
- Customer trust erodes (reactive, not proactive communication)
- Time wasted reconstructing history during disputes

---

## 2. Value Proposition

A system that watches project activity and surfaces patterns early:

| Insight Type | Example | Action Enabled |
|--------------|---------|----------------|
| Stuck Task | "PCB routing discussed 7 consecutive days" | Intervene before crisis |
| Missed Commitment | "John committed Tuesday, still open Friday" | Address accountability |
| Estimation Pattern | "Your PCB tasks take 2.3x estimated time" | Improve future estimates |
| Recurring Blocker | "Waiting on client approval - 4th time this month" | Escalate or change process |

### Outcomes
- **Early Intervention** - Problems surfaced before they become crises
- **Better Estimation** - Learn from historical patterns
- **Proactive Communication** - Know about delays before customers do
- **Informed Meetings** - Manager armed with the right questions to ask

---

## 3. System Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  PROJECT INTELLIGENCE SERVICE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐   │
│  │  Meeting    │     │   Daily     │     │  Future Inputs  │   │
│  │ Transcripts │     │  Check-ins  │     │  (Email, Chat)  │   │
│  └──────┬──────┘     └──────┬──────┘     └────────┬────────┘   │
│         │                   │                      │            │
│         └───────────────────┼──────────────────────┘            │
│                             ▼                                    │
│                  ┌─────────────────────┐                        │
│                  │   EXTRACTION LAYER   │                        │
│                  │  - Activities        │                        │
│                  │  - Commitments       │                        │
│                  │  - Blockers          │                        │
│                  │  - Decisions         │                        │
│                  └──────────┬──────────┘                        │
│                             ▼                                    │
│                  ┌─────────────────────┐                        │
│                  │   INTELLIGENCE LAYER │                        │
│                  │  - Pattern Detection │                        │
│                  │  - Cross-time Analysis│                       │
│                  │  - Commitment Tracking│                       │
│                  │  - Learning Engine   │                        │
│                  └──────────┬──────────┘                        │
│                             ▼                                    │
│                  ┌─────────────────────┐                        │
│                  │     DATA STORE       │                        │
│                  │  - Activities        │                        │
│                  │  - Patterns          │                        │
│                  │  - Insights          │                        │
│                  │  - Learning Data     │                        │
│                  └──────────┬──────────┘                        │
│                             ▼                                    │
│         ┌───────────────────┼───────────────────┐               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Daily     │     │   Critical  │     │   Query     │       │
│  │  Briefing   │     │   Alerts    │     │  Interface  │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  External Apps  │
                    │  - BOM Tracker  │
                    │  - Future Apps  │
                    └─────────────────┘
```

### Components

#### Input Layer
1. **Meeting Transcripts** - Passive capture of discussions (existing)
2. **Daily Check-ins** - Active capture via intelligent questions (new)
3. **Future**: Email, WhatsApp, commit messages, task updates

#### Extraction Layer
Processes raw inputs to extract structured information:
- **Activities** - What happened (progress, work done)
- **Commitments** - Who promised what by when
- **Blockers** - What's preventing progress, and attribution
- **Decisions** - What was decided and why

#### Intelligence Layer
Cross-references data over time to detect patterns:
- **Stuck Task Detection** - Same item appearing repeatedly
- **Commitment Tracking** - Promise made vs. delivered
- **Estimation Analysis** - Predicted vs. actual duration
- **Pattern Recognition** - Recurring blockers, common delay causes

#### Learning Engine
Gets smarter over time:
- Learns which task types are underestimated
- Learns individual engineer patterns
- Learns which language precedes missed deadlines
- Adjusts question specificity based on history

#### Output Layer
1. **Daily Briefing** - Pushed before standup meetings
2. **Critical Alerts** - Real-time for threshold breaches
3. **Query Interface** - Ask questions about project history (future)

---

## 4. Input Source 1: Meeting Transcripts

### What Gets Captured
Daily standups, project meetings, client calls - any meeting with a transcript.

### Extraction Targets

| Type | Example | Why It Matters |
|------|---------|----------------|
| Progress | "Finished the schematic review" | Track what's actually done |
| Blocker | "Waiting on vendor quote" | Identify delays, attribution |
| Commitment | "I'll have it done by Tuesday" | Track accountability |
| Decision | "We decided to use vendor X" | Document reasoning |
| Risk | "This might take longer than expected" | Early warning capture |
| Timeline Impact | "This pushes us back a week" | Delay tracking |

### Attribution
Each extracted item should capture:
- **Who** said it
- **About what** project/task
- **When** it was said
- **Category**: Internal-Team, Internal-Process, External-Client, External-Vendor

### Existing Implementation
Currently in BOM Tracker:
- Transcript paste/upload dialog
- GPT-based activity extraction
- Project attribution with learning
- Activity timeline display

**Gap**: Current system extracts single-transcript activities. Doesn't do cross-transcript pattern detection.

---

## 5. Input Source 2: Intelligent Daily Check-ins

### Purpose
Capture information that doesn't surface in meetings:
- Work done outside of discussions
- Blockers engineers don't volunteer
- Honest status on task progress

### Design Principles

#### Fact-Finding, Not Interrogation
Questions should feel neutral, not accusatory.

**Bad** (creates defensiveness):
> "Why isn't this done yet?"
> "You said Tuesday. It's Thursday. What happened?"

**Good** (neutral fact-finding):
> "What's the current state of the power supply design?"
> "Is anything waiting on someone else?"
> "What did you complete today?"

#### Specific, Not Generic
Questions should reference actual tasks, not be generic prompts.

**Bad** (invites garbage):
> "What did you work on today?"
> "Any blockers?"

**Good** (specific):
> "The PCB layout was marked 'in progress' 4 days ago. What's remaining?"
> "You mentioned waiting on a vendor quote Monday. Has it arrived?"

#### Learning Over Time
Questions evolve based on patterns.

**Week 1** (generic baseline):
> "What's the status of Task X?"

**Week 4** (learned pattern):
> "Task X is a PCB layout. These typically take you 2x estimated. Current estimate is Friday - is that realistic?"

**Week 8** (individual pattern):
> "You've marked this 'in progress' for 6 days. On similar tasks, this usually means a blocker. Anything stuck?"

### Check-in Flow

```
┌────────────────────────────────────────────────────────┐
│                  DAILY CHECK-IN FLOW                    │
├────────────────────────────────────────────────────────┤
│                                                         │
│  1. System reviews engineer's active tasks              │
│                    ▼                                    │
│  2. System reviews recent history & patterns            │
│                    ▼                                    │
│  3. System generates 3-5 specific questions             │
│                    ▼                                    │
│  4. Engineer answers (mobile-friendly, <2 min)          │
│                    ▼                                    │
│  5. Responses stored + fed to intelligence layer        │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### Question Categories

1. **Task Status** - Current state of specific active tasks
2. **Completion Capture** - What was actually finished today
3. **Blocker Probe** - What's waiting on something/someone
4. **Commitment Follow-up** - Status on previous commitments
5. **Time Check** - Remaining effort vs. estimate accuracy

### UX Requirements
- **Fast**: Complete in under 2 minutes
- **Mobile-first**: Engineers might fill during commute
- **Non-punitive feel**: Information gathering, not surveillance
- **Optional elaboration**: Quick answers default, expand if needed

---

## 6. Output 1: Daily Briefing

### Purpose
Before each standup, manager receives synthesized insights to ask the right questions.

### Timing
Delivered 15-30 minutes before scheduled standup.

### Format

```
┌────────────────────────────────────────────────────────┐
│           DAILY BRIEFING - January 6, 2026             │
│                Project: Customer XYZ                    │
├────────────────────────────────────────────────────────┤
│                                                         │
│  🔴 CRITICAL (needs immediate attention)                │
│  ─────────────────────────────────────────────         │
│  • Power supply design - discussed 7 consecutive       │
│    days with no progress. Priya owns this.             │
│    → Suggested question: "What's specifically          │
│      blocking the power supply completion?"            │
│                                                         │
│  ⚠️ WARNING (trending negative)                         │
│  ─────────────────────────────────────────────         │
│  • PCB routing - 4 days in progress, originally        │
│    estimated 2 days. Pattern: John's PCB tasks         │
│    average 2.1x estimates.                             │
│    → Suggested question: "Is Friday still realistic    │
│      for PCB routing, or should we adjust?"            │
│                                                         │
│  📋 COMMITMENT CHECK                                    │
│  ─────────────────────────────────────────────         │
│  • John committed "schematic done by Monday" on        │
│    Jan 3. Today is Jan 6. No completion recorded.      │
│    → Follow up: "John, what's the schematic status?"   │
│                                                         │
│  ✅ COMPLETED SINCE LAST STANDUP                        │
│  ─────────────────────────────────────────────         │
│  • BOM finalization (Priya) - done yesterday           │
│  • Vendor selection for connectors (Amit) - done       │
│                                                         │
│  📊 PROJECT HEALTH                                      │
│  ─────────────────────────────────────────────         │
│  • Timeline: 3 days behind (was 1 day behind Monday)   │
│  • Tasks on track: 4 of 7                              │
│  • Open blockers: 2 (both external-vendor)             │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### Key Elements
1. **Critical items** - Immediate attention needed, with suggested questions
2. **Warnings** - Trending negative, watch closely
3. **Commitment tracking** - Promised vs. delivered
4. **Completions** - Celebrate wins, confirm understanding
5. **Project health** - High-level status

---

## 7. Output 2: Critical Alerts

### Purpose
Real-time notification when patterns cross thresholds.

### Alert Triggers

| Pattern | Threshold | Alert |
|---------|-----------|-------|
| Stuck Task | Same task, 5+ consecutive days | "Task X stuck for 5 days" |
| Commitment Miss | 2+ days past committed date | "John's commitment overdue" |
| Repeat Blocker | Same blocker type, 3+ occurrences | "Vendor delays - 3rd time" |
| Estimation Blow | Task at 3x+ original estimate | "PCB layout at 3x estimate" |
| Stagnation | No check-in or activity in 48h | "No updates from John in 2 days" |

### Alert Delivery
- Push notification (mobile)
- Email digest option
- Integration with Slack/Teams (future)

### Alert Levels
- **Critical** (red): Immediate intervention likely needed
- **Warning** (yellow): Trending negative, monitor closely
- **Info** (blue): FYI, no action required

---

## 8. Intelligence Layer Details

### Pattern Detection Algorithms

#### Stuck Task Detection
```
IF task mentioned in >= 3 consecutive days
   AND no completion recorded
   AND status unchanged
THEN flag as "stuck"

Severity = days_stuck / estimated_duration
```

#### Commitment Tracking
```
EXTRACT commitments: "I'll have X done by [DATE]"
STORE: who, what, promised_date
ON promised_date + 1:
   CHECK: completion recorded?
   IF no: flag as "commitment miss"
```

#### Estimation Variance
```
FOR each completed task:
   variance = actual_duration / estimated_duration
   STORE by: engineer, task_type, project

AGGREGATE patterns:
   - Engineer average variance
   - Task type average variance
   - Identify systematic underestimation
```

#### Recurring Blocker Detection
```
CLUSTER blockers by semantic similarity
IF same blocker type appears 3+ times in 30 days:
   FLAG as "recurring blocker"
   ATTRIBUTE: internal vs external
```

### Learning System

#### What It Learns
1. **Engineer patterns**: Who underestimates, by how much, on what task types
2. **Task type patterns**: Which categories consistently take longer
3. **Language patterns**: Phrases that precede missed deadlines
4. **Blocker patterns**: Common delay causes by project type

#### How It Learns
- Track predictions vs. actuals
- Feedback loop from manager corrections
- Explicit teaching ("this project is called X, aliases: Y, Z")

#### How Learning Improves Questions
```
IF engineer.pcb_variance > 2.0:
   WHEN asking about PCB tasks:
   ADD context: "Your PCB tasks typically take {variance}x estimate"

IF task.days_in_progress > engineer.avg_completion_time:
   PROBE: "This is taking longer than your average. Anything blocking?"
```

---

## 9. Data Model

### Core Entities

#### Activity
```typescript
interface Activity {
  id: string;
  source: 'transcript' | 'checkin' | 'manual';
  sourceId: string; // transcript ID, checkin ID, etc.
  projectId: string;

  type: 'progress' | 'blocker' | 'decision' | 'commitment' | 'risk' | 'note';
  summary: string;
  rawText?: string;

  // Attribution
  personId?: string;
  personName?: string;
  attribution?: 'Internal-Team' | 'Internal-Process' | 'External-Client' | 'External-Vendor';

  // Linking
  taskId?: string;
  milestoneId?: string;

  // Timestamps
  activityDate: Date;
  extractedAt: Date;

  // AI confidence
  confidence: number;
}
```

#### Commitment
```typescript
interface Commitment {
  id: string;
  activityId: string; // source activity
  projectId: string;

  personId: string;
  personName: string;

  description: string;
  promisedDate: Date;

  // Tracking
  status: 'open' | 'completed' | 'missed' | 'revised';
  completedDate?: Date;
  revisedDate?: Date;
  revisionReason?: string;

  // Linking
  taskId?: string;
}
```

#### Pattern
```typescript
interface Pattern {
  id: string;
  projectId: string;
  type: 'stuck_task' | 'commitment_miss' | 'estimation_variance' | 'recurring_blocker';

  // What triggered it
  relatedActivityIds: string[];
  relatedTaskId?: string;
  personId?: string;

  // Details
  description: string;
  severity: 'critical' | 'warning' | 'info';
  metric: number; // e.g., days stuck, variance ratio

  // Lifecycle
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: string;

  // Was this surfaced?
  alertSent: boolean;
  briefingIncluded: boolean;
}
```

#### CheckIn
```typescript
interface CheckIn {
  id: string;
  engineerId: string;
  date: Date;

  questions: CheckInQuestion[];
  completedAt?: Date;

  // Derived
  extractedActivities: string[]; // Activity IDs
}

interface CheckInQuestion {
  id: string;
  questionText: string;
  questionType: 'task_status' | 'completion' | 'blocker' | 'commitment' | 'time_check';

  // Context that generated this question
  relatedTaskId?: string;
  relatedCommitmentId?: string;
  patternContext?: string;

  // Response
  response?: string;
  respondedAt?: Date;
}
```

#### EngineerProfile (Learning)
```typescript
interface EngineerProfile {
  id: string;
  name: string;

  // Learned patterns
  estimationVariance: {
    overall: number;
    byTaskType: Record<string, number>;
  };

  avgCompletionTime: {
    overall: number;
    byTaskType: Record<string, number>;
  };

  commitmentReliability: number; // % of commitments met

  // Question calibration
  questionAggressiveness: 'gentle' | 'standard' | 'direct';

  lastUpdated: Date;
}
```

### Storage Considerations

#### Why Vector Store Might Be Needed
- **Semantic search**: "Find all discussions about vendor delays" needs to match variations ("waiting on supplier", "vendor hasn't responded", etc.)
- **Similarity matching**: Detecting that "power supply design" and "PSU work" are the same thing
- **Cross-transcript patterns**: Finding related mentions across many documents

#### Recommended Approach
1. **Primary store**: Firestore for structured data (activities, commitments, patterns, check-ins)
2. **Vector store**: Pinecone or similar for semantic search and similarity (activity embeddings)
3. **Sync**: Activities stored in both, linked by ID

---

## 10. Integration Points

### BOM Tracker Integration
The Project Intelligence Service feeds relevant insights to BOM Tracker:

| Insight Type | BOM Tracker Use |
|--------------|-----------------|
| Supply chain blockers | Surface in Inward Tracking |
| Vendor delays pattern | Flag in vendor performance |
| Commitment on delivery | Link to expected arrival |

### API Design
```typescript
// Get insights for a project
GET /api/projects/{projectId}/insights
  ?types=stuck_task,commitment_miss
  &severity=critical,warning
  &since=2026-01-01

// Get daily briefing
GET /api/briefings/daily
  ?projectIds=proj1,proj2
  &date=2026-01-06

// Submit check-in
POST /api/checkins
  { engineerId, responses: [...] }

// Query project history
POST /api/query
  { projectId, question: "When did we decide on vendor X?" }
```

---

## 11. Implementation Phases

### Phase 1: Foundation (MVP)
**Goal**: Basic cross-transcript pattern detection

- [ ] Enhance activity extraction with commitment detection
- [ ] Store activities with proper attribution
- [ ] Basic stuck-task detection (same task, multiple days)
- [ ] Simple daily briefing (list of stuck tasks, missed commitments)
- [ ] Manual trigger for briefing generation

### Phase 2: Check-ins
**Goal**: Add active capture via intelligent questions

- [ ] Check-in data model and storage
- [ ] Basic question generation (task-status focused)
- [ ] Mobile-friendly check-in UI
- [ ] Check-in responses feed into activity stream

### Phase 3: Intelligence
**Goal**: Pattern detection gets smarter

- [ ] Commitment tracking (promise → delivery)
- [ ] Estimation variance calculation
- [ ] Recurring blocker detection
- [ ] Engineer profile building (learned patterns)

### Phase 4: Learning Questions
**Goal**: Check-in questions adapt based on history

- [ ] Context-aware question generation
- [ ] Engineer-specific question calibration
- [ ] Pattern-triggered probing questions

### Phase 5: Semantic Search
**Goal**: Enable natural language queries

- [ ] Vector embeddings for activities
- [ ] Semantic similarity matching
- [ ] Chat interface for project history queries

### Phase 6: Advanced Outputs
**Goal**: Proactive alerts and richer briefings

- [ ] Real-time critical alerts
- [ ] Suggested questions with context
- [ ] Project health scores
- [ ] Trend analysis (getting better/worse)

---

## 12. Success Metrics

### Leading Indicators
- Check-in completion rate (target: >80%)
- Daily briefing open rate (target: >90%)
- Time to complete check-in (target: <2 min)

### Lagging Indicators
- Reduction in "stuck tasks" duration (before: X days avg → after: Y days avg)
- Commitment hit rate improvement
- Estimation accuracy improvement (variance reduction)
- Customer escalations related to delays (should decrease)

### Qualitative
- Manager feels "prepared" for standups
- Engineers feel questions are "fair, not accusatory"
- Delay discussions have data, not guesses

---

## 13. Open Questions

1. **Check-in timing**: Morning (plan the day) or evening (report the day)?
2. **Multi-project engineers**: How to handle people on 3+ projects?
3. **Transcript source**: Continue with manual paste/upload, or integrate with Zoom/Teams/Meet?
4. **Alert fatigue**: How many alerts per day is too many?
5. **Privacy**: Who sees check-in responses? Just aggregated insights, or raw responses?

---

## 14. Appendix: Name Candidates

The service needs a name. Options:

| Name | Vibe |
|------|------|
| Project Pulse | Health monitoring |
| Clarity | Seeing through the noise |
| Chronicle | Historical record |
| Sentinel | Watchful guardian |
| Momentum | Tracking progress |
| Hindsight | Learning from history |

**Current working name**: Project Intelligence Service

---

*This specification is a living document. Update as implementation reveals new insights.*
