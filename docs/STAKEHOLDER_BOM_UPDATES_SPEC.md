# Stakeholder BOM Status Updates

## What This Feature Does

Sends daily email updates to project stakeholders showing the current status of all BOM items - what's ordered, what's arriving soon, what's overdue, and what's been received.

---

## Who Gets Notified?

Project stakeholders - anyone assigned to a project who has opted in to receive updates. This includes:
- Internal team members (project owners, supply chain, management)
- Customers (external contacts added to the project)

**Note**: All stakeholders see the same information in v1. No data filtering between internal/external.

---

## Email Content

### Summary
- Total items in project
- Count by status: Received / Ordered / Not Ordered
- Overall completion percentage

### Attention Required
- **Overdue items**: Past expected arrival, not yet received
- **Arriving Soon**: Expected within next 7 days

### Recent Changes (since last email)
- Items newly ordered (with expected dates)
- Items received (with actual dates)

### Full Item List
- All items grouped by category
- Status, order date, expected arrival, actual arrival for each

---

## How It Works

### Trigger: Firebase Scheduled Function

A Firebase Cloud Function runs once daily at a configured time (default: 9:00 AM IST).

```
┌─────────────────────────────────────────────────────────────┐
│                    DAILY TRIGGER FLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Firebase Scheduled Function (runs daily at 9:00 AM)        │
│                        │                                    │
│                        ▼                                    │
│  1. Get all projects with notifications enabled             │
│                        │                                    │
│                        ▼                                    │
│  2. For each project, get stakeholders                      │
│     who have notifications enabled                          │
│                        │                                    │
│                        ▼                                    │
│  3. Fetch BOM data for the project                          │
│     - Calculate summary stats                               │
│     - Find overdue items                                    │
│     - Find arriving soon items                              │
│     - Find changes since last notification                  │
│                        │                                    │
│                        ▼                                    │
│  4. Generate HTML email from template                       │
│                        │                                    │
│                        ▼                                    │
│  5. Send via SendGrid to each stakeholder                   │
│                        │                                    │
│                        ▼                                    │
│  6. Update lastNotificationSent timestamp                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Why Scheduled Function?

- **Simple**: No complex event triggers or queues
- **Predictable**: Runs at same time every day
- **Efficient**: Batches all notifications in one execution
- **Cost-effective**: Single function invocation per day
- **Configurable**: Admin can change the schedule time

---

## Stakeholder Management

### Adding Stakeholders to a Project

New "Stakeholders" tab in project view:
1. **Add Internal User**: Search from system users
2. **Add External Contact**: Enter email + name

Each stakeholder has:
- Name and email
- Role (existing roles + new `customer` role)
- Notification toggle (on/off)

### New Role: Customer

Adding `customer` to existing roles (`admin`, `user`, `viewer`):

| Role | Description |
|------|-------------|
| admin | Full system access |
| user | Can create/edit projects and BOMs |
| viewer | Read-only access to assigned projects |
| **customer** | External stakeholder, receives notifications only |

Customer permissions:
- Cannot log into the system
- Receives email notifications only
- Added per-project (not system-wide)

---

## Data Model

### Project Stakeholder

```
projects/{projectId}/stakeholders/{stakeholderId}
├── name: string
├── email: string
├── isInternalUser: boolean
├── userId: string (if internal user, null for external)
├── notificationsEnabled: boolean
├── lastNotificationSentAt: timestamp (null if never sent)
├── createdAt: timestamp
├── createdBy: string (userId of who added them)
```

**Notes:**
- External customers (non-system users) are stored here with `isInternalUser: false`
- No Firebase Auth account needed for external stakeholders
- `customer` role only exists in this context, not in Firebase Auth claims

### Notification Settings

**No separate settings collection for v1.** Reuse existing PR Settings:
- Sender email: from `settings/purchaseRequest.fromEmail`
- Company name: from `settings/purchaseRequest.companyName`
- Digest time: Hardcoded to 9:00 AM IST

---

## Sample Email

```
Subject: [Automated Testing Rig] - BOM Status Update (Dec 9, 2025)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  QUALITAS TECHNOLOGIES
  BOM Status Update
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: Automated Testing Rig
Date: December 9, 2025

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Items: 45

  ✅ Received:    12 (27%)
  📦 Ordered:     18 (40%)
  ⏳ Pending:     15 (33%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ ATTENTION REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OVERDUE (3 items):
• LCD Display 7" - Expected Dec 3 (6 days late)
• HDMI Cable - Expected Dec 5 (4 days late)
• Servo Motor MG996 - Expected Dec 7 (2 days late)

ARRIVING SOON (5 items):
• Aluminum Frame - Expected Dec 10 (1 day)
• Bearing Set - Expected Dec 12 (3 days)
• Custom PCB - Expected Dec 14 (5 days)
• Encoder Module - Expected Dec 15 (6 days)
• Power Supply 24V - Expected Dec 15 (6 days)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 CHANGES SINCE LAST UPDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RECEIVED:
• Raspberry Pi 4 - Received Dec 4
• USB Cable Set - Received Dec 6

NEWLY ORDERED:
• Arduino Mega - Ordered Dec 7, Expected Dec 21
• Stepper Motor - Ordered Dec 8, Expected Dec 22

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Questions? Contact: projects@qualitastech.com

To stop receiving these updates, contact your project manager.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## UI Components

### Stakeholders Tab (Project → BOM Page)

- List of stakeholders with name, email, type (Internal/External), notification toggle
- "Add Stakeholder" button opens dialog:
  - **Add Internal User**: Dropdown to select from system users
  - **Add External Contact**: Name + Email fields
- Toggle switch to enable/disable notifications per stakeholder
- Delete button to remove stakeholder
- "Send Update Now" button for manual testing

### No Global Settings UI for v1

Settings reused from PR Settings. No new settings tab needed.

---

## Implementation Plan (Simplified for v1)

### Step 1: Types & Firestore Operations
- Create `src/types/stakeholder.ts` with Stakeholder interface
- Create `src/utils/stakeholderFirestore.ts` with CRUD operations

### Step 2: UI Components
- Create `src/components/Stakeholders/StakeholderList.tsx`
- Create `src/components/Stakeholders/AddStakeholderDialog.tsx`
- Add "Stakeholders" tab to BOM.tsx page

### Step 3: Firebase Scheduled Function
- Add `sendDailyBOMDigest` function to `functions/index.js`
- Create email HTML template generator
- Integrate with existing SendGrid setup

### Step 4: Manual Send Function
- Add `sendBOMDigestNow` callable function for testing
- Wire up "Send Update Now" button in UI

---

## Firebase Function

```javascript
// Runs daily at 9:00 AM IST
exports.sendDailyBOMDigest = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Asia/Kolkata",
    secrets: [sendgridApiKey]
  },
  async (event) => {
    // 1. Get all projects
    // 2. For each project, get stakeholders with notificationsEnabled=true
    // 3. Fetch BOM data
    // 4. Generate email content
    // 5. Send via SendGrid
    // 6. Update lastNotificationSentAt
  }
);
```

---

## Future Enhancements (Out of Scope for v1)

- Weekly summary option (configurable frequency)
- Immediate alerts when items become overdue
- Document upload notifications
- Slack/Teams integration
- Per-stakeholder data filtering (internal vs customer view)
- Unsubscribe link in email
- Notification delivery tracking/analytics

---

## Dependencies

- **SendGrid**: Already integrated for Purchase Request emails
- **Firebase Functions**: Already deployed and configured
- **Firebase Scheduled Functions**: Uses existing Functions infrastructure

---

*Spec Version: 1.0*
*Date: December 9, 2025*
