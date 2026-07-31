import { useState } from 'react';
import { Loader2, Plus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useToast } from '@/hooks/use-toast';
import type {
  Client,
  ClientContact,
  ClientContactRole,
} from '@/utils/settingsFirestore';
import { addClientCRMContact } from '@/utils/supportFirestore';

interface Props {
  projectId: string;
  client: Client | null | undefined;
  onAdded: (contact: ClientContact) => void;
  label?: string;
  variant?: 'outline' | 'secondary' | 'ghost';
}

export function AddClientContactDialog({
  projectId,
  client,
  onAdded,
  label = 'Add CRM contact',
  variant = 'outline',
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<ClientContactRole>('technical');

  const reset = () => {
    setName('');
    setDesignation('');
    setEmail('');
    setPhone('');
    setRole('technical');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && !saving) reset();
  };

  const handleSave = async () => {
    if (!client || !name.trim()) return;
    setSaving(true);
    try {
      const contact = await addClientCRMContact({
        projectId,
        clientId: client.id,
        name: name.trim(),
        designation: designation.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role,
      });
      onAdded(contact);
      toast({
        title: 'CRM contact added',
        description: contact.name + ' is now available across ' + client.company + ' projects.',
      });
      reset();
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Could not add CRM contact',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm" disabled={!client}>
          <UserPlus className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add client CRM contact</DialogTitle>
          <DialogDescription>
            Add a contact for {client?.company || 'this client'}. The contact will be available
            to every support ticket and project for this client.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="crm-contact-name">Name *</Label>
            <Input id="crm-contact-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="crm-contact-designation">Designation</Label>
            <Input
              id="crm-contact-designation"
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="Maintenance engineer, plant manager…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="crm-contact-email">Email</Label>
              <Input id="crm-contact-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="crm-contact-phone">Phone</Label>
              <Input id="crm-contact-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Relationship</Label>
            <Select value={role} onValueChange={(value) => setRole(value as ClientContactRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="technical">Technical</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="operations">Operations</SelectItem>
                <SelectItem value="management">Management</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add to CRM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
