import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '@/hooks/useAuth';
import { createNativeProjectWorkspace, hasPendingNativeProjectRestore } from '@/utils/nativeProjectOperations';
import { isNativeProjectLifecycleEnabled } from '@/utils/projectLifecycleAccess';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { isNativeMaterialCommandEnabled } from '@/utils/nativeMaterialCommands';

type Workspace = ReturnType<typeof createNativeProjectWorkspace>;
type ProjectAction = ReturnType<Workspace['capture']>;

interface RestoreProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  action: ProjectAction;
  resolveSaved: boolean;
  onRestored?: () => void;
}

export const RestoreProjectDialog = ({ open, onOpenChange, projectName, action, resolveSaved, onRestored }: RestoreProjectDialogProps) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (resolveSaved) await action.resolve();
      else {
        await action.submit({ kind: 'restore' });
        onRestored?.();
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The restore could not be confirmed.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={value => { if (!busy.current) onOpenChange(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolveSaved ? 'Resolve saved restore?' : 'Restore project?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {resolveSaved
              ? `Check the saved restore request for “${projectName}”. The saved result is returned without changing the project's current status. If no result was recorded, this only cancels the request and will not start a new restore.`
              : `Restore “${projectName}” to Planning? The project and its BOM data will be preserved.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>
            {resolveSaved ? 'Resolve saved restore' : 'Restore project'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface RestoreProjectActionProps {
  projectId: string;
  projectName: string;
  projectStatus?: string;
  enabled?: boolean;
  onRestored?: () => void;
}

/** Loads the server capability before exposing restore or saved-request recovery. */
export const RestoreProjectAction = ({ projectId, projectName, projectStatus = 'Archived', enabled = true, onRestored }: RestoreProjectActionProps) => {
  const { user } = useAuth();
  const canStartRestore = enabled && (isNativeProjectLifecycleEnabled() || (!isScopedProjectReadEnabled() && isNativeMaterialCommandEnabled()));
  const workspaceRef = useRef<Workspace | null>(null);
  const contextRef = useRef('');
  contextRef.current = JSON.stringify([enabled, projectId, user?.uid]);
  const [loaded, setLoaded] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [canResolve, setCanResolve] = useState(false);
  const [resolveSaved, setResolveSaved] = useState(false);
  const [action, setAction] = useState<ProjectAction | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState(projectName);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(false);
    setCanRestore(false);
    setCanResolve(false);
    setResolveSaved(false);
    setAction(null);
    setCurrentProjectName(projectName);
    setError(null);
    if (!enabled || !projectId) return;
    if (projectStatus !== 'Archived') {
      const pendingRestore = hasPendingNativeProjectRestore(projectId, user?.uid || '');
      if (pendingRestore.kind === 'absent') return;
      if (pendingRestore.kind === 'error') {
        setError(pendingRestore.message);
        setLoaded(true);
        return;
      }
    }

    const context = contextRef.current;
    const workspace = createNativeProjectWorkspace(projectId, undefined, user?.uid || '');
    workspaceRef.current = workspace;
    workspace.load().then(snapshot => {
      if (contextRef.current !== context || workspaceRef.current !== workspace) return;
      const captured = workspace.capture('restore');
      const hasSavedRestore = captured.pendingCommand?.kind === 'restore';
      const restoreAllowed = canStartRestore && snapshot.permissions.restore && snapshot.project.status === 'Archived';
      const resolveAllowed = hasSavedRestore && snapshot.permissions.restore_resolve;
      setCanRestore(restoreAllowed);
      setCanResolve(resolveAllowed);
      setResolveSaved(resolveAllowed);
      setAction(captured);
      setCurrentProjectName(typeof snapshot.project.projectName === 'string' ? snapshot.project.projectName : projectName);
      setLoaded(true);
    }).catch(cause => {
      if (contextRef.current === context && workspaceRef.current === workspace) {
        setError(cause instanceof Error ? cause.message : 'Unable to check restore access.');
        setLoaded(true);
      }
    });
    return () => {
      workspace.invalidate();
      if (workspaceRef.current === workspace) workspaceRef.current = null;
    };
  }, [canStartRestore, enabled, projectId, projectName, projectStatus, user?.uid]);

  if (!enabled || !loaded) return null;
  if (!action) return error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null;
  if (!canRestore && !canResolve) return null;

  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      {canResolve ? 'Resolve saved restore' : 'Restore'}
    </Button>
    <RestoreProjectDialog
      open={open}
      onOpenChange={setOpen}
      projectName={currentProjectName || 'this project'}
      action={action}
      resolveSaved={resolveSaved}
      onRestored={onRestored}
    />
  </>;
};

export default RestoreProjectDialog;
