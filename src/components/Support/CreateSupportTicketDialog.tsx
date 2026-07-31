import { useEffect, useMemo, useState } from 'react';
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
import type {
  CoverageType,
  CreateSupportTicketInput,
  SupportChannel,
  SupportIssueCategory,
  SupportPriority,
} from '@/types/support';
import { defaultCommercialStatus, determineCoverage } from '@/utils/supportLogic';

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
  onCreate: (input: CreateSupportTicketInput) => Promise<void>;
  preferredProjectId?: string;
}

export function CreateSupportTicketDialog({
  open,
  onOpenChange,
  projects,
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
  const [reportedByEmail, setReportedByEmail] = useState('');
  const [reportedByPhone, setReportedByPhone] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('undetermined');
  const [machineStopped, setMachineStopped] = useState(false);
  const [downtime, setDowntime] = useState(false);
  const [siteVisitRequired, setSiteVisitRequired] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId),
    [projectId, projects],
  );

  useEffect(() => {
    if (!open) return;
    const initialProjectId = preferredProjectId || projects[0]?.projectId || '';
    setProjectId(initialProjectId);
  }, [open, preferredProjectId, projects]);

  useEffect(() => {
    if (!selectedProject) return;
    const contact = selectedProject.supportProfile?.supportContacts?.[0];
    setCoverageType(determineCoverage(selectedProject.supportProfile));
    setReportedByName(contact?.name || '');
    setReportedByEmail(contact?.email || '');
    setReportedByPhone(contact?.phone || '');
  }, [selectedProject]);

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
    if (!selectedProject || !title.trim() || !description.trim() || !reportedByName.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        projectId: selectedProject.projectId,
        projectName: selectedProject.projectName,
        clientName: selectedProject.clientName,
        title: title.trim(),
        description: description.trim(),
        priority,
        category,
        channel,
        reportedByName: reportedByName.trim(),
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
    selectedProject && title.trim() && description.trim() && reportedByName.trim(),
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

          <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="reported-name">Customer contact <span className="text-red-500">*</span></Label>
              <Input id="reported-name" value={reportedByName} onChange={(e) => setReportedByName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reported-email">Email</Label>
              <Input id="reported-email" type="email" value={reportedByEmail} onChange={(e) => setReportedByEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reported-phone">Phone</Label>
              <Input id="reported-phone" value={reportedByPhone} onChange={(e) => setReportedByPhone(e.target.value)} />
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

