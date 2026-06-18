# Service Partial Fulfillment Tracking

**Date:** 2026-06-18  
**Status:** Approved

## Problem

Service BOM items represent a contracted not-to-exceed budget (e.g., 25 days of consultant time). Currently the system treats the full quantity as a single all-or-nothing order — there is no way to partially consume the budget across multiple periods (e.g., 5 days in April, 8 days in May). There is also no visibility into how many days remain unconsumed.

## Scope

- Add partial fulfillment tranche tracking to service BOM items
- Show consumption progress bar on service rows
- Auto-advance item status to `received` when fully consumed
- No changes to component items, status types, status labels, or inward tracking logic

## Data Model

### New type: `ServiceTranche`

```typescript
export interface ServiceTranche {
  id: string;        // uuid, client-generated
  days: number;      // min 0.5, step 0.5
  invoiceDocId?: string; // reference to ProjectDocument id
  loggedAt: string;  // ISO date string (date only, YYYY-MM-DD)
}
```

### Changes to `BOMItem`

Add one optional field:

```typescript
serviceTranches?: ServiceTranche[]; // only populated for itemType === 'service'
```

`BOMStatus` is **unchanged**: `'not-ordered' | 'ordered' | 'received'`

### Derived values (computed in UI, never stored)

```typescript
const consumedDays = (item.serviceTranches ?? []).reduce((s, t) => s + t.days, 0);
const remainingDays = item.quantity - consumedDays;
```

### `sanitizeBOMItemForFirestore`

Add `serviceTranches` to the sanitize function alongside other optional fields.

## Status Flow

Services use the same status flow as components:

```
not-ordered → ordered → received
```

The only automation: after each tranche save, if `consumedDays >= item.quantity`, the item's `status` is set to `'received'` automatically. No new statuses, no special service-only states.

## UI — BOM Item Row (`BOMPartRow`)

When `item.itemType === 'service'` and `item.status === 'ordered'`, render below the existing row fields:

```
[████████░░░░░░░░░░░░░] 8 / 25 days  •  17 days remaining   [+ Log]
```

- Use the existing `shadcn` `<Progress>` component
- `[+ Log]` button opens the Log Fulfillment dialog
- A small badge `3 entries` appears below the bar; clicking it expands an inline list of all tranches showing days + invoice icon per tranche

When `item.status === 'received'` (fully consumed):
- Bar shows `25 / 25 days` in green
- No `[+ Log]` button
- Tranche list still expandable

When `item.status === 'not-ordered'`:
- No bar, no button shown

No changes to component item rows.

## UI — Log Fulfillment Dialog

**Trigger:** `[+ Log]` button on service row  
**Title:** "Log Service Fulfillment"  
**Subtitle:** "{X} days remaining of {Y} budgeted"

### Fields

| Field | Type | Rules |
|---|---|---|
| Days consumed | Number input | Required. Min 0.5, step 0.5. Cannot exceed `remainingDays` (inline validation error if over) |
| Invoice document | File upload or existing doc picker | Optional but prominently displayed — primary audit trail for the tranche. Same picker pattern as the existing PO document link in the Order dialog |

### On save

1. Generate a `ServiceTranche` with a client-side uuid, the entered days, optional `invoiceDocId`, and today's date as `loggedAt`
2. Append to `item.serviceTranches`
3. Recompute `consumedDays`
4. If `consumedDays >= item.quantity`, set `item.status = 'received'`
5. Single Firestore update on the BOM item

### Validation

- Days field cannot be empty or zero
- Days field cannot exceed remaining days (show: "Only {X} days remain in this budget")
- If no invoice uploaded, save is still allowed (invoice is optional)

## What Is Not In Scope

- Renaming "Received" to "Fulfilled" for services (kept consistent with components)
- Multiple blanket POs per service item
- Date-range capture per tranche (minimal approach: days + invoice only)
- Cross-project fulfillment reporting
- Budget ceiling amendments / change order tracking
