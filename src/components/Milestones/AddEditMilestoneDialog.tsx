import { useState, useEffect, useRef } from 'react';
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
import type { MilestoneCommand } from '@/utils/nativeMilestoneOperations';

// Native schedule context supplied by MilestoneList; absent means the original direct-write behaviour.
export interface NativeMilestoneContext {
  canMutate: boolean;
  isCurrent: () => boolean;
  scheduleVersion: string;
  pendingCommand: () => MilestoneCommand | null;
  // Resolves false when the account/project changed while waiting, so the acknowledgement must be ignored.
  issue: (command: MilestoneCommand) => Promise<boolean>;
}

interface AddEditMilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  milestone?: Milestone | null;
  isBaselined: boolean;
  currentDeadline: string;
  native?: NativeMilestoneContext;
}

const newMilestoneId = () => globalThis.crypto.randomUUID();

// The frozen request keeps its nonce, versions and payload; a form that no longer shows exactly those values must not be saved over it.
const sameDraft = (saved: MilestoneCommand, draft: MilestoneCommand) => {
  if (saved.kind === 'add' && draft.kind === 'add') {
    return saved.milestone_id === draft.milestone_id && saved.input.name === draft.input.name
      && (saved.input.description ?? '') === (draft.input.description ?? '')
      && saved.input.currentPlannedEndDate === draft.input.currentPlannedEndDate
      && (saved.input.status ?? 'not-started') === (draft.input.status ?? 'not-started');
  }
  if (saved.kind === 'edit' && draft.kind === 'edit') {
    const savedPatch = saved.patch as Record<string, unknown>;
    const draftPatch = draft.patch as Record<string, unknown>;
    return saved.milestone_id === draft.milestone_id && Object.keys(savedPatch).every(key => savedPatch[key] === draftPatch[key])
      && JSON.stringify(saved.delay ?? null) === JSON.stringify(draft.delay ?? null);
  }
  return false;
};

const AddEditMilestoneDialog = ({
  open,
  onOpenChange,
  projectId,
  milestone,
  isBaselined,
  currentDeadline,
  native,
}: AddEditMilestoneDialogProps) => {
  const { user } = useAuth();
  const isEditing = !!milestone;
  const addIdRef = useRef<string | null>(null);
  const baseVersionRef = useRef<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<MilestoneStatus>('not-started');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // An unconfirmed native add/edit for this form is frozen: its fields show the saved values and cannot be edited.
  const saved = native ? native.pendingCommand() : null;
  const frozen = saved && ((saved.kind === 'edit' && !!milestone && saved.milestone_id === milestone.id) || (saved.kind === 'add' && !milestone)) ? saved : null;
  const frozenDelay = frozen?.kind === 'edit' ? frozen.delay : undefined;
  const fieldsLocked = isSaving || !!frozen;

  // Delay logging state
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [pendingDateChange, setPendingDateChange] = useState<{
    previousDate: string;
    newDate: string;
  } | null>(null);

  // Reset form when dialog opens/closes or milestone changes
  // Native: only the milestone identity (not a refreshed server copy) resets the draft.
  useEffect(() => {
    if (open) {
      const pendingCommand = native?.pendingCommand() ?? null;
      if (pendingCommand?.kind === 'edit' && milestone && pendingCommand.milestone_id === milestone.id) {
        const patch = pendingCommand.patch;
        setName(patch.name ?? milestone.name);
        setDescription(patch.description === undefined ? milestone.description || '' : patch.description ?? '');
        setEndDate(patch.currentPlannedEndDate ?? milestone.currentPlannedEndDate);
        setStatus((patch.status as MilestoneStatus | undefined) ?? milestone.status);
      } else if (pendingCommand?.kind === 'add' && !milestone) {
        addIdRef.current = pendingCommand.milestone_id;
        setName(pendingCommand.input.name);
        setDescription(pendingCommand.input.description ?? '');
        setEndDate(pendingCommand.input.currentPlannedEndDate);
        setStatus((pendingCommand.input.status as MilestoneStatus | undefined) ?? 'not-started');
      } else if (milestone) {
        setName(milestone.name);
        setDescription(milestone.description || '');
        setEndDate(milestone.currentPlannedEndDate);
        setStatus(milestone.status);
      } else {
        addIdRef.current = null;
        setName('');
        setDescription('');
        setEndDate('');
        setStatus('not-started');
      }
      baseVersionRef.current = native?.scheduleVersion ?? null;
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, native ? milestone?.id : milestone]);

  // Native save of an add/edit. A pending add/edit for this same milestone is replayed exactly, never rebuilt from the form.
  const submitNative = async (command: MilestoneCommand) => {
    if (!native) return;
    const pendingCommand = native.pendingCommand();
    if (pendingCommand) {
      const sameTarget = (pendingCommand.kind === 'add' && command.kind === 'add' && pendingCommand.milestone_id === command.milestone_id)
        || (pendingCommand.kind === 'edit' && command.kind === 'edit' && pendingCommand.milestone_id === command.milestone_id);
      if (!sameTarget) throw new Error('Resolve the pending schedule request first.');
      if (!sameDraft(pendingCommand, command)) {
        throw new Error('This form no longer matches the saved request. Cancel, resolve the saved request, then enter the new values.');
      }
      command = pendingCommand;
    } else if (command.kind === 'edit' && baseVersionRef.current !== native.scheduleVersion) {
      throw new Error('The schedule changed on the server while you were editing. Close and reopen this milestone to continue.');
    }
    if (await native.issue(command)) {
      addIdRef.current = null;
      onOpenChange(false);
    }
  };

  const nativeEditCommand = (target: Milestone, newDate: string, delay?: { reason: string; attribution: DelayLogInput['attribution'] }): MilestoneCommand => ({
    kind: 'edit',
    milestone_id: target.id,
    patch: {
      name: name.trim(),
      description: description.trim() || null,
      currentPlannedEndDate: newDate,
      status,
    },
    ...(delay ? { delay } : {}),
  });

  const handleSubmit = async () => {
    if (!user) return;
    if (native && !native.canMutate) {
      setError('Schedule changes are not available right now.');
      return;
    }

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

        if (native) {
          const pendingCommand = native.pendingCommand();
          const replaying = pendingCommand?.kind === 'edit' && pendingCommand.milestone_id === milestone.id;
          if (replaying && frozenDelay) {
            setPendingDateChange({ previousDate: milestone.currentPlannedEndDate, newDate: endDate });
            setDelayDialogOpen(true);
            setIsSaving(false);
            return;
          }
          if (isBaselined && dateChanged && !replaying) {
            setPendingDateChange({ previousDate: milestone.currentPlannedEndDate, newDate: endDate });
            setDelayDialogOpen(true);
            setIsSaving(false);
            return;
          }
          await submitNative(nativeEditCommand(milestone, endDate));
          return;
        }

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
      } else if (native) {
        addIdRef.current ??= newMilestoneId();
        await submitNative({
          kind: 'add',
          milestone_id: addIdRef.current,
          input: {
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            currentPlannedEndDate: endDate,
            status,
          },
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
      if (native && !native.isCurrent()) return;
      setError(error.message || 'Failed to save milestone');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelayLogSubmit = async (input: DelayLogInput) => {
    if (!user || !pendingDateChange || !milestone) return;

    if (native) {
      // One atomic edit carries every captured draft field plus the delay reason; no separate delay-log write.
      try {
        await submitNative(nativeEditCommand(milestone, pendingDateChange.newDate, { reason: input.reason, attribution: input.attribution }));
        if (native.isCurrent()) {
          setPendingDateChange(null);
          setDelayDialogOpen(false);
        }
      } catch (error: any) {
        if (!native.isCurrent()) return;
        setError(error.message || 'Failed to save milestone');
        throw error;
      }
      return;
    }

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
      if (milestone && !frozen) {
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
            {frozen && (
              <Alert>
                <AlertDescription>
                  A saved request is awaiting confirmation. These are its original values and cannot be changed. Retry it as is, or cancel and
                  use Resolve pending schedule request before entering new values.
                </AlertDescription>
              </Alert>
            )}

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
                onChange={(e) => { if (!fieldsLocked) setName(e.target.value); }}
                disabled={fieldsLocked}
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
                onChange={(e) => { if (!fieldsLocked) setDescription(e.target.value); }}
                disabled={fieldsLocked}
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
                  onChange={(e) => { if (!fieldsLocked) setEndDate(e.target.value); }}
                  disabled={fieldsLocked}
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
                <Select value={status} onValueChange={(v) => { if (!fieldsLocked) setStatus(v as MilestoneStatus); }} disabled={fieldsLocked}>
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
          lockedInput={!!frozenDelay}
          initialReason={frozenDelay?.reason}
          initialAttribution={frozenDelay?.attribution}
        />
      )}
    </>
  );
};

export default AddEditMilestoneDialog;
