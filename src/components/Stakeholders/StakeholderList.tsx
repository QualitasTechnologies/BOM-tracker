import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Mail, User, Building, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  subscribeToStakeholders,
  addStakeholder,
  deleteStakeholder,
  toggleStakeholderNotifications
} from '@/utils/stakeholderFirestore';
import type { Stakeholder, StakeholderInput } from '@/types/stakeholder';
import AddStakeholderDialog from './AddStakeholderDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';

interface StakeholderListProps {
  projectId: string;
  projectName: string;
}

export default function StakeholderList({ projectId, projectName }: StakeholderListProps) {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [stakeholderToDelete, setStakeholderToDelete] = useState<Stakeholder | null>(null);
  const [sendingDigest, setSendingDigest] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = subscribeToStakeholders(projectId, (data) => {
      setStakeholders(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const handleAddStakeholder = async (input: StakeholderInput) => {
    if (!user) return;

    try {
      await addStakeholder(projectId, input, user.uid);
      toast({
        title: 'Stakeholder added',
        description: `${input.name} will now receive BOM status updates.`
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to add stakeholder',
        variant: 'destructive'
      });
      throw err;
    }
  };

  const handleToggleNotifications = async (stakeholder: Stakeholder) => {
    try {
      await toggleStakeholderNotifications(
        projectId,
        stakeholder.id,
        !stakeholder.notificationsEnabled
      );
      toast({
        title: stakeholder.notificationsEnabled ? 'Notifications disabled' : 'Notifications enabled',
        description: `${stakeholder.name} will ${stakeholder.notificationsEnabled ? 'no longer' : 'now'} receive updates.`
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: 'Failed to update notification settings',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteClick = (stakeholder: Stakeholder) => {
    setStakeholderToDelete(stakeholder);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!stakeholderToDelete) return;

    try {
      await deleteStakeholder(projectId, stakeholderToDelete.id);
      toast({
        title: 'Stakeholder removed',
        description: `${stakeholderToDelete.name} has been removed from this project.`
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: 'Failed to remove stakeholder',
        variant: 'destructive'
      });
    } finally {
      setDeleteConfirmOpen(false);
      setStakeholderToDelete(null);
    }
  };

  const handleSendDigestNow = async () => {
    const enabledStakeholders = stakeholders.filter(s => s.notificationsEnabled);
    if (enabledStakeholders.length === 0) {
      toast({
        title: 'No recipients',
        description: 'No stakeholders have notifications enabled.',
        variant: 'destructive'
      });
      return;
    }

    setSendingDigest(true);
    try {
      const sendBOMDigest = httpsCallable(functions, 'sendBOMDigestNow');
      await sendBOMDigest({ projectId });
      toast({
        title: 'Digest sent',
        description: `BOM status update sent to ${enabledStakeholders.length} stakeholder(s).`
      });
    } catch (err: any) {
      console.error('Error sending digest:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to send digest',
        variant: 'destructive'
      });
    } finally {
      setSendingDigest(false);
    }
  };

  const existingEmails = stakeholders.map(s => s.email.toLowerCase());

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Loading stakeholders...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Project Stakeholders</h3>
          <p className="text-sm text-muted-foreground">
            Stakeholders receive daily BOM status updates via email.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSendDigestNow}
            disabled={sendingDigest || stakeholders.filter(s => s.notificationsEnabled).length === 0}
          >
            <Send className="mr-2 h-4 w-4" />
            {sendingDigest ? 'Sending...' : 'Send Update Now'}
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Stakeholder
          </Button>
        </div>
      </div>

      {stakeholders.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Mail className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              No stakeholders added yet. Add team members or external contacts to send them BOM status updates.
            </p>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add First Stakeholder
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-left p-3 font-medium">Last Notified</th>
                  <th className="text-center p-3 font-medium">Notifications</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stakeholders.map(stakeholder => (
                  <tr key={stakeholder.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {stakeholder.isInternalUser ? (
                          <User className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Building className="h-4 w-4 text-muted-foreground" />
                        )}
                        {stakeholder.name}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{stakeholder.email}</td>
                    <td className="p-3">
                      <Badge variant={stakeholder.isInternalUser ? 'default' : 'secondary'}>
                        {stakeholder.isInternalUser ? 'Internal' : 'External'}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-sm">
                      {stakeholder.lastNotificationSentAt
                        ? stakeholder.lastNotificationSentAt.toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'Never'}
                    </td>
                    <td className="p-3 text-center">
                      <Switch
                        checked={stakeholder.notificationsEnabled}
                        onCheckedChange={() => handleToggleNotifications(stakeholder)}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(stakeholder)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AddStakeholderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddStakeholder}
        existingEmails={existingEmails}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Stakeholder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {stakeholderToDelete?.name} from this project?
              They will no longer receive BOM status updates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
