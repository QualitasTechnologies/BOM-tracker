import React, { useState, useEffect } from 'react';
import { Loader2, Send, Mail, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BOMCategory } from '@/types/bom';
import { Vendor, getPRSettings } from '@/utils/settingsFirestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from '@/components/ui/use-toast';

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
  const [groupedItems, setGroupedItems] = useState<GroupedItem[]>([]);

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

  // Group items by vendor when categories or vendors change
  useEffect(() => {
    if (!open) return;

    const grouped = groupItemsByVendor(categories, vendors);
    setGroupedItems(grouped);
  }, [categories, vendors, open]);

  const groupItemsByVendor = (cats: BOMCategory[], vends: Vendor[]): GroupedItem[] => {
    const vendorMap = new Map<string, Vendor>();
    vends.forEach(v => vendorMap.set(v.id, v));

    const grouped: { [key: string]: GroupedItem } = {};

    cats.forEach(category => {
      if (!category.items) return;

      category.items.forEach(item => {
        // @ts-ignore - finalizedVendor might exist
        const vendorId = item.finalizedVendor?.id || 'unassigned';
        // @ts-ignore
        const vendorName = item.finalizedVendor?.name || 'Unassigned Vendor';

        if (!grouped[vendorId]) {
          const vendorInfo = vendorMap.get(vendorId);
          grouped[vendorId] = {
            vendorId,
            vendorName,
            vendorEmail: vendorInfo?.email || '',
            vendorPhone: vendorInfo?.phone || '',
            items: []
          };
        }

        grouped[vendorId].items.push({
          name: item.name,
          make: item.make || '',
          sku: item.sku || '',
          description: item.description,
          quantity: item.quantity,
          category: category.name
        });
      });
    });

    return Object.values(grouped);
  };

  const handleAddEmail = () => {
    if (!emailInput.trim()) return;

    const email = emailInput.trim().toLowerCase();

    // Simple email validation
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

    setLoading(true);
    setError(null);

    try {
      const functions = getFunctions();
      const sendPR = httpsCallable(functions, 'sendPurchaseRequest');

      const result = await sendPR({
        projectDetails,
        categories,
        vendors,
        recipients,
        companyName,
        fromEmail
      });

      toast({
        title: "Success",
        description: `Purchase request sent to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''}`,
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

  const totalItems = groupedItems.reduce((sum, vendor) => sum + vendor.items.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Purchase Request Preview</DialogTitle>
          <DialogDescription>
            Review and send purchase request to supply chain team
          </DialogDescription>
        </DialogHeader>

        {loadingSettings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-6">
            {/* Email Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Email Preview</CardTitle>
                <CardDescription>
                  {projectDetails.projectName} • {projectDetails.clientName}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Items</p>
                      <p className="text-2xl font-bold">{totalItems}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Vendors</p>
                      <p className="text-2xl font-bold">{groupedItems.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Categories</p>
                      <p className="text-2xl font-bold">{categories.length}</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Vendor Sections */}
                  <div className="space-y-3">
                    <Label>Items Grouped by Vendor</Label>
                    {groupedItems.map((vendor, index) => (
                      <div
                        key={vendor.vendorId}
                        className="border rounded-lg p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold">{vendor.vendorName}</h4>
                          <Badge variant="outline">{vendor.items.length} items</Badge>
                        </div>
                        {vendor.vendorEmail && (
                          <p className="text-xs text-muted-foreground">
                            {vendor.vendorEmail}
                          </p>
                        )}
                        <div className="text-sm text-muted-foreground">
                          {vendor.items.slice(0, 3).map((item, idx) => (
                            <div key={idx} className="truncate">
                              • {item.name} (Qty: {item.quantity})
                            </div>
                          ))}
                          {vendor.items.length > 3 && (
                            <div className="text-xs italic mt-1">
                              + {vendor.items.length - 3} more items...
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recipients</CardTitle>
                <CardDescription>
                  Internal emails for supply chain and accounts team
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  />
                  <Button type="button" onClick={handleAddEmail} variant="outline">
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
                  <div className="space-y-2">
                    {recipients.map((email, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded bg-muted/50"
                      >
                        <div className="flex items-center gap-2">
                          <Mail size={14} className="text-muted-foreground" />
                          <span className="text-sm">{email}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveEmail(email)}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {recipients.length === 0 && (
                  <Alert>
                    <Mail className="h-4 w-4" />
                    <AlertDescription>
                      No recipients added. Configure recipients in Settings → Purchase Request tab.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={loading || recipients.length === 0 || totalItems === 0}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Purchase Request
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PurchaseRequestDialog;
