# Partner Category-Scoped Access Design

## Goal

External vendor partners (non-`@qualitastech.com` users) can be added to a project with access restricted to specific BOM categories. Within their assigned categories they have full collaboration capability. Internal users always see everything.

---

## Access Rules

| User type | How determined | BOM visibility | Capabilities |
|---|---|---|---|
| Admin | `role === 'admin'` claim | All projects, all categories | Everything |
| Internal | email ends with `@qualitastech.com` | All categories in assigned projects | Full collaboration |
| External / Partner | any other email domain | Only explicitly assigned categories | Full collaboration within scope |

**Empty scope = no access.** An external partner with no categories assigned sees no BOM items, no inward tracking rows, and no items in the PR dialog. The BOM view renders an empty state.

---

## Data Model

### Change to `ProjectMember`

Add one optional field to the `ProjectMember` interface (`src/utils/projectFirestore.ts`):

```typescript
export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  addedAt: string;       // ISO date
  addedBy: string;       // admin UID
  categoryScope?: string[];  // Only relevant for external users.
                             // Holds canonical category names from BOMCategory.name.
                             // undefined or [] = no access for external users.
}
```

No other data model changes. `memberIds` on `Project` is unchanged — Firestore security rules continue to enforce project-level membership.

### Category scope resolution

```typescript
// src/utils/accessControl.ts  (new utility file)
export function getVisibleCategories(
  userEmail: string,
  userRole: string,           // Firebase Custom Claims role field
  member: ProjectMember | undefined,
  allCategories: BOMCategory[]
): BOMCategory[] {
  if (userRole === 'admin') return allCategories;
  const isInternal = userEmail.endsWith('@qualitastech.com');
  if (isInternal) return allCategories;
  if (!member?.categoryScope || member.categoryScope.length === 0) return [];
  return allCategories.filter(c => member.categoryScope!.includes(c.name));
}
```

This function is called in the BOM view, Inward Tracking tab, and PR dialog. Admins bypass it entirely (they see all categories).

---

## UI Changes

### Members Tab — Add Member dialog

When the admin selects a user with a non-`@qualitastech.com` email, a category selector appears:

```
Add Member
─────────────────────────────────────────────────
User:  [searchable dropdown of approved users]

Categories:   (visible only for external email)
  ☐ Vision Systems
  ☑ Mechanical
  ☑ Fasteners
  ☐ Electrical
  ☐ Sensors
  ...

⚠  No categories selected — this user will see no BOM items.

                              [Cancel]  [Add Member]
```

- The category list is drawn from the project's active categories.
- Internal users show no category selector (they always get full access).
- The warning is shown inline when zero categories are selected for an external user (not a blocker — admin can still add, useful for pre-adding before scoping).

### Members Tab — Edit existing member

Each external member row has a **pencil icon** that opens the same category selector pre-populated with their current scope. Internal member rows show "All categories" with no edit control for scope.

This is the mechanism for adding newly-created categories to an existing partner's scope.

### BOM View

- Categories outside the user's scope are completely absent — not collapsed, not grayed out.
- Financial header totals (total BOM cost, pricing progress) are calculated from visible categories only, so the partner sees their scope's cost, not the full project cost.
- All item-level actions within visible categories work normally: status changes, fulfillment logging, invoice upload, PO linking.

### Inward Tracking Tab

Rows are filtered to items belonging to visible categories only. The summary cards (Ordered, Arriving Soon, Overdue, Received) count only scoped items.

### Documents Tab

Not filtered — documents are project-level, not category-level. All partners can see and upload documents (quotes, POs, invoices). This allows them to upload their invoice against their deliveries.

### Purchase Request (PR)

The PR dialog's item list is filtered to the user's visible categories. The partner selects from their items, submits the PR, and:
- The PR email goes to the finance/project team configured in Settings → Purchase Request
- The logged-in partner is always CC'd (existing behaviour)

The finance team receives the PR and raises a PO. No new mechanism is needed beyond the category filter on the item list.

---

## Admin Workflow Summary

1. Admin adds a user to a project (Members tab)
2. If the user's email is external, admin selects one or more categories
3. Partner logs in → sees only their categories
4. When new categories are added to the project, admin returns to Members → edits the partner row → checks the new category

No automatic assignment of new categories to partners — all scope changes are explicit admin actions.

---

## Out of Scope

- Per-category permission levels (all partners have full collaboration within their scope)
- Notifications to partners when new categories are assigned to them
- Sub-project budgets scoped per partner
- Automatic prompts when new categories are created ("assign to partner?")
- Any change to Firestore security rules — category filtering is enforced in the UI layer; project-level membership remains the DB-level gate
