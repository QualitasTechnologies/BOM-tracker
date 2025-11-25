import { useState, useEffect } from 'react';
import { CheckCircle, Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
import { BOMItem } from '@/types/bom';

interface ReceiveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BOMItem | null;
  onConfirm: (data: { actualArrival: string }) => void;
}

const ReceiveItemDialog = ({
  open,
  onOpenChange,
  item,
  onConfirm,
}: ReceiveItemDialogProps) => {
  const [actualArrival, setActualArrival] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setActualArrival(new Date().toISOString().split('T')[0]);
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm({ actualArrival });
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="bg-green-600 hover:bg-green-700">
            Mark as Received
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveItemDialog;
