import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileArchive,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { SupportDocument, SupportDocumentCategory } from '@/types/support';
import {
  deleteSupportDocument,
  subscribeToSupportDocuments,
  uploadSupportDocument,
} from '@/utils/supportFirestore';

const CATEGORY_LABELS: Record<SupportDocumentCategory, string> = {
  manual: 'Manual',
  drawing: 'Drawing',
  'electrical-drawing': 'Electrical drawing',
  'mechanical-drawing': 'Mechanical drawing',
  'software-backup': 'Software / configuration backup',
  'acceptance-document': 'Commissioning / acceptance',
  'amc-contract': 'AMC contract',
  'machine-photo': 'Machine photo',
  'diagnostic-log': 'Diagnostic log',
  quotation: 'Support quotation',
  'quotation-acceptance': 'Quotation acceptance / PO',
  'rca-report': 'RCA report',
  'solution-report': 'Solution report',
  other: 'Other',
};

const projectCategories: SupportDocumentCategory[] = [
  'manual',
  'drawing',
  'electrical-drawing',
  'mechanical-drawing',
  'software-backup',
  'acceptance-document',
  'amc-contract',
  'machine-photo',
  'other',
];

const ticketCategories: SupportDocumentCategory[] = [
  'machine-photo',
  'diagnostic-log',
  'quotation',
  'quotation-acceptance',
  'rca-report',
  'solution-report',
  'other',
];

interface Props {
  projectId: string;
  ticketId?: string;
  userId: string;
  userName: string;
  onUploaded?: (document: SupportDocument) => void;
  allowDelete?: boolean;
}

export function SupportDocuments({
  projectId,
  ticketId,
  userId,
  userName,
  onUploaded,
  allowDelete = true,
}: Props) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<SupportDocument[]>([]);
  const [category, setCategory] = useState<SupportDocumentCategory>(
    ticketId ? 'diagnostic-log' : 'manual',
  );
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const categories = ticketId ? ticketCategories : projectCategories;

  useEffect(() => subscribeToSupportDocuments(projectId, setDocuments), [projectId]);

  const visibleDocuments = useMemo(
    () =>
      ticketId
        ? documents.filter((document) => !document.ticketId || document.ticketId === ticketId)
        : documents.filter((document) => !document.ticketId),
    [documents, ticketId],
  );

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadSupportDocument(file, {
        projectId,
        ticketId,
        category,
        userId,
        userName,
      });
      onUploaded?.(uploaded);
      setFile(null);
      toast({ title: 'Document uploaded', description: file.name });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (document: SupportDocument) => {
    if (!window.confirm(`Delete ${document.name}?`)) return;
    try {
      await deleteSupportDocument(document);
      toast({ title: 'Document deleted' });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-slate-50 p-4 md:grid-cols-[180px_1fr_auto] md:items-end">
        <div className="grid gap-2">
          <Label>Document type</Label>
          <Select
            value={category}
            onValueChange={(value) => setCategory(value as SupportDocumentCategory)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map((item) => (
                <SelectItem key={item} value={item}>{CATEGORY_LABELS[item]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`support-file-${ticketId || projectId}`}>Choose file</Label>
          <Input
            id={`support-file-${ticketId || projectId}`}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </div>
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Upload
        </Button>
      </div>

      {visibleDocuments.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          <FileArchive className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          No support documents uploaded yet.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {visibleDocuments.map((document) => (
            <div key={document.id} className="flex items-center gap-3 p-3">
              <div className="rounded-md bg-slate-100 p-2">
                <FileText className="h-4 w-4 text-slate-600" />
              </div>
              <div className="min-w-0 flex-1">
                <a
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {document.name}
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{CATEGORY_LABELS[document.category]}</Badge>
                  <span>{(document.fileSize / 1024 / 1024).toFixed(1)} MB</span>
                  <span>{document.uploadedAt.toLocaleDateString('en-IN')}</span>
                  {!document.ticketId && ticketId && <span>Project library</span>}
                </div>
              </div>
              <Button asChild variant="ghost" size="icon">
                <a href={document.url} target="_blank" rel="noreferrer" aria-label={`Open ${document.name}`}>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
              {allowDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(document)}
                  aria-label={`Delete ${document.name}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

