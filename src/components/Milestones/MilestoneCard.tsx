import { useState } from 'react';
import { Calendar, Clock, Edit2, Trash2, MoreVertical, CheckCircle, AlertCircle, PlayCircle, PauseCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import DelayLogDialog from './DelayLogDialog';
import { deleteMilestone, updateMilestoneStatus, updateMilestoneDate } from '@/utils/milestoneFirestore';
import { addDelayLog } from '@/utils/delayLogFirestore';
import type { Milestone, MilestoneStatus, DelayLogInput } from '@/types/milestone';
import {
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_COLORS,
  MILESTONE_STATUS_ICONS,
  formatMilestoneDate,
  getVarianceDisplay,
  calculateDelayDays,
} from '@/types/milestone';
import { useAuth } from '@/hooks/useAuth';

interface MilestoneCardProps {
  milestone: Milestone;
  index: number;
  isBaselined: boolean;
  projectId: string;
  onEdit: () => void;
  currentDeadline: string;
}

const MilestoneCard = ({
  milestone,
  index,
  isBaselined,
  projectId,
  onEdit,
  currentDeadline,
}: MilestoneCardProps) => {
  const { user } = useAuth();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [pendingDateChange, setPendingDateChange] = useState<{ previousDate: string; newDate: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const variance = getVarianceDisplay(milestone.originalPlannedEndDate, milestone.currentPlannedEndDate);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMilestone(projectId, milestone.id);
      setDeleteDialogOpen(false);
    } catch (error) {
      console.error('Failed to delete milestone:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStatusChange = async (newStatus: MilestoneStatus) => {
    setIsUpdatingStatus(true);
    try {
      await updateMilestoneStatus(projectId, milestone.id, newStatus);
    } catch (error) {
      console.error('Failed to update milestone status:', error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDelayLogSubmit = async (input: DelayLogInput) => {
    if (!user || !pendingDateChange) return;

    try {
      // Log the delay
      await addDelayLog(
        projectId,
        input,
        user.uid,
        user.displayName || user.email || 'Unknown',
        currentDeadline
      );

      // Update the milestone date
      await updateMilestoneDate(projectId, milestone.id, pendingDateChange.newDate);

      setPendingDateChange(null);
      setDelayDialogOpen(false);
    } catch (error) {
      console.error('Failed to log delay:', error);
      throw error;
    }
  };

  const getStatusIcon = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'in-progress':
        return <PlayCircle className="h-5 w-5 text-blue-600" />;
      case 'blocked':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <PauseCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const isOverdue = () => {
    if (milestone.status === 'completed') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(milestone.currentPlannedEndDate);
    return dueDate < today;
  };

  return (
    <>
      <Card className={`${milestone.status === 'blocked' ? 'border-red-200 bg-red-50/30' : ''} ${isOverdue() ? 'border-amber-200' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            {/* Left side: Index, Status Icon, Name */}
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                {index}
              </div>
              <div className="flex-shrink-0">
                {getStatusIcon(milestone.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-gray-900 truncate">{milestone.name}</h3>
                  <Badge className={MILESTONE_STATUS_COLORS[milestone.status]}>
                    {MILESTONE_STATUS_ICONS[milestone.status]} {MILESTONE_STATUS_LABELS[milestone.status]}
                  </Badge>
                  {isOverdue() && milestone.status !== 'completed' && (
                    <Badge variant="destructive">Overdue</Badge>
                  )}
                </div>
                {milestone.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{milestone.description}</p>
                )}
                {milestone.lastProgressNote && (
                  <p className="text-xs text-gray-400 mt-1 italic">
                    Last update: {milestone.lastProgressNote}
                  </p>
                )}
              </div>
            </div>

            {/* Right side: Dates and Actions */}
            <div className="flex items-start gap-4">
              {/* Dates */}
              <div className="text-right space-y-1">
                <div className="flex items-center justify-end gap-1 text-sm">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className={milestone.status === 'completed' ? 'text-green-600' : ''}>
                    {milestone.status === 'completed' && milestone.actualEndDate
                      ? formatMilestoneDate(milestone.actualEndDate)
                      : formatMilestoneDate(milestone.currentPlannedEndDate)}
                  </span>
                </div>
                {isBaselined && milestone.originalPlannedEndDate && (
                  <div className={`text-xs ${variance.color}`}>
                    {variance.text}
                    {variance.text !== 'On Track' && variance.text !== 'No baseline' && (
                      <span className="text-gray-400 ml-1">
                        (was {formatMilestoneDate(milestone.originalPlannedEndDate)})
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Actions Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Status changes */}
                  {milestone.status !== 'in-progress' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('in-progress')} disabled={isUpdatingStatus}>
                      <PlayCircle className="h-4 w-4 mr-2 text-blue-600" />
                      Mark In Progress
                    </DropdownMenuItem>
                  )}
                  {milestone.status !== 'completed' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('completed')} disabled={isUpdatingStatus}>
                      <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                      Mark Completed
                    </DropdownMenuItem>
                  )}
                  {milestone.status !== 'blocked' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('blocked')} disabled={isUpdatingStatus}>
                      <AlertCircle className="h-4 w-4 mr-2 text-red-600" />
                      Mark Blocked
                    </DropdownMenuItem>
                  )}
                  {milestone.status !== 'not-started' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('not-started')} disabled={isUpdatingStatus}>
                      <PauseCircle className="h-4 w-4 mr-2 text-gray-400" />
                      Mark Not Started
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Milestone
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteDialogOpen(true)}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Milestone?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{milestone.name}"? This action cannot be undone.
              {isBaselined && (
                <span className="block mt-2 text-amber-600">
                  Note: Delay history for this milestone will be preserved.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delay Log Dialog */}
      {pendingDateChange && (
        <DelayLogDialog
          open={delayDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDateChange(null);
            }
            setDelayDialogOpen(open);
          }}
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

export default MilestoneCard;
