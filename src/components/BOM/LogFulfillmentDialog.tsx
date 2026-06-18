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
import { BOMItemType } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth } from '@/firebase';

interface LogFulfillmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemType: BOMItemType;
  itemName: string;
  budgetedQty: number;
  remainingQty: number;
  projectId: string;
  projectDocuments: ProjectDocument[];
  onConfirm: (data: { quantity: number; invoiceDocId?: string }) => void;
}

const LogFulfillmentDialog = ({
  open,
  onOpenChange,
  itemType,
  itemName,
  budgetedQty,
  remainingQty,
  projectId,
  projectDocuments,
  onConfirm,
}: LogFulfillmentDialogProps) => {
  const isService = itemType === 'service';
  const unit = isService ? 'days' : 'units';
  const step = isService ? 0.5 : 1;
  const min = isService ? 0.5 : 1;

  const [qty, setQty] = useState<string>('');
  const [invoiceDocId, setInvoiceDocId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<ProjectDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setQty('');
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

  const qtyNum = parseFloat(qty);
  const validQty = !isNaN(qtyNum) && qtyNum >= min && qtyNum <= remainingQty;
  const overBudget = !isNaN(qtyNum) && qtyNum > remainingQty;
  const selectedDoc = invoiceDocuments.find(d => d.id === invoiceDocId);

  const handleConfirm = () => {
    if (!validQty) return;
    onConfirm({ quantity: qtyNum, invoiceDocId: invoiceDocId || undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Log {isService ? 'Service Fulfillment' : 'Partial Receipt'}</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            {remainingQty} {unit} remaining of {budgetedQty} {isService ? 'budgeted' : 'ordered'} — {itemName}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ful-qty" className="text-sm font-medium">
              {isService ? 'Days consumed' : 'Units received'} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="ful-qty"
              type="number"
              min={min}
              step={step}
              max={remainingQty}
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder={`e.g. ${isService ? '5' : '10'}  (max ${remainingQty})`}
              className={overBudget ? 'border-red-400' : ''}
            />
            {overBudget && (
              <p className="text-xs text-red-500">
                Only {remainingQty} {unit} remain in this budget
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Vendor Invoice</Label>
            <p className="text-xs text-gray-500">
              Attach the vendor invoice for this delivery (recommended).
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
            {invoiceDocId && selectedDoc && (
              <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">
                Invoice: <span className="font-medium">{selectedDoc.name}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!validQty}>
            Log {validQty ? `${qtyNum} ${unit}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogFulfillmentDialog;
