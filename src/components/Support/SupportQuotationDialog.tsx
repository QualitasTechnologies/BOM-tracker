import { useEffect, useMemo, useRef, useState } from 'react';
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
import { createNativeProjectWorkspace } from '@/utils/nativeProjectOperations';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { isNativeSupportProfileEnabled } from '@/utils/nativeSupportProfile';
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
  const [nativeOpeningError, setNativeOpeningError] = useState('');
  const [nativeOpeningReady, setNativeOpeningReady] = useState(false);
  const [hasPendingBilling, setHasPendingBilling] = useState(false);
  const nativeWorkspace = useRef<ReturnType<typeof createNativeProjectWorkspace> | null>(null);
  const nativeAction = useRef<ReturnType<ReturnType<typeof createNativeProjectWorkspace>['capture']> | null>(null);
  const openingBillingEntityId = useRef<string | undefined>(undefined);
  const nativeOpeningLoaded = useRef(false);
  const billingChangedByUser = useRef(false);
  // Bumped whenever the project, ticket or open state changes (and on unmount) so an A-B-A switch
  // can never let an older load, submit or resolve touch the form that is now visible.
  const generation = useRef(0);
  const nativeMode = isNativeSupportProfileEnabled() || isScopedProjectReadEnabled();

  useEffect(() => subscribeToBillingEntities(setEntities), []);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const selectedEntity = entities.find((entity) => entity.id === billingEntityId);

  useEffect(() => {
    const gen = ++generation.current;
    setSaving(false);
    if (!open || !(isNativeSupportProfileEnabled() || isScopedProjectReadEnabled())) {
      nativeWorkspace.current = null; nativeAction.current = null; nativeOpeningLoaded.current = false;
      setNativeOpeningReady(true); setHasPendingBilling(false);
      return () => { generation.current += 1; };
    }
    let active = true;
    const workspace = createNativeProjectWorkspace(project.projectId);
    nativeWorkspace.current = workspace;
    nativeAction.current = null;
    nativeOpeningLoaded.current = false;
    billingChangedByUser.current = false;
    setNativeOpeningReady(false);
    setNativeOpeningError('');
    workspace.load().then((snapshot) => {
      if (!active || nativeWorkspace.current !== workspace || generation.current !== gen) return;
      // The native snapshot is authoritative: an absent route stays absent instead of borrowing a stale prop.
      const current = typeof snapshot.project.billingEntityId === 'string' ? snapshot.project.billingEntityId : undefined;
      const recovered = workspace.recover('support-billing');
      const pendingCommand = recovered?.pendingCommand;
      const pendingRoute = pendingCommand?.kind === 'support_billing_entity' ? pendingCommand.billing_entity_id : undefined;
      openingBillingEntityId.current = current;
      nativeOpeningLoaded.current = true;
      nativeAction.current = recovered || workspace.capture('support-billing');
      setBillingEntityId(pendingRoute || current || ticket.quotation?.billingEntityId || getDefaultBillingEntity(entitiesRef.current)?.id || 'company');
      setHasPendingBilling(!!pendingRoute);
      setNativeOpeningReady(true);
    }).catch((error) => {
      if (active && nativeWorkspace.current === workspace && generation.current === gen) {
        setNativeOpeningError(error instanceof Error ? error.message : 'Could not open the billing route safely.');
        setNativeOpeningReady(false);
      }
    });
    return () => {
      active = false;
      generation.current += 1;
      workspace.invalidate();
      if (nativeWorkspace.current === workspace) nativeWorkspace.current = null;
      nativeAction.current = null;
    };
  }, [open, project.projectId, ticket.id]);

  useEffect(() => {
    if (!open || !nativeMode || !nativeOpeningLoaded.current || billingChangedByUser.current || openingBillingEntityId.current || hasPendingBilling) return;
    // The native route is authoritative; the (possibly stale) project prop is not a fallback here.
    setBillingEntityId(ticket.quotation?.billingEntityId || getDefaultBillingEntity(entities)?.id || 'company');
  }, [open, entities, ticket.quotation, nativeOpeningReady, hasPendingBilling]);

  useEffect(() => {
    if (!open) return;
    const quote = ticket.quotation;
    if (!nativeMode) setBillingEntityId(project.billingEntityId || quote?.billingEntityId || getDefaultBillingEntity(entities)?.id || 'company');
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
    billingChangedByUser.current = true;
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
    const gen = generation.current;
    const isCurrent = () => generation.current === gen;
    const projectId = project.projectId, ticketId = ticket.id;
    const action = nativeAction.current, workspace = nativeWorkspace.current;
    setSaving(true);
    try {
      if (hasPendingBilling) throw new Error('Check the saved billing change before generating a quotation.');
      const nativeRouteChanged = nativeOpeningLoaded.current
        ? openingBillingEntityId.current !== billingEntityId
        : project.billingEntityId !== billingEntityId;
      if (nativeRouteChanged) {
        if (isNativeSupportProfileEnabled()) {
          if (!action || !workspace || nativeOpeningError) throw new Error(nativeOpeningError || 'Reopen the quotation before changing its billing entity.');
          const pending = action.pendingCommand;
          if (pending?.kind === 'support_billing_entity' && pending.billing_entity_id !== billingEntityId) throw new Error('A different billing route is awaiting confirmation. Check it before changing the selection.');
          // Show the recovery control before the request leaves, so a first transport failure is already recoverable.
          setHasPendingBilling(true);
          try {
            await action.submit({ kind: 'support_billing_entity', billing_entity_id: billingEntityId });
            // Reconcile with a fresh authoritative read before the journal is released.
            const snapshot = await workspace.load();
            const savedRoute = typeof snapshot.project.billingEntityId === 'string' ? snapshot.project.billingEntityId : undefined;
            if (savedRoute !== billingEntityId) throw new Error('The billing route was not confirmed by the fresh project read. Check the saved change.');
            if (!isCurrent()) throw new Error('The quotation context changed. Reopen it before continuing.');
            await action.acknowledge();
            openingBillingEntityId.current = savedRoute;
            if (isCurrent()) {
              // The acknowledged action is spent; a later explicit route change needs its own request at the confirmed version.
              nativeAction.current = workspace.capture('support-billing');
              setHasPendingBilling(false);
            }
          } catch (error) {
            // Only a request that was never journaled (validation, storage) is safe to drop from the UI.
            let stillPending = true;
            try { stillPending = !!action.pendingCommand; } catch { /* an unreadable journal stays pending */ }
            if (isCurrent()) setHasPendingBilling(stillPending);
            throw error;
          }
        } else if (isScopedProjectReadEnabled()) {
          throw new Error('Billing entity changes are paused until the versioned Support writer is enabled.');
        } else {
          await updateProject(projectId, { billingEntityId });
        }
      }
      if (!isCurrent()) throw new Error('The quotation context changed. Reopen it before continuing.');
      const quotation = await prepareSupportQuotation({
        projectId,
        ticketId,
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
      if (isCurrent()) onOpenChange(false);
    } catch (error) {
      if (isCurrent()) toast({
        title: 'Could not prepare quotation',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  const resolvePendingBilling = async () => {
    const action = nativeAction.current, workspace = nativeWorkspace.current;
    if (!action || !workspace || !hasPendingBilling || saving) return;
    const gen = generation.current;
    const isCurrent = () => generation.current === gen;
    setSaving(true); setNativeOpeningError('');
    try {
      const result = await action.resolve();
      const snapshot = await workspace.load();
      const savedRoute = typeof snapshot.project.billingEntityId === 'string' ? snapshot.project.billingEntityId : undefined;
      if (!isCurrent()) return;
      await action.acknowledge();
      if (!isCurrent()) return;
      openingBillingEntityId.current = savedRoute;
      nativeOpeningLoaded.current = true;
      billingChangedByUser.current = false;
      setBillingEntityId(savedRoute || ticket.quotation?.billingEntityId || getDefaultBillingEntity(entities)?.id || 'company');
      setHasPendingBilling(false);
      nativeAction.current = workspace.capture('support-billing');
      setNativeOpeningError(result.resolution === 'committed'
        ? 'Billing change confirmed. Reopen this quotation to review the current route.'
        : 'Saved billing change was cancelled. Reopen this quotation before generating.');
      setNativeOpeningReady(true);
    } catch (error) {
      if (isCurrent()) setNativeOpeningError(error instanceof Error ? error.message : 'Could not check the saved billing change.');
    } finally { if (isCurrent()) setSaving(false); }
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
              <Select value={billingEntityId} onValueChange={handleBillingEntityChange} disabled={hasPendingBilling || saving || ((isNativeSupportProfileEnabled() || isScopedProjectReadEnabled()) && !nativeOpeningReady)}>
                <SelectTrigger><SelectValue placeholder="Select billing entity" /></SelectTrigger>
                <SelectContent>{entities.map((entity) => <SelectItem key={entity.id} value={entity.id}>{entity.displayName} · {entity.gstin}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Valid for (days)</Label>
              <Input type="number" min="1" max="365" value={validityDays} onChange={(event) => setValidityDays(Number(event.target.value) || 30)} />
            </div>
            <div className="text-xs text-muted-foreground md:col-span-3">
              Customer GSTIN: {client?.gstin || 'Not recorded in the client CRM'}
              {client?.stateName ? ` · ${client.stateName}${client.stateCode ? ` (${client.stateCode})` : ''}` : ''}
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
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted-foreground"><tr><th className="p-3">Type</th><th className="p-3">Description</th><th className="p-3 w-28">HSN / SAC</th><th className="p-3 w-24">Qty</th><th className="p-3 w-24">Unit</th><th className="p-3 w-32">Rate</th><th className="p-3 w-32 text-right">Amount</th><th className="w-12" /></tr></thead>
                <tbody>
                  {totals.lines.map((line) => (
                    <tr key={line.id} className="border-t align-top">
                      <td className="p-3 capitalize">{line.category}</td>
                      <td className="p-3"><Input value={line.description} onChange={(event) => updateLine(line.id, 'description', event.target.value)} /></td>
                      <td className="p-3"><Input value={line.hsnSac || ''} onChange={(event) => updateLine(line.id, 'hsnSac', event.target.value.toUpperCase())} placeholder="Optional" /></td>
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
                  <SummaryRow label={taxType === 'none' ? 'Tax' : `Estimated GST ${taxPercent}%`} value={money(totals.taxAmount)} />
                  <div className="flex justify-between border-t pt-3 text-base font-semibold"><span>Total</span><span>{money(totals.total)}</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            This is a commercial quotation, not a tax invoice. GST is indicative; the final tax invoice will be issued separately through the e-invoicing system with the applicable IRN and signed QR code.
          </div>
        </div>

        <DialogFooter>
          {nativeOpeningError && <p role="alert" className="mr-auto text-sm text-destructive">{nativeOpeningError}</p>}
          {hasPendingBilling && <Button variant="outline" onClick={() => void resolvePendingBilling()} disabled={saving}>Check saved billing change</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handlePrepare} disabled={saving || hasPendingBilling || totals.total <= 0 || (isNativeSupportProfileEnabled() || isScopedProjectReadEnabled()) && !nativeOpeningReady}>
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
