# Service Partial Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow service BOM items to track partial consumption of a not-to-exceed day budget via invoice-linked tranches, with a progress bar on the item row.

**Architecture:** Embed `serviceTranches[]` directly on `BOMItem`. A new `LogFulfillmentDialog` component lives inside `BOMPartRow` — no prop drilling through `BOMCategoryCard` or `BOM.tsx` needed, since `projectId`, `projectDocuments`, and `onEdit` are already passed to `BOMPartRow`. Status auto-advances to `received` when `consumedDays >= quantity`.

**Tech Stack:** TypeScript, React, shadcn `<Progress>`, Firebase Firestore/Storage, existing `uploadProjectDocument` utility.

---

## File Map

| File | Change |
|---|---|
| `src/types/bom.ts` | Add `ServiceTranche` interface; add `serviceTranches` to `BOMItem`; update `sanitizeBOMItemForFirestore` |
| `src/components/BOM/LogFulfillmentDialog.tsx` | **New** — dialog with days input + invoice picker/uploader |
| `src/components/BOM/BOMPartRow.tsx` | Add `serviceTranches` to local interface; add consumption bar + tranche history; wire dialog |

No changes to `BOM.tsx`, `BOMCategoryCard.tsx`, or any other file.

---

## Task 1: Add `ServiceTranche` to types

**Files:**
- Modify: `src/types/bom.ts`

- [ ] **Step 1: Add `ServiceTranche` interface and `serviceTranches` field to `BOMItem`**

In `src/types/bom.ts`, after line 2 (`export type BOMItemType = ...`), insert:

```typescript
export interface ServiceTranche {
  id: string;           // e.g. `${Date.now()}-${Math.random().toString(36).substr(2,9)}`
  days: number;         // min 0.5, step 0.5
  invoiceDocId?: string; // reference to ProjectDocument.id
  loggedAt: string;     // ISO date YYYY-MM-DD
}
```

Then in the `BOMItem` interface, after `receivedPhotoUrl?: string;` (line 52), add:

```typescript
  // Service fulfillment tracking (services only)
  serviceTranches?: ServiceTranche[];
```

- [ ] **Step 2: Update `sanitizeBOMItemForFirestore`**

In the `sanitizeBOMItemForFirestore` function, after the `receivedPhotoUrl` line, add:

```typescript
  if (item.serviceTranches !== undefined) sanitized.serviceTranches = item.serviceTranches;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/bom.ts
git commit -m "feat(types): add ServiceTranche type and serviceTranches field to BOMItem"
```

---

## Task 2: Create `LogFulfillmentDialog`

**Files:**
- Create: `src/components/BOM/LogFulfillmentDialog.tsx`

- [ ] **Step 1: Create the file**

Create `src/components/BOM/LogFulfillmentDialog.tsx` with the following content:

```typescript
import { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth } from '@/firebase';

interface LogFulfillmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  budgetedDays: number;
  remainingDays: number;
  projectId: string;
  projectDocuments: ProjectDocument[];
  onConfirm: (data: { days: number; invoiceDocId?: string }) => void;
}

const LogFulfillmentDialog = ({
  open,
  onOpenChange,
  itemName,
  budgetedDays,
  remainingDays,
  projectId,
  projectDocuments,
  onConfirm,
}: LogFulfillmentDialogProps) => {
  const [days, setDays] = useState<string>('');
  const [invoiceDocId, setInvoiceDocId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<ProjectDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDays('');
      setInvoiceDocId('');
      setUploadedDoc(null);
    }
  }, [open]);

  const invoiceDocuments = uploadedDoc && !projectDocuments.some(d => d.id === uploadedDoc.id)
    ? [uploadedDoc, ...projectDocuments.filter(d => d.type === 'vendor-invoice')]
    : projectDocuments.filter(d => d.type === 'vendor-invoice');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const newDoc = await uploadProjectDocument(file, projectId, 'vendor-invoice', user.uid);
      setUploadedDoc(newDoc);
      setInvoiceDocId(newDoc.id);
      toast({ title: 'Invoice Uploaded', description: file.name });
    } catch (err) {
      toast({
        title: 'Upload Failed',
        description: err instanceof Error ? err.message : 'Upload error',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const daysNum = parseFloat(days);
  const validDays = !isNaN(daysNum) && daysNum >= 0.5 && daysNum <= remainingDays;
  const overBudget = !isNaN(daysNum) && daysNum > remainingDays;

  const handleConfirm = () => {
    if (!validDays) return;
    onConfirm({ days: daysNum, invoiceDocId: invoiceDocId || undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Log Service Fulfillment</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            {remainingDays} days remaining of {budgetedDays} budgeted — {itemName}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Days consumed */}
          <div className="space-y-1.5">
            <Label htmlFor="ful-days" className="text-sm font-medium">
              Days consumed <span className="text-red-500">*</span>
            </Label>
            <Input
              id="ful-days"
              type="number"
              min="0.5"
              step="0.5"
              max={remainingDays}
              value={days}
              onChange={e => setDays(e.target.value)}
              placeholder={`e.g. 5  (max ${remainingDays})`}
              className={overBudget ? 'border-red-400' : ''}
            />
            {overBudget && (
              <p className="text-xs text-red-500">
                Only {remainingDays} day{remainingDays !== 1 ? 's' : ''} remain in this budget
              </p>
            )}
          </div>

          {/* Invoice document */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Vendor Invoice</Label>
            <p className="text-xs text-gray-500">
              Attach the vendor invoice for this delivery period (recommended).
            </p>
            <div className="flex gap-2">
              <Select value={invoiceDocId} onValueChange={setInvoiceDocId}>
                <SelectTrigger className="h-9 text-sm flex-1">
                  <SelectValue placeholder="Select existing invoice" />
                </SelectTrigger>
                <SelectContent>
                  {invoiceDocuments.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-gray-500">No invoices uploaded yet</div>
                  )}
                  {invoiceDocuments.map(doc => (
                    <SelectItem key={doc.id} value={doc.id}>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3 w-3" />
                        {doc.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Upload invoice"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>
            {invoiceDocId && invoiceDocuments.find(d => d.id === invoiceDocId) && (
              <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">
                Invoice: <span className="font-medium">{invoiceDocuments.find(d => d.id === invoiceDocId)?.name}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!validDays}>
            Log {validDays ? `${daysNum}d` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogFulfillmentDialog;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BOM/LogFulfillmentDialog.tsx
git commit -m "feat(bom): add LogFulfillmentDialog for service partial fulfillment"
```

---

## Task 3: Update `BOMPartRow` — consumption bar + dialog wiring

**Files:**
- Modify: `src/components/BOM/BOMPartRow.tsx`

- [ ] **Step 1: Add `serviceTranches` to the local `BOMItem` interface**

In `BOMPartRow.tsx`, in the local `BOMItem` interface (lines 33–65), after `linkedSpecDocumentId?:`, add:

```typescript
  serviceTranches?: Array<{
    id: string;
    days: number;
    invoiceDocId?: string;
    loggedAt: string;
  }>;
```

- [ ] **Step 2: Add new imports**

At the top of `BOMPartRow.tsx`, add these to the existing import block:

```typescript
import { Progress } from '@/components/ui/progress';
import LogFulfillmentDialog from './LogFulfillmentDialog';
```

The `Progress` import goes alongside the existing shadcn imports. `LogFulfillmentDialog` goes alongside the existing local component imports.

- [ ] **Step 3: Add state variables for fulfillment dialog**

Inside the `BOMPartRow` component function body, after the `showDeleteConfirm` state (around line 215), add:

```typescript
  const [fulfillmentDialogOpen, setFulfillmentDialogOpen] = useState(false);
  const [showTranches, setShowTranches] = useState(false);
```

- [ ] **Step 4: Add the fulfillment confirm handler**

After the `handleAddVendor` function (around line 271), add:

```typescript
  const handleLogFulfillmentConfirm = (data: { days: number; invoiceDocId?: string }) => {
    const newTranche = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      days: data.days,
      invoiceDocId: data.invoiceDocId,
      loggedAt: new Date().toISOString().split('T')[0],
    };
    const updatedTranches = [...(part.serviceTranches ?? []), newTranche];
    const consumedDays = updatedTranches.reduce((s, t) => s + t.days, 0);
    const updates: Partial<BOMItem> = { serviceTranches: updatedTranches };
    if (consumedDays >= part.quantity && part.status !== 'received') {
      updates.status = 'received';
    }
    onEdit?.(part.id, updates);
  };
```

- [ ] **Step 5: Add consumption bar to the view (non-editing) section**

In the non-editing view section of `BOMPartRow.tsx`, find the closing `</div>` of the `<div className="space-y-1">` block (around line 584, just before `</div>` that closes the view section). Insert the consumption bar just before that closing div:

```typescript
              {/* Service fulfillment consumption bar */}
              {itemType === 'service' && part.status !== 'not-ordered' && (() => {
                const tranches = part.serviceTranches ?? [];
                const consumedDays = tranches.reduce((s, t) => s + t.days, 0);
                const remainingDays = part.quantity - consumedDays;
                const pct = part.quantity > 0 ? Math.min(100, (consumedDays / part.quantity) * 100) : 0;
                return (
                  <div className="mt-2 space-y-1" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Progress
                        value={pct}
                        className={`flex-1 h-1.5 min-w-[80px] ${consumedDays >= part.quantity ? '[&>div]:bg-green-500' : '[&>div]:bg-indigo-500'}`}
                      />
                      <span className="text-xs text-gray-600 whitespace-nowrap">
                        {consumedDays} / {part.quantity} days
                      </span>
                      {remainingDays > 0 && (
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          • {remainingDays} remaining
                        </span>
                      )}
                      {part.status !== 'received' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 ml-auto"
                          onClick={e => {
                            e.stopPropagation();
                            setFulfillmentDialogOpen(true);
                          }}
                        >
                          + Log
                        </Button>
                      )}
                    </div>
                    {tranches.length > 0 && (
                      <button
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                        onClick={e => { e.stopPropagation(); setShowTranches(v => !v); }}
                      >
                        {tranches.length} {tranches.length === 1 ? 'entry' : 'entries'} {showTranches ? '▲' : '▼'}
                      </button>
                    )}
                    {showTranches && (
                      <div className="bg-gray-50 rounded border divide-y text-xs mt-1">
                        {tranches.map(t => (
                          <div key={t.id} className="flex items-center gap-3 px-2 py-1.5 text-gray-600">
                            <span className="font-medium">{t.days}d</span>
                            <span className="text-gray-400">{t.loggedAt}</span>
                            {t.invoiceDocId && (
                              <span className="flex items-center gap-1 text-purple-600">
                                <FileText size={10} />
                                <span>Invoice</span>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
```

- [ ] **Step 6: Add the dialog to the component return**

Just before the final closing `</div>` of the component return (line 736), add:

```typescript
      {/* Log Fulfillment Dialog - service items only */}
      {itemType === 'service' && projectId && fulfillmentDialogOpen && (() => {
        const tranches = part.serviceTranches ?? [];
        const consumedDays = tranches.reduce((s, t) => s + t.days, 0);
        const remainingDays = part.quantity - consumedDays;
        return (
          <LogFulfillmentDialog
            open={fulfillmentDialogOpen}
            onOpenChange={setFulfillmentDialogOpen}
            itemName={part.name}
            budgetedDays={part.quantity}
            remainingDays={remainingDays}
            projectId={projectId}
            projectDocuments={projectDocuments}
            onConfirm={handleLogFulfillmentConfirm}
          />
        );
      })()}
```

- [ ] **Step 7: Verify `FileText` is already imported**

`FileText` is already imported at line 2 of `BOMPartRow.tsx`. No new import needed.

- [ ] **Step 8: Commit**

```bash
git add src/components/BOM/BOMPartRow.tsx
git commit -m "feat(bom): add service fulfillment progress bar and log dialog to BOMPartRow"
```

---

## Task 4: Manual Smoke Test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test the happy path**

1. Open any project that has a service BOM item (or add one: type = Service, quantity = 10, price = 500)
2. Mark the item as "Ordered" via the status badge dropdown
3. Verify a progress bar appears: `0 / 10 days • 10 remaining [+ Log]`
4. Click `[+ Log]` — dialog opens with title "Log Service Fulfillment" and subtitle "10 days remaining of 10 budgeted"
5. Enter `5` days, optionally upload/select an invoice, click "Log 5d"
6. Bar should update to `5 / 10 days • 5 remaining`
7. Click `[+ Log]` again, enter `5` days, save
8. Bar should show `10 / 10 days` in green, no `[+ Log]` button, status badge should flip to "Received"

- [ ] **Step 3: Test validation**

1. Click `[+ Log]` on an item with 3 days remaining
2. Enter `5` in the days field — error appears: "Only 3 days remain in this budget", "Log" button stays disabled
3. Enter `3` — button becomes enabled

- [ ] **Step 4: Test tranche history**

1. After logging 2+ tranches, click the "N entries ▼" link
2. Verify the inline list shows each tranche with days, date, and invoice icon (if linked)

- [ ] **Step 5: Verify component items are unaffected**

1. Open any component BOM item
2. Confirm no progress bar appears, no `[+ Log]` button, behavior unchanged
