import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { fetchAllUsers } from '@/utils/userService';
import type { StakeholderInput } from '@/types/stakeholder';

interface SystemUser {
  uid: string;
  email: string;
  displayName: string;
}

interface AddStakeholderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: StakeholderInput) => Promise<void>;
  existingEmails: string[];
}

export default function AddStakeholderDialog({
  open,
  onOpenChange,
  onAdd,
  existingEmails
}: AddStakeholderDialogProps) {
  const [activeTab, setActiveTab] = useState<'internal' | 'external'>('internal');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Internal user state
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loadingUsers, setLoadingUsers] = useState(false);

  // External contact state
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');

  // Load system users when dialog opens
  useEffect(() => {
    if (open && activeTab === 'internal') {
      loadSystemUsers();
    }
  }, [open, activeTab]);

  const loadSystemUsers = async () => {
    setLoadingUsers(true);
    try {
      const result = await fetchAllUsers();
      const users = (result as any)?.users || [];
      // Filter out users that are already stakeholders
      const filteredUsers = users.filter((u: SystemUser) =>
        !existingEmails.includes(u.email?.toLowerCase())
      );
      setSystemUsers(filteredUsers);
    } catch (err) {
      console.error('Error loading users:', err);
      setSystemUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const resetForm = () => {
    setSelectedUserId('');
    setExternalName('');
    setExternalEmail('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddInternal = async () => {
    if (!selectedUserId) {
      setError('Please select a user');
      return;
    }

    const user = systemUsers.find(u => u.uid === selectedUserId);
    if (!user) {
      setError('Selected user not found');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onAdd({
        name: user.displayName || user.email,
        email: user.email,
        isInternalUser: true,
        userId: user.uid,
        notificationsEnabled: true
      });
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add stakeholder');
    } finally {
      setLoading(false);
    }
  };

  const handleAddExternal = async () => {
    if (!externalName.trim()) {
      setError('Please enter a name');
      return;
    }

    if (!externalEmail.trim()) {
      setError('Please enter an email');
      return;
    }

    if (!validateEmail(externalEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    if (existingEmails.includes(externalEmail.toLowerCase().trim())) {
      setError('This email is already a stakeholder');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onAdd({
        name: externalName.trim(),
        email: externalEmail.trim(),
        isInternalUser: false,
        userId: null,
        notificationsEnabled: true
      });
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add stakeholder');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Stakeholder</DialogTitle>
          <DialogDescription>
            Add a team member or external contact to receive BOM status updates.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'internal' | 'external')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="internal">Internal User</TabsTrigger>
            <TabsTrigger value="external">External Contact</TabsTrigger>
          </TabsList>

          <TabsContent value="internal" className="space-y-4 mt-4">
            <div>
              <Label>Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingUsers ? "Loading users..." : "Select a user"} />
                </SelectTrigger>
                <SelectContent>
                  {systemUsers.length === 0 && !loadingUsers && (
                    <SelectItem value="__none__" disabled>No available users</SelectItem>
                  )}
                  {systemUsers.map(user => (
                    <SelectItem key={user.uid} value={user.uid}>
                      {user.displayName || user.email} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleAddInternal} disabled={loading || !selectedUserId}>
                {loading ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="external" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="extName">Name *</Label>
              <Input
                id="extName"
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="Contact name"
              />
            </div>

            <div>
              <Label htmlFor="extEmail">Email *</Label>
              <Input
                id="extEmail"
                type="email"
                value={externalEmail}
                onChange={(e) => setExternalEmail(e.target.value)}
                placeholder="contact@company.com"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleAddExternal}
                disabled={loading || !externalName.trim() || !externalEmail.trim()}
              >
                {loading ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
