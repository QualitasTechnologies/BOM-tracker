import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { InstalledMachine, SupportProjectProfile } from '@/types/support';
import { updateProject, type Project } from '@/utils/projectFirestore';
import {
  getClientContacts,
  getPrimaryClientContact,
  type Client,
  type ClientContact,
} from '@/utils/settingsFirestore';
import { AddClientContactDialog } from './AddClientContactDialog';
import { SupportDocuments } from './SupportDocuments';
import { getInstalledMachines } from '@/utils/supportLogic';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { createNativeSupportProfileDiff, createNativeSupportProfileWorkspace, hasPendingNativeSupportProfile, isNativeSupportProfileEnabled, nativeSupportProfileClient, type NativeSupportProfileCommand } from '@/utils/nativeSupportProfile';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  client: Client | null;
  userId: string;
  userName: string;
}

const emptyProfile: SupportProjectProfile = {
  amcStatus: 'none',
  machines: [],
};

// A recovered request previews its frozen deltas. Only that original command,
// never this display projection, is retried against its captured revision.
function previewPendingProfile(stored: SupportProjectProfile, command?: NativeSupportProfileCommand): SupportProjectProfile {
  if (!command) return stored;
  const next = { ...stored, ...command.patch } as SupportProjectProfile;
  if (command.machines?.length) {
    let machines = getInstalledMachines(stored).map(machine => ({ ...machine }));
    for (const operation of command.machines) {
      if (operation.kind === 'remove') machines = machines.filter(machine => machine.id !== operation.id);
      if (operation.kind === 'patch') machines = machines.map(machine => machine.id === operation.id ? { ...machine, ...(operation.patch as object) } : machine);
      if (operation.kind === 'add') {
        const machine = operation.machine as unknown as InstalledMachine;
        machines = [...machines.filter(row => row.id !== machine.id), machine];
      }
    }
    next.machines = machines;
  }
  return next;
}

export function SupportProjectDialog({
  open,
  onOpenChange,
  project,
  client,
  userId,
  userName,
}: Props) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<SupportProjectProfile>(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editable, setEditable] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const nativeEnabled = isNativeSupportProfileEnabled();
  const pendingProbe = project ? hasPendingNativeSupportProfile(project.projectId, userId) : { kind: 'absent' as const };
  const nativeMode = nativeEnabled || isScopedProjectReadEnabled() || pendingProbe.kind !== 'absent';
  type Action = ReturnType<ReturnType<typeof createNativeSupportProfileWorkspace>['capture']>;
  const actionRef = useRef<Action | null>(null);
  const frozenCommandRef = useRef<NativeSupportProfileCommand | undefined>();
  const sessionRef = useRef<{ live: boolean; projectId: string; uid: string } | null>(null);
  const busyRef = useRef(false);
  const renderedRef = useRef({ open, projectId: project?.projectId, userId });
  renderedRef.current = { open, projectId: project?.projectId, userId };
  const activeProjectIdRef = useRef('');
  const contacts = useMemo(() => getClientContacts(client), [client]);
  const contactDefaultsRef = useRef({ contacts, client });
  contactDefaultsRef.current = { contacts, client };
  const currentSession = (session: typeof sessionRef.current) => !!session?.live && sessionRef.current === session
    && renderedRef.current.open && renderedRef.current.projectId === session.projectId && renderedRef.current.userId === session.uid;

  useEffect(() => {
    if (!nativeMode || !open || !project) return;
    const session = { live: true, projectId: project.projectId, uid: userId };
    sessionRef.current = session; actionRef.current = null; frozenCommandRef.current = undefined;
    busyRef.current = false; setSaving(false); setFrozen(false); setEditable(false); setLoading(true); setError('');
    let workspace: ReturnType<typeof createNativeSupportProfileWorkspace> | undefined;
    const load = async () => {
      try {
        if (pendingProbe.kind === 'error') throw new Error(pendingProbe.message);
        workspace = createNativeSupportProfileWorkspace(session.projectId, nativeSupportProfileClient, session.uid);
        const opening = await workspace.load();
        if (!currentSession(session)) return;
        const action = workspace.capture();
        actionRef.current = action;
        frozenCommandRef.current = action.pendingCommand;
        setFrozen(!!action.pendingCommand);
        const { supportContacts: _legacyContacts, ...rawProfile } = (opening.support_profile || {}) as SupportProjectProfile;
        const stored = previewPendingProfile(rawProfile, frozenCommandRef.current);
        const defaults = contactDefaultsRef.current;
        const selected = defaults.contacts.find(contact => contact.id === stored.supportContactId) || getPrimaryClientContact(defaults.client);
        const pendingContact = frozenCommandRef.current?.patch && Object.hasOwn(frozenCommandRef.current.patch, 'supportContactId');
        setProfile({ ...emptyProfile, ...stored, machines: getInstalledMachines(stored), supportContactId: pendingContact ? stored.supportContactId : selected?.id });
        setEditable(nativeEnabled && opening.permissions.edit);
      } catch (failure) {
        if (currentSession(session)) setError(failure instanceof Error ? failure.message : 'Could not load the current Support profile.');
      } finally { if (currentSession(session)) setLoading(false); }
    };
    void load();
    return () => { session.live = false; workspace?.invalidate(); };
  }, [open, project?.projectId, userId, nativeMode, nativeEnabled]);

  useEffect(() => {
    if (nativeMode) return;
    if (project) {
      const projectChanged = activeProjectIdRef.current !== project.projectId;
      const { supportContacts: _legacyContacts, ...storedProfile } =
        project.supportProfile || {};
      setProfile((current) => {
        const currentContact = contacts.find(
          (contact) => contact.id === current.supportContactId,
        );
        if (!projectChanged && currentContact) return current;

        const selectedContact =
          contacts.find(
            (contact) => contact.id === project.supportProfile?.supportContactId,
          ) || getPrimaryClientContact(client);
        return projectChanged
          ? {
              ...emptyProfile,
              ...storedProfile,
              machines: getInstalledMachines(storedProfile),
              supportContactId: selectedContact?.id,
            }
          : {
              ...current,
              supportContactId: selectedContact?.id,
            };
      });
      activeProjectIdRef.current = project.projectId;
    }
  }, [client, contacts, project, nativeMode]);

  if (!project) return null;

  const setField = <K extends keyof SupportProjectProfile>(
    key: K,
    value: SupportProjectProfile[K],
  ) => setProfile((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (busyRef.current || nativeMode && (!editable || !actionRef.current)) return;
    const incompleteMachine = (profile.machines || []).find(
      (machine) => !machine.name.trim() || !machine.serialNumber.trim(),
    );
    if (incompleteMachine) {
      toast({
        title: 'Complete the machine register',
        description: 'Every machine needs a name and serial / asset number.',
        variant: 'destructive',
      });
      return;
    }
    const session = sessionRef.current;
    if (nativeMode && !currentSession(session)) return;
    busyRef.current = true; setSaving(true); setError('');
    try {
      const { supportContacts: _legacyContacts, ...canonicalProfile } = profile;
      if (nativeMode) {
        const action = actionRef.current!;
        const command = frozenCommandRef.current || createNativeSupportProfileDiff(action.baseline.support_profile, canonicalProfile as unknown as Record<string, unknown>);
        if (!command) { toast({ title: 'No Support changes to save' }); return; }
        frozenCommandRef.current = command; setFrozen(true);
        await action.submit(command);
        if (!currentSession(session)) return;
        onOpenChange(false);
      } else {
        if (isScopedProjectReadEnabled() || hasPendingNativeSupportProfile(project.projectId, userId).kind !== 'absent') throw new Error('Reopen Support to check the saved request before editing.');
        await updateProject(project.projectId, { supportProfile: canonicalProfile });
      }
      toast({ title: 'Support profile saved' });
    } catch (error) {
      if (nativeMode && !currentSession(session)) return;
      setError(error instanceof Error ? error.message : 'Please try again.');
      toast({
        title: 'Could not save profile',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      if (!nativeMode || currentSession(session)) { busyRef.current = false; setSaving(false); }
    }
  };

  const resolveSaved = async () => {
    const session = sessionRef.current, action = actionRef.current;
    if (busyRef.current || !action || !currentSession(session)) return;
    busyRef.current = true; setSaving(true); setError('');
    try {
      const result = await action.resolve();
      if (!currentSession(session)) return;
      toast({ title: result.resolution === 'committed' ? 'Support profile saved' : 'Saved request cancelled', description: 'Reopen Support to review current values before another edit.' });
      onOpenChange(false);
    } catch (failure) { if (currentSession(session)) setError(failure instanceof Error ? failure.message : 'Could not check the saved request.'); }
    finally { if (currentSession(session)) { busyRef.current = false; setSaving(false); } }
  };

  const addMachine = () => {
    const machine: InstalledMachine = {
      id: `machine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Machine ${(profile.machines?.length || 0) + 1}`,
      serialNumber: '',
      amcStatus: 'none',
      status: 'active',
    };
    setField('machines', [...(profile.machines || []), machine]);
  };

  const updateMachine = <K extends keyof InstalledMachine>(
    machineId: string,
    key: K,
    value: InstalledMachine[K],
  ) => setField(
    'machines',
    (profile.machines || []).map((machine) =>
      machine.id === machineId ? { ...machine, [key]: value } : machine,
    ),
  );

  const removeMachine = (machineId: string) =>
    setField('machines', (profile.machines || []).filter((machine) => machine.id !== machineId));

  const contact = contacts.find((item) => item.id === profile.supportContactId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project.projectName} · Support readiness</DialogTitle>
          <DialogDescription>
            Maintain installed-machine coverage, contacts, and the document pack used during support.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="coverage">
          <TabsList>
            <TabsTrigger value="coverage">Coverage & machine</TabsTrigger>
            <TabsTrigger value="documents">Document pack</TabsTrigger>
          </TabsList>
          <TabsContent value="coverage" className="space-y-5 pt-4">
            {loading && <p role="status">Loading current Support profile…</p>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {nativeMode && !loading && !editable && !error && <p className="text-sm text-muted-foreground">Support profile changes are currently paused.</p>}
            {frozen && <p className="text-sm text-amber-700">A saved request needs confirmation before another edit. Retry the same changes, or confirm a completed save and cancel it if it never saved.</p>}
            <fieldset disabled={saving || nativeMode && (loading || !editable || frozen || !actionRef.current)} className="space-y-5">
            <div className="rounded-lg border p-4">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-medium">Installed machines / lines</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Each support ticket can be tagged to one machine and serial number.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addMachine}><Plus className="mr-2 h-4 w-4" />Add machine</Button>
              </div>
              {(profile.machines || []).length === 0 ? (
                <div className="rounded-md bg-slate-50 p-5 text-center text-sm text-muted-foreground">No machines configured yet.</div>
              ) : (
                <div className="space-y-4">
                  {(profile.machines || []).map((machine, index) => (
                    <div key={machine.id} className="rounded-md border bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="font-medium">Machine {index + 1}</div>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => removeMachine(machine.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-4">
                        <MachineField label="Machine name *" value={machine.name} onChange={(value) => updateMachine(machine.id, 'name', value)} />
                        <MachineField label="Line / cell" value={machine.lineName || ''} onChange={(value) => updateMachine(machine.id, 'lineName', value)} />
                        <MachineField label="Model" value={machine.model || ''} onChange={(value) => updateMachine(machine.id, 'model', value)} />
                        <MachineField label="Serial / asset number *" value={machine.serialNumber} onChange={(value) => updateMachine(machine.id, 'serialNumber', value)} />
                        <MachineField label="Installed site" value={machine.siteLocation || ''} onChange={(value) => updateMachine(machine.id, 'siteLocation', value)} />
                        <MachineField label="Commissioning date" value={machine.commissioningDate || ''} onChange={(value) => updateMachine(machine.id, 'commissioningDate', value)} type="date" />
                        <MachineField label="Warranty start" value={machine.warrantyStartDate || ''} onChange={(value) => updateMachine(machine.id, 'warrantyStartDate', value)} type="date" />
                        <MachineField label="Warranty end" value={machine.warrantyEndDate || ''} onChange={(value) => updateMachine(machine.id, 'warrantyEndDate', value)} type="date" />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-4">
                        <div className="grid gap-2">
                          <Label>AMC status</Label>
                          <Select value={machine.amcStatus || 'none'} onValueChange={(value) => updateMachine(machine.id, 'amcStatus', value as InstalledMachine['amcStatus'])}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="none">No AMC</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <MachineField label="AMC start" value={machine.amcStartDate || ''} onChange={(value) => updateMachine(machine.id, 'amcStartDate', value)} type="date" />
                        <MachineField label="AMC end" value={machine.amcEndDate || ''} onChange={(value) => updateMachine(machine.id, 'amcEndDate', value)} type="date" />
                        <MachineField label="AMC contract" value={machine.amcContractNumber || ''} onChange={(value) => updateMachine(machine.id, 'amcContractNumber', value)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-medium">Primary customer support contact</h3>
                <AddClientContactDialog
                  projectId={project.projectId}
                  client={client}
                  onAdded={(newContact: ClientContact) =>
                    setField('supportContactId', newContact.id)
                  }
                />
              </div>
              <div className="grid gap-3">
                <Select
                  value={profile.supportContactId || ''}
                  onValueChange={(value) => setField('supportContactId', value)}
                >
                  <SelectTrigger><SelectValue placeholder="Select a contact from the client CRM" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                        {item.designation ? ` · ${item.designation}` : ''}
                        {item.email ? ` · ${item.email}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {contact ? (
                  <div className="grid gap-3 rounded-md border bg-white p-3 text-sm md:grid-cols-3">
                    <div><span className="text-muted-foreground">Name:</span> {contact.name}</div>
                    <div><span className="text-muted-foreground">Email:</span> {contact.email || 'Not provided'}</div>
                    <div><span className="text-muted-foreground">Phone:</span> {contact.phone || 'Not provided'}</div>
                  </div>
                ) : (
                  <p className="text-sm text-amber-700">
                    No client CRM contact is available. Use Add CRM contact above to create one.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  New contacts are saved centrally for this client. Save the support profile to keep this contact as the project's default.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Internal support notes</Label>
              <Textarea value={profile.internalNotes || ''} onChange={(e) => setField('internalNotes', e.target.value)} placeholder="Access constraints, backup location, known exclusions, special escalation notes…" />
            </div>
            </fieldset>

            <DialogFooter>
              {nativeMode && frozen && <Button variant="outline" onClick={resolveSaved} disabled={saving || loading || !actionRef.current}>Confirm or cancel saved request</Button>}
              <Button onClick={handleSave} disabled={saving || nativeMode && (loading || !editable || !actionRef.current)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {nativeMode && frozen ? 'Retry saved changes' : 'Save support profile'}
              </Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent value="documents" className="pt-4">
            <SupportDocuments
              projectId={project.projectId}
              userId={userId}
              userName={userName}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MachineField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="grid gap-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
