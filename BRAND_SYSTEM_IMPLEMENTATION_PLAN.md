# Brand-Centric Vendor System - Implementation Plan

## 🎯 Overview

**Goal:** Replace the current vendor system with a brand-centric model that separates:
- **Brands** (OEMs with product catalogs)
- **Dealers** (distributors who sell multiple brands)
- **Products** (items scraped from brand websites)

**Timeline:** 6-8 weeks
**Branch:** KPI-Dashboard
**Deployment:** Incremental (feature flags for gradual rollout)

---

## 📊 Current State vs Target State

### Current State
```
Vendors Collection
├─ type: 'OEM' | 'Dealer'
├─ makes: string[]
└─ Contact info, terms, etc.

BOM Items
└─ make: string (manually entered)
```

### Target State
```
Brands Collection
├─ Name, website, logo
├─ Catalog scraping config
└─ Direct sales contact

Dealers Collection
├─ Company info
├─ distributedBrands: string[]
└─ Business terms, ratings

Products Collection
├─ brandId (links to Brand)
├─ SKU, name, specs
├─ MSRP, images
└─ Scraping metadata

BOM Items (updated)
├─ brandId (links to Brand)
├─ productId (links to Product) - optional
└─ make: string (for backward compatibility)
```

---

## 🗓️ Phase-by-Phase Breakdown

---

## **PHASE 1: Data Model & Infrastructure (Week 1-2)**

### **Week 1: Type Definitions & Schema Design**

#### **Task 1.1: Create Type Definitions**
**File:** `src/types/brand.ts`

**Types to define:**
```typescript
- Brand
- Product
- Dealer (updated from current Vendor)
- CatalogConfig
- QuoteSupplier
- BrandSuppliers
```

**Deliverables:**
- ✅ Complete TypeScript interfaces
- ✅ JSDoc comments for each type
- ✅ Helper types for queries

**Estimated Time:** 4 hours

---

#### **Task 1.2: Firestore Schema Design**
**Collections to create:**

```
/brands/{brandId}
  - name, website, logo
  - catalogConfig
  - industry, country
  - directSalesContact
  - status, timestamps

/dealers/{dealerId}
  - company, contact info
  - distributedBrands[]
  - paymentTerms, leadTime
  - rating, reliability
  - volumeDiscounts[]
  - status, timestamps

/products/{productId}
  - brandId, brand
  - sku, name, description
  - specifications{}
  - msrp, currency
  - sourceUrl, scrapedAt
  - bomCategories[]
  - discontinued, stockStatus
  - timestamps
```

**Indexes needed:**
```
brands: name, status
dealers: distributedBrands (array), status
products: brandId, sku, bomCategories (array)
```

**Deliverables:**
- ✅ Firestore security rules
- ✅ Index definitions
- ✅ Data validation rules

**Estimated Time:** 4 hours

---

#### **Task 1.3: Create Firestore Utility Functions**
**File:** `src/utils/brandFirestore.ts`

**Functions to implement:**
```typescript
// Brands
- addBrand(brand: Brand): Promise<string>
- getBrands(): Promise<Brand[]>
- getBrand(id: string): Promise<Brand>
- updateBrand(id: string, updates: Partial<Brand>): Promise<void>
- deleteBrand(id: string): Promise<void>
- subscribeToBrands(callback): Unsubscribe

// Products
- addProduct(product: Product): Promise<string>
- getProductsByBrand(brandId: string): Promise<Product[]>
- getProduct(id: string): Promise<Product>
- searchProducts(query: string): Promise<Product[]>
- updateProduct(id: string, updates: Partial<Product>): Promise<void>
- deleteProduct(id: string): Promise<void>
- subscribeToProducts(brandId: string, callback): Unsubscribe

// Dealers
- addDealer(dealer: Dealer): Promise<string>
- getDealers(): Promise<Dealer[]>
- getDealer(id: string): Promise<Dealer>
- getDealersByBrand(brand: string): Promise<Dealer[]>
- updateDealer(id: string, updates: Partial<Dealer>): Promise<void>
- deleteDealer(id: string): Promise<void>
- subscribeToDealers(callback): Unsubscribe

// Queries
- getSuppliersForBrand(brand: string): Promise<QuoteSupplier[]>
- getAllAvailableBrands(): Promise<string[]>
```

**Deliverables:**
- ✅ Complete CRUD operations for all collections
- ✅ Real-time listeners
- ✅ Error handling with try-catch
- ✅ Undefined value filtering (from recent fixes)

**Estimated Time:** 8 hours

---

### **Week 2: Data Migration & Validation**

#### **Task 1.4: Create Migration Script**
**File:** `src/utils/migrations/migrateToBrandSystem.ts`

**Migration logic:**
```typescript
1. Read all existing vendors
2. For each vendor:
   IF type === 'OEM':
     - Create Brand entry
     - Extract brand name from makes[0]
     - Set catalogConfig.enabled = false (manual setup later)

   IF type === 'Dealer' OR makes.length > 1:
     - Create Dealer entry
     - distributedBrands = makes

3. Update BOM items:
   - Add brandId field (lookup from brand name)
   - Keep make field for backward compatibility

4. Create backup before migration
5. Validate migrated data
```

**Safety measures:**
- Dry-run mode (preview changes without writing)
- Rollback capability
- Data validation at each step
- Progress logging

**Deliverables:**
- ✅ Migration script with dry-run mode
- ✅ Validation script to check data integrity
- ✅ Rollback script (emergency revert)
- ✅ Migration report (counts, errors, warnings)

**Estimated Time:** 12 hours

---

#### **Task 1.5: Data Validation & Testing**
**Create test datasets:**

```typescript
// Test brands
- Basler (pure OEM)
- Cognex (pure OEM)
- Edmund Optics (OEM + Dealer)

// Test dealers
- Edmund Optics (distributes Basler, Cognex, Edmund Optics)
- Vision Components (distributes Basler, Cognex)
- Direct from Basler (distributes Basler only)

// Test products
- 5-10 sample products per brand
- Various categories, specs, pricing
```

**Test scenarios:**
1. Create brand → Query brand → Update → Delete
2. Create dealer → Add brands → Update → Delete
3. Create product → Link to brand → Query by brand
4. Query suppliers for a brand
5. Migration with test vendor data

**Deliverables:**
- ✅ Test data fixtures
- ✅ Integration tests for all Firestore operations
- ✅ Migration test with sample data
- ✅ Validation test suite

**Estimated Time:** 8 hours

---

## **PHASE 2: Settings UI (Week 3-4)**

### **Week 3: Brands Management UI**

#### **Task 2.1: Brands List Page**
**File:** `src/pages/Settings.tsx` (new tab)

**Components to create:**
- BrandsList (table/cards view)
- BrandCard (compact view)
- Search and filter controls
- Status indicator (active/inactive)

**Features:**
- List all brands with logos
- Search by name
- Filter by status, industry
- Sort by name, product count
- Pagination (20 per page)

**Estimated Time:** 6 hours

---

#### **Task 2.2: Add/Edit Brand Dialog**
**File:** `src/components/Brand/AddBrandDialog.tsx`

**Form fields:**
```
- Brand Name * (required)
- Website * (required)
- Logo upload (optional)
- Industry tags (multi-select)
- Country (dropdown)
- Description (textarea)

Catalog Scraping Section:
- Enable scraping (toggle)
- Catalog URL
- API endpoint (optional)
- Scrape frequency (dropdown)

Direct Sales Contact (optional):
- Email
- Phone
- Website
```

**Validation:**
- Brand name unique
- Valid URL format
- Logo max 2MB

**Deliverables:**
- ✅ Add Brand dialog with validation
- ✅ Edit Brand dialog (reuse component)
- ✅ Logo upload to Firebase Storage
- ✅ Form error handling

**Estimated Time:** 8 hours

---

#### **Task 2.3: Brand Detail Page**
**File:** `src/pages/BrandDetail.tsx`

**Sections:**
1. Brand header (name, logo, status)
2. Catalog scraping status & config
3. Products list (with search/filter)
4. Dealers who distribute this brand
5. Stats (product count, dealer count)
6. Actions (edit, delete, trigger scrape)

**Estimated Time:** 6 hours

---

### **Week 4: Dealers Management UI**

#### **Task 2.4: Dealers List Page**
**File:** `src/pages/Settings.tsx` (update)

**Components:**
- DealersList (table view)
- DealerCard
- Search and filters
- Brand filter (multi-select)

**Features:**
- List all dealers
- Show distributed brands as badges
- Filter by brand, status
- Sort by rating, company name
- Export to CSV

**Estimated Time:** 6 hours

---

#### **Task 2.5: Add/Edit Dealer Dialog**
**File:** `src/components/Dealer/AddDealerDialog.tsx`

**Form fields:**
```
Company Info:
- Company Name * (required)
- Contact Person * (required)
- Email * (required)
- Phone * (required)
- Address
- Website (optional)
- Logo upload (optional)

Distributed Brands:
- Multi-select dropdown (from Brands collection)
- Search brands
- Add custom brand (creates new Brand entry)

Business Terms:
- Payment Terms * (dropdown or text)
- Lead Time * (text)
- Min Order Value (number)
- Shipping Cost (number)

Performance:
- Rating (1-5 stars)
- Reliability % (slider 0-100)
- Response Time (text)

Notes:
- Internal notes (textarea)
```

**Features:**
- Validation for required fields
- Duplicate company name check
- Logo upload
- Brand auto-complete

**Deliverables:**
- ✅ Add Dealer dialog
- ✅ Edit Dealer dialog
- ✅ Brand selection with autocomplete
- ✅ Performance metrics sliders

**Estimated Time:** 8 hours

---

#### **Task 2.6: Dealer Detail Page**
**File:** `src/pages/DealerDetail.tsx`

**Sections:**
1. Dealer header (name, logo, rating)
2. Contact information
3. Distributed brands (with links to brand pages)
4. Business terms display
5. Performance metrics
6. Quote history (if available)
7. Actions (edit, delete, contact)

**Estimated Time:** 6 hours

---

## **PHASE 3: Products Management (Week 4-5)**

### **Task 3.1: Products List & Search**
**File:** `src/pages/Products.tsx` (new page)

**Features:**
- Products table/grid view
- Search by SKU, name, description
- Filter by:
  - Brand
  - BOM category
  - Price range
  - Stock status
  - Data quality
- Sort by: name, SKU, brand, price, date added
- Bulk actions (export, delete)

**Estimated Time:** 8 hours

---

### **Task 3.2: Add/Edit Product Dialog**
**File:** `src/components/Product/AddProductDialog.tsx`

**Form fields:**
```
Basic Info:
- Brand * (dropdown)
- SKU * (required)
- Product Name * (required)
- Description (rich text)

Specifications:
- Dynamic key-value pairs
- Add/remove spec fields
- Type selector (text, number, boolean)

Pricing:
- MSRP (number)
- Currency (dropdown)

Media:
- Image upload
- Datasheet URL

Categorization:
- BOM Categories (multi-select)

Availability:
- Stock Status (dropdown)
- Discontinued (toggle)
- Replacement SKU (if discontinued)
```

**Features:**
- SKU uniqueness validation within brand
- Image upload to Firebase Storage
- Dynamic specifications builder
- Auto-save draft

**Estimated Time:** 10 hours

---

### **Task 3.3: Product Detail Page**
**File:** `src/pages/ProductDetail.tsx`

**Sections:**
1. Product header (image, name, SKU)
2. Specifications table
3. Pricing information
4. Available from dealers (list)
5. BOM usage (which projects use this)
6. Scraping metadata (if auto-scraped)
7. Actions (edit, delete, add to BOM)

**Estimated Time:** 6 hours

---

## **PHASE 4: BOM Integration (Week 5-6)**

### **Task 4.1: Update BOM Item Data Model**
**File:** `src/types/bom.ts`

**Add new fields:**
```typescript
interface BOMItem {
  // Existing fields...

  // NEW: Brand relationships
  brandId?: string;        // Links to Brand collection
  productId?: string;      // Links to Product collection

  // KEEP for backward compatibility
  make?: string;           // Brand name (denormalized)

  // Enhanced product info (from Product)
  msrp?: number;
  productSpecs?: Record<string, any>;
}
```

**Estimated Time:** 2 hours

---

### **Task 4.2: Enhanced BOM Part Selection**
**File:** `src/components/BOM/AddPartDialog.tsx`

**New workflow:**
```
1. Select Brand (dropdown with search)
   ↓
2. [Optional] Select Product from catalog
   - Shows products for selected brand
   - Displays: SKU, name, specs, MSRP
   - Auto-fills fields when selected
   ↓
3. OR manually enter part details
   - Name, SKU, description (manual entry)
   ↓
4. Enter quantity, category, etc.
```

**Features:**
- Brand autocomplete with logos
- Product search within brand
- Quick-add product from catalog
- Manual entry fallback
- Preview product specs before adding

**Deliverables:**
- ✅ Updated AddPartDialog with brand/product selection
- ✅ Product search modal
- ✅ Auto-fill from product catalog
- ✅ Backward compatibility with old BOM items

**Estimated Time:** 8 hours

---

### **Task 4.3: Quote Request System**
**File:** `src/components/BOM/RequestQuoteDialog.tsx` (new)

**Workflow:**
```
User clicks "Request Quote" on BOM item
↓
System queries: getSuppliersForBrand(item.brand)
↓
Shows dialog with:
- Direct from manufacturer (if available)
- All dealers who distribute this brand
↓
User selects suppliers and sends quote request
```

**Dialog sections:**
1. Item summary (name, SKU, quantity)
2. Available suppliers table:
   - Supplier name
   - Type (Manufacturer/Dealer)
   - Lead time
   - Rating
   - Last quoted price (if available)
   - Checkbox to select
3. Message to suppliers (textarea)
4. Send quote request button

**Features:**
- Multi-select suppliers
- Show supplier details on hover
- Pre-fill message template
- Track quote request status
- Email integration (SendGrid)

**Deliverables:**
- ✅ Quote request dialog
- ✅ Supplier selection logic
- ✅ Email template for quote requests
- ✅ Quote tracking in BOM item

**Estimated Time:** 10 hours

---

### **Task 4.4: Vendor Comparison View**
**File:** `src/components/BOM/VendorComparisonView.tsx`

**For a specific BOM item, show:**

| Supplier | Type | Unit Price | Total | Lead Time | Rating | Actions |
|----------|------|-----------|-------|-----------|--------|---------|
| Basler AG | Mfg | ₹45,000 | ₹90,000 | 4 weeks | 4.5⭐ | [Select] |
| Edmund Optics | Dealer | ₹42,000 | ₹84,000 | 2 weeks | 4.8⭐ | [Select] |
| Vision Comp | Dealer | ₹48,000 | ₹96,000 | 1 week | 4.2⭐ | [Select] |

**Features:**
- Sort by price, lead time, rating
- Highlight best value
- Show historical pricing
- Quick select winner
- Export comparison table

**Estimated Time:** 6 hours

---

## **PHASE 5: Web Scraping Foundation (Week 6-7)**

### **Task 5.1: Scraping Data Model**
**File:** `src/types/scraping.ts`

**Define:**
```typescript
interface ScrapeJob {
  id: string;
  brandId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  productsFound: number;
  productsAdded: number;
  productsUpdated: number;
  errors: string[];
}

interface ScrapeLog {
  id: string;
  jobId: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: Date;
}
```

**Estimated Time:** 2 hours

---

### **Task 5.2: Manual Scraping UI**
**File:** `src/components/Brand/ScrapingControl.tsx`

**Features:**
- Trigger manual scrape button
- Show scraping status (progress bar)
- Display logs in real-time
- Show results summary
- Error handling and retry

**Located in:** Brand Detail page

**Estimated Time:** 6 hours

---

### **Task 5.3: Scraping Scheduler (Backend)**
**File:** `functions/src/scheduledScraping.ts`

**Firebase Function:**
```typescript
// Scheduled Cloud Function
exports.scheduledScraping = functions.pubsub
  .schedule('0 2 * * *') // Daily at 2 AM
  .onRun(async () => {
    // Get brands where scraping is enabled and due
    // Trigger n8n workflows
    // Log results
  });
```

**Estimated Time:** 8 hours (includes n8n workflow setup)

---

### **Task 5.4: n8n Workflow Templates**
**Create n8n workflows for:**

1. **Generic Product Scraper**
   - HTTP Request to catalog URL
   - HTML Parser
   - Data extractor
   - Validation
   - Write to Firestore

2. **Brand-specific scrapers:**
   - Basler scraper (customized)
   - Cognex scraper (customized)
   - Edmund Optics scraper (customized)

**Deliverables:**
- ✅ n8n workflow JSON templates
- ✅ Documentation for setting up scrapers
- ✅ Error handling and retries
- ✅ Webhook integration with Firebase

**Estimated Time:** 12 hours

---

## **PHASE 6: Testing & Validation (Week 7-8)**

### **Task 6.1: Unit Tests**
**Files to test:**
- All Firestore utility functions
- Data migration script
- Validation functions
- Helper functions

**Test coverage target:** >80%

**Estimated Time:** 8 hours

---

### **Task 6.2: Integration Tests**
**Test scenarios:**
1. Complete brand CRUD workflow
2. Complete dealer CRUD workflow
3. Product catalog browsing and search
4. BOM part selection with brand/product
5. Quote request workflow
6. Supplier query for specific brand

**Estimated Time:** 10 hours

---

### **Task 6.3: User Acceptance Testing (UAT)**
**Create test plan:**
1. Migrate sample data
2. Test all UI workflows
3. Validate data integrity
4. Performance testing (large datasets)
5. Mobile responsiveness

**Test with:**
- Admin user (full access)
- Regular user (limited access)

**Estimated Time:** 8 hours

---

### **Task 6.4: Performance Optimization**
**Focus areas:**
- Query optimization (add indexes)
- Lazy loading for large lists
- Image optimization
- Caching strategies
- Bundle size reduction

**Estimated Time:** 6 hours

---

## **PHASE 7: Deployment & Rollout (Week 8)**

### **Task 7.1: Feature Flag Implementation**
**File:** `src/config/featureFlags.ts`

```typescript
export const featureFlags = {
  useBrandSystem: false,  // Toggle for gradual rollout
  enableScraping: false,   // Enable scraping features
  showProducts: false      // Show products page
};
```

**Strategy:**
1. Deploy with flags OFF
2. Enable for admin users only
3. Enable for all users after validation
4. Remove old vendor system after 2 weeks

**Estimated Time:** 4 hours

---

### **Task 7.2: Data Migration Execution**
**Steps:**
1. Backup production database
2. Run migration script in dry-run mode
3. Review migration report
4. Execute migration with rollback ready
5. Validate migrated data
6. Monitor for errors

**Estimated Time:** 4 hours

---

### **Task 7.3: Documentation**
**Create:**
1. User guide for brand management
2. User guide for dealer management
3. Admin guide for scraping setup
4. Developer documentation (API reference)
5. Troubleshooting guide

**Estimated Time:** 8 hours

---

### **Task 7.4: Training & Support**
**Activities:**
1. Create video tutorials
2. Train internal team
3. Create FAQ document
4. Set up support channel

**Estimated Time:** 6 hours

---

## 📊 Summary Timeline

| Phase | Tasks | Duration | Status |
|-------|-------|----------|--------|
| Phase 1: Data Model | Types, Schema, Utils, Migration | Week 1-2 | 🔴 Not Started |
| Phase 2: Settings UI | Brands & Dealers Management | Week 3-4 | 🔴 Not Started |
| Phase 3: Products | Products Management UI | Week 4-5 | 🔴 Not Started |
| Phase 4: BOM Integration | Part Selection, Quotes | Week 5-6 | 🔴 Not Started |
| Phase 5: Scraping | Scraping Foundation | Week 6-7 | 🔴 Not Started |
| Phase 6: Testing | Unit, Integration, UAT | Week 7-8 | 🔴 Not Started |
| Phase 7: Deployment | Migration, Docs, Training | Week 8 | 🔴 Not Started |

**Total Estimated Time:** 220 hours (~6-8 weeks with parallel work)

---

## 🎯 Success Metrics

### **Technical Metrics**
- ✅ Zero data loss during migration
- ✅ <2s page load time for brand/dealer lists
- ✅ <1s query time for supplier lookup
- ✅ >80% test coverage
- ✅ Zero critical bugs in production

### **Business Metrics**
- ✅ 100% of existing vendor data migrated successfully
- ✅ Users can request quotes 50% faster
- ✅ Reduce manual part entry time by 60% (with product catalog)
- ✅ Add 3+ scraped brands within first month
- ✅ 100+ products in catalog within first month

### **User Satisfaction**
- ✅ Admin users can manage brands/dealers easily
- ✅ BOM creation time reduced
- ✅ Quote comparison is clearer
- ✅ Positive feedback from team

---

## 🚨 Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Data loss during migration | High | Low | Full backups, dry-run testing, rollback plan |
| User adoption resistance | Medium | Medium | Training, gradual rollout, feature flags |
| Scraping complexity | Medium | High | Start with manual entry, add scraping gradually |
| Performance issues | Medium | Low | Load testing, query optimization, caching |
| Scope creep | High | Medium | Strict phase gates, focus on MVP first |

---

## 📋 Prerequisites

### **Before Starting:**
1. ✅ Backup production database
2. ✅ Set up development environment
3. ✅ Create feature branch: `brand-system`
4. ✅ Install dependencies (if any new ones needed)
5. ✅ Set up Firebase emulators for local testing

### **Access Required:**
- Firebase admin access
- n8n instance access (for scraping setup)
- SendGrid API key (for quote emails)

---

## 🔄 Rollback Plan

**If migration fails:**
1. Stop all write operations
2. Restore from backup
3. Re-enable old vendor system
4. Investigate failure
5. Fix issues and retry

**Rollback script:** `src/utils/migrations/rollbackBrandSystem.ts`

---

## 📝 Post-Implementation Tasks

### **Week 9-10: Enhancement Phase**
1. Gather user feedback
2. Fix reported bugs
3. Performance tuning
4. Add requested features

### **Week 11-12: Scraping Optimization**
1. Set up 5+ brand scrapers
2. Optimize scraping frequency
3. Improve data quality validation
4. Add more product specifications

### **Future Enhancements:**
- Price history tracking
- Automated quote comparison
- Preferred vendor recommendations
- Integration with procurement systems
- Mobile app support

---

**Document Version:** 1.0
**Last Updated:** November 25, 2025
**Author:** Development Team
**Status:** Approved for Implementation

---

*This plan will be updated as we progress through phases. Track status in project management tool.*
