import { useState, useEffect, useRef, useCallback } from 'react';
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
import { auth } from '@/firebase';
import { isNativeMaterialCommandEnabled } from '@/utils/nativeMaterialCommands';
import { createNativeMilestoneSession } from '@/utils/nativeMilestoneOperations';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import type { MilestoneCommand, MilestoneSnapshot } from '@/utils/nativeMilestoneOperations';
import type { NativeMilestoneContext } from './AddEditMilestoneDialog';

type NativeSession = ReturnType<typeof createNativeMilestoneSession>;
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

interface MilestoneListProps {
  projectId: string;
}

const MilestoneList = ({ projectId }: MilestoneListProps) => {
  const { user } = useAuth();
  const native = isNativeMaterialCommandEnabled();
  // Scoped reads never enable the legacy writers; without the native commands the schedule is read-only.
  const legacyLocked = !native && isScopedProjectReadEnabled();
  const uid = user?.uid ?? null;
  const [legacyMilestones, setMilestones] = useState<Milestone[]>([]);
  const [delayLogs, setDelayLogs] = useState<DelayLog[]>([]);
  const [legacyProject, setProject] = useState<Project | null>(null);
  const [snapshot, setSnapshot] = useState<MilestoneSnapshot | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, bumpPending] = useState(0);
  const sessionRef = useRef<NativeSession | null>(null);
  const contextRef = useRef<object | null>(null);
  const milestones: Milestone[] = native ? ((snapshot?.milestones ?? []) as unknown as Milestone[]) : legacyMilestones;
  const project: Project | null = native ? ((snapshot?.project ?? null) as unknown as Project | null) : legacyProject;
  const pending = native ? sessionRef.current?.pending ?? null : null;
  const nativeReady = native && !!snapshot;
  const canEdit = nativeReady && snapshot?.permissions.edit === true;
  const canMutate = native ? canEdit && !pending && !busy : !legacyLocked;
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
    if (native) return;
    const loadProject = async () => {
      const proj = await getProject(projectId);
      setProject(proj);
    };
    loadProject();
  }, [projectId, native]);

  // Subscribe to milestones
  useEffect(() => {
    if (native) return;
    const unsubscribe = subscribeToMilestones(projectId, (data) => {
      setMilestones(data);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [projectId, native]);

  // Native opening: authoritative project + milestones are loaded together through one session per uid/project.
  const reloadNative = useCallback(async (session: NativeSession, context: object) => {
    try {
      const fresh = await session.load();
      if (contextRef.current !== context) return;
      setSnapshot(fresh);
      setNativeError(null);
    } catch (error) {
      if (contextRef.current !== context) return;
      setNativeError(errorText(error, 'Failed to load the schedule'));
    } finally {
      if (contextRef.current === context) {
        setIsLoading(false);
        bumpPending((n) => n + 1);
      }
    }
  }, []);

  useEffect(() => {
    if (!native) return;
    const context = {};
    contextRef.current = context;
    sessionRef.current = null;
    setSnapshot(null);
    setNativeError(null);
    setActionError(null);
    setBusy(false);
    setIsLoading(true);
    setAddDialogOpen(false);
    setEditingMilestone(null);
    setLockBaselineDialogOpen(false);
    setTemplateDialogOpen(false);
    if (!uid || auth.currentUser?.uid !== uid) {
      setNativeError('Sign in again to load the schedule.');
      setIsLoading(false);
      return () => { if (contextRef.current === context) contextRef.current = null; };
    }
    const session = createNativeMilestoneSession(
      projectId,
      uid,
      () => contextRef.current === context && auth.currentUser?.uid === uid,
    );
    sessionRef.current = session;
    void reloadNative(session, context);
    return () => {
      if (contextRef.current === context) contextRef.current = null;
    };
  }, [native, projectId, uid, reloadNative]);

  // Subscribe to delay logs (read-only history); in native mode a change triggers a reload that never touches pending/draft state.
  useEffect(() => {
    let first = true;
    const unsubscribe = subscribeToDelayLogs(projectId, (data) => {
      setDelayLogs(data);
      if (native && !first && sessionRef.current && contextRef.current) void reloadNative(sessionRef.current, contextRef.current);
      first = false;
    });

    return () => unsubscribe();
  }, [projectId, native, reloadNative]);

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

  // Issues one native command; false means the context changed while waiting, so the acknowledgement is ignored.
  const nativeIssue = async (command: MilestoneCommand): Promise<boolean> => {
    const session = sessionRef.current;
    const context = contextRef.current;
    if (!session || !context) throw new Error('The schedule is not ready. Reload and try again.');
    const outstanding = session.pending;
    if (outstanding && JSON.stringify(outstanding.command) !== JSON.stringify(command)) {
      throw new Error('Resolve the pending schedule request first.');
    }
    setBusy(true);
    try {
      await session.issue(outstanding ? outstanding.command : command);
    } catch (error) {
      if (contextRef.current === context) bumpPending((n) => n + 1);
      throw error;
    } finally {
      if (contextRef.current === context) setBusy(false);
    }
    if (contextRef.current !== context) return false;
    bumpPending((n) => n + 1);
    // A reload failure here must not turn a committed mutation into a failed save.
    await reloadNative(session, context);
    return contextRef.current === context;
  };

  const runAction = async (command: MilestoneCommand) => {
    const context=contextRef.current;
    setActionError(null);
    try {
      await nativeIssue(command);
    } catch (error) {
      if(contextRef.current===context)setActionError(errorText(error, 'Failed to update the schedule'));
    }
  };

  const handleResolvePending = async () => {
    const session = sessionRef.current;
    const context = contextRef.current;
    if (!session || !context) return;
    setActionError(null);
    setBusy(true);
    try {
      await session.resolve();
      if (contextRef.current !== context) return;
      await reloadNative(session, context);
    } catch (error) {
      if (contextRef.current === context) setActionError(errorText(error, 'Could not resolve the pending request'));
    } finally {
      if (contextRef.current === context) {
        setBusy(false);
        bumpPending((n) => n + 1);
      }
    }
  };

  const handleReopenPending = () => {
    const command = sessionRef.current?.pending?.command;
    if (!command) return;
    setActionError(null);
    if (command.kind === 'add') {
      setEditingMilestone(null);
      setAddDialogOpen(true);
    } else if (command.kind === 'edit') {
      const existing = milestones.find((m) => m.id === command.milestone_id);
      setEditingMilestone(existing ?? ({ id: command.milestone_id, name: '', currentPlannedEndDate: '', status: 'not-started' } as unknown as Milestone));
      setAddDialogOpen(true);
    }
  };

  const handleRetryPending = async () => {
    const command = sessionRef.current?.pending?.command;
    if (command) await runAction(command);
  };

  const handleLockBaseline = async () => {
    if (!user || legacyLocked) return;

    setLockingBaseline(true);
    setBaselineError(null);

    if (native) {
      const context = contextRef.current;
      try {
        if (await nativeIssue({ kind: 'baseline_lock' })) setLockBaselineDialogOpen(false);
      } catch (error) {
        if (contextRef.current === context) setBaselineError(errorText(error, 'Failed to lock baseline'));
      } finally {
        if (contextRef.current === context) setLockingBaseline(false);
      }
      return;
    }

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
    if (!user || !project?.deadline || legacyLocked) return;

    setApplyingTemplate(true);
    setTemplateError(null);

    if (native) {
      const context = contextRef.current;
      try {
        if (await nativeIssue({ kind: 'template',time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone })) setTemplateDialogOpen(false);
      } catch (error) {
        if (contextRef.current === context) setTemplateError(errorText(error, 'Failed to apply template'));
      } finally {
        if (contextRef.current === context) setApplyingTemplate(false);
      }
      return;
    }

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
    if (legacyLocked) return;
    setEditingMilestone(milestone);
    setAddDialogOpen(true);
  };

  const handleStatusChange = async (milestoneId: string, status: MilestoneStatus) => {
    if (legacyLocked) return;
    if (native) {
      await runAction({ kind: 'status', milestone_id: milestoneId, status });
      return;
    }
    try {
      await updateMilestoneStatus(projectId, milestoneId, status);
    } catch (error) {
      console.error('Failed to update milestone status:', error);
    }
  };

  const handleDeleteMilestone = async (milestoneId: string) => {
    if (legacyLocked || !confirm('Are you sure you want to delete this milestone?')) return;
    if (native) {
      await runAction({ kind: 'delete', milestone_id: milestoneId });
      return;
    }
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

  const nativeContext: NativeMilestoneContext | undefined = native && nativeReady
    ? {
        canMutate: canEdit,
        isCurrent: () => contextRef.current !== null && sessionRef.current !== null,
        scheduleVersion: snapshot!.schedule_version,
        pendingCommand: () => sessionRef.current?.pending?.command ?? null,
        issue: async (command) => {
          setActionError(null);
          return nativeIssue(command);
        },
      }
    : undefined;

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
          {(!native || nativeReady) && !isBaselined && milestones.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setLockBaselineDialogOpen(true)}
              disabled={!canMutate}
              className="gap-2"
            >
              <Lock size={16} />
              Lock Baseline
            </Button>
          )}
          {(!native || nativeReady) && (
            <Button onClick={() => setAddDialogOpen(true)} disabled={!canMutate} className="gap-2">
              <Plus size={16} />
              Add Milestone
            </Button>
          )}
        </div>
      </div>

      {legacyLocked && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Schedule editing is temporarily unavailable here. Reopen the project to use its safe schedule actions.</AlertDescription>
        </Alert>
      )}

      {native && nativeError && (
        <Alert variant="destructive">
          <AlertDescription>
            {nativeError}
            {' '}
            {sessionRef.current && (
              <Button variant="outline" size="sm" onClick={() => contextRef.current && void reloadNative(sessionRef.current!, contextRef.current)}>
                Reload schedule
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {native && actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {native && pending && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Resolve the pending schedule request</strong> ({pending.command.kind}) before making other changes. Its outcome was not confirmed.
            <div className="flex gap-2 mt-2">
              {canEdit && (pending.command.kind === 'add' || pending.command.kind === 'edit') && (
                <Button variant="outline" size="sm" disabled={busy} onClick={handleReopenPending}>Reopen pending request</Button>
              )}
              {canEdit && pending.command.kind !== 'add' && pending.command.kind !== 'edit' && (
                <Button variant="outline" size="sm" disabled={busy} onClick={handleRetryPending}>Retry pending request</Button>
              )}
              <Button variant="outline" size="sm" disabled={busy} onClick={handleResolvePending}>Resolve pending schedule request</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Baseline status banner */}
      {(!native || nativeReady) && !isBaselined && milestones.length > 0 && (
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
      {isLoading || (native && !nativeReady) ? (
        <div className="text-center py-8 text-gray-500">{native && nativeError && !nativeReady ? 'Schedule unavailable.' : 'Loading milestones...'}</div>
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
                  disabled={!canMutate}
                  className="gap-2"
                >
                  <FileText size={16} />
                  Apply Template
                </Button>
              )}
              <Button onClick={() => setAddDialogOpen(true)} disabled={!canMutate} className="gap-2">
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
          onEdit={canMutate ? handleEditMilestone : undefined}
          onStatusChange={canMutate ? handleStatusChange : undefined}
          onDelete={canMutate ? handleDeleteMilestone : undefined}
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
        native={nativeContext}
        key={native ? `${projectId}:${uid}` : undefined}
      />

      {/* Lock Baseline Confirmation Dialog */}
      <AlertDialog open={lockBaselineDialogOpen} onOpenChange={value=>{if(!native||!lockingBaseline)setLockBaselineDialogOpen(value);}}>
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
              onClick={event=>{if(native)event.preventDefault();void handleLockBaseline();}}
              disabled={lockingBaseline}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {lockingBaseline ? 'Locking...' : 'Lock Baseline'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply Template Confirmation Dialog */}
      <AlertDialog open={templateDialogOpen} onOpenChange={value=>{if(!native||!applyingTemplate)setTemplateDialogOpen(value);}}>
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
              onClick={event=>{if(native)event.preventDefault();void handleApplyTemplate();}}
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
