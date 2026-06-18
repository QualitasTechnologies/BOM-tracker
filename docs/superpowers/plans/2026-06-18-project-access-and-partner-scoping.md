# Project Access Control & Partner Category Scoping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-admin users see only projects they are explicitly added to; external vendor partners see only BOM categories assigned to them within a project.

**Architecture:** Two layered changes — (1) project-level membership (`memberIds` array on each project, Firestore security rules enforce it, client queries filter by it) and (2) category-level scoping (`categoryScope` on `ProjectMember`, enforced in UI via a `getVisibleCategories` utility). Both share the `ProjectMember` interface. Migration function backfills existing projects so no one loses access on deploy day.

**Tech Stack:** React, TypeScript, Firebase Firestore, Firebase Functions (Node.js/CommonJS), shadcn/ui, Tailwind CSS.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/utils/projectFirestore.ts` | Modify | Add `ProjectMember`, membership fields on `Project`, member CRUD functions, update query signatures |
| `src/utils/accessControl.ts` | **Create** | `getVisibleCategories` utility |
| `src/components/Project/ProjectMembersTab.tsx` | **Create** | Members tab UI — list, add, edit scope, remove |
| `firestore.rules` | Modify | Enforce membership at DB level |
| `functions/index.js` | Modify | Add `migrateProjectMembership` callable function |
| `src/pages/BOM.tsx` | Modify | Load full project, add Members tab, apply category filtering |
| `src/pages/Projects.tsx` | Modify | Pass user info to `subscribeToProjects`; pass creator to `addProject` |
| `src/components/Project/AddProjectDialog.tsx` | Modify | Pass user info to `subscribeToProjects` |
| `src/components/Project/EditProjectDialog.tsx` | Modify | Pass user info to `subscribeToProjects` |
| `src/pages/CostAnalysis.tsx` | Modify | Pass user info to `subscribeToProjects` |
| `src/components/Transcripts/TranscriptPasteDialog.tsx` | Modify | Pass user info to `getProjects` |
| `src/components/BOM/PurchaseRequestDialog.tsx` | Modify | Accept and use visible categories |
| `src/pages/Settings.tsx` | Modify | Pending users badge; migration trigger button |

---

### Task 1: Data model — `ProjectMember` + Project membership fields + member functions

**Files:**
- Modify: `src/utils/projectFirestore.ts`

- [ ] **Step 1: Add `where` to Firestore imports**

In `src/utils/projectFirestore.ts`, line 1–15, replace the import block:

```typescript
import { db } from "@/firebase";
import {
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  where,
  DocumentData,
  Unsubscribe,
  getDoc
} from "firebase/firestore";
import type { BOMItem, BOMCategory, BOMStatus } from "@/types/bom";
import { sanitizeBOMItemForFirestore } from "@/types/bom";
```

- [ ] **Step 2: Add `ProjectMember` interface and update `Project`**

After the existing imports (before `export interface Project`), insert:

```typescript
export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  addedAt: string;      // ISO date YYYY-MM-DD
  addedBy: string;      // UID of admin who added them (or 'migration' / 'self')
  categoryScope?: string[]; // undefined = all categories (internal); [] = none; ['Mech'] = scoped
}
```

Then add two fields to the `Project` interface (after `baselinedBy?: string;`):

```typescript
  // Membership — used in Firestore security rules and client queries
  memberIds?: string[];    // UIDs of all members (optional for backward compat during migration)
  members?: ProjectMember[]; // Full member records for UI display
```

- [ ] **Step 3: Update `addProject` to accept creator info**

Replace the existing `addProject` function:

```typescript
export const addProject = async (
  project: Project,
  creator?: { uid: string; email: string; displayName: string }
) => {
  const today = new Date().toISOString().split('T')[0];
  const projectWithMembership: Project = creator
    ? {
        ...project,
        memberIds: [creator.uid],
        members: [{
          userId: creator.uid,
          email: creator.email,
          displayName: creator.displayName || creator.email,
          addedAt: today,
          addedBy: creator.uid,
        }],
      }
    : project;

  const cleanProject = Object.fromEntries(
    Object.entries(projectWithMembership).filter(([_, value]) => value !== undefined)
  );
  await setDoc(doc(projectsCol, project.projectId), cleanProject);
};
```

- [ ] **Step 4: Update `subscribeToProjects` to filter by membership**

Replace the existing `subscribeToProjects` function:

```typescript
export const subscribeToProjects = (
  callback: (projects: Project[]) => void,
  userInfo?: { uid: string; isAdmin: boolean }
): Unsubscribe => {
  const q =
    userInfo && !userInfo.isAdmin
      ? query(projectsCol, where('memberIds', 'array-contains', userInfo.uid))
      : query(projectsCol);
  return onSnapshot(q, (snapshot) => {
    const projects: Project[] = snapshot.docs.map((doc) => doc.data() as Project);
    callback(projects);
  });
};
```

- [ ] **Step 5: Update `getProjects` to filter by membership**

Replace the existing `getProjects` function:

```typescript
export const getProjects = async (
  userInfo?: { uid: string; isAdmin: boolean }
): Promise<(Project & { id: string })[]> => {
  const q =
    userInfo && !userInfo.isAdmin
      ? query(projectsCol, where('memberIds', 'array-contains', userInfo.uid))
      : query(projectsCol);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Project),
  }));
};
```

- [ ] **Step 6: Add member management functions**

Add these three functions after `deleteProject`:

```typescript
export const addProjectMember = async (
  projectId: string,
  project: Project,
  newMember: ProjectMember
): Promise<void> => {
  const updatedMemberIds = [...(project.memberIds || []), newMember.userId];
  const updatedMembers = [...(project.members || []), newMember];
  await updateDoc(doc(projectsCol, projectId), {
    memberIds: updatedMemberIds,
    members: updatedMembers,
  });
};

export const removeProjectMember = async (
  projectId: string,
  project: Project,
  userId: string
): Promise<void> => {
  const updatedMemberIds = (project.memberIds || []).filter(id => id !== userId);
  const updatedMembers = (project.members || []).filter(m => m.userId !== userId);
  await updateDoc(doc(projectsCol, projectId), {
    memberIds: updatedMemberIds,
    members: updatedMembers,
  });
};

export const updateProjectMemberScope = async (
  projectId: string,
  project: Project,
  userId: string,
  categoryScope: string[]
): Promise<void> => {
  const updatedMembers = (project.members || []).map(m =>
    m.userId === userId ? { ...m, categoryScope } : m
  );
  await updateDoc(doc(projectsCol, projectId), { members: updatedMembers });
};
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors related to `projectFirestore.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/utils/projectFirestore.ts
git commit -m "feat(types): add ProjectMember interface and membership fields to Project"
```

---

### Task 2: `getVisibleCategories` utility

**Files:**
- Create: `src/utils/accessControl.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/utils/accessControl.ts
import { BOMCategory } from '@/types/bom';
import { ProjectMember } from '@/utils/projectFirestore';

export const INTERNAL_DOMAIN = '@qualitastech.com';

export function isInternalUser(email: string): boolean {
  return email.toLowerCase().endsWith(INTERNAL_DOMAIN);
}

/**
 * Returns the BOM categories visible to the current user in this project.
 *
 * Rules:
 *  - admin role → all categories
 *  - @qualitastech.com email → all categories
 *  - external user with no categoryScope or empty scope → [] (sees nothing)
 *  - external user with categoryScope → only matching categories
 */
export function getVisibleCategories(
  userEmail: string,
  userRole: string,
  member: ProjectMember | undefined,
  allCategories: BOMCategory[]
): BOMCategory[] {
  if (userRole === 'admin') return allCategories;
  if (isInternalUser(userEmail)) return allCategories;
  if (!member?.categoryScope || member.categoryScope.length === 0) return [];
  return allCategories.filter(c => member.categoryScope!.includes(c.name));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/accessControl.ts
git commit -m "feat: add getVisibleCategories utility for partner category scoping"
```

---

### Task 3: Firestore security rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Replace the projects rule**

Replace the entire contents of `firestore.rules` with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Projects: admins see all; non-admins see only projects where their UID is in memberIds.
    // During migration window, projects without memberIds fall back to any authenticated user.
    match /projects/{projectId} {
      allow read: if request.auth != null
        && request.auth.token.status == 'approved'
        && (request.auth.token.role == 'admin'
            || (resource.data.memberIds == null)
            || request.auth.uid in resource.data.memberIds);

      allow create: if request.auth != null
        && request.auth.token.status == 'approved'
        && (request.auth.token.role == 'admin'
            || request.auth.uid in request.resource.data.memberIds);

      allow update: if request.auth != null
        && request.auth.token.status == 'approved'
        && (request.auth.token.role == 'admin'
            || (resource.data.memberIds == null)
            || request.auth.uid in resource.data.memberIds);

      allow delete: if request.auth != null
        && request.auth.token.role == 'admin';

      // Subcollections (BOM data, documents, POs, milestones, etc.)
      match /{subcollection=**} {
        allow read, write: if request.auth != null
          && request.auth.token.status == 'approved'
          && (request.auth.token.role == 'admin'
              || get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds == null
              || request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds);
      }
    }

    match /clients/{document=**} {
      allow read, write: if request.auth != null;
    }

    match /vendors/{document=**} {
      allow read, write: if request.auth != null;
    }

    match /settings/{document=**} {
      allow read, write: if request.auth != null;
    }

    match /engineerRates/{doc} {
      allow read, write: if request.auth != null
        && request.auth.token.role == 'admin'
        && request.auth.token.status == 'approved';
    }

    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Note: The `resource.data.memberIds == null` fallback ensures existing projects without membership data are still readable during the migration window. After migration runs and all projects have `memberIds`, this fallback becomes inactive.

- [ ] **Step 2: Deploy rules**

```bash
firebase deploy --only firestore:rules
```

Expected: `Deploy complete!`

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(security): enforce project membership in Firestore rules"
```

---

### Task 4: `migrateProjectMembership` Firebase Function

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Add the callable function**

Append this to `functions/index.js` (before the final `module.exports` if one exists, otherwise just append):

```javascript
// Migration: backfill memberIds/members for all existing projects that lack them.
// Adds all currently approved users to every un-migrated project.
// Call once from Settings as admin. Safe to call multiple times (idempotent per project).
exports.migrateProjectMembership = onCall(async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
  }

  const db = admin.firestore();

  // Find projects without memberIds
  const projectsSnap = await db.collection('projects').get();
  const unmigrated = projectsSnap.docs.filter(d => {
    const data = d.data();
    return !data.memberIds || data.memberIds.length === 0;
  });

  if (unmigrated.length === 0) {
    return { migrated: 0, message: 'All projects already have membership data.' };
  }

  // Collect all approved users (Firebase Auth list, up to 1000)
  const listResult = await admin.auth().listUsers(1000);
  const approvedUsers = listResult.users
    .filter(u => (u.customClaims || {}).status === 'approved')
    .map(u => ({
      userId: u.uid,
      email: u.email || '',
      displayName: u.displayName || u.email || u.uid,
    }));

  const today = new Date().toISOString().split('T')[0];
  const BATCH_SIZE = 500; // Firestore batch limit

  // Write in batches of 500
  for (let i = 0; i < unmigrated.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = unmigrated.slice(i, i + BATCH_SIZE);
    for (const projectDoc of slice) {
      batch.update(projectDoc.ref, {
        memberIds: approvedUsers.map(u => u.userId),
        members: approvedUsers.map(u => ({
          ...u,
          addedAt: today,
          addedBy: 'migration',
        })),
      });
    }
    await batch.commit();
  }

  return {
    migrated: unmigrated.length,
    totalUsers: approvedUsers.length,
    message: `Migrated ${unmigrated.length} project(s) with ${approvedUsers.length} user(s).`,
  };
});
```

- [ ] **Step 2: Deploy the function**

```bash
firebase deploy --only functions:migrateProjectMembership
```

Expected: `Deploy complete!` (function appears in Firebase console)

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): add migrateProjectMembership callable function"
```

---

### Task 5: `ProjectMembersTab` component

**Files:**
- Create: `src/components/Project/ProjectMembersTab.tsx`

This component renders the Members tab. It shows the member list, handles Add (with category selector for external users), Edit scope, and Remove.

- [ ] **Step 1: Create the component**

```typescript
// src/components/Project/ProjectMembersTab.tsx
import { useState } from 'react';
import { Pencil, Trash2, UserPlus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Project,
  ProjectMember,
  addProjectMember,
  removeProjectMember,
  updateProjectMemberScope,
} from '@/utils/projectFirestore';
import { isInternalUser } from '@/utils/accessControl';

interface AppUserOption {
  uid: string;
  email: string;
  displayName: string;
}

interface ProjectMembersTabProps {
  projectId: string;
  project: Project;
  currentUserId: string;
  isAdmin: boolean;
  categoryNames: string[];          // All canonical category names for this project
  availableUsers: AppUserOption[];  // All approved users (fetched by parent)
  onProjectUpdated: (updated: Project) => void; // Called after member changes
}

const ProjectMembersTab = ({
  projectId,
  project,
  currentUserId,
  isAdmin,
  categoryNames,
  availableUsers,
  onProjectUpdated,
}: ProjectMembersTabProps) => {
  const { toast } = useToast();
  const members: ProjectMember[] = project.members || [];

  // Add member dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUserOption | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Edit scope dialog state
  const [editMember, setEditMember] = useState<ProjectMember | null>(null);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const memberIds = project.memberIds || [];
  const nonMembers = availableUsers.filter(u => !memberIds.includes(u.uid));

  const isExternal = (email: string) => !isInternalUser(email);

  const handleAddOpen = () => {
    setSelectedUser(null);
    setSelectedCategories([]);
    setAddOpen(true);
  };

  const handleUserSelect = (user: AppUserOption) => {
    setSelectedUser(user);
    setUserPickerOpen(false);
    setSelectedCategories([]);
  };

  const toggleCategory = (cat: string, checked: boolean, list: string[], setList: (v: string[]) => void) => {
    setList(checked ? [...list, cat] : list.filter(c => c !== cat));
  };

  const handleAdd = async () => {
    if (!selectedUser) return;
    setAdding(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const newMember: ProjectMember = {
        userId: selectedUser.uid,
        email: selectedUser.email,
        displayName: selectedUser.displayName || selectedUser.email,
        addedAt: today,
        addedBy: currentUserId,
        ...(isExternal(selectedUser.email) ? { categoryScope: selectedCategories } : {}),
      };
      await addProjectMember(projectId, project, newMember);
      const updatedProject: Project = {
        ...project,
        memberIds: [...(project.memberIds || []), selectedUser.uid],
        members: [...(project.members || []), newMember],
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Member added', description: selectedUser.email });
      setAddOpen(false);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to add member', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleEditOpen = (member: ProjectMember) => {
    setEditMember(member);
    setEditCategories(member.categoryScope || []);
  };

  const handleSaveScope = async () => {
    if (!editMember) return;
    setSaving(true);
    try {
      await updateProjectMemberScope(projectId, project, editMember.userId, editCategories);
      const updatedProject: Project = {
        ...project,
        members: (project.members || []).map(m =>
          m.userId === editMember.userId ? { ...m, categoryScope: editCategories } : m
        ),
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Scope updated' });
      setEditMember(null);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update scope', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (members.length === 1) {
      toast({ title: 'Cannot remove', description: 'Project must have at least one member.', variant: 'destructive' });
      return;
    }
    try {
      await removeProjectMember(projectId, project, member.userId);
      const updatedProject: Project = {
        ...project,
        memberIds: (project.memberIds || []).filter(id => id !== member.userId),
        members: (project.members || []).filter(m => m.userId !== member.userId),
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Member removed', description: member.email });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to remove member', variant: 'destructive' });
    }
  };

  const selectedIsExternal = selectedUser ? isExternal(selectedUser.email) : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Members ({members.length})</h3>
        {isAdmin && (
          <Button size="sm" onClick={handleAddOpen} className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No members yet. Add members to grant project access.</p>
      ) : (
        <div className="border rounded-md divide-y">
          {members.map(member => {
            const external = isExternal(member.email);
            const isSelf = member.userId === currentUserId;
            return (
              <div key={member.userId} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{member.displayName || member.email}</span>
                      {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                      {external && (
                        <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">Partner</Badge>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{member.email}</span>
                    {external && member.categoryScope && member.categoryScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {member.categoryScope.map(cat => (
                          <Badge key={cat} variant="outline" className="text-xs px-1 py-0">{cat}</Badge>
                        ))}
                      </div>
                    )}
                    {external && (!member.categoryScope || member.categoryScope.length === 0) && (
                      <span className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3" /> No categories — user sees no BOM items
                      </span>
                    )}
                    {!external && (
                      <span className="text-xs text-gray-400">All categories</span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    {external && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit category scope"
                        onClick={() => handleEditOpen(member)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-700"
                      title="Remove member"
                      onClick={() => handleRemove(member)}
                      disabled={isSelf && members.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">User</Label>
              <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm">
                    {selectedUser ? (
                      <span>{selectedUser.displayName || selectedUser.email} <span className="text-gray-400">({selectedUser.email})</span></span>
                    ) : (
                      <span className="text-gray-400">Search users…</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name or email…" />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {nonMembers.map(u => (
                          <CommandItem key={u.uid} onSelect={() => handleUserSelect(u)}>
                            <div>
                              <div className="text-sm font-medium">{u.displayName || u.email}</div>
                              <div className="text-xs text-gray-400">{u.email}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedUser && selectedIsExternal && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Categories (partner access)</Label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-md p-2">
                  {categoryNames.map(cat => (
                    <div key={cat} className="flex items-center gap-2">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={selectedCategories.includes(cat)}
                        onCheckedChange={(checked) =>
                          toggleCategory(cat, !!checked, selectedCategories, setSelectedCategories)
                        }
                      />
                      <label htmlFor={`cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                    </div>
                  ))}
                </div>
                {selectedCategories.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!selectedUser || adding}>
              {adding ? 'Adding…' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Scope Dialog */}
      <Dialog open={!!editMember} onOpenChange={(o) => { if (!o) setEditMember(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category Scope — {editMember?.displayName || editMember?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm font-medium">Categories this partner can access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded-md p-2">
              {categoryNames.map(cat => (
                <div key={cat} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-cat-${cat}`}
                    checked={editCategories.includes(cat)}
                    onCheckedChange={(checked) =>
                      toggleCategory(cat, !!checked, editCategories, setEditCategories)
                    }
                  />
                  <label htmlFor={`edit-cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                </div>
              ))}
            </div>
            {editCategories.length === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMember(null)}>Cancel</Button>
            <Button onClick={handleSaveScope} disabled={saving}>
              {saving ? 'Saving…' : 'Save Scope'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectMembersTab;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors related to `ProjectMembersTab.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Project/ProjectMembersTab.tsx
git commit -m "feat: add ProjectMembersTab component for project membership management"
```

---

### Task 6: Wire Members tab + category filtering into BOM.tsx

**Files:**
- Modify: `src/pages/BOM.tsx`

This is the largest change. We:
1. Load the full `Project` object (currently only name/id/client is loaded)
2. Integrate `useAuth` to get current user's email and role
3. Compute `visibleCategories` using `getVisibleCategories`
4. Add a 7th Members tab
5. Pass `visibleCategories` (not `categories`) to BOM rendering, header metrics, InwardTracking, and PurchaseRequestDialog
6. Fetch approved users list for the Members tab

- [ ] **Step 1: Add imports to BOM.tsx**

At the top of `src/pages/BOM.tsx`, add these imports alongside existing ones:

```typescript
import { useAuth } from '@/hooks/useAuth';
import { Project } from '@/utils/projectFirestore';
import { getVisibleCategories } from '@/utils/accessControl';
import ProjectMembersTab from '@/components/Project/ProjectMembersTab';
import { fetchAllUsers } from '@/utils/userService';
```

Also add `UserCheck` to the existing lucide-react import line (line 2):
```typescript
import { Search, Plus, Download, Filter, X, Upload, Package, FileText, Users, ChevronDown, ChevronUp, Milestone, Brain, UserCheck } from 'lucide-react';
```

- [ ] **Step 2: Add state variables in the BOM component**

Inside `const BOM = () => {`, after the existing state declarations, add:

```typescript
const { user, isAdmin } = useAuth();
const [fullProject, setFullProject] = useState<Project | null>(null);
const [approvedUsers, setApprovedUsers] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
```

- [ ] **Step 3: Load the full project object**

In the `loadProjectDetails` useEffect (around line 168), replace:

```typescript
const projectData = projectSnap.data() as { projectName: string; projectId: string; clientName: string };
setProjectDetails({
  projectName: projectData.projectName,
  projectId: projectData.projectId,
  clientName: projectData.clientName,
});
```

with:

```typescript
const projectData = projectSnap.data() as Project & { projectName: string; clientName: string };
setFullProject(projectData);
setProjectDetails({
  projectName: projectData.projectName,
  projectId: projectData.projectId,
  clientName: projectData.clientName,
});
```

Also add the approved users fetch inside `loadProjectDetails` (after setting `projectDocuments`):

```typescript
// Load approved users for Members tab (admin only, but fetch lazily)
try {
  const result = await fetchAllUsers() as { users: Array<{ uid: string; email?: string; displayName?: string; customClaims?: { status?: string } }> };
  const approved = (result.users || [])
    .filter(u => (u.customClaims?.status) === 'approved')
    .map(u => ({ uid: u.uid, email: u.email || '', displayName: u.displayName || u.email || '' }));
  setApprovedUsers(approved);
} catch {
  // Non-admin users won't have access to fetchAllUsers — that's fine
}
```

- [ ] **Step 4: Compute `visibleCategories`**

After the `calculateBOMMetrics` function definition, add:

```typescript
const currentMember = fullProject?.members?.find(m => m.userId === user?.uid);
const visibleCategories = user
  ? getVisibleCategories(
      user.email || '',
      user.claims?.role || 'user',
      currentMember,
      categories
    )
  : categories;
```

- [ ] **Step 5: Update `calculateBOMMetrics` to use `visibleCategories`**

Change line 600 in `calculateBOMMetrics` from:
```typescript
const allParts = categories.flatMap(cat => cat.items);
```
to:
```typescript
const allParts = visibleCategories.flatMap(cat => cat.items);
```

- [ ] **Step 6: Update the tabs grid and add the Members tab trigger**

Find the TabsList at line 670:
```typescript
<TabsList className="grid w-full grid-cols-6 mb-4">
```
Change `grid-cols-6` to `grid-cols-7`, then add the Members tab trigger after the Context trigger:
```tsx
<TabsTrigger value="members" className="flex items-center gap-2">
  <UserCheck size={16} />
  Members
  <Badge variant="secondary" className="ml-1 text-xs">
    {fullProject?.members?.length ?? 0}
  </Badge>
</TabsTrigger>
```

- [ ] **Step 7: Replace `filteredCategories` to use `visibleCategories`**

At line 496 in `src/pages/BOM.tsx`, find:

```typescript
  const filteredCategories = categories
    .map(category => ({
```

Replace `categories` with `visibleCategories`:

```typescript
  const filteredCategories = visibleCategories
    .map(category => ({
      ...category,
      items: category.items.filter(item => {
        const matchesSearch =
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus =
          selectedStatuses.length === 0 || selectedStatuses.includes(item.status as string);
        const matchesCategory =
          selectedCategories.length === 0 || selectedCategories.includes(category.name);
        return matchesSearch && matchesStatus && matchesCategory;
      })
    }))
    .filter(category => category.items.length > 0);
```

Also at line 1117, update the filter panel category checkboxes from `categories.map` to `visibleCategories.map` so partners don't see categories outside their scope in the filter UI:

```tsx
{visibleCategories.map(cat => (
  <label key={cat.name} className="flex items-center gap-2 mb-1">
```

Write operations (`updateBOMItem`, `deleteBOMItem`, `updateBOMData`) continue to use `categories` (the full dataset) — do NOT change those.

- [ ] **Step 8: Pass `visibleCategories` to InwardTracking**

Find `<InwardTracking` in the JSX and add/update the `categories` prop:
```tsx
<InwardTracking
  categories={visibleCategories}
  ...rest of existing props...
/>
```

- [ ] **Step 9: Pass `visibleCategories` to PurchaseRequestDialog**

Find `<PurchaseRequestDialog` and change its `categories` prop:
```tsx
<PurchaseRequestDialog
  categories={visibleCategories}
  ...rest of existing props...
/>
```

- [ ] **Step 10: Add Members TabsContent**

After the last existing `</TabsContent>` (Context tab), add:

```tsx
{/* Members Tab */}
<TabsContent value="members" className="mt-0">
  {fullProject && (
    <ProjectMembersTab
      projectId={projectId || ''}
      project={fullProject}
      currentUserId={user?.uid || ''}
      isAdmin={isAdmin}
      categoryNames={categories.flatMap(c => [c.name])}
      availableUsers={approvedUsers}
      onProjectUpdated={(updated) => setFullProject(updated)}
    />
  )}
</TabsContent>
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors before proceeding.

- [ ] **Step 12: Commit**

```bash
git add src/pages/BOM.tsx
git commit -m "feat(bom): add Members tab, apply category scoping to BOM view"
```

---

### Task 7: Update callers of `subscribeToProjects` and `getProjects`

Every caller must now pass `userInfo` so the Firestore query has the membership filter.

**Files:**
- Modify: `src/pages/Projects.tsx`
- Modify: `src/components/Project/AddProjectDialog.tsx`
- Modify: `src/components/Project/EditProjectDialog.tsx`
- Modify: `src/pages/CostAnalysis.tsx`
- Modify: `src/components/Transcripts/TranscriptPasteDialog.tsx`

- [ ] **Step 1: Update `src/pages/Projects.tsx`**

Add `useAuth` import:
```typescript
import { useAuth } from '@/hooks/useAuth';
```

Inside `const Projects = () => {`, add:
```typescript
const { user, isAdmin } = useAuth();
```

Change the `subscribeToProjects` call:
```typescript
const unsubscribeProjects = subscribeToProjects(
  (fetchedProjects) => { setProjects(fetchedProjects); },
  user ? { uid: user.uid, isAdmin } : undefined
);
```

Update `handleAddProject` to pass creator info:
```typescript
const handleAddProject = async (newProject: NewProjectFormData, templateId?: string) => {
  const project: FirestoreProject = {
    projectId: newProject.id,
    projectName: newProject.name,
    clientName: newProject.client,
    description: newProject.description,
    status: newProject.status,
    deadline: newProject.deadline,
    poValue: newProject.poValue,
  };
  await addProject(project, user ? { uid: user.uid, email: user.email || '', displayName: user.displayName || '' } : undefined);
  // ... rest of function unchanged
```

- [ ] **Step 2: Update `src/components/Project/AddProjectDialog.tsx`**

Add `useAuth` import. Add `const { user, isAdmin } = useAuth();` in the component. Pass `user ? { uid: user.uid, isAdmin } : undefined` as second arg to both `subscribeToProjects` calls (lines 83 and 95).

- [ ] **Step 3: Update `src/components/Project/EditProjectDialog.tsx`**

Add `useAuth` import. Add `const { user, isAdmin } = useAuth();`. Pass `user ? { uid: user.uid, isAdmin } : undefined` to `subscribeToProjects` (line 188).

- [ ] **Step 4: Update `src/pages/CostAnalysis.tsx`**

Add `useAuth` import. Add `const { user, isAdmin } = useAuth();`. Pass `user ? { uid: user.uid, isAdmin } : undefined` to `subscribeToProjects` (line 51).

- [ ] **Step 5: Update `src/components/Transcripts/TranscriptPasteDialog.tsx`**

Add `useAuth` import. Add `const { user, isAdmin } = useAuth();`. Update `getProjects` call:
```typescript
const projectList = await getProjects(user ? { uid: user.uid, isAdmin } : undefined);
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Projects.tsx src/components/Project/AddProjectDialog.tsx src/components/Project/EditProjectDialog.tsx src/pages/CostAnalysis.tsx src/components/Transcripts/TranscriptPasteDialog.tsx
git commit -m "feat: pass user membership filter to all project queries"
```

---

### Task 8: Settings — pending users badge + migration button

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add pending count state**

In `src/pages/Settings.tsx`, find where `appUsers` state is declared (around line 121). Add next to it:

```typescript
const [pendingCount, setPendingCount] = useState(0);
```

- [ ] **Step 2: Compute pending count when users load**

In `loadUsers` (around line 999), after `setAppUsers(usersData)`, add:

```typescript
setPendingCount(usersData.filter(u => !u.status || u.status === 'pending').length);
```

- [ ] **Step 3: Add pending badge to the Users tab trigger**

Find the Users tab trigger (around line 1263):
```tsx
<TabsTrigger value="users" className="flex items-center gap-2" onClick={() => loadUsers()}>
  <UserCog size={16} />
  Users
</TabsTrigger>
```

Replace with:
```tsx
<TabsTrigger value="users" className="flex items-center gap-2 relative" onClick={() => loadUsers()}>
  <UserCog size={16} />
  Users
  {pendingCount > 0 && (
    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold h-4 min-w-4 px-1">
      {pendingCount}
    </span>
  )}
</TabsTrigger>
```

- [ ] **Step 4: Add migration button in Users tab**

In the Users tab content (find `{/* Users Tab */}` around line 2560), inside the `CardHeader` alongside the existing Refresh button, add:

```tsx
<Button
  variant="outline"
  onClick={async () => {
    try {
      const functions = getFunctions();
      const migrate = httpsCallable(functions, 'migrateProjectMembership');
      const result = await migrate();
      toast({ title: 'Migration complete', description: (result.data as { message: string }).message });
    } catch (err: any) {
      toast({ title: 'Migration failed', description: err.message, variant: 'destructive' });
    }
  }}
>
  Run Migration
</Button>
```

Also ensure `getFunctions` and `httpsCallable` are imported (add to existing firebase/functions import if not already there):
```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(settings): add pending users badge and migration trigger"
```

---

### Task 9: Deploy and verify

- [ ] **Step 1: Build the frontend**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Deploy everything**

```bash
firebase deploy
```

Expected: Hosting, functions, and rules all deploy successfully.

- [ ] **Step 3: Manual verification — internal user**

1. Log in as an `@qualitastech.com` user
2. Confirm all existing projects are visible (migration ran, or fallback rule applies)
3. Open any project → confirm a "Members" tab appears (7th tab)
4. Confirm Members tab shows all current members

- [ ] **Step 4: Manual verification — run migration**

1. Log in as admin
2. Go to Settings → Users tab
3. Click "Run Migration"
4. Confirm toast: "Migrated N project(s) with M user(s)."
5. Open any project → Members tab → confirm all users listed

- [ ] **Step 5: Manual verification — external partner**

1. Add a test account with a non-qualitastech email (or use Settings → Users to approve one)
2. In a project's Members tab, add that user with only "Mechanical" category checked
3. Log in as that partner
4. Confirm only the Mechanical category is visible in BOM Items
5. Confirm Inward Tracking only shows Mechanical items
6. Confirm PR dialog only offers Mechanical items
7. Confirm Documents tab is fully visible

- [ ] **Step 6: Manual verification — empty scope**

1. Add a partner with NO categories selected
2. Log in as that partner
3. Confirm BOM Items tab shows empty state (no categories)
4. Confirm Inward Tracking shows 0 items

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup after project access control implementation"
```
