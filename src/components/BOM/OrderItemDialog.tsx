import { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Package, Upload, Loader2, Search, Check, ChevronsUpDown } from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { BOMItem, calculateExpectedArrival, parseLeadTimeToDays } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth } from '@/firebase';
import { Vendor } from '@/utils/settingsFirestore';

interface OrderItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BOMItem | null;
  projectId: string;
  availablePODocuments: ProjectDocument[];
  vendors: Vendor[]; // List of all vendors (OEMs and Dealers)
  onConfirm: (data: {
    orderDate: string;
    expectedArrival: string;
    poNumber?: string;
    linkedPODocumentId: string;
    vendor: {
      id: string;
      name: string;
      price: number;
      leadTime: string;
      availability: string;
    };
  }) => void;
  onDocumentUploaded?: (doc: ProjectDocument) => void;
}

const OrderItemDialog = ({
  open,
  onOpenChange,
  item,
  projectId,
  availablePODocuments,
  vendors,
  onConfirm,
  onDocumentUploaded,
}: OrderItemDialogProps) => {
  const [orderDate, setOrderDate] = useState<string>('');
  const [poNumber, setPONumber] = useState<string>('');
  const [linkedPODocumentId, setLinkedPODocumentId] = useState<string>('');
  const [expectedArrival, setExpectedArrival] = useState<string>('');
  const [calculatedArrival, setCalculatedArrival] = useState<string>('');
  const [leadTimeDays, setLeadTimeDays] = useState<number>(0);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Get selected vendor details
  const selectedVendor = vendors.find(v => v.id === selectedVendorId);
  const hasVendor = !!selectedVendor;

  // Filter to show only active vendors, sorted by type (OEM first) then name
  const activeVendors = useMemo(() => {
    return vendors
      .filter(v => v.status === 'active')
      .sort((a, b) => {
        // Sort by type first (OEM before Dealer)
        if (a.type !== b.type) {
          return a.type === 'OEM' ? -1 : 1;
        }
        // Then by company name
        return a.company.localeCompare(b.company);
      });
  }, [vendors]);

  // Calculate expected arrival when order date or vendor changes
  useEffect(() => {
    if (item && orderDate && selectedVendor) {
      const leadTime = selectedVendor.leadTime || '';
      const days = parseLeadTimeToDays(leadTime);
      setLeadTimeDays(days);

      if (days > 0) {
        const arrival = calculateExpectedArrival(orderDate, days);
        setCalculatedArrival(arrival);
        // Auto-update expected arrival if not manually modified
        if (!expectedArrival || expectedArrival === calculatedArrival) {
          setExpectedArrival(arrival);
        }
      } else {
        setCalculatedArrival('');
      }
    } else if (!selectedVendor) {
      setLeadTimeDays(0);
      setCalculatedArrival('');
    }
  }, [item, orderDate, selectedVendor]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open && item) {
      const today = new Date().toISOString().split('T')[0];
      setOrderDate(today);
      setPONumber(item.poNumber || '');
      setLinkedPODocumentId(item.linkedPODocumentId || '');
      setSelectedVendorId(''); // Reset vendor selection
      setExpectedArrival('');
      setCalculatedArrival('');
      setLeadTimeDays(0);
    }
  }, [open, item]);

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
    if (!canSubmit || !selectedVendor) return;

    onConfirm({
      orderDate,
      expectedArrival,
      poNumber: poNumber || undefined,
      linkedPODocumentId,
      vendor: {
        id: selectedVendor.id,
        name: selectedVendor.company,
        price: item?.price || 0,
        leadTime: selectedVendor.leadTime,
        availability: 'In Stock', // Default value
      },
    });
    onOpenChange(false);
  };

  const isExpectedArrivalModified = expectedArrival && calculatedArrival && expectedArrival !== calculatedArrival;
  const hasPODocument = linkedPODocumentId && linkedPODocumentId !== '__NONE__';
  const canSubmit = hasVendor && hasPODocument && expectedArrival;

  if (!item) return null;

  // Group vendors by type for display
  const oemVendors = activeVendors.filter(v => v.type === 'OEM');
  const dealerVendors = activeVendors.filter(v => v.type === 'Dealer');

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
          {/* Item Info */}
          <div className="bg-gray-50 rounded-md p-2.5 space-y-0.5 text-sm">
            <div className="font-medium text-gray-900">{item.name}</div>
            <div className="text-gray-600 text-xs flex flex-wrap gap-x-3">
              {item.make && <span>Make: {item.make}</span>}
              {item.sku && <span>SKU: {item.sku}</span>}
              <span>Qty: {item.quantity}</span>
            </div>
          </div>

          {/* Vendor Selection - Searchable Combobox */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">
              Select Vendor <span className="text-red-500">*</span>
            </Label>
            <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={vendorPopoverOpen}
                  className={cn(
                    "w-full h-8 justify-between text-sm font-normal",
                    !hasVendor && "border-red-300 text-muted-foreground"
                  )}
                >
                  {selectedVendor ? (
                    <span className="flex items-center gap-2 truncate">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        selectedVendor.type === 'OEM' ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                      )}>
                        {selectedVendor.type}
                      </span>
                      {selectedVendor.company}
                    </span>
                  ) : (
                    "Search and select vendor..."
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[350px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search vendors..." />
                  <CommandList>
                    <CommandEmpty>No vendor found.</CommandEmpty>
                    {oemVendors.length > 0 && (
                      <CommandGroup heading="OEM / Brands">
                        {oemVendors.map((vendor) => (
                          <CommandItem
                            key={vendor.id}
                            value={`${vendor.company} ${vendor.type}`}
                            onSelect={() => {
                              setSelectedVendorId(vendor.id);
                              setVendorPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedVendorId === vendor.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{vendor.company}</span>
                              {vendor.leadTime && (
                                <span className="text-xs text-gray-500">Lead time: {vendor.leadTime}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {dealerVendors.length > 0 && (
                      <CommandGroup heading="Dealers / Distributors">
                        {dealerVendors.map((vendor) => (
                          <CommandItem
                            key={vendor.id}
                            value={`${vendor.company} ${vendor.type}`}
                            onSelect={() => {
                              setSelectedVendorId(vendor.id);
                              setVendorPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedVendorId === vendor.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{vendor.company}</span>
                              {vendor.leadTime && (
                                <span className="text-xs text-gray-500">Lead time: {vendor.leadTime}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {activeVendors.length === 0 && (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No active vendors available. Add vendors in Settings.
                      </div>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {!hasVendor && (
              <p className="text-xs text-red-500">Please select a vendor</p>
            )}
            {selectedVendor && (
              <p className="text-xs text-gray-500">
                {selectedVendor.type} · Lead time: {selectedVendor.leadTime || 'Not specified'}
              </p>
            )}
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
