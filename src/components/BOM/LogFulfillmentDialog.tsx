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
  const selectedDoc = invoiceDocuments.find(d => d.id === invoiceDocId);

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
            {invoiceDocId && selectedDoc && (
              <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">
                Invoice: <span className="font-medium">{selectedDoc.name}</span>
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
