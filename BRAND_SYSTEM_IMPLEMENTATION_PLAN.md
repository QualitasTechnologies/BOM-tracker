# Brand-Centric System - Simplified Implementation

## 🎯 Goal (Simplified)

Separate **Brands** (OEMs/manufacturers) from **Dealers** (distributors) with a simple data model that:
1. Brands are the source of truth for manufacturers
2. Dealers distribute one or more brands
3. BOM items reference a brand (not free-text "make")

**No complex features yet:** No product catalogs, no scraping, no quote systems.

---

## 📊 Simplified Data Model

### New: Brands Collection
```typescript
interface Brand {
  id: string;
  name: string;           // e.g., "Basler", "Cognex"
  website?: string;       // Company website
  logo?: string;          // Firebase Storage URL
  logoPath?: string;      // Storage path for deletion
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}
```

### Updated: Vendor → Dealer (clarified)
```typescript
interface Dealer {
  id: string;
  company: string;        // Dealer company name
  // ... existing contact fields ...
  distributedBrands: string[];  // Brand IDs (was: makes: string[])
  // ... existing terms, rating, etc. ...
}
```

### Updated: BOM Item
```typescript
interface BOMItem {
  // ... existing fields ...
  brandId?: string;       // NEW: Reference to Brand
  make?: string;          // KEEP for backward compat (denormalized brand name)
}
```

---

## 📋 Implementation Steps

### Step 1: Create Brand Types & Firestore Utils
**File:** `src/types/brand.ts`
**File:** `src/utils/brandFirestore.ts`

Simple CRUD:
- `addBrand(brand)` → Promise<string>
- `getBrands()` → Promise<Brand[]>
- `updateBrand(id, updates)` → Promise<void>
- `deleteBrand(id)` → Promise<void>

### Step 2: Add Brands Tab in Settings
**File:** `src/pages/Settings.tsx`

- New "Brands" tab alongside Clients, Vendors, BOM Settings
- Simple table: Name, Website, Logo, Status, Actions
- Add/Edit dialog with: Name*, Website, Logo upload, Status

### Step 3: Update Vendors Tab → Dealers
**File:** `src/pages/Settings.tsx`

- Rename "Vendors" tab to "Dealers" (or keep as is, just clarify)
- Change `makes` field to use Brand dropdown (multi-select)
- Shows brand names from Brands collection

### Step 4: Update BOM Make Field
**File:** `src/components/BOM/BOMPartRow.tsx`
**File:** `src/components/BOM/AddPartDialog.tsx` (in BOM.tsx)

- Make field becomes dropdown populated from Brands collection
- On select, store both `brandId` and `make` (name for display)

---

## 🔄 Migration Strategy

**No breaking migration needed:**
1. Create Brands from existing unique `makes` values in Vendors
2. Keep `makes` field working alongside new `distributedBrands`
3. Gradually update BOM items to use `brandId`

---

## ✅ Success Criteria

- [ ] Brands can be managed in Settings
- [ ] Dealers can select which brands they distribute
- [ ] BOM "Make" field uses Brand dropdown
- [ ] Existing data continues to work

---

## 🚫 Out of Scope (For Now)

- Product catalog per brand
- Web scraping
- Quote request system
- Vendor comparison views
- Complex supplier queries

These can be added later once the basic brand foundation is working.

---

**Status:** Ready to implement
**Estimated Time:** 4-6 hours
