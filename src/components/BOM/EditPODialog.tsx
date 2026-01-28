import React, { useState, useEffect } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PurchaseOrder, POItem, calculatePOTotals } from '@/types/purchaseOrder';
import { updatePurchaseOrder } from '@/utils/poFirestore';
import { toast } from '@/components/ui/use-toast';

interface EditPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrder | null;
  projectId: string;
  onSaved?: () => void;
}

const EditPODialog: React.FC<EditPODialogProps> = ({
  open,
  onOpenChange,
  purchaseOrder,
  projectId,
  onSaved,
}) => {
  const [saving, setSaving] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [vendorQuoteReference, setVendorQuoteReference] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [items, setItems] = useState<POItem[]>([]);

  // Initialize form when PO changes
  useEffect(() => {
    if (purchaseOrder) {
      setPaymentTerms(purchaseOrder.paymentTerms || '');
      setDeliveryTerms(purchaseOrder.deliveryTerms || '');
      setVendorQuoteReference(purchaseOrder.vendorQuoteReference || '');
      setExpectedDeliveryDate(
        purchaseOrder.expectedDeliveryDate
          ? new Date(purchaseOrder.expectedDeliveryDate).toISOString().split('T')[0]
          : ''
      );
      setItems([...purchaseOrder.items]);
    }
  }, [purchaseOrder]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const handleItemChange = (index: number, field: 'quantity' | 'rate', value: string) => {
    const numValue = parseFloat(value) || 0;
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: numValue,
        amount: field === 'quantity'
          ? numValue * updated[index].rate
          : updated[index].quantity * numValue,
      };
      return updated;
    });
  };

  const calculateTotals = () => {
    if (!purchaseOrder) return { subtotal: 0, totalAmount: 0 };
    return calculatePOTotals(items, purchaseOrder.taxType, purchaseOrder.taxPercentage);
  };

  const handleSave = async () => {
    if (!purchaseOrder) return;

    setSaving(true);
    try {
      const totals = calculateTotals();

      await updatePurchaseOrder(projectId, purchaseOrder.id, {
        paymentTerms,
        deliveryTerms,
        vendorQuoteReference,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      });

      // Note: Item updates would need a separate function if we want to update items
      // For now, we only update terms and dates

      toast({
        title: 'PO Updated',
        description: `Purchase Order ${purchaseOrder.poNumber} has been updated.`,
      });

      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('Error updating PO:', error);
      toast({
        title: 'Error',
        description: 'Failed to update Purchase Order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!purchaseOrder) return null;

  const totals = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase Order</DialogTitle>
          <DialogDescription>
            {purchaseOrder.poNumber} - {purchaseOrder.vendorName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Terms Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Textarea
                id="paymentTerms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g., 100% advance payment"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryTerms">Delivery Terms</Label>
              <Textarea
                id="deliveryTerms"
                value={deliveryTerms}
                onChange={(e) => setDeliveryTerms(e.target.value)}
                placeholder="e.g., Ex-works, 3 weeks"
                rows={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quoteRef">Vendor Quote Reference</Label>
              <Input
                id="quoteRef"
                value={vendorQuoteReference}
                onChange={(e) => setVendorQuoteReference(e.target.value)}
                placeholder="e.g., QT-2026-001 Dated: 15 Jan 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedDelivery">Expected Delivery Date</Label>
              <Input
                id="expectedDelivery"
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </div>
          </div>

          {/* Items Table (Read-only for now, can be extended) */}
          <div>
            <Label className="mb-2 block">Items ({items.length})</Label>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-20 text-right">Qty</TableHead>
                    <TableHead className="w-24 text-right">Rate</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-gray-500">{item.slNo}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.description}</div>
                        {item.hsn && (
                          <div className="text-xs text-gray-500">HSN: {item.hsn}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.quantity} {item.uom}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.rate)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(totals.subtotal)}</span>
              </div>
              {purchaseOrder.taxType === 'igst' ? (
                <div className="flex justify-between">
                  <span>IGST ({purchaseOrder.taxPercentage}%):</span>
                  <span>{formatCurrency(totals.igstAmount || 0)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>CGST ({purchaseOrder.taxPercentage / 2}%):</span>
                    <span>{formatCurrency(totals.cgstAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SGST ({purchaseOrder.taxPercentage / 2}%):</span>
                    <span>{formatCurrency(totals.sgstAmount || 0)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t">
                <span>Total:</span>
                <span className="text-green-700">{formatCurrency(totals.totalAmount)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditPODialog;
