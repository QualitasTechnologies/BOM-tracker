import { useState, useEffect } from 'react';
import {
  FileText,
  Trash2,
  Send,
  Edit,
  Eye,
  MoreHorizontal,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  Download,
  Mail
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  subscribeToPurchaseOrders,
  deletePurchaseOrder,
  sendPurchaseOrder,
  generatePOPDF,
  sendPOEmail,
  PurchaseOrder
} from '@/utils/poFirestore';
import { getCompanySettings } from '@/utils/settingsFirestore';
import { auth } from '@/firebase';
import { useAuth } from '@/hooks/useAuth';

interface POListSectionProps {
  projectId: string;
  onPOSent?: (poId: string, bomItemIds: string[]) => Promise<void>;
}

const POListSection = ({ projectId, onPOSent }: POListSectionProps) => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [poToDelete, setPOToDelete] = useState<PurchaseOrder | null>(null);
  const [poToSend, setPOToSend] = useState<PurchaseOrder | null>(null);
  const [sendToEmail, setSendToEmail] = useState('');
  const [sendMode, setSendMode] = useState<'email' | 'mark'>('email'); // 'email' = send email, 'mark' = just mark as sent
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  // Subscribe to purchase orders
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = subscribeToPurchaseOrders(projectId, (pos) => {
      setPurchaseOrders(pos);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-300">
            <Edit size={12} className="mr-1" />
            Draft
          </Badge>
        );
      case 'sent':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
            <Send size={12} className="mr-1" />
            Sent
          </Badge>
        );
      case 'acknowledged':
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
            <CheckCircle size={12} className="mr-1" />
            Acknowledged
          </Badge>
        );
      case 'partially-received':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock size={12} className="mr-1" />
            Partial
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            <CheckCircle size={12} className="mr-1" />
            Completed
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
            <XCircle size={12} className="mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleViewPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setViewDialogOpen(true);
  };

  const handleDeleteClick = (po: PurchaseOrder) => {
    setPOToDelete(po);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!poToDelete) return;

    setDeleting(true);
    try {
      await deletePurchaseOrder(projectId, poToDelete.id);
      toast({
        title: 'PO Deleted',
        description: `Purchase Order ${poToDelete.poNumber} has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setPOToDelete(null);
    } catch (error) {
      console.error('Error deleting PO:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete Purchase Order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleSendClick = (po: PurchaseOrder, mode: 'email' | 'mark' = 'email') => {
    setPOToSend(po);
    setSendToEmail(po.vendorEmail || '');
    setSendMode(mode);
    setSendDialogOpen(true);
  };

  const handleConfirmSend = async () => {
    if (!poToSend) return;

    if (!sendToEmail.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address to send the PO.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      await sendPurchaseOrder(
        projectId,
        poToSend.id,
        {
          sentBy: user.uid,
          sentToEmail: sendToEmail.trim(),
        },
        onPOSent ? async (bomItemIds) => {
          await onPOSent(poToSend.id, bomItemIds);
        } : undefined
      );

      toast({
        title: 'PO Sent',
        description: `Purchase Order ${poToSend.poNumber} has been marked as sent.`,
      });
      setSendDialogOpen(false);
      setPOToSend(null);
      setSendToEmail('');
    } catch (error) {
      console.error('Error sending PO:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send Purchase Order.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  // Generate PDF and download
  const handleGeneratePDF = async (po: PurchaseOrder) => {
    setGeneratingPDF(po.id);
    try {
      const companySettings = await getCompanySettings();
      if (!companySettings) {
        throw new Error('Company settings not configured');
      }

      const result = await generatePOPDF({
        purchaseOrder: po,
        companySettings: {
          companyName: companySettings.companyName,
          companyAddress: companySettings.companyAddress,
          gstin: companySettings.gstin,
          stateCode: companySettings.stateCode,
          stateName: companySettings.stateName,
          pan: companySettings.pan,
          phone: companySettings.phone,
          email: companySettings.email,
          website: companySettings.website,
        },
      });

      // Open PDF in new tab
      window.open(result.pdfUrl, '_blank');

      toast({
        title: 'PDF Generated',
        description: `PO ${po.poNumber} PDF is ready for download.`,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate PDF.',
        variant: 'destructive',
      });
    } finally {
      setGeneratingPDF(null);
    }
  };

  // Send PO via email with PDF
  const handleSendPOEmail = async () => {
    if (!poToSend || !sendToEmail.trim()) return;

    setSendingEmail(true);
    try {
      const companySettings = await getCompanySettings();
      if (!companySettings) {
        throw new Error('Company settings not configured');
      }

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Send email with PDF
      await sendPOEmail({
        purchaseOrder: poToSend,
        companySettings: {
          companyName: companySettings.companyName,
          companyAddress: companySettings.companyAddress,
          gstin: companySettings.gstin,
          stateCode: companySettings.stateCode,
          stateName: companySettings.stateName,
          pan: companySettings.pan,
          phone: companySettings.phone,
          email: companySettings.email,
          website: companySettings.website,
        },
        recipientEmail: sendToEmail.trim(),
        ccEmails: user.email ? [user.email] : [],
      });

      // Also update local status
      if (onPOSent) {
        const bomItemIds = poToSend.items.map(item => item.bomItemId);
        await onPOSent(poToSend.id, bomItemIds);
      }

      toast({
        title: 'PO Sent',
        description: `Purchase Order ${poToSend.poNumber} has been emailed to ${sendToEmail}.`,
      });
      setSendDialogOpen(false);
      setPOToSend(null);
      setSendToEmail('');
    } catch (error) {
      console.error('Error sending PO email:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send PO email.',
        variant: 'destructive',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mb-8">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b">
        <div>
          <h3 className="font-semibold text-lg text-gray-900">
            Purchase Orders
            <Badge variant="outline" className="ml-2">{purchaseOrders.length}</Badge>
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Generated POs from BOM items. Admin users can send draft POs to vendors.
          </p>
        </div>
      </div>

      {/* PO List */}
      <div className="space-y-3">
        {purchaseOrders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm italic bg-gray-50 rounded border border-dashed">
            No purchase orders created yet. Use "Create PO" button in the BOM Items tab.
          </div>
        ) : (
          purchaseOrders.map((po) => (
            <div
              key={po.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              <FileText className="text-blue-600 flex-shrink-0" size={20} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-blue-700">
                    {po.poNumber}
                  </span>
                  {getStatusBadge(po.status)}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  <span className="font-medium">{po.vendorName}</span>
                  <span className="mx-2">•</span>
                  <span className="text-green-700 font-medium">{formatCurrency(po.totalAmount)}</span>
                  <span className="mx-2">•</span>
                  <span className="text-gray-500">{formatDate(po.poDate)}</span>
                  <span className="mx-2">•</span>
                  <span className="text-gray-500">{po.items.length} item{po.items.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleViewPO(po)}
                  title="View details"
                >
                  <Eye size={16} />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleViewPO(po)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => handleGeneratePDF(po)}
                      disabled={generatingPDF === po.id}
                    >
                      {generatingPDF === po.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Download PDF
                    </DropdownMenuItem>

                    {po.status === 'draft' && isAdmin && (
                      <DropdownMenuItem onClick={() => handleSendClick(po, 'email')}>
                        <Mail className="mr-2 h-4 w-4" />
                        Email to Vendor
                      </DropdownMenuItem>
                    )}

                    {po.status === 'draft' && isAdmin && (
                      <DropdownMenuItem onClick={() => handleSendClick(po, 'mark')}>
                        <Send className="mr-2 h-4 w-4" />
                        Mark as Sent
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onClick={() => handleDeleteClick(po)}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      {/* View PO Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Order Details</DialogTitle>
            <DialogDescription>
              {selectedPO?.poNumber} - {selectedPO?.vendorName}
            </DialogDescription>
          </DialogHeader>

          {selectedPO && (
            <div className="space-y-6">
              {/* Status and Basic Info */}
              <div className="flex items-center justify-between">
                {getStatusBadge(selectedPO.status)}
                <span className="text-sm text-gray-500">
                  Created: {formatDate(selectedPO.createdAt)}
                </span>
              </div>

              {/* Vendor Info */}
              <div className="bg-gray-50 rounded p-4">
                <h4 className="font-medium mb-2">Vendor Details</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Name:</span>{' '}
                    <span className="font-medium">{selectedPO.vendorName}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">GSTIN:</span>{' '}
                    <span className="font-medium">{selectedPO.vendorGstin || 'N/A'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Address:</span>{' '}
                    <span>{selectedPO.vendorAddress || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-medium mb-2">Items ({selectedPO.items.length})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left p-2">#</th>
                        <th className="text-left p-2">Description</th>
                        <th className="text-right p-2">Qty</th>
                        <th className="text-right p-2">Rate</th>
                        <th className="text-right p-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{item.slNo}</td>
                          <td className="p-2">
                            <div className="font-medium">{item.description}</div>
                            {item.hsn && (
                              <div className="text-xs text-gray-500">HSN: {item.hsn}</div>
                            )}
                          </td>
                          <td className="text-right p-2">{item.quantity} {item.uom}</td>
                          <td className="text-right p-2">{formatCurrency(item.rate)}</td>
                          <td className="text-right p-2">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-gray-50 rounded p-4">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedPO.subtotal)}</span>
                  </div>
                  {selectedPO.taxType === 'igst' ? (
                    <div className="flex justify-between">
                      <span>IGST ({selectedPO.taxPercentage}%):</span>
                      <span>{formatCurrency(selectedPO.igstAmount || 0)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span>CGST ({selectedPO.taxPercentage / 2}%):</span>
                        <span>{formatCurrency(selectedPO.cgstAmount || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>SGST ({selectedPO.taxPercentage / 2}%):</span>
                        <span>{formatCurrency(selectedPO.sgstAmount || 0)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold text-base pt-2 border-t">
                    <span>Total:</span>
                    <span className="text-green-700">{formatCurrency(selectedPO.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              {(selectedPO.paymentTerms || selectedPO.deliveryTerms) && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedPO.paymentTerms && (
                    <div>
                      <span className="text-gray-500 block">Payment Terms:</span>
                      <span>{selectedPO.paymentTerms}</span>
                    </div>
                  )}
                  {selectedPO.deliveryTerms && (
                    <div>
                      <span className="text-gray-500 block">Delivery Terms:</span>
                      <span>{selectedPO.deliveryTerms}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
            {selectedPO?.status === 'draft' && isAdmin && (
              <Button onClick={() => {
                setViewDialogOpen(false);
                handleSendClick(selectedPO);
              }}>
                <Send className="mr-2 h-4 w-4" />
                Send PO
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete PO <strong>{poToDelete?.poNumber}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send PO Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sendMode === 'email' ? 'Email Purchase Order' : 'Mark as Sent'}
            </DialogTitle>
            <DialogDescription>
              {sendMode === 'email'
                ? `Generate PDF and email PO ${poToSend?.poNumber} to the vendor.`
                : `Mark PO ${poToSend?.poNumber} as sent and record the vendor email.`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {sendMode === 'email'
                  ? 'This will generate a PDF and email it to the vendor. The PO will be marked as "Sent" and all linked BOM items updated to "Ordered" status.'
                  : 'This will mark the PO as "Sent" and update all linked BOM items to "Ordered" status. Make sure you\'ve sent the actual PO document to the vendor.'
                }
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendorEmail">Vendor Email</Label>
              <Input
                id="vendorEmail"
                type="email"
                value={sendToEmail}
                onChange={(e) => setSendToEmail(e.target.value)}
                placeholder="vendor@example.com"
              />
              <p className="text-xs text-gray-500">
                {sendMode === 'email'
                  ? 'The PO PDF will be sent to this email address.'
                  : 'Enter the email address where the PO was sent.'
                }
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)} disabled={sending || sendingEmail}>
              Cancel
            </Button>
            {sendMode === 'email' ? (
              <Button onClick={handleSendPOEmail} disabled={sendingEmail || !sendToEmail.trim()}>
                {sendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Email...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Email
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={handleConfirmSend} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Mark as Sent
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default POListSection;
