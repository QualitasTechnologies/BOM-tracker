# Deep Code Review Findings

## 🔴 Critical Issues

### 1. Code Duplication - Image Upload Functions
**Location:** `src/utils/imageUpload.ts`
**Issue:** Four nearly identical functions (uploadVendorLogo, uploadBrandLogo, uploadClientLogo, uploadCompanyLogo) with only minor differences
**Impact:** High maintenance burden, bug fixes need to be applied in 4 places
**Recommendation:** Extract common logic into a reusable function

### 2. Code Duplication - cleanFirestoreData
**Location:** Multiple files (settingsFirestore.ts, timeTrackingFirestore.ts, crmFirestore.ts, poFirestore.ts, BOMTemplatesTab.tsx)
**Issue:** Same utility function duplicated across 5+ files
**Impact:** Inconsistency, maintenance issues
**Recommendation:** Create shared utility file

### 3. Null Safety - Canvas Context
**Location:** `src/utils/imageUpload.ts:76`
**Issue:** `ctx?.drawImage` - if ctx is null, promise never resolves, causing memory leak
**Impact:** Potential memory leaks, hanging promises
**Recommendation:** Add proper null check and error handling

### 4. Missing Error Handling - FileReader
**Location:** `src/components/settings/CompanySettingsTab.tsx:147-151`
**Issue:** No error handling for FileReader.onerror
**Impact:** Silent failures, poor UX
**Recommendation:** Add error handler

### 5. Missing State Reset
**Location:** `src/components/Project/EditProjectDialog.tsx:40-50`
**Issue:** `poValue` not reset when dialog closes
**Impact:** State pollution, incorrect form values
**Recommendation:** Add poValue to reset

## 🟡 Medium Priority Issues

### 6. Memory Leak - Object URLs
**Location:** `src/utils/imageUpload.ts:90`
**Issue:** `URL.createObjectURL` creates object URLs that are never revoked
**Impact:** Memory leaks over time
**Recommendation:** Revoke object URLs after use

### 7. Code Duplication - PO Format Calculation
**Location:** `src/components/settings/CompanySettingsTab.tsx:506-523`
**Issue:** Financial year calculation logic duplicated in IIFE
**Impact:** Logic inconsistency risk
**Recommendation:** Extract to helper function

### 8. Type Safety - Using 'any'
**Location:** Multiple locations
**Issue:** Using `any` type reduces type safety
**Impact:** Runtime errors, reduced IDE support
**Recommendation:** Use proper types or `unknown`

### 9. Missing Null Checks
**Location:** `src/components/Project/EditProjectDialog.tsx:79`
**Issue:** `client.company?.trim()` - if company is null, trim() will error
**Impact:** Potential runtime errors
**Recommendation:** Add proper null checks

## 🟢 Low Priority / Improvements

### 10. State Management Complexity
**Location:** `src/components/settings/CompanySettingsTab.tsx`
**Issue:** 15+ individual useState calls
**Impact:** Harder to maintain, potential for bugs
**Recommendation:** Consider useReducer for complex state

### 11. Inconsistent Error Messages
**Location:** Multiple files
**Issue:** Error messages vary in format and detail
**Impact:** Inconsistent UX
**Recommendation:** Standardize error messages

### 12. Missing Input Validation
**Location:** `src/components/settings/CompanySettingsTab.tsx:535`
**Issue:** `parseInt(e.target.value) || 1` - doesn't handle NaN properly
**Impact:** Potential incorrect values
**Recommendation:** Add proper validation


