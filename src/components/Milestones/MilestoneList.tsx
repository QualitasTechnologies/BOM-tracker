import { useState, useEffect } from 'react';
import { Plus, Lock, AlertTriangle, Calendar, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import MilestoneTableView from './MilestoneTableView';
import DelayHistoryView from './DelayHistoryView';
import AddEditMilestoneDialog from './AddEditMilestoneDialog';
import { subscribeToMilestones, lockMilestonesBaseline, validateMilestonesForBaseline, applyMilestoneTemplate, DEFAULT_MILESTONE_TEMPLATE, updateMilestoneStatus, deleteMilestone } from '@/utils/milestoneFirestore';
import type { MilestoneStatus } from '@/types/milestone';
import { lockProjectBaseline, getProject } from '@/utils/projectFirestore';
import { subscribeToDelayLogs, getDelayStats } from '@/utils/delayLogFirestore';
import type { Milestone, DelayLog } from '@/types/milestone';
import type { Project } from '@/utils/projectFirestore';
import { useAuth } from '@/hooks/useAuth';

interface MilestoneListProps {
  projectId: string;
}

const MilestoneList = ({ projectId }: MilestoneListProps) => {
  const { user } = useAuth();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [delayLogs, setDelayLogs] = useState<DelayLog[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [lockBaselineDialogOpen, setLockBaselineDialogOpen] = useState(false);
  const [lockingBaseline, setLockingBaseline] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [delayStats, setDelayStats] = useState<{
    totalDelayDays: number;
    internalDays: number;
    externalDays: number;
  }>({ totalDelayDays: 0, internalDays: 0, externalDays: 0 });

  // Load project data
  useEffect(() => {
    const loadProject = async () => {
      const proj = await getProject(projectId);
      setProject(proj);
    };
    loadProject();
  }, [projectId]);

  // Subscribe to milestones
  useEffect(() => {
    const unsubscribe = subscribeToMilestones(projectId, (data) => {
      setMilestones(data);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Subscribe to delay logs
  useEffect(() => {
    const unsubscribe = subscribeToDelayLogs(projectId, (data) => {
      setDelayLogs(data);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Load delay stats when project changes
  useEffect(() => {
    const loadDelayStats = async () => {
      if (project?.isBaselined) {
        const stats = await getDelayStats(projectId);
        setDelayStats({
          totalDelayDays: stats.totalDelayDays,
          internalDays: stats.internalDays,
          externalDays: stats.externalDays,
        });
      }
    };
    loadDelayStats();
  }, [projectId, project?.isBaselined, delayLogs]);

  const handleLockBaseline = async () => {
    if (!user) return;

    setLockingBaseline(true);
    setBaselineError(null);

    try {
      // Validate milestones first
      const validation = await validateMilestonesForBaseline(projectId);
      if (!validation.valid) {
        setBaselineError(validation.errors.join('\n'));
        setLockingBaseline(false);
        return;
      }

      // Lock milestones baseline first
      await lockMilestonesBaseline(projectId);

      // Then lock project baseline
      await lockProjectBaseline(projectId, user.uid);

      // Reload project
      const proj = await getProject(projectId);
      setProject(proj);

      setLockBaselineDialogOpen(false);
    } catch (error: any) {
      setBaselineError(error.message || 'Failed to lock baseline');
    } finally {
      setLockingBaseline(false);
    }
  };

  const handleApplyTemplate = async () => {
    if (!user || !project?.deadline) return;

    setApplyingTemplate(true);
    setTemplateError(null);

    try {
      await applyMilestoneTemplate(projectId, project.deadline, user.uid);
      setTemplateDialogOpen(false);
    } catch (error: any) {
      setTemplateError(error.message || 'Failed to apply template');
    } finally {
      setApplyingTemplate(false);
    }
  };

  const handleEditMilestone = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setAddDialogOpen(true);
  };

  const handleStatusChange = async (milestoneId: string, status: MilestoneStatus) => {
    try {
      await updateMilestoneStatus(projectId, milestoneId, status);
    } catch (error) {
      console.error('Failed to update milestone status:', error);
    }
  };

  const handleDeleteMilestone = async (milestoneId: string) => {
    if (!confirm('Are you sure you want to delete this milestone?')) return;
    try {
      await deleteMilestone(projectId, milestoneId);
    } catch (error) {
      console.error('Failed to delete milestone:', error);
    }
  };

  const handleDialogClose = () => {
    setAddDialogOpen(false);
    setEditingMilestone(null);
  };

  const isBaselined = project?.isBaselined ?? false;

  // Check if deadline is in the future (for template validation)
  const isDeadlineInFuture = project?.deadline ? new Date(project.deadline) > new Date() : false;

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold">Project Milestones</h2>
          <p className="text-sm text-gray-500">
            Track project phases and progress
          </p>
        </div>

        <div className="flex gap-2">
          {!isBaselined && milestones.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setLockBaselineDialogOpen(true)}
              className="gap-2"
            >
              <Lock size={16} />
              Lock Baseline
            </Button>
          )}
          <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
            <Plus size={16} />
            Add Milestone
          </Button>
        </div>
      </div>

      {/* Baseline status banner */}
      {!isBaselined && milestones.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Baseline not locked.</strong> Delay tracking is inactive. Lock the baseline when your plan is finalized to start tracking variances.
          </AlertDescription>
        </Alert>
      )}

      {isBaselined && (
        <Alert className="bg-green-50 border-green-200">
          <Lock className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            <strong>Baseline locked</strong> on {new Date(project?.baselinedAt || '').toLocaleDateString()}.
            {delayStats.totalDelayDays > 0 && (
              <span className="ml-2">
                Total delay: <span className="font-semibold text-red-600">+{delayStats.totalDelayDays} days</span>
                {' '}(Internal: {delayStats.internalDays}d, External: {delayStats.externalDays}d)
              </span>
            )}
            {delayStats.totalDelayDays === 0 && (
              <span className="ml-2 text-green-600">Project is on track!</span>
            )}
          </AlertDescription>
        </Alert>
      )}


      {/* Milestones list */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading milestones...</div>
      ) : milestones.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No milestones yet</h3>
            <p className="text-gray-500 mb-4">
              Break your project into phases by adding milestones.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {project?.deadline && isDeadlineInFuture && (
                <Button
                  variant="outline"
                  onClick={() => setTemplateDialogOpen(true)}
                  className="gap-2"
                >
                  <FileText size={16} />
                  Apply Template
                </Button>
              )}
              <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
                <Plus size={16} />
                Add Milestone
              </Button>
            </div>
            {!project?.deadline && (
              <p className="text-xs text-amber-600 mt-3">
                Set a project deadline to use the milestone template.
              </p>
            )}
            {project?.deadline && !isDeadlineInFuture && (
              <p className="text-xs text-amber-600 mt-3">
                Project deadline is in the past. Update deadline to use the milestone template.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <MilestoneTableView
          milestones={milestones}
          project={project}
          isBaselined={isBaselined}
          onEdit={handleEditMilestone}
          onStatusChange={handleStatusChange}
          onDelete={handleDeleteMilestone}
        />
      )}

      {/* Delay History */}
      {milestones.length > 0 && (
        <DelayHistoryView projectId={projectId} isBaselined={isBaselined} />
      )}

      {/* Add/Edit Dialog */}
      <AddEditMilestoneDialog
        open={addDialogOpen}
        onOpenChange={handleDialogClose}
        projectId={projectId}
        milestone={editingMilestone}
        isBaselined={isBaselined}
        currentDeadline={project?.deadline || ''}
      />

      {/* Lock Baseline Confirmation Dialog */}
      <AlertDialog open={lockBaselineDialogOpen} onOpenChange={setLockBaselineDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock Project Baseline?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Once locked, the baseline cannot be changed. All future date changes will be tracked as delays with mandatory reason and attribution.
              </p>
              <p className="font-medium">
                This will capture the current deadline ({project?.deadline ? new Date(project.deadline).toLocaleDateString() : 'N/A'}) and all milestone dates as the original plan.
              </p>
              {baselineError && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription>{baselineError}</AlertDescription>
                </Alert>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={lockingBaseline}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLockBaseline}
              disabled={lockingBaseline}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {lockingBaseline ? 'Locking...' : 'Lock Baseline'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply Template Confirmation Dialog */}
      <AlertDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply Milestone Template?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will create 4 standard milestones with dates distributed across your project timeline
                  (today → {project?.deadline ? new Date(project.deadline).toLocaleDateString() : 'deadline'}):
                </p>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
                  {DEFAULT_MILESTONE_TEMPLATE.map((m, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="font-medium">{i + 1}. {m.name}</span>
                      <span className="text-gray-500">{m.percentageOfTimeline}% of timeline</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-500">
                  You can edit or delete these milestones after they're created.
                </p>
                {!isDeadlineInFuture && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>Project deadline must be in the future to apply template.</AlertDescription>
                  </Alert>
                )}
                {templateError && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{templateError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyingTemplate}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApplyTemplate}
              disabled={applyingTemplate || !isDeadlineInFuture}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applyingTemplate ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                'Apply Template'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MilestoneList;
