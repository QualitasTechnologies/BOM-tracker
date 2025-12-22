# AI-Assisted Project Planning & Monitoring

## Product Requirements Document (PRD)

**Version**: 1.0
**Created**: December 2025
**Status**: Draft

---

## Preamble: Domain Context

This PRD is designed for **industrial automation and machine vision inspection systems**. Projects in this domain combine custom hardware (machines, fixtures, conveyors) with sophisticated software (vision algorithms, inspection logic, PLC programming).

### Industry Focus

| Aspect | Description |
|--------|-------------|
| **Domain** | Industrial automation, machine vision, quality inspection systems |
| **Clients** | Manufacturing companies requiring automated inspection, sorting, or quality control |
| **Deliverables** | Turnkey inspection machines combining hardware (HW) and software (SW) |

### Typical Project Components

**Hardware (HW)**
- Mechanical structures (frames, enclosures, fixtures)
- Motion systems (conveyors, actuators, rotary tables)
- Electrical systems (panels, wiring, sensors)
- Vision hardware (industrial cameras, lenses, lighting)
- Control systems (PLCs, HMIs, I/O modules)
- Safety systems (light curtains, interlocks, e-stops)

**Software (SW)**
- Vision algorithms (defect detection, measurement, classification)
- Inspection logic (pass/fail criteria, recipe management)
- PLC programming (machine control, sequencing, safety)
- HMI development (operator interface, reporting, dashboards)
- System integration (MES/ERP connectivity, data logging)

### Domain-Specific Planning Challenges

| Challenge | Impact on Planning |
|-----------|-------------------|
| **Long lead times** | Industrial cameras (4-6 weeks), custom mechanical parts (3-4 weeks), specialized lighting |
| **HW-SW dependencies** | Vision software cannot be fully validated until hardware is assembled and calibrated |
| **Integration complexity** | Camera + lighting + optics must work together; PLC + vision + HMI must communicate |
| **Iterative tuning** | Vision algorithms often need on-site adjustment with real production samples |
| **Site dependencies** | Final commissioning depends on customer factory readiness and production schedule |
| **Sample availability** | Good/bad samples needed for algorithm development and validation |

### Why AI-Assisted Planning Matters

Traditional project planning fails in this domain because:
1. Estimation is difficult - each machine is somewhat custom
2. Dependencies are complex - HW and SW streams must converge
3. External factors (vendor delays, sample availability) frequently disrupt plans
4. Manual plan updates are tedious and quickly become stale

The AI planning system must understand these domain patterns to generate realistic estimates and identify risks early.

---

## 1. Executive Summary

### 1.1 Problem Statement

Project overruns are a recurring issue caused by poor estimation accuracy. Current project planning is manual, static, and quickly becomes outdated. Teams struggle to:
- Create accurate initial estimates for complex HW+SW projects
- Track progress across parallel hardware and software workstreams
- Understand the impact of changes and delays (vendor delays, sample availability)
- Keep plans synchronized with actual work (BOM ordering, receiving, vision development)

### 1.2 Solution Overview

An **AI-assisted project planning system** that:
1. **Generates** complete project plans from scope/spec input using AI, understanding HW+SW dependencies
2. **Integrates** with BOM Tracker to auto-create and auto-complete procurement tasks
3. **Adapts** plans when changes occur, suggesting downstream impacts on both HW and SW streams
4. **Visualizes** project timeline via Gantt chart and list views

### 1.3 Success Metrics

| Metric | Target |
|--------|--------|
| Project overruns | Reduce by 30% |
| Plan accuracy | Estimates within 20% of actual |
| Plan freshness | No task more than 3 days stale |

---

## 2. User Personas

| Persona | Role | Needs |
|---------|------|-------|
| **Project Manager** | Creates and manages project plans | Accurate estimates, clear timeline, easy updates |
| **Vision Engineer** | Develops inspection algorithms | Visibility into when hardware will be ready, sample availability |
| **Mechanical/Electrical Engineer** | Designs and assembles hardware | Clear procurement timeline, assembly dependencies |
| **CEO/Stakeholder** | Reviews project health | High-level progress view, milestone tracking |

---

## 3. Project Template Structure

All projects follow the standard pattern for vision inspection machines:

```
Design → Procurement → Assembly → Software Development → Integration & Testing → Delivery
```

### 3.1 Standard Phases and Tasks

| Phase | Typical Tasks | Duration Factors |
|-------|---------------|------------------|
| **Design** | Mechanical design, Electrical schematics, Vision system specification, Client approval | Project complexity |
| **Procurement** | Create BOM, Get quotes, Place orders, Receive items (cameras, optics, PLCs, mechanical parts) | BOM size, Vendor lead times |
| **Assembly** | Mechanical assembly, Electrical panel build, Wiring, Camera/lighting mounting | Project complexity, Resource availability |
| **Software Development** | Vision algorithm development, PLC programming, HMI development | Complexity, Sample availability |
| **Integration & Testing** | Vision calibration, PLC-Vision integration, Full system testing, Client acceptance (FAT) | Project complexity |
| **Delivery** | Documentation, Packaging, Shipping, Site installation, Commissioning (SAT), Operator training | Project scope |

### 3.2 HW and SW Parallel Streams

Unlike simple sequential projects, vision inspection machines have **parallel workstreams** that must converge:

```
                    ┌─────────────────────────────────────────────┐
                    │                  DESIGN                      │
                    │  Mechanical │ Electrical │ Vision Spec       │
                    └─────────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┴─────────────────────────┐
              │                                                    │
              ▼                                                    ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│      HARDWARE STREAM          │              │      SOFTWARE STREAM          │
├──────────────────────────────┤              ├──────────────────────────────┤
│ Procurement                   │              │ Vision Algorithm Dev          │
│ - Mechanical parts            │              │ - Image acquisition setup     │
│ - Electrical components       │              │ - Defect detection logic      │
│ - Cameras, lenses, lighting   │              │ - Measurement algorithms      │
│ - PLCs, HMIs                  │              │                               │
├──────────────────────────────┤              │ PLC Programming               │
│ Assembly                      │              │ - Machine sequence            │
│ - Mechanical build            │              │ - Safety logic                │
│ - Electrical panel            │              │ - I/O configuration           │
│ - Wiring                      │              │                               │
│ - Camera/lighting mount       │              │ HMI Development               │
└──────────────────────────────┘              │ - Operator screens            │
              │                                │ - Recipe management           │
              │                                │ - Reporting                   │
              │                                └──────────────────────────────┘
              │                                                    │
              └─────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
                    ┌─────────────────────────────────────────────┐
                    │           INTEGRATION & TESTING              │
                    │  Vision calibration │ PLC-Vision comm        │
                    │  Full system test   │ Client FAT             │
                    └─────────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌─────────────────────────────────────────────┐
                    │                 DELIVERY                     │
                    │  Site install │ Commissioning │ Training     │
                    └─────────────────────────────────────────────┘
```

### 3.3 Procurement Task Granularity

Procurement tasks use a **progressive refinement** approach:

**Stage 1: Planning (Category-based)**
```
Procurement Phase
├── Vision Components (8 items)
│   ├── Get quotes
│   ├── Place orders
│   └── Receive items
├── Electrical Components (20 items)
│   ├── Get quotes
│   ├── Place orders
│   └── Receive items
├── Mechanical Components (15 items)
│   ├── Get quotes
│   ├── Place orders
│   └── Receive items
└── Controls (PLC/HMI) (5 items)
    ├── Get quotes
    ├── Place orders
    └── Receive items
```

**Stage 2: Execution (Vendor-based)**

Once vendors are assigned to BOM items, tasks regroup by vendor:
```
Procurement Phase
├── Cognex (cameras, lighting) - PO-001
│   ├── Place order ✓
│   └── Receive items (Expected: Jan 20)
├── Siemens (PLC, HMI, I/O) - PO-002
│   ├── Place order ✓
│   └── Receive items (Expected: Jan 15)
├── Misumi (mechanical parts) - PO-003
│   ├── Place order ✓
│   └── Receive items (Expected: Jan 18)
└── Unassigned (3 items)
    └── Assign vendors & get quotes
```

---

## 4. Feature Specifications

### 4.1 Plan Generation (AI-Powered)

#### 4.1.1 Input Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| **Free-form text** | Describe project in natural language | Quick planning, simple inspection systems |
| **Structured template** | Fill in objectives, deliverables, constraints | Consistent planning, complex multi-camera systems |
| **Document upload** | Upload SOW, proposal, requirements doc | Customer projects with formal specifications |

#### 4.1.2 Structured Template Fields

```typescript
interface ProjectScopeInput {
  // Basic Info
  projectName: string;
  clientName: string;
  projectType: 'Simple' | 'Standard' | 'Complex' | 'Custom';

  // Inspection System Details
  inspectionType: 'Defect Detection' | 'Measurement' | 'Classification' | 'OCR/OCV' | 'Multi-Function';
  numberOfCameras: number;
  numberOfInspectionStations: number;

  // Objectives
  objectives: string;           // What defects/measurements?
  deliverables: string[];       // List of deliverables

  // Constraints
  targetDeadline?: Date;        // When should it be done?
  budgetRange?: 'Low' | 'Medium' | 'High';
  sampleAvailability?: 'Available Now' | 'Available Later' | 'Unknown';

  // Resources
  teamSize: number;             // Number of people
  resourceAvailability: number; // Percentage (50%, 100%)

  // BOM Reference (if exists)
  bomId?: string;               // Link to existing BOM
  estimatedBOMSize?: number;    // Or estimate if no BOM yet

  // Additional Context
  integrationRequirements?: string;  // MES, ERP, line integration
  specialRequirements?: string;
  knownRisks?: string;
}
```

#### 4.1.3 AI Generation Process

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INPUT                                │
│  (Text / Template / Document)                                │
│  "Build a 2-camera defect inspection system for PCBs..."    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI PROCESSING                             │
│  1. Parse input to understand inspection requirements        │
│  2. Determine complexity (cameras, algorithms, integration)  │
│  3. Generate HW and SW parallel streams                      │
│  4. Calculate estimates based on:                            │
│     - Project complexity                                     │
│     - Number of cameras/stations                             │
│     - BOM size (if available)                                │
│     - Resource availability                                  │
│     - Standard lead times for vision components              │
│  5. Generate dependencies (HW-SW convergence points)         │
│  6. Identify domain-specific risks                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    GENERATED PLAN                            │
│  - Milestones with dates                                     │
│  - HW tasks (procurement, assembly)                          │
│  - SW tasks (vision, PLC, HMI)                               │
│  - Dependencies (especially HW→Integration)                  │
│  - Identified risks                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    USER REVIEW                               │
│  - Edit tasks, dates, estimates                              │
│  - Add/remove tasks                                          │
│  - Adjust dependencies                                       │
│  - Approve plan                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 4.1.4 Estimation Factors

| Factor | Source | Impact |
|--------|--------|--------|
| Project complexity | User selection (Simple/Standard/Complex/Custom) | Multiplier on base estimates |
| Number of cameras | User input | Scales vision development and integration time |
| BOM size | Existing BOM or user estimate | Scales procurement & assembly time |
| Vendor lead times | BOM Tracker vendor database OR standard defaults | Sets procurement receive dates |
| Resource availability | User input (50%, 75%, 100%) | Extends duration proportionally |
| Sample availability | User input | Affects when vision development can complete |

**Complexity Multipliers:**
| Complexity | Design | Assembly | Vision Dev | Integration |
|------------|--------|----------|------------|-------------|
| Simple | 0.5x | 0.5x | 0.5x | 0.5x |
| Standard | 1.0x | 1.0x | 1.0x | 1.0x |
| Complex | 1.5x | 1.5x | 1.5x | 1.5x |
| Custom | 2.0x | 2.0x | 2.0x | 2.0x |

**Base Estimates (Standard complexity, 100% availability, 1 camera):**
| Phase | Base Duration |
|-------|---------------|
| Design | 5 days |
| Procurement (per category) | Quote: 3 days, Order: 1 day, Receive: per lead time |
| Assembly | 5 days + (BOM items / 10) days |
| Vision Algorithm Development | 5 days per camera + 3 days per inspection type |
| PLC Programming | 5 days |
| HMI Development | 3 days |
| Integration & Testing | 5 days + 2 days per camera |
| Delivery | 3 days (local) / 5 days (remote site) |

**Standard Lead Times for Vision Components:**
| Component | Typical Lead Time |
|-----------|-------------------|
| Industrial cameras (Cognex, Keyence, Basler) | 4-6 weeks |
| Machine vision lenses | 2-3 weeks |
| LED lighting (standard) | 1-2 weeks |
| LED lighting (custom) | 4-6 weeks |
| PLCs (Siemens, Allen-Bradley) | 2-4 weeks |
| HMI panels | 2-3 weeks |
| Mechanical parts (standard) | 2-3 weeks |
| Mechanical parts (custom fabrication) | 4-6 weeks |

---

### 4.2 Plan Data Model

#### 4.2.1 Core Entities

```typescript
interface ProjectPlan {
  id: string;
  projectId: string;

  // Plan metadata
  createdAt: Date;
  createdBy: string;
  lastModified: Date;
  status: 'Draft' | 'Active' | 'Completed' | 'On Hold';

  // Planning inputs (stored for reference)
  scopeInput: ProjectScopeInput;

  // Calculated fields
  plannedStartDate: Date;
  plannedEndDate: Date;
  actualStartDate?: Date;
  actualEndDate?: Date;

  // Progress
  completionPercentage: number;
}

interface Milestone {
  id: string;
  planId: string;
  projectId: string;

  // Identity
  name: string;                 // "Procurement", "Vision Development", etc.
  phase: 'Design' | 'Procurement' | 'Assembly' | 'Software' | 'Integration' | 'Delivery';
  stream: 'Hardware' | 'Software' | 'Combined';  // Which workstream
  order: number;                // Sequence within plan

  // Dates
  plannedStartDate: Date;
  plannedEndDate: Date;
  actualStartDate?: Date;
  actualEndDate?: Date;

  // Status
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  completionPercentage: number;

  // Metadata
  createdAt: Date;
  modifiedAt: Date;
}

interface Task {
  id: string;
  milestoneId: string;
  planId: string;
  projectId: string;

  // Identity
  name: string;
  description?: string;
  order: number;                // Sequence within milestone

  // Dates & Estimates
  plannedStartDate: Date;
  plannedEndDate: Date;
  estimatedDuration: number;    // In days
  actualStartDate?: Date;
  actualEndDate?: Date;
  actualDuration?: number;

  // Status
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  completionPercentage: number;

  // Assignment
  assignedTo?: string;          // User ID

  // Dependencies
  dependsOn: string[];          // Task IDs that must complete first

  // BOM Integration
  taskType: 'Manual' | 'BOM-Linked';
  linkedBOMCategory?: string;   // Category name (Stage 1)
  linkedVendorId?: string;      // Vendor ID (Stage 2)
  linkedBOMItems?: string[];    // BOM item IDs
  autoComplete: boolean;        // Auto-complete when BOM items reach status

  // Metadata
  createdAt: Date;
  modifiedAt: Date;
  createdBy: 'AI' | 'User';
}

interface TaskDependency {
  id: string;
  sourceTaskId: string;         // Task that must complete first
  targetTaskId: string;         // Task that depends on source
  dependencyType: 'FinishToStart' | 'StartToStart' | 'FinishToFinish';
}
```

#### 4.2.2 BOM-Linked Task Types

| Task Type | Trigger | Auto-Complete When |
|-----------|---------|-------------------|
| `Create BOM` | Plan created | BOM has items |
| `Get Quotes` | Manual or BOM exists | All items in category have vendor quotes |
| `Place Orders` | Quotes complete | All items in category status = "Ordered" |
| `Receive Items` | Orders placed | All items in category status = "Received" |

---

### 4.3 BOM Integration

#### 4.3.1 Auto-Task Creation

When a BOM is created or linked to a project plan:

```
BOM Created/Linked
        │
        ▼
┌───────────────────────────────────┐
│  Analyze BOM Categories           │
│  - Vision Components (8 items)    │
│  - Electrical (20 items)          │
│  - Mechanical (15 items)          │
│  - Controls (5 items)             │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│  Create Procurement Tasks         │
│  Per Category:                    │
│  - Get quotes                     │
│  - Place orders                   │
│  - Receive items                  │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│  Calculate Dates                  │
│  - Vision components: 4-6 weeks   │
│  - PLCs: 2-4 weeks                │
│  - Mechanical: 2-3 weeks          │
│  - Set dependencies               │
└───────────────────────────────────┘
```

#### 4.3.2 Auto-Task Completion

| BOM Event | Plan Update |
|-----------|-------------|
| All items in category have vendor quotes uploaded | Mark "Get Quotes" task complete |
| All items in category status → "Ordered" | Mark "Place Orders" task complete |
| All items in category status → "Received" | Mark "Receive Items" task complete |
| New vendor assigned to items | Suggest regrouping from category to vendor |
| All vision components received | Unblock "Vision Calibration" task |

#### 4.3.3 Category → Vendor Transition

When vendors are assigned to BOM items:

```
Before (Category-based):
├── Vision Components (8 items)
│   ├── Get quotes ✓
│   ├── Place orders (In Progress)
│   └── Receive items

After (Vendor-based):
├── Cognex (cameras, lighting) - PO-001 ✓
│   ├── Place order ✓
│   └── Receive items (Est: Jan 20)
├── Edmund Optics (lenses) - PO-002
│   ├── Place order ✓
│   └── Receive items (Est: Jan 15)
```

**Transition Logic:**
1. System detects >80% of items in a category have vendors assigned
2. Prompts user: "Regroup procurement tasks by vendor?"
3. If approved:
   - Archive category-based tasks
   - Create vendor-based tasks
   - Preserve completion status
   - Link to actual PO documents

---

### 4.4 Plan Monitoring & Updates

#### 4.4.1 Update Triggers

| Trigger | Source | Action |
|---------|--------|--------|
| Manual check-in | User marks task complete | Update task status, recalculate milestone % |
| BOM status change | Item ordered/received | Auto-complete linked tasks |
| Date change | User edits task date | Prompt for downstream impact |
| New information | User adds notes/blockers | Flag for attention |
| Vendor delay | Camera delivery pushed out | User updates, AI suggests HW and Integration impacts |
| Sample delay | Customer samples not available | User updates, AI suggests Vision Dev impacts |

#### 4.4.2 Downstream Impact Suggestion

When a task date changes:

```
User changes "Receive Vision Components" from Jan 20 → Feb 3 (+14 days)
        │
        ▼
┌───────────────────────────────────┐
│  AI Analyzes Dependencies         │
│  - Camera mounting depends on     │
│    receiving cameras              │
│  - Vision calibration depends on  │
│    camera mounting                │
│  - Integration depends on both    │
│    HW assembly and Vision dev     │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│  Suggested Changes                │
│  ┌─────────────────────────────┐  │
│  │ This change affects:        │  │
│  │                             │  │
│  │ Hardware Stream:            │  │
│  │ • Camera mounting: +14 days │  │
│  │ • Wiring: +14 days          │  │
│  │                             │  │
│  │ Integration:                │  │
│  │ • Vision calibration: +14d  │  │
│  │ • System testing: +14 days  │  │
│  │                             │  │
│  │ Project end: Feb 15 → Mar 1 │  │
│  │                             │  │
│  │ [Apply Changes] [Dismiss]   │  │
│  └─────────────────────────────┘  │
└───────────────────────────────────┘
```

User can:
- **Apply Changes**: Auto-update all downstream tasks
- **Dismiss**: Keep changes local (user will manually adjust)

---

### 4.5 User Interface

#### 4.5.1 Location in App

**New Tab**: "Project Plan" added to project page tabs:
```
┌──────────────────────────────────────────────────────────────┐
│  Project: PCB Defect Inspection System for Acme Electronics  │
├──────────────────────────────────────────────────────────────┤
│  [BOM Items]  [Inward Tracking]  [Documents]  [Project Plan] │
└──────────────────────────────────────────────────────────────┘
```

#### 4.5.2 Plan Views

**View Toggle:**
```
┌─────────────────────────────────────────────────────────────┐
│  [Gantt Chart]  [List View]                    [+ Add Task] │
└─────────────────────────────────────────────────────────────┘
```

**Gantt Chart View:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Task                    │ Jan 6  │ Jan 13 │ Jan 20 │ Jan 27 │ Feb 3 │
├─────────────────────────┼────────┴────────┴────────┴────────┴───────┤
│ ▼ Design                │ ████████                                   │
│   Mechanical design     │ ████                                       │
│   Vision system spec    │ ████                                       │
│   Electrical schematics │     ████                                   │
├─────────────────────────┼───────────────────────────────────────────┤
│ ▼ Procurement           │     ████████████████████                   │
│   Vision Components     │     ░░░░░░░░████████████                   │
│   Electrical            │     ░░░░████████                           │
│   Mechanical            │     ░░░░░░░░████████                       │
├─────────────────────────┼───────────────────────────────────────────┤
│ ▼ Assembly              │                     ████████████           │
│   Mechanical build      │                     ████████               │
│   Electrical panel      │                         ████████           │
│   Camera/lighting mount │                             ████           │
├─────────────────────────┼───────────────────────────────────────────┤
│ ▼ Software Development  │     ████████████████████                   │
│   Vision algorithm dev  │     ████████████████                       │
│   PLC programming       │         ████████████                       │
│   HMI development       │             ████████                       │
├─────────────────────────┼───────────────────────────────────────────┤
│ ▼ Integration & Testing │                                 ████████  │
│   Vision calibration    │                                 ████      │
│   PLC-Vision integration│                                     ████  │
│   Full system test      │                                     ████  │
└─────────────────────────┴───────────────────────────────────────────┘

Legend: ████ = Completed  ░░░░ = In Progress  ░░░░ = Not Started
        ──── = Dependency line
```

**List View:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ ▼ Design                                          Jan 6 - Jan 12    │
│   ├── ✓ Mechanical design                        Jan 6 - Jan 9     │
│   │     Assigned: Raj   │  Duration: 4 days  │  Status: Complete    │
│   ├── ✓ Vision system specification             Jan 6 - Jan 9     │
│   │     Assigned: Priya │  Duration: 4 days  │  Status: Complete    │
│   └── ○ Electrical schematics                   Jan 9 - Jan 12    │
│         Assigned: Kumar │  Duration: 3 days  │  Status: In Progress │
├─────────────────────────────────────────────────────────────────────┤
│ ▼ Software Development                            Jan 9 - Jan 30    │
│   ├── ◐ Vision algorithm development             Jan 9 - Jan 25    │
│   │     Assigned: Priya │  Duration: 12 days │  Status: In Progress │
│   │     ⚠️ Waiting for defect samples from customer                 │
│   ├── ○ PLC programming                          Jan 12 - Jan 23   │
│   │     Assigned: Kumar │  Duration: 8 days  │  Status: Not Started │
│   └── ○ HMI development                          Jan 16 - Jan 23   │
│         Assigned: Raj   │  Duration: 6 days  │  Status: Not Started │
└─────────────────────────────────────────────────────────────────────┘

Legend: ✓ Complete  ◐ In Progress  ○ Not Started  ⊘ Blocked
```

#### 4.5.3 Plan Creation Flow

**Step 1: Choose Input Method**
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Create Project Plan                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   How would you like to create the plan?                            │
│                                                                      │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│   │  📝 Describe    │  │  📋 Template    │  │  📄 Upload      │     │
│   │                 │  │                 │  │                 │     │
│   │  Write a free-  │  │  Fill in a      │  │  Upload SOW or  │     │
│   │  form project   │  │  structured     │  │  requirements   │     │
│   │  description    │  │  form           │  │  document       │     │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Step 2a: Free-form Input**
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Describe Your Project                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ Build a 2-camera PCB defect inspection system for Acme      │   │
│   │ Electronics. The system should inspect solder joints and    │   │
│   │ component placement on populated PCBs.                       │   │
│   │                                                              │   │
│   │ Key requirements:                                            │   │
│   │ - 2 x 5MP cameras with telecentric lenses                   │   │
│   │ - Top and angled lighting for solder inspection             │   │
│   │ - Conveyor integration with existing SMT line               │   │
│   │ - Siemens S7-1500 PLC control                               │   │
│   │ - Recipe-based inspection for different PCB models          │   │
│   │ - MES integration for traceability                          │   │
│   │                                                              │   │
│   │ Timeline: 6 weeks. Team: 2 engineers full-time.             │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   Project Complexity: [Standard ▼]  Resource Availability: [100% ▼] │
│                                                                      │
│   [ ] Link to existing BOM: [Select BOM ▼]                          │
│                                                                      │
│                                    [Cancel]  [Generate Plan →]       │
└─────────────────────────────────────────────────────────────────────┘
```

**Step 3: Review Generated Plan**
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Review Generated Plan                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Project: PCB Defect Inspection System                              │
│   Duration: 32 days (Jan 6 - Feb 14)                                │
│   Complexity: Standard │ Team: 2 engineers @ 100%                   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ Phase              │ Duration │ Start    │ End      │ Tasks │   │
│   ├────────────────────┼──────────┼──────────┼──────────┼───────┤   │
│   │ Design             │ 5 days   │ Jan 6    │ Jan 10   │ 4     │   │
│   │ Procurement        │ 25 days  │ Jan 8    │ Feb 7    │ 12    │   │
│   │ Assembly           │ 8 days   │ Jan 27   │ Feb 5    │ 4     │   │
│   │ Software Dev       │ 15 days  │ Jan 10   │ Jan 30   │ 4     │   │
│   │ Integration/Test   │ 7 days   │ Feb 5    │ Feb 12   │ 4     │   │
│   │ Delivery           │ 2 days   │ Feb 12   │ Feb 14   │ 3     │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ⚠️ Identified Risks:                                               │
│   • Camera lead time (4-6 weeks) is on critical path                │
│   • Vision algorithm depends on sample availability                  │
│   • MES integration complexity may require additional time           │
│                                                                      │
│   [← Back]  [Edit Plan]  [Approve & Save →]                         │
└─────────────────────────────────────────────────────────────────────┘
```

#### 4.5.4 Task Edit Dialog

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Edit Task                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Task Name: [Vision algorithm development                   ]       │
│                                                                      │
│   Milestone: [Software Development ▼]                               │
│                                                                      │
│   ┌──────────────────────┐  ┌──────────────────────┐                │
│   │ Start Date           │  │ End Date             │                │
│   │ [Jan 10, 2025    📅] │  │ [Jan 25, 2025    📅] │                │
│   └──────────────────────┘  └──────────────────────┘                │
│                                                                      │
│   Duration: [12 days   ]   Status: [In Progress ▼]                  │
│                                                                      │
│   Assigned To: [Priya - Vision Engineer ▼]                          │
│                                                                      │
│   Dependencies (must complete first):                                │
│   ☑ Vision system specification                                      │
│   ☐ Receive cameras (for final validation)                          │
│                                                                      │
│   BOM Linkage: [None - Manual Task ▼]                               │
│                                                                      │
│   Notes:                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ Waiting for defect samples from customer. Initial algorithm │   │
│   │ development using synthetic images.                          │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│                                    [Cancel]  [Save Changes]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Phases

### Phase 1: Foundation (V1)

**Scope:**
- AI plan generation from text input
- Basic template support (structured form)
- Milestones + tasks with dates and estimates
- HW and SW parallel streams
- Sequential dependencies (Finish-to-Start)
- List view UI
- Manual task updates
- Basic Gantt chart view

**Out of Scope for V1:**
- Document upload parsing
- BOM auto-integration
- Resource assignments
- Risk identification
- Complex dependencies

**Deliverables:**
1. Project Plan data models (Firestore)
2. AI plan generation Firebase Function (with vision/automation domain knowledge)
3. Plan creation dialog (text + template)
4. List view component
5. Basic Gantt chart component
6. Task edit dialog
7. Manual status updates

### Phase 2: BOM Integration (V2)

**Scope:**
- Auto-create procurement tasks from BOM categories
- Auto-complete tasks based on BOM status changes
- Category → Vendor task regrouping
- Link tasks to PO documents
- Sync expected arrival dates from BOM
- Unblock dependent tasks when components received

**Deliverables:**
1. BOM-to-Plan sync logic
2. Auto-task creation on BOM link
3. Status change listeners
4. Vendor regrouping prompt
5. PO document linking
6. Vision component → Integration task dependencies

### Phase 3: Enhanced Planning (V3)

**Scope:**
- Document upload parsing (SOW, proposals)
- Resource assignment with availability
- Risk identification and display (domain-specific risks)
- Downstream impact suggestions
- Advanced Gantt features (zoom, drag-drop)
- Sample availability tracking

**Deliverables:**
1. Document parsing Firebase Function
2. Resource management UI
3. Risk display component (vision-specific risks)
4. Impact suggestion dialog
5. Enhanced Gantt chart
6. Sample/prerequisite tracking

---

## 6. Technical Architecture

### 6.1 Firebase Collections

```
/projects/{projectId}
  /plan                     # Single document with plan metadata
  /milestones/{milestoneId} # Milestone documents
  /tasks/{taskId}           # Task documents
```

### 6.2 Firebase Functions

| Function | Type | Purpose |
|----------|------|---------|
| `generateProjectPlan` | Callable | AI plan generation with vision/automation domain knowledge |
| `parseProjectDocument` | Callable | Extract scope from uploaded SOW/specs |
| `calculatePlanImpact` | Callable | Calculate downstream date changes |
| `syncBOMToPlan` | Firestore trigger | Update tasks when BOM changes |

### 6.3 AI Prompt Structure

```typescript
const systemPrompt = `
You are a project planning assistant specializing in industrial automation
and machine vision inspection systems.

These projects combine:
- Hardware: mechanical structures, electrical systems, cameras, lighting, PLCs
- Software: vision algorithms, PLC programming, HMI development

Projects follow this pattern with parallel HW and SW streams:
Design → Procurement + Software Development (parallel) → Assembly → Integration & Testing → Delivery

Key domain knowledge:
- Industrial cameras (Cognex, Keyence, Basler) have 4-6 week lead times
- Vision algorithm development can start before hardware arrives (using synthetic images)
- But final validation requires actual hardware and production samples
- PLC-Vision integration is typically the most complex phase
- On-site commissioning often requires algorithm tuning with real production conditions

Base your estimates on:
- Project complexity: ${complexity}
- Number of cameras: ${numberOfCameras}
- Inspection type: ${inspectionType}
- BOM size: ${bomSize} items
- Resource availability: ${availability}%
- Standard lead times for vision components

Output format:
{
  "milestones": [...],
  "tasks": [...],
  "risks": [...],
  "totalDuration": number,
  "criticalPath": [...]
}
`;
```

---

## 7. Dependencies & Risks

### 7.1 Dependencies

| Dependency | Impact | Mitigation |
|------------|--------|------------|
| OpenAI API | Required for plan generation | Fallback to template-only mode |
| BOM data model | Required for integration | V1 works without BOM link |
| Vendor database | Needed for lead times | Use standard vision component defaults |

### 7.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AI generates unrealistic estimates for complex vision systems | Medium | High | User review step, domain-specific calibration |
| Camera lead time variability | High | Medium | Flag as risk, build in buffer |
| Sample availability delays | High | Medium | Track as dependency, allow parallel work |
| Complex HW-SW dependency management | Medium | Medium | Start with simple sequential, add complexity |
| Performance with large plans | Low | Medium | Pagination, lazy loading |

---

## 8. Future Considerations

These are explicitly **out of scope** but noted for future versions:

- **Predictive warnings**: "Camera delivery delay will impact integration by X days"
- **AI proactive suggestions**: "Based on this delay, I recommend starting PLC programming first..."
- **Historical learning**: "Similar 2-camera inspection systems took 15% longer than estimated"
- **Multi-project views**: Portfolio-level timeline for all active machines
- **External integrations**: Jira, Asana, MS Project import/export
- **Automated notifications**: Email/Slack alerts for overdue tasks
- **CEO Dashboard integration**: Feed milestone data to executive reporting
- **Resource optimization**: "Engineer A is overallocated in week 3"

---

## 9. Appendix

### 9.1 Example AI-Generated Plan

**Input:**
```
Build a 2-camera surface defect inspection system for automotive brake rotors.
The system should detect cracks, porosity, and surface finish defects on
machined rotors moving on a conveyor at 10 parts per minute.

Requirements:
- 2 x 12MP area scan cameras with 35mm lenses
- Dome lighting for uniform illumination
- Rotary table for 360° inspection
- Siemens S7-1200 PLC
- 15" HMI with defect visualization
- Integration with customer's MES for traceability

Timeline: 8 weeks
Team: 2 engineers at 100% availability
```

**Output:**
```json
{
  "milestones": [
    {
      "name": "Design",
      "phase": "Design",
      "stream": "Combined",
      "plannedStartDate": "2025-01-06",
      "plannedEndDate": "2025-01-13",
      "tasks": [
        { "name": "Mechanical design (frame, rotary table, enclosure)", "duration": 5 },
        { "name": "Electrical schematic design", "duration": 4 },
        { "name": "Vision system specification (cameras, lenses, lighting)", "duration": 3 },
        { "name": "Client design review and approval", "duration": 2 }
      ]
    },
    {
      "name": "Procurement",
      "phase": "Procurement",
      "stream": "Hardware",
      "plannedStartDate": "2025-01-13",
      "plannedEndDate": "2025-02-17",
      "tasks": [
        { "name": "Vision Components - Get quotes", "duration": 2, "category": "Vision" },
        { "name": "Vision Components - Place orders", "duration": 1, "category": "Vision" },
        { "name": "Vision Components - Receive (cameras, lenses, lighting)", "duration": 25, "category": "Vision" },
        { "name": "Mechanical - Get quotes", "duration": 2, "category": "Mechanical" },
        { "name": "Mechanical - Place orders", "duration": 1, "category": "Mechanical" },
        { "name": "Mechanical - Receive (frame, rotary table)", "duration": 18, "category": "Mechanical" },
        { "name": "Controls - Get quotes", "duration": 2, "category": "Controls" },
        { "name": "Controls - Place orders", "duration": 1, "category": "Controls" },
        { "name": "Controls - Receive (PLC, HMI, I/O)", "duration": 14, "category": "Controls" }
      ]
    },
    {
      "name": "Software Development",
      "phase": "Software",
      "stream": "Software",
      "plannedStartDate": "2025-01-15",
      "plannedEndDate": "2025-02-10",
      "tasks": [
        { "name": "Vision algorithm development - crack detection", "duration": 8 },
        { "name": "Vision algorithm development - porosity detection", "duration": 6 },
        { "name": "Vision algorithm development - surface finish", "duration": 6 },
        { "name": "PLC programming - rotary table control", "duration": 5 },
        { "name": "PLC programming - conveyor integration", "duration": 4 },
        { "name": "HMI development - operator interface", "duration": 5 },
        { "name": "HMI development - defect visualization", "duration": 4 }
      ]
    },
    {
      "name": "Assembly",
      "phase": "Assembly",
      "stream": "Hardware",
      "plannedStartDate": "2025-02-03",
      "plannedEndDate": "2025-02-14",
      "tasks": [
        { "name": "Mechanical assembly - frame and enclosure", "duration": 3 },
        { "name": "Rotary table installation and alignment", "duration": 2 },
        { "name": "Electrical panel build and wiring", "duration": 4 },
        { "name": "Camera and lighting mounting", "duration": 2 },
        { "name": "Conveyor interface installation", "duration": 2 }
      ]
    },
    {
      "name": "Integration & Testing",
      "phase": "Integration",
      "stream": "Combined",
      "plannedStartDate": "2025-02-17",
      "plannedEndDate": "2025-02-26",
      "tasks": [
        { "name": "Camera calibration and focusing", "duration": 2 },
        { "name": "Lighting optimization", "duration": 2 },
        { "name": "PLC-Vision communication setup", "duration": 2 },
        { "name": "Vision algorithm tuning with real rotors", "duration": 4 },
        { "name": "MES integration and testing", "duration": 3 },
        { "name": "Full system integration test", "duration": 3 },
        { "name": "Client Factory Acceptance Test (FAT)", "duration": 2 }
      ]
    },
    {
      "name": "Delivery",
      "phase": "Delivery",
      "stream": "Combined",
      "plannedStartDate": "2025-02-26",
      "plannedEndDate": "2025-03-03",
      "tasks": [
        { "name": "Documentation preparation (user manual, maintenance guide)", "duration": 2 },
        { "name": "Disassembly and packaging for shipping", "duration": 1 },
        { "name": "Site installation and commissioning (SAT)", "duration": 3 },
        { "name": "Operator training", "duration": 1 }
      ]
    }
  ],
  "risks": [
    "Camera and dome lighting lead time (5+ weeks) is on critical path",
    "Vision algorithm accuracy depends on sample availability - need good/bad rotor samples",
    "Rotary table precision affects 360° image stitching quality",
    "MES integration complexity may require additional time if API documentation incomplete",
    "On-site algorithm tuning may require multiple iterations with production conditions"
  ],
  "criticalPath": [
    "Vision Components - Receive",
    "Camera and lighting mounting",
    "Camera calibration",
    "Vision algorithm tuning",
    "Client FAT"
  ],
  "totalDuration": 40
}
```

---

*End of PRD*
