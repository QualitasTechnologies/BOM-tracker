import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import type { SupportProjectProfile } from '@/types/support';
import { updateProject, type Project } from '@/utils/projectFirestore';
import { SupportDocuments } from './SupportDocuments';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  userId: string;
  userName: string;
}

const emptyProfile: SupportProjectProfile = {
  amcStatus: 'none',
  supportContacts: [{ name: '', email: '', phone: '', designation: '' }],
};

export function SupportProjectDialog({
  open,
  onOpenChange,
  project,
  userId,
  userName,
}: Props) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<SupportProjectProfile>(emptyProfile);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setProfile({
        ...emptyProfile,
        ...project.supportProfile,
        supportContacts:
          project.supportProfile?.supportContacts?.length
            ? project.supportProfile.supportContacts
            : emptyProfile.supportContacts,
      });
    }
  }, [project]);

  if (!project) return null;

  const setField = <K extends keyof SupportProjectProfile>(
    key: K,
    value: SupportProjectProfile[K],
  ) => setProfile((current) => ({ ...current, [key]: value }));

  const setContact = (key: 'name' | 'email' | 'phone' | 'designation', value: string) => {
    const existing = profile.supportContacts?.[0] || { name: '' };
    setField('supportContacts', [{ ...existing, [key]: value }]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProject(project.projectId, { supportProfile: profile });
      toast({ title: 'Support profile saved' });
    } catch (error) {
      toast({
        title: 'Could not save profile',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const contact = profile.supportContacts?.[0] || { name: '', email: '', phone: '', designation: '' };

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
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>Commissioning date</Label>
                <Input type="date" value={profile.commissioningDate || ''} onChange={(e) => setField('commissioningDate', e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Machine / system model</Label>
                <Input value={profile.machineModel || ''} onChange={(e) => setField('machineModel', e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Serial / asset number</Label>
                <Input value={profile.machineSerialNumber || ''} onChange={(e) => setField('machineSerialNumber', e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Installed site / line</Label>
              <Input value={profile.siteLocation || ''} onChange={(e) => setField('siteLocation', e.target.value)} placeholder="Plant, city, line or machine location" />
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-medium">Warranty</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Warranty start</Label>
                  <Input type="date" value={profile.warrantyStartDate || ''} onChange={(e) => setField('warrantyStartDate', e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Warranty end</Label>
                  <Input type="date" value={profile.warrantyEndDate || ''} onChange={(e) => setField('warrantyEndDate', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-medium">Annual maintenance contract</h3>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2">
                  <Label>AMC status</Label>
                  <Select value={profile.amcStatus || 'none'} onValueChange={(value) => setField('amcStatus', value as SupportProjectProfile['amcStatus'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No AMC</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>AMC start</Label>
                  <Input type="date" value={profile.amcStartDate || ''} onChange={(e) => setField('amcStartDate', e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>AMC end</Label>
                  <Input type="date" value={profile.amcEndDate || ''} onChange={(e) => setField('amcEndDate', e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Contract number</Label>
                  <Input value={profile.amcContractNumber || ''} onChange={(e) => setField('amcContractNumber', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-slate-50 p-4">
              <h3 className="mb-3 font-medium">Primary customer support contact</h3>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2"><Label>Name</Label><Input value={contact.name} onChange={(e) => setContact('name', e.target.value)} /></div>
                <div className="grid gap-2"><Label>Designation</Label><Input value={contact.designation || ''} onChange={(e) => setContact('designation', e.target.value)} /></div>
                <div className="grid gap-2"><Label>Email</Label><Input type="email" value={contact.email || ''} onChange={(e) => setContact('email', e.target.value)} /></div>
                <div className="grid gap-2"><Label>Phone</Label><Input value={contact.phone || ''} onChange={(e) => setContact('phone', e.target.value)} /></div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Internal support notes</Label>
              <Textarea value={profile.internalNotes || ''} onChange={(e) => setField('internalNotes', e.target.value)} placeholder="Access constraints, backup location, known exclusions, special escalation notes…" />
            </div>

            <DialogFooter>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save support profile
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

