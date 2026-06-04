# Planned vs Committed Cost Tracking + PO Enhancements

**Date:** 2026-06-04  
**Status:** Approved  

---

## Overview

Four related improvements to the BOM Tracker to surface planned vs actual spend, enable meaningful receipt tracking per PO line, allow PO draft editing, and improve the PO item picker UX. No new BOM item statuses are introduced — existing `not-ordered`, `ordered`, `received` are sufficient.

---

## 1. Planned vs Committed Cost Display

### Problem

The current BOM header shows a single "Total BOM Cost" = `sum(price × qty)` across all items. Once a PO is raised, there is no way to see how much is actually committed vs still on estimate.

### Design

**Two cost figures in the BOM header:**

| Metric | Calculation | Source |
|---|---|---|
| **Planned** | `sum(price × qty)` for all items | BOM item prices (unchanged from today) |
| **Committed** | `sum(POItem.amount)` for all POs in status `sent`, `partially-received`, or `completed` | Actual PO line amounts |
| **Unallocated** | Planned − Committed | Derived |

- Existing pricing-progress badge (X of Y items priced) is unchanged.
- The BOM header (`BOMHeader.tsx`) adds a second cost column alongside the existing total.
- The Cost Analysis page (`CostAnalysis.tsx`) uses Committed as the "actual material cost" alongside the existing Planned figure.

**Data flow:** `committed cost` is computed by fetching all POs for the project and summing `POItem.amount` where PO status is `sent`, `partially-received`, or `completed` (i.e. excluding `draft` and `cancelled`). Computed in the BOM page and passed down as a prop to the header.

---

## 2. PO Item Receipt Tracking

### Problem

`partially-received` PO status existed but was not actionable — no way to record which line items arrived or when.

### Design

**New fields on `POItem`:**
```typescript
receivedQty: number;      // default 0, updated when items arrive
receivedDate?: string;    // ISO date when received, optional
```

**"Mark Received" action** on POs in `sent` or `partially-received` status:
- Opens a dialog listing all PO line items
- Each row shows: description, ordered qty, a number input for received qty, and a date picker
- On save, updates each `POItem.receivedQty` and `POItem.receivedDate`

**Automatic PO status derivation** (computed, not manually set):
- All items `receivedQty >= quantity` → `completed`
- Any item `receivedQty > 0` but not all complete → `partially-received`
- No items received → `sent`

**BOM item status auto-update:** When a PO item reaches `receivedQty >= quantity`, the linked `BOMItem.status` is updated to `received` and `BOMItem.actualArrival` is set to `POItem.receivedDate`.

**`acknowledged` status removal:**
- Removed from `POStatus` type.
- Existing POs with `acknowledged` status are migrated to `sent` on first load (via a one-time Firestore migration utility or on-read coercion in `poFirestore.ts`).

---

## 3. PO Draft Editing

### Problem

POs in `draft` status cannot be edited — the only option is delete and recreate.

### Design

- An **Edit** button (pencil icon) appears in `POListSection` on cards where `status === 'draft'`.
- Clicking it opens `CreatePODialog` in edit mode, pre-populated with all existing PO data.
- Saving in edit mode calls `updatePO()` (update, not create) via `poFirestore.ts`.
- Once status moves to `sent`, the Edit button is hidden — behaviour identical to today.
- No changes to the dialog's internal logic beyond accepting an optional `existingPO` prop.

---

## 4. PO Item Picker Enhancement

### Problem

When creating a PO, the item selection step shows all BOM items without indicating which are already committed to another PO. Users have to mentally track what's already been ordered.

### Design

The BOM item selection step in `CreatePODialog` groups items into two sections:

1. **Unallocated** (no `linkedPODocumentId`) — shown first, full opacity, default expanded
2. **Already on a PO** — shown below, dimmed (50% opacity), still selectable

Items with `status === 'received'` are hidden from the picker by default (already fully received — no reason to re-order unless intended).

No new data fields needed — grouping is derived from `BOMItem.linkedPODocumentId`.

---

## Data Model Changes Summary

### `POItem` (additive, backward compatible)
```typescript
receivedQty: number;       // new — defaults to 0
receivedDate?: string;     // new — ISO date string
```

### `POStatus` type
```typescript
// Remove 'acknowledged'
type POStatus = 'draft' | 'sent' | 'partially-received' | 'completed' | 'cancelled';
```

### No changes to `BOMItem` fields

---

## Files Affected

| File | Change |
|---|---|
| `src/types/purchaseOrder.ts` | Add `receivedQty`/`receivedDate` to `POItem`; remove `acknowledged` from `POStatus` |
| `src/components/BOM/BOMHeader.tsx` | Add Committed cost display alongside Planned |
| `src/pages/BOM.tsx` | Compute committed cost from project POs; pass to header |
| `src/components/BOM/POListSection.tsx` | Add Edit button for draft POs; add Mark Received action; drive status display from computed receipts |
| `src/components/BOM/CreatePODialog.tsx` | Accept `existingPO` prop for edit mode; group item picker by allocated/unallocated |
| `src/utils/poFirestore.ts` | Add `updatePO()`; add receipt update function; coerce `acknowledged` → `sent` on read |
| `src/pages/CostAnalysis.tsx` | Show Committed alongside Planned material cost |

---

## Out of Scope

- Invoice reconciliation (actual invoice amounts vs PO amounts)
- Per-item partial quantity receipt on BOM (BOM item remains binary: ordered/received)
- New BOM item statuses
- Notification on receipt

---

## Success Criteria

1. BOM header shows both Planned and Committed cost, both update in real-time.
2. A PO in draft can be opened, edited, and saved without delete/recreate.
3. A sent PO shows a "Mark Received" action; marking partial quantities sets PO to `partially-received` without manual intervention.
4. BOM item flips to `received` automatically when all its PO qty is received.
5. PO creation dialog shows unallocated items prominently at top.
6. No regressions on existing PO create/send/PDF/email flows.
