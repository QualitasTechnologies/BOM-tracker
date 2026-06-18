# Project-Level Access Control Design

## Goal

Every non-admin user — internal staff and external partners alike — sees only the projects they are explicitly added to. Admins retain a global view. Capabilities within a project are identical for all non-admin users.

## Architecture

### Roles (unchanged)

| Role | Project visibility | Settings / Vendors | Users panel |
|---|---|---|---|
| `admin` | All projects | Full access | Full access |
| `user` | Member projects only | Read-only (no settings changes) | No access |
| `viewer` | Member projects only | Read-only | No access |

No new role is added for external partners — they receive the existing `user` role on approval. The distinction between internal and external is purely in the onboarding path.

### Data Model Changes

**Add to `Project` interface** (`src/utils/projectFirestore.ts`):

```typescript
memberIds: string[];          // UIDs — used in queries and security rules
members: ProjectMember[];     // Full records — used for UI display
```

**New `ProjectMember` interface** (same file or `src/types/project.ts`):

```typescript
export interface ProjectMember {
  userId: string;       // Firebase Auth UID
  email: string;
  displayName: string;
  addedAt: string;      // ISO date
  addedBy: string;      // admin UID who added them
}
```

Both fields travel together and must be kept in sync. `memberIds` is the authoritative set used in security rules; `members` is the display copy used in the UI.

### Firestore Security Rules

Replace the blanket `projects/{document=**}` rule with:

```
match /projects/{projectId} {
  // Admins see everything; others only see projects they're in
  allow read: if request.auth != null
    && request.auth.token.status == 'approved'
    && (request.auth.token.role == 'admin'
        || request.auth.uid in resource.data.memberIds);

  // Creating a project: any approved user (they add themselves as first member)
  allow create: if request.auth != null
    && request.auth.token.status == 'approved'
    && request.auth.uid in request.resource.data.memberIds;

  // Updating a project: must already be a member (or admin)
  allow update: if request.auth != null
    && request.auth.token.status == 'approved'
    && (request.auth.token.role == 'admin'
        || request.auth.uid in resource.data.memberIds);

  // Deleting: admin only
  allow delete: if request.auth != null
    && request.auth.token.role == 'admin';

  // All subcollections inherit parent membership
  match /{subcollection=**} {
    allow read, write: if request.auth != null
      && request.auth.token.status == 'approved'
      && (request.auth.token.role == 'admin'
          || request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds);
  }
}
```

---

## User Flows

### A — New external partner

1. Partner visits the app and signs in with Gmail
2. Firebase Auth creates their account; Firestore writes `users/{uid}` with `status: 'pending'`
3. Partner sees a **"Your account is awaiting approval"** screen — no content visible
4. Admin sees a **pending badge** on the Users panel (Settings → Users) showing count of pending accounts
5. Admin approves the user → Firebase Custom Claims set: `status: approved, role: user`
6. User still sees no projects until added to one
7. Admin (or project creator) opens a project → **Members tab** → types the partner's email → adds them
8. Partner now sees that project on their dashboard

### B — New internal hire (@qualitastech.com)

1. Signs in with Google OAuth
2. Auto-approved (existing behaviour): Custom Claims set immediately with `status: approved, role: user`
3. No projects visible — admin adds them to relevant projects
4. Admin can do this from the project Members tab or from the Users panel

### C — Admin creates a new project

1. Admin fills out the Create Project dialog (no change to UI)
2. `createProject()` writes `memberIds: [creatorUid]` and `members: [{ userId, email, displayName, addedAt, addedBy: creatorUid }]`
3. Creator immediately sees the project in their list

---

## Project Members UI

**Location:** Project page → new **Members** tab (alongside BOM Items, Inward Tracking, Documents)

**Contents:**

```
Members (3)                                          [+ Add Member]

Name            Email                     Added        Actions
─────────────────────────────────────────────────────────────────
Raghava K.      raghava@qualitastech.com  15 Jun 2026  [Owner]
Puneeth Raj     puneeth@qualitastech.com  15 Jun 2026  [Remove]
ACME Partner    contact@acme.com          18 Jun 2026  [Remove]
```

**Add Member dialog:**
- Searchable dropdown of all approved users (name + email)
- Shows only users not already on this project
- Admin-only action

**Remove:**
- Admin-only
- Cannot remove yourself if you are the only member

---

## Migration Strategy

On deploy, a **one-time migration** runs to preserve current access:

- Fetch all existing projects that have no `memberIds` field
- Fetch all currently approved users
- Write `memberIds: [all approved user UIDs]` and `members: [...]` to each project

This means no one loses access on day one. Admin can then remove individuals project-by-project as needed.

The migration runs as a callable Firebase Function (`migrateProjectMembership`) triggered once by the admin from the Settings panel. A "Run migration" button appears only when projects without `memberIds` are detected.

---

## Pending Users Notification

**Settings → Users tab** shows a badge:

```
Users  ●2 pending
```

Pending users appear at the top of the list in an amber row with an **Approve** button. Rejected users are hidden by default with a "Show rejected" toggle.

---

## Out of Scope

- Per-member permission levels within a project (viewer vs contributor) — all non-admins have the same capabilities
- Email notifications when a user is approved or added to a project
- Self-service project request (partner requests access to a specific project)
- Project transfer (changing project owner)
