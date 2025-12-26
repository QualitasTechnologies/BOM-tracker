# BOM Spreadsheet View - Feature Specification

## Overview

Add a compact spreadsheet-like view for BOM items that mimics Google Sheets interface, with click-to-edit cells and collapsible category rows.

## User Requirements

- **View Toggle**: Switch between Card View (current) and Spreadsheet View
- **Editing**: Click-to-edit cells (like Google Sheets) - most fluid editing experience
- **Categories**: Grouped rows with collapsible category headers
- **Columns**: Compact 6-7 columns: Name, Make, SKU, Qty, Price, Total, Status

---

## Implementation Plan

### Phase 1: Create Spreadsheet Components

#### 1.1 Create `BOMSpreadsheetView.tsx`
**Path**: `src/components/BOM/BOMSpreadsheetView.tsx`

Main container component that:
- Renders a table with sticky header row
- Groups items by category with collapsible header rows
- Passes edit handlers to cell components

```typescript
interface BOMSpreadsheetViewProps {
  categories: BOMCategory[];
  onEditPart: (itemId: string, updates: Partial<BOMItem>) => void;
  onDeletePart: (itemId: string) => void;
  onStatusChange: (itemId: string, newStatus: string) => void;
  vendors: Vendor[];
  // ... other props from BOM.tsx
}
```

#### 1.2 Create `SpreadsheetCell.tsx`
**Path**: `src/components/BOM/SpreadsheetCell.tsx`

Reusable cell component with:
- Click to enter edit mode
- Different input types based on column (text, number, select)
- Escape to cancel, Enter/blur to save
- Visual feedback (border highlight when editing)

```typescript
interface SpreadsheetCellProps {
  value: string | number;
  type: 'text' | 'number' | 'select' | 'status';
  options?: string[];  // For select type
  onChange: (value: string | number) => void;
  className?: string;
  editable?: boolean;
}
```

#### 1.3 Create `SpreadsheetRow.tsx`
**Path**: `src/components/BOM/SpreadsheetRow.tsx`

Row component for a single BOM item:
- 7 columns: Name, Make, SKU, Qty, Price, Total (computed), Status
- Uses SpreadsheetCell for each editable column
- Total column is read-only (qty × price)
- Row hover highlight

#### 1.4 Create `SpreadsheetCategoryHeader.tsx`
**Path**: `src/components/BOM/SpreadsheetCategoryHeader.tsx`

Collapsible category header row:
- Full-width spanning cell with category name
- Expand/collapse chevron icon
- Item count badge
- Category total (sum of item totals)
- Background color to distinguish from data rows

---

### Phase 2: Integrate into BOM Page

#### 2.1 Update `BOM.tsx`
**Path**: `src/pages/BOM.tsx`

Changes:
1. Add `viewMode` state: `'card' | 'spreadsheet'`
2. Add view toggle buttons in toolbar (next to filter/search)
3. Conditionally render `BOMCategoryCard` (card view) or `BOMSpreadsheetView` (spreadsheet view)
4. Pass same handlers to both views

```typescript
const [viewMode, setViewMode] = useState<'card' | 'spreadsheet'>('card');
```

#### 2.2 View Toggle UI
- Two icon buttons: Grid icon (spreadsheet) and Cards icon (card view)
- Active state highlighting
- Tooltip on hover: "Spreadsheet View" / "Card View"

---

### Phase 3: Spreadsheet Styling

#### 3.1 Table Structure
- Use native HTML `<table>` for proper column alignment
- Sticky header row (`position: sticky; top: 0`)
- Column widths: Name (flex), Make (120px), SKU (100px), Qty (70px), Price (90px), Total (90px), Status (100px)
- Horizontal scroll if needed on narrow screens

#### 3.2 Cell Styling
- Borders: Light gray cell borders (like spreadsheet)
- Padding: Compact (py-1.5 px-2)
- Font: Smaller than card view (text-sm)
- Edit mode: Blue border, white background
- Hover: Light background highlight

#### 3.3 Category Header Styling
- Background: Light gray (#f3f4f6)
- Bold text
- Sticky below main header when scrolling within category

---

## Column Specifications

| Column | Width | Type | Editable | Notes |
|--------|-------|------|----------|-------|
| Name | flex | text | Yes | Main identifier |
| Make | 120px | text/select | Yes | Autocomplete from existing makes |
| SKU | 100px | text | Yes | Part number |
| Qty | 70px | number | Yes | Quantity (0.5 min for services) |
| Price | 90px | number | Yes | Unit price (₹) |
| Total | 90px | computed | No | Qty × Price, auto-calculated |
| Status | 100px | select | Yes | not-ordered/ordered/received |

---

## Files to Create

| File | Description |
|------|-------------|
| `src/components/BOM/BOMSpreadsheetView.tsx` | Main spreadsheet container |
| `src/components/BOM/SpreadsheetCell.tsx` | Editable cell component |
| `src/components/BOM/SpreadsheetRow.tsx` | Item row component |
| `src/components/BOM/SpreadsheetCategoryHeader.tsx` | Collapsible category header |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/BOM.tsx` | Add viewMode state, toggle buttons, conditional rendering |

---

## Implementation Order

1. **SpreadsheetCell.tsx** - Core editable cell component
2. **SpreadsheetRow.tsx** - Item row using cells
3. **SpreadsheetCategoryHeader.tsx** - Category header with collapse
4. **BOMSpreadsheetView.tsx** - Main container assembling all parts
5. **BOM.tsx** - Add toggle and integrate spreadsheet view

---

## Technical Notes

### Click-to-Edit Behavior
```typescript
// SpreadsheetCell internal state
const [isEditing, setIsEditing] = useState(false);
const [editValue, setEditValue] = useState(value);

// Click to edit
onClick={() => editable && setIsEditing(true)}

// Save on blur or Enter
onBlur={() => { onChange(editValue); setIsEditing(false); }}
onKeyDown={(e) => {
  if (e.key === 'Enter') { onChange(editValue); setIsEditing(false); }
  if (e.key === 'Escape') { setEditValue(value); setIsEditing(false); }
}}
```

### Category Collapse State
- Reuse existing `category.isExpanded` from BOMCategory
- Same toggle handler as card view

### Status Change Handling
- Status dropdown triggers same `onStatusChange` as card view
- This triggers OrderItemDialog/ReceiveItemDialog when appropriate

---

## Success Criteria

1. Toggle between card and spreadsheet views preserves all data
2. Click any editable cell to edit inline
3. Categories collapse/expand with smooth animation
4. Total column auto-updates when qty/price changes
5. Status changes trigger appropriate dialogs (order/receive)
6. Responsive: Works on both desktop and tablet
7. Performance: Smooth with 100+ items

---

## Status

**Status**: PLANNED
**Priority**: Medium
**Created**: Dec 2025
