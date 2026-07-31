import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/utils/projectFirestore';
import {
  getClientContacts,
  getPrimaryClientContact,
  type Client,
  type ClientContact,
} from '@/utils/settingsFirestore';
import type {
  CoverageType,
  CreateSupportTicketInput,
  SupportChannel,
  SupportIssueCategory,
  SupportPriority,
} from '@/types/support';
import { defaultCommercialStatus, determineCoverage } from '@/utils/supportLogic';
import { AddClientContactDialog } from './AddClientContactDialog';

const categories: Array<{ value: SupportIssueCategory; label: string }> = [
  { value: 'vision-performance', label: 'Vision performance / inspection' },
  { value: 'camera-lens-lighting', label: 'Camera, lens or lighting' },
  { value: 'software', label: 'Vision software / application' },
  { value: 'plc-integration', label: 'PLC / machine integration' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'network', label: 'Network / connectivity' },
  { value: 'preventive-maintenance', label: 'Preventive maintenance' },
  { value: 'training', label: 'Training' },
  { value: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  clients: Client[];
  onCreate: (input: CreateSupportTicketInput) => Promise<void>;
  preferredProjectId?: string;
}

export function CreateSupportTicketDialog({
  open,
  onOpenChange,
  projects,
  clients,
  onCreate,
  preferredProjectId,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<SupportPriority>('medium');
  const [category, setCategory] = useState<SupportIssueCategory>('vision-performance');
  const [channel, setChannel] = useState<SupportChannel>('email');
  const [reportedByName, setReportedByName] = useState('');
  const [reportedByContactId, setReportedByContactId] = useState('');
  const [reportedByEmail, setReportedByEmail] = useState('');
  const [reportedByPhone, setReportedByPhone] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('undetermined');
  const [machineStopped, setMachineStopped] = useState(false);
  const [downtime, setDowntime] = useState(false);
  const [siteVisitRequired, setSiteVisitRequired] = useState(false);
  const activeProjectIdRef = useRef('');
  const selectedContactIdRef = useRef('');

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId),
    [projectId, projects],
  );

  const selectedClient = useMemo(
    () =>
      selectedProject
        ? clients.find(
            (client) =>
              client.id === selectedProject.clientId ||
              client.company.trim().toLowerCase() ===
                selectedProject.clientName.trim().toLowerCase(),
          )
        : undefined,
    [clients, selectedProject],
  );

  const clientContacts = useMemo(
    () => getClientContacts(selectedClient),
    [selectedClient],
  );

  useEffect(() => {
    if (!open) return;
    const initialProjectId = preferredProjectId || projects[0]?.projectId || '';
    setProjectId(initialProjectId);
  }, [open, preferredProjectId, projects]);

  useEffect(() => {
    if (!selectedProject) return;
    const projectChanged = activeProjectIdRef.current !== selectedProject.projectId;
    const currentContact = clientContacts.find(
      (item) => item.id === selectedContactIdRef.current,
    );
    if (!projectChanged && currentContact) return;

    const preferredContactId = selectedProject.supportProfile?.supportContactId;
    const contact =
      clientContacts.find((item) => item.id === preferredContactId) ||
      getPrimaryClientContact(selectedClient);
    activeProjectIdRef.current = selectedProject.projectId;
    selectedContactIdRef.current = contact?.id || '';
    if (projectChanged) setCoverageType(determineCoverage(selectedProject.supportProfile));
    setReportedByContactId(contact?.id || '');
    setReportedByName(contact?.name || '');
    setReportedByEmail(contact?.email || '');
    setReportedByPhone(contact?.phone || '');
  }, [clientContacts, selectedClient, selectedProject]);

  const applyContact = (contact?: ClientContact) => {
    selectedContactIdRef.current = contact?.id || '';
    setReportedByContactId(contact?.id || '');
    setReportedByName(contact?.name || '');
    setReportedByEmail(contact?.email || '');
    setReportedByPhone(contact?.phone || '');
  };

  const handleContactChange = (contactId: string) => {
    applyContact(clientContacts.find((item) => item.id === contactId));
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setCategory('vision-performance');
    setChannel('email');
    setMachineStopped(false);
    setDowntime(false);
    setSiteVisitRequired(false);
  };

  const handleCreate = async () => {
    if (
      !selectedProject ||
      !title.trim() ||
      !description.trim() ||
      !reportedByContactId ||
      !reportedByName.trim()
    ) return;
    setSaving(true);
    try {
      await onCreate({
        projectId: selectedProject.projectId,
        projectName: selectedProject.projectName,
        clientName: selectedProject.clientName,
        clientId: selectedClient?.id,
        title: title.trim(),
        description: description.trim(),
        priority,
        category,
        channel,
        reportedByName: reportedByName.trim(),
        reportedByContactId: reportedByContactId || undefined,
        reportedByEmail: reportedByEmail.trim() || undefined,
        reportedByPhone: reportedByPhone.trim() || undefined,
        coverageType,
        commercialStatus: defaultCommercialStatus(coverageType),
        siteVisitRequired,
        downtime,
        machineStopped,
      });
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const valid = Boolean(
    selectedProject &&
      title.trim() &&
      description.trim() &&
      reportedByContactId &&
      reportedByName.trim(),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log a support issue</DialogTitle>
          <DialogDescription>
            Capture the symptom and business impact first. Diagnosis and RCA belong in the ticket.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label>Project / installed machine</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>
                    {project.projectName} · {project.clientName} ({project.projectId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="support-title">Issue title <span className="text-red-500">*</span></Label>
            <Input
              id="support-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: False rejects increased after lighting change"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="support-description">Observed symptom and impact <span className="text-red-500">*</span></Label>
            <Textarea
              id="support-description"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What changed, when it began, frequency, affected recipe/product, error messages, and production impact."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as SupportPriority)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">P1 · Production stopped</SelectItem>
                  <SelectItem value="high">P2 · Major degradation</SelectItem>
                  <SelectItem value="medium">P3 · Normal</SelectItem>
                  <SelectItem value="low">P4 · Minor / planned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Issue category</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as SupportIssueCategory)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Received via</Label>
              <Select value={channel} onValueChange={(value) => setChannel(value as SupportChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="site">On site</SelectItem>
                  <SelectItem value="internal">Internal observation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Customer contact <span className="text-red-500">*</span></Label>
                <AddClientContactDialog
                  projectId={selectedProject?.projectId || ''}
                  client={selectedClient}
                  onAdded={applyContact}
                />
              </div>
              <Select value={reportedByContactId} onValueChange={handleContactChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a contact from the client CRM" />
                </SelectTrigger>
                <SelectContent>
                  {clientContacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.designation ? ` · ${contact.designation}` : ''}
                      {contact.email ? ` · ${contact.email}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clientContacts.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No CRM contacts are configured for {selectedProject?.clientName}. Use Add CRM contact to create one without leaving this ticket.
                </p>
              ) : (
                <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
                  <div><span className="text-muted-foreground">Name:</span> {reportedByName}</div>
                  <div><span className="text-muted-foreground">Email:</span> {reportedByEmail || 'Not provided'}</div>
                  <div><span className="text-muted-foreground">Phone:</span> {reportedByPhone || 'Not provided'}</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Coverage assessment</Label>
              <Select
                value={coverageType}
                onValueChange={(value) => setCoverageType(value as CoverageType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warranty">Under warranty</SelectItem>
                  <SelectItem value="amc">Under AMC</SelectItem>
                  <SelectItem value="chargeable">Chargeable</SelectItem>
                  <SelectItem value="goodwill">Goodwill</SelectItem>
                  <SelectItem value="undetermined">To be assessed</SelectItem>
                </SelectContent>
              </Select>
              {!selectedProject?.supportProfile?.warrantyEndDate &&
                !selectedProject?.supportProfile?.amcEndDate && (
                  <p className="flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Coverage dates are not configured for this project.
                  </p>
                )}
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="machine-stopped">Machine / line stopped</Label>
                <Switch id="machine-stopped" checked={machineStopped} onCheckedChange={setMachineStopped} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="downtime">Production downtime</Label>
                <Switch id="downtime" checked={downtime} onCheckedChange={setDowntime} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="site-visit">Site visit likely</Label>
                <Switch id="site-visit" checked={siteVisitRequired} onCheckedChange={setSiteVisitRequired} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={handleCreate}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
