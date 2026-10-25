import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createNativeProjectWorkspace, hasPendingNativeProjectArchive } from '@/utils/nativeProjectOperations';
import { isNativeProjectLifecycleEnabled } from '@/utils/projectLifecycleAccess';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { isNativeMaterialCommandEnabled } from '@/utils/nativeMaterialCommands';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ArchiveProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  onNativeArchived?: (project: Awaited<ReturnType<Workspace['load']>>['project']) => Promise<void> | void;
  projectName: string;
  projectId?: string;
}

type Workspace = ReturnType<typeof createNativeProjectWorkspace>;
type Action = ReturnType<Workspace['capture']>;

const ArchiveProjectDialog = ({ open, onOpenChange, onConfirm, onNativeArchived, projectName, projectId }: ArchiveProjectDialogProps) => {
  const { user } = useAuth();
  const native = isNativeProjectLifecycleEnabled() || (!isScopedProjectReadEnabled() && isNativeMaterialCommandEnabled());
  const workspaceRef = useRef<Workspace | null>(null);
  const actionRef = useRef<Action | null>(null);
  const contextRef = useRef('');
  contextRef.current = JSON.stringify([open, projectId, user?.uid, native]);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [resolveSaved, setResolveSaved] = useState(false);
  const [name, setName] = useState(projectName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const context = contextRef.current;
    setReady(false); setPending(false); setResolveSaved(false); setRecoveryOnly(false); setError(null); actionRef.current = null;
    if (!projectId) { setError('Select a project before archiving.'); return; }
    if (!native) {
      const saved = hasPendingNativeProjectArchive(projectId, user?.uid || '');
      if (saved.kind === 'absent') return;
      setRecoveryOnly(true);
      if (saved.kind === 'error') { setError(saved.message); return; }
    }
    const workspace = createNativeProjectWorkspace(projectId, undefined, user?.uid || '');
    workspaceRef.current = workspace;
    workspace.load().then(snapshot => {
      if (contextRef.current !== context || workspaceRef.current !== workspace) return;
      setName(typeof snapshot.project.projectName === 'string' ? snapshot.project.projectName : projectName);
      const action = workspace.recover('archive') ?? workspace.capture('archive');
      actionRef.current = action;
      const hasPending = action.pendingCommand?.kind === 'archive';
      if (hasPending && snapshot.permissions.restore_resolve) {
        setRecoveryOnly(!native);
        setResolveSaved(true); setReady(true); return;
      }
      if (!native) return;
      if (!snapshot.permissions.edit || snapshot.project.status === 'Archived') {
        setError('Project archiving is not enabled for this account here.'); return;
      }
      setReady(true);
    }).catch(cause => {
      if (contextRef.current === context && workspaceRef.current === workspace) setError(cause instanceof Error ? cause.message : 'Unable to check archive access.');
    });
    return () => { workspace.invalidate(); if (workspaceRef.current === workspace) workspaceRef.current = null; };
  }, [native, open, projectId, projectName, user?.uid]);

  const finishCommitted = async (action: Action, workspace: Workspace, context: string) => {
    if (contextRef.current !== context || workspaceRef.current !== workspace) return false;
    const refreshed = await workspace.load();
    if (contextRef.current !== context || workspaceRef.current !== workspace) return false;
    const statuses: readonly string[] = ['Planning', 'Procurement', 'Ongoing', 'Delayed', 'Completed', 'Archived'];
    if (refreshed.project.projectId !== projectId || typeof refreshed.project.status !== 'string' || !statuses.includes(refreshed.project.status)) {
      throw new Error('The archive was confirmed, but the current project could not be refreshed. Retry resolution before continuing.');
    }
    if (onNativeArchived) await onNativeArchived(refreshed.project);
    if (contextRef.current !== context || workspaceRef.current !== workspace) return false;
    await action.acknowledge();
    return true;
  };

  const nativeFlow = native || recoveryOnly;
  const archive = async (event: React.MouseEvent) => {
    if (!nativeFlow) { onConfirm(); return; }
    event.preventDefault();
    if (busy.current || !ready || !actionRef.current) return;
    const context = contextRef.current, workspace = workspaceRef.current, action = actionRef.current;
    busy.current = true; setPending(true); setError(null);
    try {
      if (resolveSaved) {
        const result = await action.resolve();
        if (contextRef.current !== context || workspaceRef.current !== workspace) return;
        if (result.resolution === 'committed') {
          const reconciled = await finishCommitted(action, workspace!, context);
          if (!reconciled) return;
        }
        if (contextRef.current === context && workspaceRef.current === workspace) onOpenChange(false);
      } else {
        await action.submit({ kind: 'archive' });
        if (contextRef.current !== context || workspaceRef.current !== workspace) return;
        const reconciled = await finishCommitted(action, workspace!, context);
        if (!reconciled) return;
        if (contextRef.current === context && workspaceRef.current === workspace) onOpenChange(false);
      }
    } catch (cause) {
      if (contextRef.current === context && workspaceRef.current === workspace) {
        setError(cause instanceof Error ? cause.message : 'The archive result is unconfirmed.');
        try { setResolveSaved(action.pendingCommand?.kind === 'archive'); } catch { setResolveSaved(true); }
      }
    } finally {
      if (contextRef.current === context && workspaceRef.current === workspace) { busy.current = false; setPending(false); }
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={value => { if (!busy.current) onOpenChange(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolveSaved ? 'Resolve saved archive?' : 'Archive Project?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {resolveSaved
              ? `Check the saved archive request for “${name}”. The saved result is returned without starting another archive.`
              : `This will archive the project “${nativeFlow ? name : projectName}”. The project and its data will be preserved and can be restored later.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(nativeFlow || recoveryOnly) && error && <div role="alert" className="text-sm text-destructive">{error}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={nativeFlow && pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={archive} disabled={nativeFlow && (!ready || pending)}>
            {resolveSaved ? 'Resolve saved archive' : 'Archive'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ArchiveProjectDialog;
export { ArchiveProjectDialog };

interface ArchiveProjectRecoveryActionProps {
  projectId: string;
  projectName: string;
}

/** Keeps committed-but-unconfirmed archive receipts reachable after the row leaves Active. */
export const ArchiveProjectRecoveryAction = ({ projectId, projectName }: ArchiveProjectRecoveryActionProps) => {
  const { user } = useAuth();
  const enabled = true;
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState<ReturnType<typeof hasPendingNativeProjectArchive>>({ kind: 'absent' });
  useEffect(() => {
    setProbe(enabled ? hasPendingNativeProjectArchive(projectId, user?.uid || '') : { kind: 'absent' });
  }, [enabled, open, projectId, user?.uid]);
  if (!enabled || probe.kind === 'absent') return null;
  if (probe.kind === 'error') return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Archive recovery</Button>
    <ArchiveProjectDialog open={open} onOpenChange={setOpen} onConfirm={() => {}} onNativeArchived={() => {}} projectId={projectId} projectName={projectName} />
  </>;
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Resolve saved archive</Button>
    <ArchiveProjectDialog open={open} onOpenChange={setOpen} onConfirm={() => {}} projectId={projectId} projectName={projectName} />
  </>;
};
