import { useState, useEffect } from 'react';
import { Calendar, FileText, Package } from 'lucide-react';
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
import { BOMItem, calculateExpectedArrival, parseLeadTimeToDays } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';

interface OrderItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BOMItem | null;
  availablePODocuments: ProjectDocument[];
  onConfirm: (data: {
    orderDate: string;
    expectedArrival: string;
    poNumber?: string;
    linkedPODocumentId?: string;
  }) => void;
}

const OrderItemDialog = ({
  open,
  onOpenChange,
  item,
  availablePODocuments,
  onConfirm,
}: OrderItemDialogProps) => {
  const [orderDate, setOrderDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [poNumber, setPONumber] = useState<string>('');
  const [linkedPODocumentId, setLinkedPODocumentId] = useState<string>('');
  const [expectedArrival, setExpectedArrival] = useState<string>('');
  const [leadTimeDays, setLeadTimeDays] = useState<number>(0);

  // Calculate expected arrival when order date or lead time changes
  useEffect(() => {
    if (item && orderDate) {
      // Get lead time from finalized vendor or first vendor
      const leadTime = item.finalizedVendor?.leadTime || item.vendors?.[0]?.leadTime || '';
      const days = parseLeadTimeToDays(leadTime);
      setLeadTimeDays(days);

      if (days > 0) {
        const arrival = calculateExpectedArrival(orderDate, days);
        setExpectedArrival(arrival);
      } else {
        setExpectedArrival('');
      }
    }
  }, [item, orderDate]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setOrderDate(new Date().toISOString().split('T')[0]);
      setPONumber(item?.poNumber || '');
      setLinkedPODocumentId(item?.linkedPODocumentId || '');
    }
  }, [open, item]);

  const handleConfirm = () => {
    onConfirm({
      orderDate,
      expectedArrival,
      poNumber: poNumber || undefined,
      linkedPODocumentId: linkedPODocumentId || undefined,
    });
    onOpenChange(false);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (!item) return null;

  const vendorName = item.finalizedVendor?.name || item.vendors?.[0]?.name || 'Not specified';
  const leadTimeStr = item.finalizedVendor?.leadTime || item.vendors?.[0]?.leadTime || 'Not specified';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Mark Item as Ordered
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Item Info */}
          <div className="bg-gray-50 rounded-md p-3 space-y-1 text-sm">
            <div className="font-medium text-gray-900">{item.name}</div>
            <div className="text-gray-600 flex items-center gap-4">
              <span>Vendor: {vendorName}</span>
              <span>Lead Time: {leadTimeStr}</span>
            </div>
          </div>

          {/* Order Date */}
          <div className="space-y-1.5">
            <Label htmlFor="orderDate" className="text-sm font-medium">
              Order Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="orderDate"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="h-9"
            />
          </div>

          {/* PO Number */}
          <div className="space-y-1.5">
            <Label htmlFor="poNumber" className="text-sm font-medium">
              PO Number
            </Label>
            <Input
              id="poNumber"
              type="text"
              placeholder="e.g., PO-2025-0042"
              value={poNumber}
              onChange={(e) => setPONumber(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Link PO Document */}
          <div className="space-y-1.5">
            <Label htmlFor="linkedPO" className="text-sm font-medium">
              Link PO Document
            </Label>
            <Select
              value={linkedPODocumentId}
              onValueChange={setLinkedPODocumentId}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a PO document (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">No document</SelectItem>
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
            {availablePODocuments.length === 0 && (
              <p className="text-xs text-gray-500">
                No PO documents uploaded. Upload in Documents section.
              </p>
            )}
          </div>

          {/* Expected Arrival (calculated) */}
          <div className="bg-blue-50 rounded-md p-3 flex items-center gap-3">
            <Calendar className="h-5 w-5 text-blue-600" />
            <div>
              <div className="text-xs text-blue-600 font-medium">Expected Arrival</div>
              <div className="text-sm font-semibold text-blue-900">
                {expectedArrival
                  ? `${formatDate(expectedArrival)} (${leadTimeDays} days from order)`
                  : 'Unable to calculate - no lead time specified'}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Mark as Ordered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OrderItemDialog;
