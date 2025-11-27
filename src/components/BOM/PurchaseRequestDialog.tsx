import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Send, Mail, X, AlertCircle, User, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { BOMCategory, BOMItem } from '@/types/bom';
import { Vendor, getPRSettings } from '@/utils/settingsFirestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from '@/components/ui/use-toast';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';

interface PurchaseRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectDetails: {
    projectName: string;
    projectId: string;
    clientName: string;
  };
  categories: BOMCategory[];
  vendors: Vendor[];
}

interface SelectableItem {
  id: string;
  name: string;
  make: string;
  sku: string;
  description: string;
  quantity: number;
  category: string;
  selectedVendorId: string;
  selectedVendorName: string;
  isSelected: boolean;
}

interface GroupedItem {
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
  items: Array<{
    name: string;
    make: string;
    sku: string;
    description: string;
    quantity: number;
    category: string;
  }>;
}

// Searchable Vendor Combobox Component
const VendorCombobox: React.FC<{
  vendors: Vendor[];
  value: string;
  onChange: (vendorId: string, vendorName: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}> = ({ vendors, value, onChange, disabled, hasError }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedVendor = vendors.find(v => v.id === value);

  const filteredVendors = useMemo(() => {
    if (!searchQuery) return vendors;
    const query = searchQuery.toLowerCase();
    return vendors.filter(v =>
      v.company.toLowerCase().includes(query) ||
      v.type.toLowerCase().includes(query)
    );
  }, [vendors, searchQuery]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full h-8 justify-between text-xs font-normal",
            hasError && "border-red-300",
            !selectedVendor && "text-muted-foreground"
          )}
        >
          {selectedVendor ? (
            <span className="flex items-center gap-1 truncate">
              <span className={cn(
                "px-1 py-0.5 rounded text-[10px] shrink-0",
                selectedVendor.type === 'OEM' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
              )}>
                {selectedVendor.type}
              </span>
              <span className="truncate">{selectedVendor.company}</span>
            </span>
          ) : (
            "Select vendor..."
          )}
          <Search className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
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
              <CommandItem
                value="__NONE__"
                onSelect={() => {
                  onChange('', '');
                  setOpen(false);
                  setSearchQuery('');
                }}
              >
                <span className="text-muted-foreground">No vendor</span>
              </CommandItem>
              {filteredVendors
                .filter(v => v.status === 'active')
                .sort((a, b) => {
                  if (a.type !== b.type) return a.type === 'OEM' ? -1 : 1;
                  return a.company.localeCompare(b.company);
                })
                .map((vendor) => (
                  <CommandItem
                    key={vendor.id}
                    value={vendor.id}
                    onSelect={() => {
                      onChange(vendor.id, vendor.company);
                      setOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === vendor.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex items-center gap-2">
                      <span className={cn(
                        "px-1 py-0.5 rounded text-[10px]",
                        vendor.type === 'OEM' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      )}>
                        {vendor.type}
                      </span>
                      <span className="truncate">{vendor.company}</span>
                    </span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const PurchaseRequestDialog: React.FC<PurchaseRequestDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectDetails,
  categories,
  vendors
}) => {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [companyName, setCompanyName] = useState('Qualitas Technologies Pvt Ltd');
  const [fromEmail, setFromEmail] = useState('info@qualitastech.com');
  const [loading, setLoading] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Item selection and vendor assignment state
  const [selectableItems, setSelectableItems] = useState<SelectableItem[]>([]);

  // Get logged-in user's email
  const loggedInUserEmail = auth.currentUser?.email || '';

  // Active vendors for selection
  const activeVendors = useMemo(() => {
    return vendors.filter(v => v.status === 'active');
  }, [vendors]);

  // Load PR settings when dialog opens
  useEffect(() => {
    const loadSettings = async () => {
      if (!open) return;

      setLoadingSettings(true);
      try {
        const settings = await getPRSettings();
        if (settings) {
          setRecipients(settings.recipients || []);
          setCompanyName(settings.companyName || 'Qualitas Technologies Pvt Ltd');
          setFromEmail(settings.fromEmail || 'info@qualitastech.com');
        }
      } catch (err) {
        console.error('Error loading PR settings:', err);
        setError('Failed to load settings');
      } finally {
        setLoadingSettings(false);
      }
    };

    loadSettings();
  }, [open]);

  // Initialize selectable items when dialog opens
  useEffect(() => {
    if (!open) return;

    const items: SelectableItem[] = [];
    categories.forEach(category => {
      if (!category.items) return;

      category.items.forEach(item => {
        // Only include components (not services)
        if (item.itemType === 'service') return;

        // Find vendor ID from name if finalizedVendor exists
        let vendorId = '';
        let vendorName = '';
        if (item.finalizedVendor?.name) {
          const matchingVendor = vendors.find(
            v => v.company.toLowerCase() === item.finalizedVendor?.name.toLowerCase()
          );
          if (matchingVendor) {
            vendorId = matchingVendor.id;
            vendorName = matchingVendor.company;
          } else {
            // Keep the name even if not found in current vendor list
            vendorName = item.finalizedVendor.name;
          }
        }

        items.push({
          id: item.id,
          name: item.name,
          make: item.make || '',
          sku: item.sku || '',
          description: item.description,
          quantity: item.quantity,
          category: category.name,
          selectedVendorId: vendorId,
          selectedVendorName: vendorName,
          isSelected: true // All selected by default
        });
      });
    });

    setSelectableItems(items);
  }, [categories, vendors, open]);

  // Group selected items by vendor for preview
  const groupedItems = useMemo((): GroupedItem[] => {
    const grouped: { [key: string]: GroupedItem } = {};

    selectableItems
      .filter(item => item.isSelected && item.selectedVendorId)
      .forEach(item => {
        const vendorId = item.selectedVendorId;

        if (!grouped[vendorId]) {
          const vendorInfo = vendors.find(v => v.id === vendorId);
          grouped[vendorId] = {
            vendorId: vendorId,
            vendorName: item.selectedVendorName,
            vendorEmail: vendorInfo?.email || '',
            vendorPhone: vendorInfo?.phone || '',
            items: []
          };
        }

        grouped[vendorId].items.push({
          name: item.name,
          make: item.make,
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          category: item.category
        });
      });

    return Object.values(grouped);
  }, [selectableItems, vendors]);

  const handleToggleItem = (itemId: string) => {
    setSelectableItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, isSelected: !item.isSelected } : item
      )
    );
  };

  const handleSelectAll = () => {
    setSelectableItems(prev => prev.map(item => ({ ...item, isSelected: true })));
  };

  const handleDeselectAll = () => {
    setSelectableItems(prev => prev.map(item => ({ ...item, isSelected: false })));
  };

  const handleVendorChange = (itemId: string, vendorId: string, vendorName: string) => {
    setSelectableItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, selectedVendorId: vendorId, selectedVendorName: vendorName }
          : item
      )
    );
  };

  const handleAddEmail = () => {
    if (!emailInput.trim()) return;

    const email = emailInput.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Invalid email format');
      return;
    }

    if (recipients.includes(email)) {
      setError('Email already added');
      return;
    }

    setRecipients([...recipients, email]);
    setEmailInput('');
    setError(null);
  };

  const handleRemoveEmail = (email: string) => {
    setRecipients(recipients.filter(e => e !== email));
  };

  const handleSend = async () => {
    if (recipients.length === 0) {
      setError('Please add at least one recipient email');
      return;
    }

    const selectedItems = selectableItems.filter(item => item.isSelected);
    if (selectedItems.length === 0) {
      setError('Please select at least one item');
      return;
    }

    const itemsWithoutVendor = selectedItems.filter(item => !item.selectedVendorId);
    if (itemsWithoutVendor.length > 0) {
      setError(`Please assign a vendor to all selected items (${itemsWithoutVendor.length} items without vendor)`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const functions = getFunctions();
      const sendPR = httpsCallable(functions, 'sendPurchaseRequest');

      // Build categories with only selected items and include vendor ID
      const filteredCategories = categories.map(cat => ({
        ...cat,
        items: cat.items.filter(item => {
          const selectableItem = selectableItems.find(si => si.id === item.id);
          return selectableItem?.isSelected;
        }).map(item => {
          const selectableItem = selectableItems.find(si => si.id === item.id);
          // IMPORTANT: Include vendor ID for proper grouping in Firebase function
          return {
            ...item,
            finalizedVendor: selectableItem?.selectedVendorId
              ? {
                  id: selectableItem.selectedVendorId,
                  name: selectableItem.selectedVendorName,
                  price: item.price || 0,
                  leadTime: '',
                  availability: ''
                }
              : item.finalizedVendor
          };
        })
      })).filter(cat => cat.items.length > 0);

      // Always include logged-in user in CC
      const allRecipients = loggedInUserEmail && !recipients.includes(loggedInUserEmail.toLowerCase())
        ? [...recipients, loggedInUserEmail.toLowerCase()]
        : recipients;

      const result = await sendPR({
        projectDetails,
        categories: filteredCategories,
        vendors,
        recipients: allRecipients,
        companyName,
        fromEmail,
        ccUser: loggedInUserEmail
      });

      toast({
        title: "Success",
        description: `Purchase request sent to ${allRecipients.length} recipient${allRecipients.length > 1 ? 's' : ''}`,
      });

      onOpenChange(false);
    } catch (err: any) {
      console.error('Error sending purchase request:', err);
      setError(err.message || 'Failed to send purchase request');
      toast({
        title: "Error",
        description: "Failed to send purchase request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectableItems.filter(item => item.isSelected).length;
  const totalItems = selectableItems.length;
  const itemsWithVendor = selectableItems.filter(item => item.isSelected && item.selectedVendorId).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Create Purchase Request</DialogTitle>
          <DialogDescription>
            Select items and assign vendors, then send to supply chain team
          </DialogDescription>
        </DialogHeader>

        {loadingSettings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Item Selection */}
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Select Items</CardTitle>
                    <CardDescription className="text-xs">
                      {selectedCount} of {totalItems} items selected
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDeselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {selectableItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 p-2 border rounded-lg",
                        item.isSelected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'
                      )}
                    >
                      <Checkbox
                        checked={item.isSelected}
                        onCheckedChange={() => handleToggleItem(item.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{item.name}</span>
                          {item.make && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded">{item.make}</span>
                          )}
                          <span className="text-xs text-gray-500">Qty: {item.quantity}</span>
                        </div>
                        <div className="text-xs text-gray-500 truncate">{item.category}</div>
                      </div>
                      <div className="w-[200px]">
                        <VendorCombobox
                          vendors={activeVendors}
                          value={item.selectedVendorId}
                          onChange={(vendorId, vendorName) => handleVendorChange(item.id, vendorId, vendorName)}
                          disabled={!item.isSelected}
                          hasError={item.isSelected && !item.selectedVendorId}
                        />
                      </div>
                    </div>
                  ))}
                  {selectableItems.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      No component items found in BOM
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Preview - Grouped by Vendor */}
            {groupedItems.length > 0 && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Preview - Grouped by Vendor</CardTitle>
                  <CardDescription className="text-xs">
                    {itemsWithVendor} items across {groupedItems.length} vendors
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {groupedItems.map((vendor) => (
                      <div
                        key={vendor.vendorId}
                        className="border rounded-lg p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm">{vendor.vendorName}</h4>
                          <Badge variant="outline" className="text-xs">{vendor.items.length} items</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {vendor.items.slice(0, 3).map((item, idx) => (
                            <div key={idx} className="truncate">
                              • {item.name} {item.sku && `(${item.sku})`} - Qty: {item.quantity}
                            </div>
                          ))}
                          {vendor.items.length > 3 && (
                            <div className="italic mt-1">
                              + {vendor.items.length - 3} more items...
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recipients */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Recipients</CardTitle>
                <CardDescription className="text-xs">
                  Internal emails for supply chain team
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {/* Logged-in user CC notice */}
                {loggedInUserEmail && (
                  <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                    <User size={14} className="text-blue-600" />
                    <span className="text-blue-800">
                      Copy will be sent to: <strong>{loggedInUserEmail}</strong>
                    </span>
                  </div>
                )}

                {/* Add Email Input */}
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddEmail();
                      }
                    }}
                    placeholder="Add recipient email"
                    className="h-9"
                  />
                  <Button type="button" onClick={handleAddEmail} variant="outline" size="sm">
                    Add
                  </Button>
                </div>

                {/* Error Display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Recipients List */}
                {recipients.length > 0 && (
                  <div className="space-y-1">
                    {recipients.map((email, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded bg-muted/50"
                      >
                        <div className="flex items-center gap-2">
                          <Mail size={12} className="text-muted-foreground" />
                          <span className="text-sm">{email}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => handleRemoveEmail(email)}
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {recipients.length === 0 && (
                  <Alert>
                    <Mail className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Configure recipients in Settings → Purchase Request tab.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 flex-shrink-0 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={loading || recipients.length === 0 || selectedCount === 0 || itemsWithVendor !== selectedCount}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send PR ({itemsWithVendor} items)
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PurchaseRequestDialog;
