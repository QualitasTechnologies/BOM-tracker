import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2,
  FileText,
  AlertCircle,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Building2,
  MapPin,
  Receipt,
  Calendar,
  Package,
  IndianRupee,
} from 'lucide-react';
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
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import { Separator } from '@/components/ui/separator';
import { BOMCategory, BOMItem } from '@/types/bom';
import { Vendor, getCompanySettings, CompanySettings } from '@/utils/settingsFirestore';
import {
  POItem,
  calculatePOTotals,
  determineTaxType,
  DEFAULT_TERMS_AND_CONDITIONS,
  getStateName,
  TaxType,
} from '@/types/purchaseOrder';
import { createPurchaseOrder, CreatePOInput } from '@/utils/poFirestore';
import { toast } from '@/components/ui/use-toast';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';

interface CreatePODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  categories: BOMCategory[];
  vendors: Vendor[];
}

interface SelectablePOItem {
  bomItemId: string;
  name: string;
  description: string;
  make?: string;
  sku?: string;
  uom: string;
  quantity: number;
  rate: number;
  category: string;
  isSelected: boolean;
  hsn?: string;
}

// Vendor Combobox Component
const VendorCombobox: React.FC<{
  vendors: Vendor[];
  value: string;
  onChange: (vendor: Vendor | null) => void;
  disabled?: boolean;
}> = ({ vendors, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedVendor = vendors.find((v) => v.id === value);

  const filteredVendors = useMemo(() => {
    if (!searchQuery) return vendors;
    const query = searchQuery.toLowerCase();
    return vendors.filter(
      (v) =>
        v.company.toLowerCase().includes(query) ||
        v.type.toLowerCase().includes(query)
    );
  }, [vendors, searchQuery]);

  // Check for vendors with missing GSTIN or stateCode
  const vendorsWithIssues = useMemo(() => {
    return vendors.filter((v) => !v.gstNo || !v.stateCode);
  }, [vendors]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between',
            !selectedVendor && 'text-muted-foreground'
          )}
        >
          {selectedVendor ? (
            <span className="flex items-center gap-2 truncate">
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded text-xs',
                  selectedVendor.type === 'OEM'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-green-100 text-green-700'
                )}
              >
                {selectedVendor.type}
              </span>
              <span className="truncate">{selectedVendor.company}</span>
            </span>
          ) : (
            'Select vendor...'
          )}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search vendors..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>No vendor found.</CommandEmpty>
            <CommandGroup>
              {filteredVendors
                .filter((v) => v.status === 'active')
                .sort((a, b) => {
                  if (a.type !== b.type) return a.type === 'OEM' ? -1 : 1;
                  return a.company.localeCompare(b.company);
                })
                .map((vendor) => {
                  const hasIssues = !vendor.gstNo || !vendor.stateCode;
                  return (
                    <CommandItem
                      key={vendor.id}
                      value={vendor.id}
                      onSelect={() => {
                        onChange(vendor);
                        setOpen(false);
                        setSearchQuery('');
                      }}
                      disabled={hasIssues}
                      className={cn(hasIssues && 'opacity-50')}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === vendor.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="flex items-center gap-2 flex-1">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-xs',
                            vendor.type === 'OEM'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          )}
                        >
                          {vendor.type}
                        </span>
                        <span className="truncate">{vendor.company}</span>
                        {hasIssues && (
                          <Badge variant="destructive" className="ml-auto text-[10px] px-1">
                            Missing GST Info
                          </Badge>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>
        </Command>
        {vendorsWithIssues.length > 0 && (
          <div className="p-2 border-t text-xs text-muted-foreground">
            <AlertCircle className="inline h-3 w-3 mr-1" />
            {vendorsWithIssues.length} vendor(s) need GSTIN/State in Settings
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const CreatePODialog: React.FC<CreatePODialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  categories,
  vendors,
}) => {
  // State
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [selectableItems, setSelectableItems] = useState<SelectablePOItem[]>([]);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState(DEFAULT_TERMS_AND_CONDITIONS);
  const [includeAnnexure, setIncludeAnnexure] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const [vendorQuoteReference, setVendorQuoteReference] = useState('');

  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load company settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!open) return;

      setLoadingSettings(true);
      try {
        const settings = await getCompanySettings();
        setCompanySettings(settings);

        if (!settings) {
          setError('Company settings not configured. Please set up company details in Settings.');
        } else if (!settings.gstin || !settings.stateCode) {
          setError('Company GSTIN and State Code must be configured in Settings.');
        } else {
          setError(null);
        }

        // Set default terms from company settings
        if (settings?.defaultPaymentTerms) {
          setPaymentTerms(settings.defaultPaymentTerms);
        }
        if (settings?.defaultDeliveryTerms) {
          setDeliveryTerms(settings.defaultDeliveryTerms);
        }
        if (settings?.defaultTermsAndConditions) {
          setTermsAndConditions(settings.defaultTermsAndConditions);
        }
      } catch (err) {
        console.error('Error loading company settings:', err);
        setError('Failed to load company settings');
      } finally {
        setLoadingSettings(false);
      }
    };

    loadSettings();
  }, [open]);

  // Get vendors that have at least one BOM item assigned
  const vendorsWithItems = useMemo(() => {
    const vendorIds = new Set<string>();

    categories.forEach((category) => {
      category.items?.forEach((item) => {
        if (item.itemType === 'component' && item.finalizedVendor?.name) {
          const matchingVendor = vendors.find(
            (v) =>
              v.company.toLowerCase() === item.finalizedVendor?.name.toLowerCase()
          );
          if (matchingVendor) {
            vendorIds.add(matchingVendor.id);
          }
        }
      });
    });

    return vendors.filter((v) => vendorIds.has(v.id));
  }, [categories, vendors]);

  // Update selectable items when vendor changes
  useEffect(() => {
    if (!selectedVendor) {
      setSelectableItems([]);
      return;
    }

    const items: SelectablePOItem[] = [];

    categories.forEach((category) => {
      category.items?.forEach((item) => {
        if (item.itemType !== 'component') return;
        if (!item.finalizedVendor?.name) return;

        // Match vendor by name
        const vendorMatches =
          item.finalizedVendor.name.toLowerCase() ===
          selectedVendor.company.toLowerCase();

        if (vendorMatches) {
          items.push({
            bomItemId: item.id,
            name: item.name,
            description: item.description,
            make: item.make,
            sku: item.sku,
            uom: 'nos', // Default UOM
            quantity: item.quantity,
            rate: item.price || 0,
            category: category.name,
            isSelected: true,
            hsn: undefined,
          });
        }
      });
    });

    setSelectableItems(items);
  }, [selectedVendor, categories]);

  // Calculate totals
  const calculatedTotals = useMemo(() => {
    if (!selectedVendor || !companySettings) return null;

    const selectedItems = selectableItems.filter((item) => item.isSelected);
    if (selectedItems.length === 0) return null;

    const poItems: POItem[] = selectedItems.map((item, index) => ({
      bomItemId: item.bomItemId,
      slNo: index + 1,
      description: item.name + (item.description ? ` - ${item.description}` : ''),
      itemCode: item.sku,
      make: item.make,
      uom: item.uom,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.quantity * item.rate,
      hsn: item.hsn,
    }));

    const taxType = determineTaxType(
      companySettings.stateCode,
      selectedVendor.stateCode || ''
    );

    return {
      ...calculatePOTotals(poItems, taxType, 18),
      taxType,
      items: poItems,
    };
  }, [selectableItems, selectedVendor, companySettings]);

  // Toggle item selection
  const handleToggleItem = (bomItemId: string) => {
    setSelectableItems((prev) =>
      prev.map((item) =>
        item.bomItemId === bomItemId
          ? { ...item, isSelected: !item.isSelected }
          : item
      )
    );
  };

  // Update item rate
  const handleRateChange = (bomItemId: string, rate: number) => {
    setSelectableItems((prev) =>
      prev.map((item) =>
        item.bomItemId === bomItemId ? { ...item, rate } : item
      )
    );
  };

  // Update item quantity
  const handleQuantityChange = (bomItemId: string, quantity: number) => {
    setSelectableItems((prev) =>
      prev.map((item) =>
        item.bomItemId === bomItemId ? { ...item, quantity } : item
      )
    );
  };

  // Create PO
  const handleCreate = async () => {
    if (!selectedVendor || !companySettings || !calculatedTotals) return;

    // Validation
    if (!paymentTerms.trim()) {
      setError('Payment terms are required');
      return;
    }
    if (!deliveryTerms.trim()) {
      setError('Delivery terms are required');
      return;
    }

    const selectedItems = selectableItems.filter((item) => item.isSelected);
    if (selectedItems.length === 0) {
      setError('Please select at least one item');
      return;
    }

    // Check for items with zero price
    const itemsWithNoPrice = selectedItems.filter((item) => !item.rate || item.rate <= 0);
    if (itemsWithNoPrice.length > 0) {
      setError(
        `${itemsWithNoPrice.length} item(s) have no price. Please enter unit price for all items.`
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const input: CreatePOInput = {
        projectId,
        projectReference: projectName,

        vendorId: selectedVendor.id,
        vendorName: selectedVendor.company,
        vendorAddress: selectedVendor.address,
        vendorGstin: selectedVendor.gstNo || '',
        vendorStateCode: selectedVendor.stateCode || '',
        vendorStateName: selectedVendor.stateName || getStateName(selectedVendor.stateCode || ''),
        vendorEmail: selectedVendor.email,
        vendorPhone: selectedVendor.phone,

        items: calculatedTotals.items,

        paymentTerms,
        deliveryTerms,
        termsAndConditions: includeAnnexure ? termsAndConditions : undefined,
        includeAnnexure,

        expectedDeliveryDate: expectedDeliveryDate
          ? new Date(expectedDeliveryDate)
          : undefined,
        vendorQuoteReference: vendorQuoteReference || undefined,

        createdBy: auth.currentUser?.uid || 'unknown',
      };

      const poId = await createPurchaseOrder(input);

      toast({
        title: 'Purchase Order Created',
        description: `PO created as draft. You can review and send it from the Documents tab.`,
      });

      // Reset form
      setSelectedVendor(null);
      setSelectableItems([]);
      setPaymentTerms(companySettings?.defaultPaymentTerms || '');
      setDeliveryTerms(companySettings?.defaultDeliveryTerms || '');
      setExpectedDeliveryDate('');
      setVendorQuoteReference('');

      onOpenChange(false);
    } catch (err: any) {
      console.error('Error creating PO:', err);
      setError(err.message || 'Failed to create purchase order');
      toast({
        title: 'Error',
        description: 'Failed to create purchase order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectableItems.filter((item) => item.isSelected).length;
  const totalItems = selectableItems.length;

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Create Purchase Order
          </DialogTitle>
          <DialogDescription>
            Create a PO for a single vendor. The PO will be saved as draft.
          </DialogDescription>
        </DialogHeader>

        {loadingSettings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : !companySettings || !companySettings.gstin ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Company settings not configured. Please set up company details (GSTIN, Address, State)
              in Settings → Company before creating POs.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Vendor Selection */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Select Vendor
                </CardTitle>
                <CardDescription className="text-xs">
                  {vendorsWithItems.length} vendor(s) have items assigned in BOM
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <VendorCombobox
                  vendors={vendorsWithItems}
                  value={selectedVendor?.id || ''}
                  onChange={setSelectedVendor}
                />

                {selectedVendor && (
                  <div className="mt-3 p-3 bg-muted rounded-lg text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">GSTIN:</span>{' '}
                        <span className="font-medium">{selectedVendor.gstNo}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">State:</span>{' '}
                        <span className="font-medium">
                          {selectedVendor.stateName || getStateName(selectedVendor.stateCode || '')}
                          {selectedVendor.stateCode && ` (${selectedVendor.stateCode})`}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Address:</span>{' '}
                        <span>{selectedVendor.address}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items Selection */}
            {selectedVendor && (
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Items ({selectedCount}/{totalItems})
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Items assigned to {selectedVendor.company}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectableItems((prev) =>
                            prev.map((item) => ({ ...item, isSelected: true }))
                          )
                        }
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectableItems((prev) =>
                            prev.map((item) => ({ ...item, isSelected: false }))
                          )
                        }
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {selectableItems.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      No items found for this vendor
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[250px] overflow-y-auto">
                      {/* Header */}
                      <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 pb-1 border-b">
                        <div className="col-span-1"></div>
                        <div className="col-span-4">Item</div>
                        <div className="col-span-2 text-center">Qty</div>
                        <div className="col-span-2 text-right">Rate (₹)</div>
                        <div className="col-span-3 text-right">Amount</div>
                      </div>

                      {selectableItems.map((item) => (
                        <div
                          key={item.bomItemId}
                          className={cn(
                            'grid grid-cols-12 gap-2 items-center p-2 border rounded-lg',
                            item.isSelected
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-gray-50'
                          )}
                        >
                          <div className="col-span-1">
                            <Checkbox
                              checked={item.isSelected}
                              onCheckedChange={() => handleToggleItem(item.bomItemId)}
                            />
                          </div>
                          <div className="col-span-4">
                            <div className="font-medium text-sm truncate">
                              {item.name}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              {item.make && (
                                <span className="bg-blue-100 text-blue-700 px-1 rounded">
                                  {item.make}
                                </span>
                              )}
                              {item.sku && <span>SKU: {item.sku}</span>}
                            </div>
                          </div>
                          <div className="col-span-2">
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                handleQuantityChange(
                                  item.bomItemId,
                                  parseInt(e.target.value) || 1
                                )
                              }
                              disabled={!item.isSelected}
                              className="h-8 text-center text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.rate || ''}
                              onChange={(e) =>
                                handleRateChange(
                                  item.bomItemId,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              disabled={!item.isSelected}
                              placeholder="0.00"
                              className={cn(
                                'h-8 text-right text-sm',
                                item.isSelected && !item.rate && 'border-red-300'
                              )}
                            />
                          </div>
                          <div className="col-span-3 text-right text-sm font-medium">
                            {item.isSelected
                              ? formatCurrency(item.quantity * item.rate)
                              : '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Terms */}
            {selectedVendor && selectedCount > 0 && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-4 w-4" />
                    Payment & Delivery Terms
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="paymentTerms">
                        Payment Terms <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        id="paymentTerms"
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                        placeholder="e.g., 100% payment within 30 days from invoice date"
                        className="min-h-[60px]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deliveryTerms">
                        Delivery Terms <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        id="deliveryTerms"
                        value={deliveryTerms}
                        onChange={(e) => setDeliveryTerms(e.target.value)}
                        placeholder="e.g., 2-4 Weeks from PO date"
                        className="min-h-[60px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="expectedDelivery">Expected Delivery Date</Label>
                      <Input
                        id="expectedDelivery"
                        type="date"
                        value={expectedDeliveryDate}
                        onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vendorQuote">Vendor Quote</Label>
                      <Input
                        id="vendorQuote"
                        value={vendorQuoteReference}
                        onChange={(e) => setVendorQuoteReference(e.target.value)}
                        placeholder="Vendor's quote number/reference (if any)"
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Terms & Conditions */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={includeAnnexure}
                          onCheckedChange={setIncludeAnnexure}
                          id="includeAnnexure"
                        />
                        <Label htmlFor="includeAnnexure">
                          Include Terms & Conditions Annexure
                        </Label>
                      </div>
                      {includeAnnexure && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowTerms(!showTerms)}
                        >
                          {showTerms ? (
                            <>
                              <ChevronUp className="h-4 w-4 mr-1" />
                              Hide
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4 mr-1" />
                              Edit
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {includeAnnexure && showTerms && (
                      <Textarea
                        value={termsAndConditions}
                        onChange={(e) => setTermsAndConditions(e.target.value)}
                        placeholder="Enter terms and conditions..."
                        className="min-h-[200px] text-sm font-mono"
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Summary */}
            {calculatedTotals && (
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader className="py-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <IndianRupee className="h-4 w-4" />
                    PO Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-medium">
                        {formatCurrency(calculatedTotals.subtotal)}
                      </span>
                    </div>

                    {calculatedTotals.taxType === 'igst' ? (
                      <div className="flex justify-between text-muted-foreground">
                        <span>IGST @ 18%</span>
                        <span>{formatCurrency(calculatedTotals.igstAmount || 0)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>CGST @ 9%</span>
                          <span>{formatCurrency(calculatedTotals.cgstAmount || 0)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>SGST @ 9%</span>
                          <span>{formatCurrency(calculatedTotals.sgstAmount || 0)}</span>
                        </div>
                      </>
                    )}

                    <Separator />

                    <div className="flex justify-between text-lg font-bold">
                      <span>Total</span>
                      <span>{formatCurrency(calculatedTotals.totalAmount)}</span>
                    </div>

                    <div className="text-xs text-muted-foreground italic">
                      {calculatedTotals.amountInWords}
                    </div>

                    <div className="mt-2 pt-2 border-t">
                      <Badge
                        variant={
                          calculatedTotals.taxType === 'igst' ? 'default' : 'secondary'
                        }
                      >
                        {calculatedTotals.taxType === 'igst'
                          ? 'Interstate (IGST)'
                          : 'Intrastate (CGST+SGST)'}
                      </Badge>
                      <span className="ml-2 text-xs text-muted-foreground">
                        Company: {companySettings?.stateName} → Vendor:{' '}
                        {selectedVendor?.stateName ||
                          getStateName(selectedVendor?.stateCode || '')}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 flex-shrink-0 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              loading ||
              !selectedVendor ||
              selectedCount === 0 ||
              !paymentTerms.trim() ||
              !deliveryTerms.trim() ||
              !companySettings?.gstin
            }
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Create Draft PO
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePODialog;
