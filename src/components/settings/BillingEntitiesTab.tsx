import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Edit, Image as ImageIcon, Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { createNativeBillingEntitySession, hasPendingNativeBillingEntityRequest, isNativeBillingEntityEnabled } from '@/utils/nativeBillingEntityOperations';
import { uploadCompanyLogo } from '@/utils/imageUpload';
import {
  addBillingEntity,
  deleteBillingEntity,
  getDefaultBillingEntity,
  setDefaultBillingEntity,
  subscribeToBillingEntities,
  updateBillingEntity,
  type BillingEntity,
} from '@/utils/settingsFirestore';

const emptyEntity = (): Omit<BillingEntity, 'id' | 'updatedAt'> => ({
  legalName: '',
  displayName: '',
  companyAddress: '',
  gstin: '',
  stateCode: '',
  stateName: '',
  pan: '',
  cin: '',
  udyamRegistrationNumber: '',
  phone: '',
  email: '',
  website: '',
  fax: '',
  authorizedSignatoryName: '',
  authorizedSignatoryDesignation: '',
  logo: '',
  logoPath: '',
  quotationPrefix: 'SVC',
  nextQuotationNumber: 1,
  defaultValidityDays: 30,
  defaultPaymentTerms: '100% payable against invoice',
  defaultDeliveryTerms: '',
  defaultTermsAndConditions: '',
  poNumberPrefix: 'PO-DS',
  poNumberFormat: 'simple',
  nextPoNumber: 1,
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankBranch: '',
  isDefault: false,
  isActive: true,
});

export default function BillingEntitiesTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const nativeEnabled = isNativeBillingEntityEnabled() || hasPendingNativeBillingEntityRequest(user?.uid);
  const context = useRef({ uid: user?.uid, mounted: true });
  context.current.uid = user?.uid;
  const native = useMemo(() => {
    const uid = user?.uid;
    return nativeEnabled && uid ? createNativeBillingEntitySession(uid, () => context.current.mounted && context.current.uid === uid) : null;
  }, [nativeEnabled, user?.uid]);
  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyEntity());
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [nativePending, setNativePending] = useState(false);
  const [nativeLoading, setNativeLoading] = useState(nativeEnabled);
  const [nativeOpening, setNativeOpening] = useState<{ id: string; version: string } | null>(null);
  const [nativeEditable, setNativeEditable] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState('');
  const [catalogPermissions, setCatalogPermissions] = useState({ create: false, set_default: false });
  const defaultEntity = getDefaultBillingEntity(entities);

  const applyCatalog = (page: Awaited<ReturnType<NonNullable<typeof native>['catalog']>>) => {
    setEntities(page.entities); setCatalogVersion(page.catalog_version); setCatalogPermissions(page.permissions);
  };
  useEffect(() => {
    context.current.mounted = true;
    let active = true;
    if (!nativeEnabled) return subscribeToBillingEntities(setEntities);
    setEntities([]); setOpen(false); setNativeOpening(null); setNativeLoading(true);
    setNativePending(native?.pending() ?? false);
    native?.catalog().then(page => { if (active) applyCatalog(page); }).catch(error => {
      if (active) toast({ title: 'Could not load billing entities', description: error.message, variant: 'destructive' });
    }).finally(() => { if (active) setNativeLoading(false); });
    return () => { active = false; context.current.mounted = false; };
  }, [native, nativeEnabled]);

  // Keep the original automatically updating catalog without reading raw SDK
  // payloads. An open or unconfirmed form keeps its original pinned revision.
  useEffect(() => {
    if (!native || saving || open || nativePending || nativeLoading) return;
    let active = true, refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try { const page = await native.catalog(); if (active) applyCatalog(page); }
      catch { if (active) setCatalogPermissions({ create: false, set_default: false }); }
      finally { refreshing = false; }
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [native, saving, open, nativePending, nativeLoading]);

  const finishNative = async () => {
    if (!native) throw Error('Reopen Settings with your signed-in account.');
    applyCatalog(await native.acknowledge());
    setNativePending(native.pending());
  };
  const recoverNative = async (retry: boolean) => {
    if (!native || saving) return;
    setSaving(true);
    try {
      const result = retry ? await native.retry() : await native.resolve();
      await finishNative(); setOpen(false);
      toast({ title: result === 'committed' ? 'Saved billing change confirmed' : 'Uncommitted billing change cancelled. Reopen the entity to edit.' });
    } catch (error) {
      toast({ title: 'Could not confirm saved change', description: error instanceof Error ? error.message : 'Keep the saved request.', variant: 'destructive' });
    } finally { setNativePending(native.pending()); setSaving(false); }
  };
  const recoveryControls = nativePending ? <div role="status" className="space-y-2 rounded-md border p-3">
    <p>A billing change is saved in this browser. Confirm it before another change.</p>
    <Button variant="outline" disabled={saving} onClick={() => recoverNative(false)}>Check saved change</Button>{' '}
    <Button variant="outline" disabled={saving} onClick={() => recoverNative(true)}>Retry saved change</Button>
  </div> : null;

  const startAdd = () => {
    if (nativeEnabled) {
      if (!native || native.pending() || !catalogPermissions.create) return;
      setNativeOpening({ id: crypto.randomUUID(), version: 'missing' }); setNativeEditable(true);
    }
    setEditingId(null);
    setForm(emptyEntity());
    setLogoFile(null);
    setOpen(true);
  };

  const startEdit = async (listed: BillingEntity) => {
    let entity = listed;
    if (nativeEnabled) {
      if (!native || native.pending() || saving) return;
      setSaving(true);
      try {
        const opening = await native.open(entity.id); entity = opening.entity;
        setNativeOpening({ id: entity.id, version: opening.entity_version }); setNativeEditable(opening.permissions.edit);
      } catch (error) {
        toast({ title: 'Could not open billing entity', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' }); return;
      } finally { setSaving(false); }
    }
    const { id: _id, updatedAt: _updatedAt, ...editable } = entity;
    setEditingId(entity.id);
    setForm({ ...emptyEntity(), ...editable });
    setLogoFile(null);
    setOpen(true);
  };

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (saving || nativeEnabled && (!native || native.pending() || !nativeOpening || !nativeEditable)) return;
    const openingUid = user?.uid;
    if (!form.legalName.trim() || !form.companyAddress.trim() || !form.gstin.trim()) {
      toast({ title: 'Legal name, address and GSTIN are required', variant: 'destructive' });
      return;
    }
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstin.trim().toUpperCase())) {
      toast({ title: 'Enter a valid 15-character GSTIN', variant: 'destructive' });
      return;
    }
    if (form.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan.trim().toUpperCase())) {
      toast({ title: 'Enter a valid 10-character PAN', variant: 'destructive' });
      return;
    }
    if (form.cin && !/^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(form.cin.trim().toUpperCase())) {
      toast({ title: 'Enter a valid 21-character CIN', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let logo = form.logo;
      let logoPath = form.logoPath;
      if (logoFile) {
        const uploaded = await uploadCompanyLogo(logoFile);
        if (nativeEnabled && (!context.current.mounted || context.current.uid !== openingUid)) throw Error('The signed-in account changed. Reopen Settings.');
        logo = uploaded.url;
        logoPath = uploaded.path;
        setForm(current => ({ ...current, logo, logoPath })); setLogoFile(null);
      }
      const payload = {
        ...form,
        displayName: form.displayName.trim() || form.legalName.trim(),
        legalName: form.legalName.trim(),
        companyAddress: form.companyAddress.trim(),
        logo,
        logoPath,
      };
      if (nativeEnabled) {
        if (!native || !nativeOpening) throw Error('Reopen the billing entity before saving.');
        await native.mutate(editingId
          ? { operation: 'update', entity_id: nativeOpening.id, expected_version: nativeOpening.version, patch: payload }
          : { operation: 'create', entity_id: nativeOpening.id, expected_version: 'missing', entity: payload });
        await finishNative();
      }
      else if (editingId) await updateBillingEntity(editingId, payload);
      else await addBillingEntity(payload);
      toast({ title: editingId ? 'Billing entity updated' : 'Billing entity added' });
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Could not save billing entity',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      if (nativeEnabled) setNativePending(native?.pending() ?? false);
      setSaving(false);
    }
  };

  const handleDelete = async (entity: BillingEntity) => {
    if (saving || nativeEnabled && (!native || native.pending())) return;
    setSaving(true);
    try {
      if (nativeEnabled) {
        const opening = await native!.open(entity.id);
        if (!opening.permissions.delete) throw Error('Billing deletion is paused or unavailable with your current access.');
        if (!window.confirm(`Delete ${opening.entity.displayName}? Projects using it must be reassigned.`)) return;
        await native!.mutate({ operation: 'delete', entity_id: entity.id, expected_version: opening.entity_version }); await finishNative();
      } else {
        if (!window.confirm(`Delete ${entity.displayName}? Projects using it must be reassigned.`)) return;
        await deleteBillingEntity(entity.id);
      }
      toast({ title: 'Billing entity deleted' });
    } catch (error) {
      toast({
        title: 'Could not delete billing entity',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally { setNativePending(native?.pending() ?? false); setSaving(false); }
  };

  const handleSetDefault = async (entity: BillingEntity) => {
    if (saving || nativeEnabled && (!native || native.pending() || !catalogVersion || !catalogPermissions.set_default)) return;
    setSaving(true);
    try {
      if (nativeEnabled) {
        await native!.mutate({ operation: 'set_default', entity_id: entity.id, expected_catalog_version: catalogVersion }); await finishNative();
      } else await setDefaultBillingEntity(entity.id);
      toast({ title: `${entity.displayName} is now the default billing entity` });
    } catch (error) {
      toast({
        title: 'Could not change the default billing entity',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally { setNativePending(native?.pending() ?? false); setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {!open && recoveryControls}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Billing entities</CardTitle>
            <CardDescription>
              One source of truth for legal details, logos, quotations and purchase orders. Datasensor is the default unless you choose another entity.
            </CardDescription>
          </div>
          <Button onClick={startAdd} disabled={saving || nativeEnabled && (nativeLoading || nativePending || !catalogPermissions.create)}><Plus className="mr-2 h-4 w-4" />Add entity</Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {entities.map((entity) => (
              <div key={entity.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
                      {entity.logo ? <img src={entity.logo} alt="" className="max-h-full max-w-full object-contain" /> : <Building2 className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold">{entity.displayName}</div>
                      <div className="text-sm text-muted-foreground">{entity.legalName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">GSTIN {entity.gstin || 'not configured'} · Quote prefix {entity.quotationPrefix}</div>
                    </div>
                  </div>
                  {entity.id === defaultEntity?.id && <Badge><Star className="mr-1 h-3 w-3" />Default</Badge>}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  {entity.id !== defaultEntity?.id && <Button size="sm" variant="ghost" disabled={saving || nativeEnabled && (nativePending || !catalogPermissions.set_default)} onClick={() => handleSetDefault(entity)}><Star className="mr-2 h-3.5 w-3.5" />Set default</Button>}
                  <Button size="sm" variant="outline" disabled={saving || nativeEnabled && nativePending} onClick={() => startEdit(entity)}><Edit className="mr-2 h-3.5 w-3.5" />Edit</Button>
                  {entity.id !== 'company' && <Button size="sm" variant="ghost" aria-label={`Delete ${entity.displayName}`} disabled={saving || nativeEnabled && (nativePending || !catalogPermissions.create)} className="text-red-600" onClick={() => handleDelete(entity)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit billing entity' : 'Add billing entity'}</DialogTitle>
            <DialogDescription>These details and logo are used on documents issued by this legal entity.</DialogDescription>
          </DialogHeader>
          {recoveryControls}
          {nativeEnabled && !nativeEditable && <p>Billing changes are paused or unavailable with your current access.</p>}
          <fieldset disabled={saving || nativeEnabled && (nativePending || !nativeEditable)} className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Legal name *" value={form.legalName} onChange={(value) => setField('legalName', value)} />
              <Field label="Display name" value={form.displayName} onChange={(value) => setField('displayName', value)} />
            </div>
            <div className="grid gap-2"><Label>Registered address *</Label><Textarea value={form.companyAddress} onChange={(event) => setField('companyAddress', event.target.value)} /></div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="GSTIN *" value={form.gstin} onChange={(value) => setField('gstin', value.toUpperCase())} />
              <Field label="PAN" value={form.pan} onChange={(value) => setField('pan', value.toUpperCase())} />
              <Field label="CIN" value={form.cin || ''} onChange={(value) => setField('cin', value.toUpperCase())} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="State code" value={form.stateCode} onChange={(value) => setField('stateCode', value)} />
              <Field label="State" value={form.stateName} onChange={(value) => setField('stateName', value)} />
              <Field label="Udyam / MSME registration" value={form.udyamRegistrationNumber || ''} onChange={(value) => setField('udyamRegistrationNumber', value.toUpperCase())} />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Email" value={form.email || ''} onChange={(value) => setField('email', value)} type="email" />
              <Field label="Phone" value={form.phone || ''} onChange={(value) => setField('phone', value)} />
              <Field label="Website" value={form.website || ''} onChange={(value) => setField('website', value)} />
              <Field label="Fax" value={form.fax || ''} onChange={(value) => setField('fax', value)} />
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 font-medium">Quotation defaults</div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Quotation prefix" value={form.quotationPrefix} onChange={(value) => setField('quotationPrefix', value.toUpperCase())} />
                <Field label="Next number" value={String(form.nextQuotationNumber)} onChange={(value) => setField('nextQuotationNumber', Number(value) || 1)} type="number" />
                <Field label="Validity (days)" value={String(form.defaultValidityDays)} onChange={(value) => setField('defaultValidityDays', Number(value) || 30)} type="number" />
              </div>
              <div className="mt-4 grid gap-2"><Label>Default payment terms</Label><Textarea value={form.defaultPaymentTerms || ''} onChange={(event) => setField('defaultPaymentTerms', event.target.value)} /></div>
              <div className="mt-4 grid gap-2"><Label>Terms and conditions</Label><Textarea value={form.defaultTermsAndConditions || ''} onChange={(event) => setField('defaultTermsAndConditions', event.target.value)} /></div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 font-medium">Purchase order defaults</div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="PO number prefix" value={form.poNumberPrefix} onChange={(value) => setField('poNumberPrefix', value.toUpperCase())} />
                <div className="grid gap-2">
                  <Label>PO number format</Label>
                  <Select value={form.poNumberFormat} onValueChange={(value: 'simple' | 'financial-year') => setField('poNumberFormat', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Calendar year</SelectItem>
                      <SelectItem value="financial-year">Financial year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Next PO number" value={String(form.nextPoNumber)} onChange={(value) => setField('nextPoNumber', Number(value) || 1)} type="number" />
              </div>
              <div className="mt-4 grid gap-2"><Label>Default delivery terms</Label><Textarea value={form.defaultDeliveryTerms || ''} onChange={(event) => setField('defaultDeliveryTerms', event.target.value)} /></div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 font-medium">Bank details</div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Bank" value={form.bankName || ''} onChange={(value) => setField('bankName', value)} />
                <Field label="Account name" value={form.bankAccountName || ''} onChange={(value) => setField('bankAccountName', value)} />
                <Field label="Account number" value={form.bankAccountNumber || ''} onChange={(value) => setField('bankAccountNumber', value)} />
                <Field label="IFSC" value={form.bankIfsc || ''} onChange={(value) => setField('bankIfsc', value.toUpperCase())} />
              </div>
              <div className="mt-4"><Field label="Branch" value={form.bankBranch || ''} onChange={(value) => setField('bankBranch', value)} /></div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 font-medium">Authorised signatory</div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name" value={form.authorizedSignatoryName || ''} onChange={(value) => setField('authorizedSignatoryName', value)} />
                <Field label="Designation" value={form.authorizedSignatoryDesignation || ''} onChange={(value) => setField('authorizedSignatoryDesignation', value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Logo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-md border bg-white">
                  {form.logo ? <img src={form.logo} alt="" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                </div>
                <Input type="file" accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} />
              </div>
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || nativeEnabled && (nativePending || !nativeEditable)}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save entity</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="grid gap-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
