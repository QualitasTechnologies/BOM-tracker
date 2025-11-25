import { useState, useEffect, useRef } from 'react';
import { FileText, Package, Upload, Loader2, AlertCircle } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { BOMItem, calculateExpectedArrival, parseLeadTimeToDays } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth } from '@/firebase';

interface OrderItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BOMItem | null;
  projectId: string;
  availablePODocuments: ProjectDocument[];
  onConfirm: (data: {
    orderDate: string;
    expectedArrival: string;
    poNumber?: string;
    linkedPODocumentId: string;
  }) => void;
  onDocumentUploaded?: (doc: ProjectDocument) => void;
}

const OrderItemDialog = ({
  open,
  onOpenChange,
  item,
  projectId,
  availablePODocuments,
  onConfirm,
  onDocumentUploaded,
}: OrderItemDialogProps) => {
  const [orderDate, setOrderDate] = useState<string>('');
  const [poNumber, setPONumber] = useState<string>('');
  const [linkedPODocumentId, setLinkedPODocumentId] = useState<string>('');
  const [expectedArrival, setExpectedArrival] = useState<string>('');
  const [calculatedArrival, setCalculatedArrival] = useState<string>('');
  const [leadTimeDays, setLeadTimeDays] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Check if vendor is specified
  const hasVendor = item?.finalizedVendor?.name;

  // Calculate expected arrival when order date changes
  useEffect(() => {
    if (item && orderDate && hasVendor) {
      const leadTime = item.finalizedVendor?.leadTime || '';
      const days = parseLeadTimeToDays(leadTime);
      setLeadTimeDays(days);

      if (days > 0) {
        const arrival = calculateExpectedArrival(orderDate, days);
        setCalculatedArrival(arrival);
        if (!expectedArrival || expectedArrival === calculatedArrival) {
          setExpectedArrival(arrival);
        }
      } else {
        setCalculatedArrival('');
      }
    }
  }, [item, orderDate, hasVendor]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open && item) {
      const today = new Date().toISOString().split('T')[0];
      setOrderDate(today);
      setPONumber(item.poNumber || '');
      setLinkedPODocumentId(item.linkedPODocumentId || '');

      if (hasVendor) {
        const leadTime = item.finalizedVendor?.leadTime || '';
        const days = parseLeadTimeToDays(leadTime);
        setLeadTimeDays(days);
        if (days > 0) {
          const arrival = calculateExpectedArrival(today, days);
          setExpectedArrival(arrival);
          setCalculatedArrival(arrival);
        } else {
          setExpectedArrival('');
          setCalculatedArrival('');
        }
      } else {
        setExpectedArrival('');
        setCalculatedArrival('');
        setLeadTimeDays(0);
      }
    }
  }, [open, item, hasVendor]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !projectId) return;

    const file = e.target.files[0];
    setUploading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      const newDoc = await uploadProjectDocument(file, projectId, 'outgoing-po', user.uid);
      onDocumentUploaded?.(newDoc);
      setLinkedPODocumentId(newDoc.id);

      toast({
        title: 'PO Uploaded',
        description: `${file.name} uploaded and linked`,
      });
    } catch (error) {
      console.error('Error uploading PO:', error);
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

    onConfirm({
      orderDate,
      expectedArrival,
      poNumber: poNumber || undefined,
      linkedPODocumentId,
    });
    onOpenChange(false);
  };

  const isExpectedArrivalModified = expectedArrival && calculatedArrival && expectedArrival !== calculatedArrival;
  const hasPODocument = linkedPODocumentId && linkedPODocumentId !== '__NONE__';
  const canSubmit = hasVendor && hasPODocument && expectedArrival;

  if (!item) return null;

  const vendorName = item.finalizedVendor?.name;
  const leadTimeStr = item.finalizedVendor?.leadTime || 'Not specified';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Mark Item as Ordered
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Vendor Required Alert */}
          {!hasVendor && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                A vendor must be selected before marking as ordered. Edit the item to set a finalized vendor.
              </AlertDescription>
            </Alert>
          )}

          {/* Item Info */}
          <div className="bg-gray-50 rounded-md p-2.5 space-y-0.5 text-sm">
            <div className="font-medium text-gray-900">{item.name}</div>
            <div className="text-gray-600 text-xs flex flex-wrap gap-x-3">
              <span>Vendor: {vendorName || <span className="text-red-500">Not set</span>}</span>
              {hasVendor && <span>Lead Time: {leadTimeStr}</span>}
            </div>
          </div>

          {hasVendor && (
            <>
              {/* Order Date & Expected Arrival */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="orderDate" className="text-xs font-medium">
                    Order Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="orderDate"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="expectedArrival" className="text-xs font-medium">
                    Expected Arrival <span className="text-red-500">*</span>
                    {isExpectedArrivalModified && (
                      <span className="text-amber-600 ml-1">(edited)</span>
                    )}
                  </Label>
                  <Input
                    id="expectedArrival"
                    type="date"
                    value={expectedArrival}
                    onChange={(e) => setExpectedArrival(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              {calculatedArrival && (
                <p className="text-xs text-gray-500">
                  Calculated: {leadTimeDays}d → {new Date(calculatedArrival).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {isExpectedArrivalModified && (
                    <button
                      type="button"
                      className="text-blue-600 hover:underline ml-2"
                      onClick={() => setExpectedArrival(calculatedArrival)}
                    >
                      Reset
                    </button>
                  )}
                </p>
              )}

              {/* PO Number */}
              <div className="space-y-1">
                <Label htmlFor="poNumber" className="text-xs font-medium">PO Number</Label>
                <Input
                  id="poNumber"
                  type="text"
                  placeholder="e.g., PO-2025-0042"
                  value={poNumber}
                  onChange={(e) => setPONumber(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              {/* PO Document - Required */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  PO Document <span className="text-red-500">*</span>
                </Label>
                <div className="flex gap-2">
                  <Select value={linkedPODocumentId} onValueChange={setLinkedPODocumentId}>
                    <SelectTrigger className={`h-8 text-sm flex-1 ${!hasPODocument ? 'border-red-300' : ''}`}>
                      <SelectValue placeholder="Select or upload PO" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__" disabled>Select a PO document</SelectItem>
                      {availablePODocuments.map((doc) => (
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
                    className="h-8 px-2.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
                {!hasPODocument && (
                  <p className="text-xs text-red-500">PO document is required</p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!canSubmit}>
            Mark as Ordered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OrderItemDialog;
