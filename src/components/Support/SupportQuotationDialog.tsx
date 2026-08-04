import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { SupportQuotation, SupportQuotationLine, SupportTicket } from '@/types/support';
import { updateProject, type Project } from '@/utils/projectFirestore';
import { prepareSupportQuotation } from '@/utils/supportFirestore';
import { calculateQuotationTotals, createQuotationLine } from '@/utils/supportQuotation';
import { getDefaultBillingEntity, subscribeToBillingEntities, type BillingEntity, type Client } from '@/utils/settingsFirestore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  ticket: SupportTicket;
  client: Client | null;
}

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

export function SupportQuotationDialog({ open, onOpenChange, project, ticket, client }: Props) {
  const { toast } = useToast();
  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [billingEntityId, setBillingEntityId] = useState(project.billingEntityId || 'company');
  const [lines, setLines] = useState<SupportQuotationLine[]>([createQuotationLine('engineering')]);
  const [taxType, setTaxType] = useState<SupportQuotation['taxType']>('igst');
  const [taxPercent, setTaxPercent] = useState(18);
  const [validityDays, setValidityDays] = useState(30);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeToBillingEntities(setEntities), []);
  const selectedEntity = entities.find((entity) => entity.id === billingEntityId);

  useEffect(() => {
    if (!open) return;
    const quote = ticket.quotation;
    setBillingEntityId(project.billingEntityId || quote?.billingEntityId || getDefaultBillingEntity(entities)?.id || 'company');
    setLines(quote?.lines?.length ? quote.lines : [createQuotationLine('engineering')]);
    setTaxType(quote?.taxType || 'igst');
    setTaxPercent(quote?.taxPercent ?? 18);
    setValidityDays(selectedEntity?.defaultValidityDays || 30);
    setPaymentTerms(quote?.paymentTerms || selectedEntity?.defaultPaymentTerms || '');
    setTermsAndConditions(quote?.termsAndConditions || selectedEntity?.defaultTermsAndConditions || '');
    setNotes(quote?.notes || '');
  }, [open, project.billingEntityId, ticket.quotation, entities.length]);

  const totals = useMemo(
    () => calculateQuotationTotals(lines, taxType === 'none' ? 0 : taxPercent),
    [lines, taxPercent, taxType],
  );

  const updateLine = <K extends keyof SupportQuotationLine>(
    lineId: string,
    key: K,
    value: SupportQuotationLine[K],
  ) => setLines((current) => current.map((line) =>
    line.id === lineId ? { ...line, [key]: value } : line,
  ));

  const handleBillingEntityChange = (entityId: string) => {
    setBillingEntityId(entityId);
    const entity = entities.find((item) => item.id === entityId);
    if (entity) {
      setValidityDays(entity.defaultValidityDays || 30);
      setPaymentTerms(entity.defaultPaymentTerms || '');
      setTermsAndConditions(entity.defaultTermsAndConditions || '');
    }
  };

  const handlePrepare = async () => {
    if (!billingEntityId || !selectedEntity) {
      toast({ title: 'Select a billing entity', variant: 'destructive' });
      return;
    }
    if (totals.lines.some((line) => !line.description.trim() || line.quantity <= 0) || totals.total <= 0) {
      toast({ title: 'Complete the quotation line items', description: 'Descriptions, quantities and rates are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (project.billingEntityId !== billingEntityId) {
        await updateProject(project.projectId, { billingEntityId });
      }
      const quotation = await prepareSupportQuotation({
        projectId: project.projectId,
        ticketId: ticket.id,
        billingEntityId,
        lines: totals.lines,
        taxType,
        taxPercent: taxType === 'none' ? 0 : taxPercent,
        validityDays,
        paymentTerms,
        termsAndConditions,
        notes,
      });
      toast({
        title: `${quotation.quotationNumber} prepared`,
        description: `${money(quotation.total)} · PDF added to ticket documents`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Could not prepare quotation',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket.quotation ? 'Prepare revised support quotation' : 'Prepare support quotation'}</DialogTitle>
          <DialogDescription>
            {ticket.ticketNumber} · {project.projectName}{ticket.machineName ? ` · ${ticket.machineName}` : ''} · Bill to {client?.company || project.clientName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-3">
            <div className="grid gap-2 md:col-span-2">
              <Label>Issuing billing entity *</Label>
              <Select value={billingEntityId} onValueChange={handleBillingEntityChange}>
                <SelectTrigger><SelectValue placeholder="Select billing entity" /></SelectTrigger>
                <SelectContent>{entities.map((entity) => <SelectItem key={entity.id} value={entity.id}>{entity.displayName} · {entity.gstin}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Valid for (days)</Label>
              <Input type="number" min="1" max="365" value={validityDays} onChange={(event) => setValidityDays(Number(event.target.value) || 30)} />
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div>
                <div className="font-medium">Quotation items</div>
                <div className="text-xs text-muted-foreground">Add engineering hours, travel expenses and any material or replacement costs.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <AddLineButton label="Engineering hours" onClick={() => setLines((current) => [...current, createQuotationLine('engineering')])} />
                <AddLineButton label="Travel" onClick={() => setLines((current) => [...current, createQuotationLine('travel')])} />
                <AddLineButton label="Material" onClick={() => setLines((current) => [...current, createQuotationLine('material')])} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted-foreground"><tr><th className="p-3">Type</th><th className="p-3">Description</th><th className="p-3 w-24">Qty</th><th className="p-3 w-24">Unit</th><th className="p-3 w-32">Rate</th><th className="p-3 w-32 text-right">Amount</th><th className="w-12" /></tr></thead>
                <tbody>
                  {totals.lines.map((line) => (
                    <tr key={line.id} className="border-t align-top">
                      <td className="p-3 capitalize">{line.category}</td>
                      <td className="p-3"><Input value={line.description} onChange={(event) => updateLine(line.id, 'description', event.target.value)} /></td>
                      <td className="p-3"><Input type="number" min="0" step="0.25" value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', Number(event.target.value))} /></td>
                      <td className="p-3"><Input value={line.unit} onChange={(event) => updateLine(line.id, 'unit', event.target.value)} /></td>
                      <td className="p-3"><Input type="number" min="0" step="0.01" value={line.unitRate} onChange={(event) => updateLine(line.id, 'unitRate', Number(event.target.value))} /></td>
                      <td className="p-3 text-right font-medium">{money(line.amount)}</td>
                      <td className="p-3"><Button type="button" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4 text-red-600" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <div className="grid gap-2"><Label>Payment terms</Label><Textarea value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} /></div>
              <div className="grid gap-2"><Label>Terms and conditions</Label><Textarea value={termsAndConditions} onChange={(event) => setTermsAndConditions(event.target.value)} /></div>
              <div className="grid gap-2"><Label>Customer-facing notes</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Scope clarifications, exclusions or scheduling assumptions" /></div>
            </div>
            <div className="h-fit rounded-lg border p-4">
              <div className="grid gap-3">
                <div className="grid gap-2"><Label>Tax treatment</Label><Select value={taxType} onValueChange={(value) => setTaxType(value as SupportQuotation['taxType'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="igst">IGST</SelectItem><SelectItem value="cgst-sgst">CGST + SGST</SelectItem><SelectItem value="none">No tax</SelectItem></SelectContent></Select></div>
                {taxType !== 'none' && <div className="grid gap-2"><Label>GST %</Label><Input type="number" min="0" max="100" value={taxPercent} onChange={(event) => setTaxPercent(Number(event.target.value) || 0)} /></div>}
                <div className="mt-2 space-y-2 border-t pt-3 text-sm">
                  <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
                  <SummaryRow label={taxType === 'none' ? 'Tax' : `GST ${taxPercent}%`} value={money(totals.taxAmount)} />
                  <div className="flex justify-between border-t pt-3 text-base font-semibold"><span>Total</span><span>{money(totals.total)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handlePrepare} disabled={saving || totals.total <= 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Generate quotation PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLineButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button type="button" size="sm" variant="outline" onClick={onClick}><Plus className="mr-1.5 h-3.5 w-3.5" />{label}</Button>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
