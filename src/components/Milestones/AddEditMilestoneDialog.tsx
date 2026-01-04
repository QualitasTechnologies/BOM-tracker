import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DelayLogDialog from './DelayLogDialog';
import { addMilestone, updateMilestone, updateMilestoneDate } from '@/utils/milestoneFirestore';
import { addDelayLog } from '@/utils/delayLogFirestore';
import { getProject } from '@/utils/projectFirestore';
import type { Milestone, MilestoneInput, MilestoneStatus, DelayLogInput } from '@/types/milestone';
import { validateMilestoneName, calculateDelayDays, MILESTONE_STATUS_LABELS } from '@/types/milestone';
import { useAuth } from '@/hooks/useAuth';

interface AddEditMilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  milestone?: Milestone | null;
  isBaselined: boolean;
  currentDeadline: string;
}

const AddEditMilestoneDialog = ({
  open,
  onOpenChange,
  projectId,
  milestone,
  isBaselined,
  currentDeadline,
}: AddEditMilestoneDialogProps) => {
  const { user } = useAuth();
  const isEditing = !!milestone;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<MilestoneStatus>('not-started');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Delay logging state
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [pendingDateChange, setPendingDateChange] = useState<{
    previousDate: string;
    newDate: string;
  } | null>(null);

  // Reset form when dialog opens/closes or milestone changes
  useEffect(() => {
    if (open) {
      if (milestone) {
        setName(milestone.name);
        setDescription(milestone.description || '');
        setEndDate(milestone.currentPlannedEndDate);
        setStatus(milestone.status);
      } else {
        setName('');
        setDescription('');
        setEndDate('');
        setStatus('not-started');
      }
      setError(null);
    }
  }, [open, milestone]);

  const handleSubmit = async () => {
    if (!user) return;

    // Validate name
    const nameValidation = validateMilestoneName(name);
    if (!nameValidation.valid) {
      setError(nameValidation.error || 'Invalid milestone name');
      return;
    }

    // Validate date
    if (!endDate) {
      setError('End date is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEditing && milestone) {
        // Check if date changed on baselined project
        const dateChanged = endDate !== milestone.currentPlannedEndDate;

        if (isBaselined && dateChanged) {
          // Date changed on baselined project - need to log delay
          setPendingDateChange({
            previousDate: milestone.currentPlannedEndDate,
            newDate: endDate,
          });
          setDelayDialogOpen(true);
          setIsSaving(false);
          return;
        }

        // Update milestone (no delay logging needed)
        await updateMilestone(projectId, milestone.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          currentPlannedEndDate: endDate,
          status,
        });
      } else {
        // Get project to check if baselined
        const project = await getProject(projectId);

        // Create new milestone
        const input: MilestoneInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          currentPlannedEndDate: endDate,
          status,
        };

        await addMilestone(projectId, input, user.uid, project?.isBaselined || false);
      }

      onOpenChange(false);
    } catch (error: any) {
      setError(error.message || 'Failed to save milestone');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelayLogSubmit = async (input: DelayLogInput) => {
    if (!user || !pendingDateChange || !milestone) return;

    try {
      // Log the delay
      await addDelayLog(
        projectId,
        input,
        user.uid,
        user.displayName || user.email || 'Unknown',
        currentDeadline
      );

      // Update the milestone with all fields including the new date
      await updateMilestone(projectId, milestone.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        currentPlannedEndDate: pendingDateChange.newDate,
        status,
      });

      setPendingDateChange(null);
      setDelayDialogOpen(false);
      onOpenChange(false);
    } catch (error: any) {
      setError(error.message || 'Failed to save milestone');
      throw error;
    }
  };

  const handleDelayDialogClose = (open: boolean) => {
    if (!open) {
      // User cancelled delay logging - revert date
      if (milestone) {
        setEndDate(milestone.currentPlannedEndDate);
      }
      setPendingDateChange(null);
    }
    setDelayDialogOpen(open);
  };

  // Get today's date for min date validation
  const today = new Date().toISOString().split('T')[0];

  return (
    <>
      <Dialog open={open && !delayDialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit Milestone' : 'Add Milestone'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the milestone details below.'
                : 'Create a new milestone to track project progress.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Milestone Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Planning & Requirements"
                maxLength={100}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this milestone"
                rows={2}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">Planned End Date *</Label>
              <div className="relative">
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={isEditing ? undefined : today}
                />
              </div>
              {isBaselined && isEditing && milestone && endDate !== milestone.currentPlannedEndDate && (
                <p className="text-xs text-amber-600">
                  Changing the date will require logging a delay reason.
                </p>
              )}
            </div>

            {/* Status (only for editing) */}
            {isEditing && (
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as MilestoneStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MILESTONE_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Milestone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delay Log Dialog (shown when date changes on baselined project) */}
      {pendingDateChange && milestone && (
        <DelayLogDialog
          open={delayDialogOpen}
          onOpenChange={handleDelayDialogClose}
          entityType="milestone"
          entityId={milestone.id}
          entityName={milestone.name}
          previousDate={pendingDateChange.previousDate}
          newDate={pendingDateChange.newDate}
          onSubmit={handleDelayLogSubmit}
        />
      )}
    </>
  );
};

export default AddEditMilestoneDialog;
