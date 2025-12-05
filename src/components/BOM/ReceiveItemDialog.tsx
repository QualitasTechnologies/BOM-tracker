import { useState, useEffect, useRef } from 'react';
import { CheckCircle, Calendar, TrendingUp, TrendingDown, Minus, FileText, Upload, Loader2 } from 'lucide-react';
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
import { BOMItem } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth } from '@/firebase';

interface ReceiveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BOMItem | null;
  projectId: string;
  availableVendorQuotes: ProjectDocument[]; // Vendor quotes that can serve as invoices
  onConfirm: (data: { actualArrival: string; linkedInvoiceDocumentId: string }) => void;
  onDocumentUploaded?: (doc: ProjectDocument) => void;
}

const ReceiveItemDialog = ({
  open,
  onOpenChange,
  item,
  projectId,
  availableVendorQuotes,
  onConfirm,
  onDocumentUploaded,
}: ReceiveItemDialogProps) => {
  const [actualArrival, setActualArrival] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [linkedInvoiceDocumentId, setLinkedInvoiceDocumentId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Initialize form when dialog opens - preserve existing linkage if present
  useEffect(() => {
    if (open && item) {
      setActualArrival(new Date().toISOString().split('T')[0]);

      // Check for existing invoice linkage - either on the item OR via document's linkedBOMItems
      let existingInvoiceId = item.linkedInvoiceDocumentId || '';

      // If item doesn't have linkedInvoiceDocumentId, check if any invoice has this item in linkedBOMItems
      if (!existingInvoiceId) {
        const linkedInvoice = availableVendorQuotes.find(
          doc => doc.linkedBOMItems?.includes(item.id)
        );
        if (linkedInvoice) {
          existingInvoiceId = linkedInvoice.id;
        }
      }

      setLinkedInvoiceDocumentId(existingInvoiceId);
    }
  }, [open, item, availableVendorQuotes]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !projectId || !item) return;

    const file = e.target.files[0];
    setUploading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      // Upload as vendor-invoice type
      const newDoc = await uploadProjectDocument(file, projectId, 'vendor-invoice', user.uid);

      onDocumentUploaded?.(newDoc);
      setLinkedInvoiceDocumentId(newDoc.id);

      toast({
        title: 'Invoice Uploaded',
        description: `${file.name} uploaded successfully`,
      });
    } catch (error) {
      console.error('Error uploading invoice:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm({ actualArrival, linkedInvoiceDocumentId });
    onOpenChange(false);
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'Not specified';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Calculate days difference from expected
  const getDaysDifference = () => {
    if (!item?.expectedArrival || !actualArrival) return null;

    const expected = new Date(item.expectedArrival);
    const actual = new Date(actualArrival);
    expected.setHours(0, 0, 0, 0);
    actual.setHours(0, 0, 0, 0);

    const diffTime = actual.getTime() - expected.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  };

  const daysDiff = getDaysDifference();

  const getDeliveryStatus = () => {
    if (daysDiff === null) return null;

    if (daysDiff < 0) {
      return {
        icon: <TrendingUp className="h-4 w-4" />,
        text: `${Math.abs(daysDiff)} day${Math.abs(daysDiff) !== 1 ? 's' : ''} early`,
        className: 'bg-green-50 text-green-700 border-green-200',
      };
    } else if (daysDiff > 0) {
      return {
        icon: <TrendingDown className="h-4 w-4" />,
        text: `${daysDiff} day${daysDiff !== 1 ? 's' : ''} late`,
        className: 'bg-red-50 text-red-700 border-red-200',
      };
    } else {
      return {
        icon: <Minus className="h-4 w-4" />,
        text: 'On time',
        className: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    }
  };

  const deliveryStatus = getDeliveryStatus();
  const hasInvoice = linkedInvoiceDocumentId && linkedInvoiceDocumentId !== '__NONE__';
  const canSubmit = actualArrival && hasInvoice;

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Mark Item as Received
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Item Info */}
          <div className="bg-gray-50 rounded-md p-3 space-y-1 text-sm">
            <div className="font-medium text-gray-900">{item.name}</div>
            <div className="text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Ordered: {formatDate(item.orderDate)}</span>
              <span>Expected: {formatDate(item.expectedArrival)}</span>
            </div>
            {item.finalizedVendor?.name && (
              <div className="text-gray-500 text-xs">
                Vendor: {item.finalizedVendor.name}
              </div>
            )}
          </div>

          {/* Actual Arrival Date */}
          <div className="space-y-1.5">
            <Label htmlFor="actualArrival" className="text-sm font-medium">
              Actual Arrival Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="actualArrival"
              type="date"
              value={actualArrival}
              onChange={(e) => setActualArrival(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Delivery Status Indicator */}
          {deliveryStatus && (
            <div
              className={`rounded-md p-3 flex items-center gap-3 border ${deliveryStatus.className}`}
            >
              {deliveryStatus.icon}
              <div>
                <div className="text-sm font-semibold">
                  {deliveryStatus.text}
                </div>
                {item.expectedArrival && (
                  <div className="text-xs opacity-80">
                    Expected: {formatDate(item.expectedArrival)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vendor Invoice - Required */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Vendor Invoice <span className="text-red-500">*</span>
            </Label>
            <p className="text-xs text-gray-500 mb-2">
              Upload the vendor invoice or select an existing document to complete the inward process.
            </p>
            <div className="flex gap-2">
              <Select value={linkedInvoiceDocumentId} onValueChange={setLinkedInvoiceDocumentId}>
                <SelectTrigger className={`h-9 text-sm flex-1 ${!hasInvoice ? 'border-red-300' : ''}`}>
                  <SelectValue placeholder="Select or upload invoice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__" disabled>Select a document</SelectItem>
                  {availableVendorQuotes.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-gray-500">No invoices uploaded yet</div>
                  )}
                  {availableVendorQuotes.map((doc) => (
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
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>
            {!hasInvoice && (
              <p className="text-xs text-red-500">Vendor invoice is required to complete inwarding</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-green-600 hover:bg-green-700"
          >
            Mark as Received
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveItemDialog;
