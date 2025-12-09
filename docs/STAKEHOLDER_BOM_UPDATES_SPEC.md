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
├── role: 'admin' | 'user' | 'viewer' | 'customer'
├── isInternalUser: boolean
├── userId: string (if internal user)
├── notificationsEnabled: boolean
├── lastNotificationSentAt: timestamp
├── createdAt: timestamp
├── createdBy: string
```

### Notification Settings (Global)

```
settings/notifications
├── enabled: boolean
├── dailyDigestTime: string (e.g., "09:00")
├── timezone: string (e.g., "Asia/Kolkata")
├── senderEmail: string
├── senderName: string
├── companyName: string
```

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

## Settings UI

### Global Notification Settings (Settings → Notifications tab)

- **Enable/Disable** daily notifications globally
- **Daily digest time**: Time picker (default 9:00 AM)
- **Timezone**: Dropdown (default Asia/Kolkata)
- **Sender email**: Must be verified in SendGrid
- **Sender name**: e.g., "BOM Tracker"
- **Company name**: For email header

### Per-Project Settings (Project → Stakeholders tab)

- List of stakeholders with toggle switches
- Add/remove stakeholders
- Manual "Send Update Now" button (for testing)

---

## Implementation Plan

### Phase 1: Data Model & Settings
1. Create stakeholder data model
2. Add notification settings to settings collection
3. Add `customer` role to userService.ts
4. Create Firestore operations for stakeholders

### Phase 2: Stakeholder UI
1. Add "Stakeholders" tab to project view
2. Build add/edit/remove stakeholder flows
3. Toggle notification preferences
4. Add notification settings to Settings page

### Phase 3: Email Function
1. Create Firebase scheduled function
2. Build email template generator
3. Integrate with existing SendGrid setup
4. Track last notification sent per stakeholder

### Phase 4: Testing & Polish
1. Test email delivery
2. Handle edge cases (no items, no changes)
3. Add "Send Now" button for manual testing
4. Add notification history/logs

---

## Configuration

### Firebase Function Schedule

```javascript
// In functions/index.js
exports.sendDailyBOMDigest = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Asia/Kolkata"
  },
  async (event) => {
    // ... send notifications
  }
);
```

The schedule time should be configurable via the settings document. If admin changes the time in settings, the function would need to be redeployed (or use a more flexible approach like Cloud Tasks).

### Simple Approach for Configurable Time

Run the function every hour and check if current time matches configured time:

```javascript
exports.sendDailyBOMDigest = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Kolkata"
  },
  async (event) => {
    const settings = await getNotificationSettings();
    const currentHour = new Date().getHours();
    const configuredHour = parseInt(settings.dailyDigestTime.split(':')[0]);

    if (currentHour !== configuredHour) {
      return; // Not the right time
    }

    // ... send notifications
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
