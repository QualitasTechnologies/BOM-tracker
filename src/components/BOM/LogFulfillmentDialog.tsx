import { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Loader2, Camera, X, CheckCircle } from 'lucide-react';
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
import { BOMItemType } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { uploadProjectDocument } from '@/utils/projectDocumentFirestore';
import { auth, storage } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface LogFulfillmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemType: BOMItemType;
  itemName: string;
  budgetedQty: number;
  remainingQty: number;
  projectId: string;
  projectDocuments: ProjectDocument[];
  onConfirm: (data: { quantity: number; invoiceDocId?: string; photoUrl?: string }) => void;
}

const formatUploadDate = (uploadedAt: Date | unknown): string => {
  if (!uploadedAt) return '';
  try {
    const d = uploadedAt instanceof Date ? uploadedAt : new Date((uploadedAt as any).seconds * 1000);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

const compressImage = async (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      const maxDim = 800;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/jpeg',
        0.7
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

const LogFulfillmentDialog = ({
  open,
  onOpenChange,
  itemType,
  itemName,
  budgetedQty,
  remainingQty,
  projectId,
  projectDocuments,
  onConfirm,
}: LogFulfillmentDialogProps) => {
  const isService = itemType === 'service';
  const unit = isService ? 'days' : 'units';
  const step = isService ? 0.5 : 1;
  const min = isService ? 0.5 : 1;

  const [qty, setQty] = useState<string>('');
  const [invoiceDocId, setInvoiceDocId] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<ProjectDocument | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setQty('');
      setInvoiceDocId('');
      setUploadedDoc(null);
      setPhotoUrl('');
      setPhotoPreview('');
    }
  }, [open]);

  // Deduplicate and sort: most recently uploaded first; show date in label
  const invoiceDocuments = (() => {
    const base = projectDocuments.filter(d => d.type === 'vendor-invoice');
    if (uploadedDoc && !base.some(d => d.id === uploadedDoc.id)) {
      base.unshift(uploadedDoc);
    }
    // Deduplicate by ID, sort newest first
    const seen = new Set<string>();
    return base.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    }).sort((a, b) => {
      const ta = a.uploadedAt instanceof Date ? a.uploadedAt.getTime() : (a.uploadedAt as any)?.seconds * 1000 || 0;
      const tb = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : (b.uploadedAt as any)?.seconds * 1000 || 0;
      return tb - ta;
    });
  })();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const newDoc = await uploadProjectDocument(file, projectId, 'vendor-invoice', user.uid);
      setUploadedDoc(newDoc);
      setInvoiceDocId(newDoc.id);
      toast({ title: 'Invoice Uploaded', description: file.name });
    } catch (err) {
      toast({
        title: 'Upload Failed',
        description: err instanceof Error ? err.message : 'Upload error',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid File', description: 'Please select an image file', variant: 'destructive' });
      return;
    }
    setUploadingPhoto(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      setPhotoPreview(URL.createObjectURL(file));
      const compressed = await compressImage(file);
      const fileName = `received-photo-${Date.now()}.jpg`;
      const storageRef = ref(storage, `projects/${projectId}/received-photos/${fileName}`);
      await uploadBytes(storageRef, compressed, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(storageRef);
      setPhotoUrl(url);
      toast({ title: 'Photo Uploaded', description: 'Receipt proof uploaded' });
    } catch (err) {
      setPhotoPreview('');
      toast({ title: 'Upload Failed', description: err instanceof Error ? err.message : 'Upload error', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const qtyNum = parseFloat(qty);
  const validQty = !isNaN(qtyNum) && qtyNum >= min && qtyNum <= remainingQty;
  const overBudget = !isNaN(qtyNum) && qtyNum > remainingQty;
  const selectedDoc = invoiceDocuments.find(d => d.id === invoiceDocId);

  const handleConfirm = () => {
    if (!validQty) return;
    onConfirm({
      quantity: qtyNum,
      invoiceDocId: invoiceDocId || undefined,
      photoUrl: photoUrl || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Log {isService ? 'Service Fulfillment' : 'Partial Receipt'}</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            {remainingQty} {unit} remaining of {budgetedQty} {isService ? 'budgeted' : 'ordered'} — {itemName}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Qty */}
          <div className="space-y-1.5">
            <Label htmlFor="ful-qty" className="text-sm font-medium">
              {isService ? 'Days consumed' : 'Units received'} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="ful-qty"
              type="number"
              min={min}
              step={step}
              max={remainingQty}
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder={`e.g. ${isService ? '5' : '10'}  (max ${remainingQty})`}
              className={overBudget ? 'border-red-400' : ''}
            />
            {overBudget && (
              <p className="text-xs text-red-500">Only {remainingQty} {unit} remain</p>
            )}
          </div>

          {/* Vendor Invoice */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Vendor Invoice {!isService && <span className="text-red-500">*</span>}
            </Label>
            <div className="flex gap-2">
              <Select value={invoiceDocId} onValueChange={setInvoiceDocId}>
                <SelectTrigger className={`h-9 text-sm flex-1 ${!isService && !invoiceDocId ? 'border-red-300' : ''}`}>
                  <SelectValue placeholder="Select existing invoice" />
                </SelectTrigger>
                <SelectContent>
                  {invoiceDocuments.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-gray-500">No invoices uploaded yet</div>
                  )}
                  {invoiceDocuments.map(doc => (
                    <SelectItem key={doc.id} value={doc.id}>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{doc.name}</span>
                        {doc.uploadedAt && (
                          <span className="text-gray-400 text-[10px] shrink-0 ml-auto">
                            {formatUploadDate(doc.uploadedAt)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleFileUpload} className="hidden" />
              <Button type="button" variant="outline" size="sm" className="h-9 px-3" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Upload invoice">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>
            {invoiceDocId && selectedDoc && (
              <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-800">
                Invoice: <span className="font-medium">{selectedDoc.name}</span>
              </div>
            )}
          </div>

          {/* Receipt Photo */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Receipt Photo {!isService && <span className="text-red-500">*</span>}
            </Label>
            <p className="text-xs text-gray-500">Photo proof of the received items or packaging.</p>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Receipt preview" className="w-full h-32 object-cover rounded-md border" />
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
                {!uploadingPhoto && (
                  <Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2 h-6 w-6 p-0"
                    onClick={() => { setPhotoUrl(''); setPhotoPreview(''); }}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
                {photoUrl && (
                  <div className="absolute bottom-2 left-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Uploaded
                  </div>
                )}
              </div>
            ) : (
              <>
                <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
                <Button type="button" variant="outline"
                  className={`w-full h-16 flex-col gap-1 ${!isService && !photoUrl ? 'border-red-300' : ''}`}
                  onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
                  {uploadingPhoto ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <Camera className="h-5 w-5" />
                      <span className="text-xs">Take Photo / Upload</span>
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!validQty || (!isService && (!invoiceDocId || !photoUrl))}>
            Log {validQty ? `${qtyNum} ${unit}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogFulfillmentDialog;
