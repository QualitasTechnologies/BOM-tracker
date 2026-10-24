import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Trash2, UserPlus, AlertCircle, Bell, BellOff, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import {
  Project,
  ProjectMember,
  ExternalRecipient,
  addProjectMember,
  removeProjectMember,
  updateProjectMemberScope,
  getProject,
  addExternalRecipient,
  removeExternalRecipient,
  toggleExternalRecipientNotifications,
} from '@/utils/projectFirestore';
import { isInternalUser } from '@/utils/accessControl';
import { memberNotificationOperations } from '@/utils/memberNotificationOperations';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { createNativeProjectWorkspace } from '@/utils/nativeProjectOperations';
import { hasPendingNativeProjectMembers } from '@/utils/nativeProjectJournal';

interface NativeAction {
  submit: (command: Record<string, unknown>) => Promise<unknown>;
  resolve?: () => Promise<{ resolution: 'committed' | 'cancelled' }>;
  acknowledge?: () => Promise<void>;
  pendingCommand?: Record<string, unknown>;
}
interface NativeWorkspace {
  load: () => Promise<any>;
  capture: (namespace?: 'members') => NativeAction;
  recover?: (namespace: 'members') => NativeAction | null;
  invalidate: () => void;
}
interface NativePermissions { edit?: boolean; manage_members?: boolean; notifications?: boolean }
type PreferenceContext = { projectId: string; currentUserId: string; native: boolean };
const nativeMessage = (err: any, fallback: string) => (err && err.message) || fallback;

interface AppUserOption {
  uid: string;
  email: string;
  displayName: string;
}

interface ProjectMembersTabProps {
  projectId: string;
  project: Project;
  currentUserId: string;
  isAdmin: boolean;
  categoryNames: string[];
  availableUsers: AppUserOption[];
  onProjectUpdated: (updated: Project) => void;
}

const ProjectMembersTab = ({
  projectId,
  project: inputProject,
  currentUserId,
  isAdmin,
  categoryNames,
  availableUsers,
  onProjectUpdated,
}: ProjectMembersTabProps) => {
  const { toast } = useToast();
  const scopedReads = isScopedProjectReadEnabled();
  const memberJournalProbe = useMemo(() => hasPendingNativeProjectMembers(projectId, currentUserId), [projectId, currentUserId, scopedReads]);
  // Scoped reads omit the raw management fields, so member and recipient edits
  // must use the versioned commands instead of legacy array replacement. The
  // server's own gate still decides whether those commands may write. A saved
  // request also forces native recovery when the local read switch has changed.
  const native = scopedReads || memberJournalProbe.kind !== 'absent';
  const preferenceContext = useRef({ projectId, currentUserId, native, epoch: 0 });
  if (preferenceContext.current.projectId !== projectId || preferenceContext.current.currentUserId !== currentUserId
    || preferenceContext.current.native !== native) {
    preferenceContext.current = { projectId, currentUserId, native, epoch: preferenceContext.current.epoch + 1 };
  }
  const workspaceRef = useRef<NativeWorkspace | null>(null);
  const generationRef = useRef(0);
  // Uncertain native commands stay keyed by their exact command so a retry,
  // even after closing and reopening a dialog, reuses the frozen nonce/revision.
  const retainedRef = useRef<Map<string, NativeAction>>(new Map());
  const dialogActionRef = useRef<NativeAction | null>(null);
  const recoveryActionRef = useRef<NativeAction | null>(null);
  const [nativeProject, setNativeProject] = useState<Project | null>(null);
  const [permissions, setPermissions] = useState<NativePermissions>({});
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingMemberCommand, setPendingMemberCommand] = useState<Record<string, unknown> | null>(null);
  const preferenceGeneration = useRef(0);
  const preferenceBusyRef = useRef(false);
  const preferenceLockRef = useRef(false);
  const [memberPreferences, setMemberPreferences] = useState<Record<string, boolean>>({});
  const [preferenceVersion, setPreferenceVersion] = useState<string | null>(null);
  const [preferenceLoadedContext, setPreferenceLoadedContext] = useState<PreferenceContext | null>(null);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [preferencePending, setPreferencePending] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [projectRefreshFailed, setProjectRefreshFailed] = useState(false);
  const [authoritativeProject, setAuthoritativeProject] = useState<Project | null>(null);
  const publicationEpoch = preferenceContext.current.epoch;
  const publishProject = (updated: Project) => {
    if (preferenceContext.current.epoch !== publicationEpoch) return;
    if (!native) setAuthoritativeProject(updated);
    onProjectUpdated(updated);
  };
  const assertPreferenceContext = (expected: PreferenceContext) => {
    const epoch = preferenceContext.current.epoch;
    const check = () => preferenceContext.current.projectId === expected.projectId
      && preferenceContext.current.currentUserId === expected.currentUserId && preferenceContext.current.native === expected.native
      && preferenceContext.current.epoch === epoch;
    const assert = () => { if (!check()) throw new Error('The project context changed. Reopen it before continuing.'); };
    return Object.assign(assert, { isCurrent: check });
  };
  const refreshPreferences = async (expected: PreferenceContext = preferenceContext.current) => {
    const generation = ++preferenceGeneration.current;
    const assertContext = assertPreferenceContext(expected);
    try {
      const snapshot = await memberNotificationOperations.load(expected.projectId, expected.currentUserId, assertContext);
      assertContext();
      if (generation !== preferenceGeneration.current) return false;
      if (!snapshot || snapshot.project_id !== expected.projectId) throw new Error('The notification service returned an unexpected project.');
      setMemberPreferences(Object.fromEntries(snapshot.preferences.map(item => [item.member_uid, item.notifications_enabled])));
      setPreferenceVersion(snapshot.version);
      setPreferenceLoadedContext(expected);
      setPreferenceReady(true);
      setPreferenceError(null);
      const hasPending = memberNotificationOperations.hasPending(expected.projectId, expected.currentUserId);
      preferenceLockRef.current = hasPending;
      setPreferencePending(hasPending);
      return true;
    } catch (err: any) {
      if (generation === preferenceGeneration.current && preferenceContext.current.projectId === expected.projectId
        && preferenceContext.current.currentUserId === expected.currentUserId && preferenceContext.current.native === expected.native) {
        setPreferenceReady(false);
        setPreferenceError(err?.message || 'Failed to load notification preferences');
      }
      return false;
    }
  };
  const refreshProjectAfterPreference = async (
    expected: PreferenceContext,
    assertContext: (() => void) & { isCurrent: () => boolean }
  ) => {
    try {
      let updated: Project | null;
      if (expected.native) {
        const res = await workspaceRef.current?.load();
        assertContext();
        if (!res || res.ok === false || !res.project) throw new Error((res && res.error) || 'Failed to refresh project');
        updated = res.project;
        setNativeProject(res.project);
        setPermissions(res.permissions || {});
      } else {
        updated = await getProject(expected.projectId, expected.currentUserId, assertContext);
        assertContext();
        if (!updated) throw new Error('Failed to reload the saved project. Retry before editing members.');
        setAuthoritativeProject(updated);
      }
      publishProject(updated);
      setProjectRefreshFailed(false);
    } catch (err) {
      if (assertContext.isCurrent()) setProjectRefreshFailed(true);
      throw err;
    }
  };
  useEffect(() => {
    const expected = { projectId, currentUserId, native };
    preferenceBusyRef.current = false;
    preferenceLockRef.current = false;
    setPreferenceBusy(false);
    setPreferencePending(false);
    setProjectRefreshFailed(false);
    setAuthoritativeProject(null);
    setMemberPreferences({});
    setPreferenceVersion(null);
    setPreferenceLoadedContext(null);
    setPreferenceReady(false);
    setPreferencePending(false);
    setPreferenceError(null);
    void refreshPreferences(expected);
    // Native mode loads its authoritative project through the pinned workspace below.
    if (!native) {
      void refreshProjectAfterPreference(expected, assertPreferenceContext(expected)).catch(err => {
        if (preferenceContext.current.projectId === expected.projectId && preferenceContext.current.currentUserId === expected.currentUserId
          && preferenceContext.current.native === expected.native) {
          setPreferenceError(err?.message || 'Failed to load the saved project. Retry before editing members.');
        }
      });
    }
    return () => { preferenceGeneration.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, projectId, currentUserId]);

  useEffect(() => {
    if (!native) return;
    const generation = ++generationRef.current;
    retainedRef.current = new Map();
    dialogActionRef.current = null;
    recoveryActionRef.current = null;
    setPending(false);
    setPendingMemberCommand(null);
    setNativeProject(null);
    setNativeError(memberJournalProbe.kind === 'error' ? memberJournalProbe.message : null);
    setActionError(null);
    setAddOpen(false);
    setEditMember(null);
    setExtOpen(false);
    let workspace: NativeWorkspace;
    try {
      workspace = createNativeProjectWorkspace(projectId, undefined, currentUserId) as NativeWorkspace;
    } catch (err) {
      setNativeError(nativeMessage(err, 'Native project controls are unavailable'));
      return;
    }
    workspaceRef.current = workspace;
    workspace.load().then(
      res => {
        if (generation !== generationRef.current) return;
        if (!res || res.ok === false || !res.project) {
          setNativeError((res && res.error) || 'Failed to load project members');
          return;
        }
        setNativeProject(res.project);
        setPermissions(res.permissions || {});
        try {
          const recovery = workspace.recover?.('members') || null;
          recoveryActionRef.current = recovery;
          setPendingMemberCommand(recovery?.pendingCommand || null);
        } catch (err) {
          setNativeError(nativeMessage(err, 'The saved access change could not be read. Restore browser session storage before editing.'));
        }
      },
      err => {
        if (generation === generationRef.current) setNativeError(nativeMessage(err, 'Failed to load project members'));
      }
    );
    return () => {
      generationRef.current++;
      workspace.invalidate();
      if (workspaceRef.current === workspace) workspaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, projectId, currentUserId]);

  // Native mode never falls back to the scoped prop's roster: a projected roster
  // must not be mistaken for the authoritative management view.
  const project: Project = native
    ? (nativeProject || ({ ...inputProject, members: [], memberIds: [], externalRecipients: [] } as Project))
    : (authoritativeProject || inputProject);
  const nativeReady = !native || (!!nativeProject && !nativeError);
  const nativeManageDenied = native && nativeReady && permissions.manage_members === false;
  const members: ProjectMember[] = project.members || [];
  const preferenceContextMatches = preferenceLoadedContext?.projectId === projectId && preferenceLoadedContext.currentUserId === currentUserId
    && preferenceLoadedContext.native === native;
  const externalRecipients: ExternalRecipient[] = project.externalRecipients || [];

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUserOption | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Edit scope dialog
  const [editMember, setEditMember] = useState<ProjectMember | null>(null);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Add external recipient dialog
  const [extOpen, setExtOpen] = useState(false);
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [extAdding, setExtAdding] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  // Send digest
  const [sendingDigest, setSendingDigest] = useState(false);

  const memberIds = project.memberIds || [];
  const nonMembers = availableUsers.filter(u => !memberIds.includes(u.uid));
  const isExternal = (email: string) => !isInternalUser(email);

  const toggleCategory = (
    cat: string,
    checked: boolean,
    list: string[],
    setList: (v: string[]) => void
  ) => setList(checked ? [...list, cat] : list.filter(c => c !== cat));

  const captureAction = (): NativeAction | null => {
    const ws = workspaceRef.current;
    if (!ws || !nativeProject) return null;
    return ws.capture('members');
  };

  // Runs one native command. The captured action (nonce, opening revision,
  // frozen command) is retained on any failure, including a failed post-save
  // refresh, so a retry replays the same request instead of rebasing it.
  const runNative = async (command: Record<string, unknown>, dialogAction?: NativeAction | null): Promise<boolean> => {
    const ws = workspaceRef.current;
    if (!ws || preferenceBusyRef.current || preferenceLockRef.current || preferenceBusy || preferencePending) return false;
    const generation = generationRef.current;
    const key = JSON.stringify(command);
    let action: NativeAction | null;
    try { action = retainedRef.current.get(key) || dialogAction || captureAction(); }
    catch (err) {
      const message = nativeMessage(err, 'The saved access change could not be read. Restore browser session storage before editing.');
      setActionError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
      return false;
    }
    if (!action) return false;
    if (pendingMemberCommand && action !== recoveryActionRef.current) return false;
    retainedRef.current.set(key, action);
    preferenceBusyRef.current = true;
    setPending(true);
    setActionError(null);
    try {
      await action.submit(command);
      const res = await ws.load();
      if (generation !== generationRef.current) return false;
      if (!res || res.ok === false || !res.project) throw new Error((res && res.error) || 'Failed to refresh project');
      retainedRef.current.delete(key);
      setNativeProject(res.project);
      setPermissions(res.permissions || {});
      publishProject(res.project);
      if (!await refreshPreferences({ projectId, currentUserId, native })) throw new Error('Project refreshed, but notifications could not be refreshed. Retry the saved request to confirm it.');
      await action.acknowledge?.();
      recoveryActionRef.current = null;
      setPendingMemberCommand(null);
      return true;
    } catch (err) {
      if (generation === generationRef.current) {
        try {
          if (action.pendingCommand) {
            recoveryActionRef.current = action;
            setPendingMemberCommand(action.pendingCommand);
          }
        } catch { /* The storage error below remains visible. */ }
        const message = nativeMessage(err, 'Request failed');
        setActionError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
      }
      return false;
    } finally {
      if (generation === generationRef.current) {
        preferenceBusyRef.current = false;
        setPending(false);
      }
    }
  };

  const resolveNativeMemberRequest = async () => {
    const action = recoveryActionRef.current;
    const ws = workspaceRef.current;
    if (!action?.resolve || !ws || pending || preferenceBusyRef.current || preferenceLockRef.current) return;
    const generation = generationRef.current;
    setPending(true);
    setActionError(null);
    try {
      const result = await action.resolve();
      if (generation !== generationRef.current) return;
      const res = await ws.load();
      if (generation !== generationRef.current) return;
      if (!res || res.ok === false || !res.project) throw new Error((res && res.error) || 'Failed to refresh project');
      setNativeProject(res.project);
      setPermissions(res.permissions || {});
      publishProject(res.project);
      if (!await refreshPreferences({ projectId, currentUserId, native })) throw new Error('Project refreshed, but notifications could not be refreshed.');
      recoveryActionRef.current = null;
      retainedRef.current.clear();
      setPendingMemberCommand(null);
      toast({ title: result.resolution === 'committed' ? 'Saved change confirmed' : 'Pending change cancelled' });
    } catch (err) {
      if (generation === generationRef.current) {
        const message = nativeMessage(err, 'Could not check the pending change');
        setActionError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
      }
    } finally {
      if (generation === generationRef.current) setPending(false);
    }
  };

  const pendingCommandLabel = (command: Record<string, unknown>) => {
    const uid = typeof command.user_id === 'string' ? command.user_id : '';
    const member = members.find(row => row.userId === uid);
    const available = availableUsers.find(row => row.uid === uid);
    const target = member?.displayName || available?.displayName || member?.email || available?.email || uid;
    if (command.kind === 'member_add') return `Add project member ${target}`;
    if (command.kind === 'member_remove') return `Remove project member ${target}`;
    if (command.kind === 'member_scope') return `Change category access for ${target} to ${Array.isArray(command.category_scope) && command.category_scope.length ? command.category_scope.join(', ') : 'no categories'}`;
    if (command.kind === 'member_notifications') return `Change notification preference for ${target}`;
    if (command.kind === 'recipient_add') return `Add email recipient ${String(command.email || '')}`;
    if (command.kind === 'recipient_remove') return `Remove email recipient ${String(command.email || '')}`;
    if (command.kind === 'recipient_notifications') return `Change notifications for email recipient ${String(command.email || '')}`;
    return 'A project access change';
  };

  // Dialogs capture their action when opened; a previously retained action for
  // the same exact command still wins in runNative.
  const openNativeDialog = (): boolean => {
    setActionError(null);
    try {
      dialogActionRef.current = captureAction();
      return !!dialogActionRef.current;
    } catch (err) {
      setActionError(nativeMessage(err, 'The saved access change could not be read. Restore browser session storage before editing.'));
      return false;
    }
  };
  const closeNativeDialog = () => { dialogActionRef.current = null; };

  // --- Member handlers ---

  const handleAddOpen = () => {
    setSelectedUser(null);
    setSelectedCategories([]);
    if (native && !openNativeDialog()) return;
    setAddOpen(true);
  };

  const handleUserSelect = (user: AppUserOption) => {
    setSelectedUser(user);
    setUserPickerOpen(false);
    setSelectedCategories([]);
  };

  const handleAdd = async () => {
    if (!selectedUser) return;
    if (native) {
      const command: Record<string, unknown> = {
        kind: 'member_add',
        user_id: selectedUser.uid,
        ...(isExternal(selectedUser.email) ? { category_scope: selectedCategories } : {}),
      };
      if (await runNative(command, dialogActionRef.current)) {
        toast({ title: 'Member added', description: selectedUser.email });
        closeNativeDialog();
        setAddOpen(false);
      }
      return;
    }
    setAdding(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const newMember: ProjectMember = {
        userId: selectedUser.uid,
        email: selectedUser.email,
        displayName: selectedUser.displayName || selectedUser.email,
        addedAt: today,
        addedBy: currentUserId,
        notificationsEnabled: true,
        ...(isExternal(selectedUser.email) ? { categoryScope: selectedCategories } : {}),
      };
      await addProjectMember(projectId, project, newMember);
      publishProject({
        ...project,
        memberIds: [...(project.memberIds || []), selectedUser.uid],
        members: [...(project.members || []), newMember],
      });
      toast({ title: 'Member added', description: selectedUser.email });
      setAddOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to add member', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleEditOpen = (member: ProjectMember) => {
    if (native && !openNativeDialog()) return;
    setEditMember(member);
    setEditCategories(member.categoryScope || []);
  };

  const handleSaveScope = async () => {
    if (!editMember) return;
    if (native) {
      const command = { kind: 'member_scope', user_id: editMember.userId, category_scope: editCategories };
      if (await runNative(command, dialogActionRef.current)) {
        toast({ title: 'Scope updated' });
        closeNativeDialog();
        setEditMember(null);
      }
      return;
    }
    setSaving(true);
    try {
      await updateProjectMemberScope(projectId, project, editMember.userId, editCategories);
      publishProject({
        ...project,
        members: (project.members || []).map(m =>
          m.userId === editMember.userId ? { ...m, categoryScope: editCategories } : m
        ),
      });
      toast({ title: 'Scope updated' });
      setEditMember(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to update scope', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (members.length === 1) {
      toast({ title: 'Cannot remove', description: 'Project must have at least one member.', variant: 'destructive' });
      return;
    }
    if (native) {
      if (await runNative({ kind: 'member_remove', user_id: member.userId })) {
        toast({ title: 'Member removed', description: member.email });
      }
      return;
    }
    try {
      await removeProjectMember(projectId, project, member.userId);
      publishProject({
        ...project,
        memberIds: (project.memberIds || []).filter(id => id !== member.userId),
        members: (project.members || []).filter(m => m.userId !== member.userId),
      });
      toast({ title: 'Member removed', description: member.email });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove member', variant: 'destructive' });
    }
  };

  const handleToggleMemberNotifications = async (member: ProjectMember, enabled: boolean) => {
    if (preferenceLockRef.current || preferenceBusyRef.current || !preferenceReady || !preferenceContextMatches || !preferenceVersion || preferencePending || projectRefreshFailed) return;
    if (!isAdmin && member.userId !== currentUserId) return;
    const expected = { projectId, currentUserId, native };
    const assertContext = assertPreferenceContext(expected);
    preferenceLockRef.current = true;
    preferenceBusyRef.current = true;
    setPreferenceBusy(true);
    setPreferenceError(null);
    try {
      await memberNotificationOperations.setPreference(projectId, member.userId, enabled, preferenceVersion, currentUserId, assertContext);
      assertContext();
      preferenceLockRef.current = false;
      await refreshProjectAfterPreference(expected, assertContext);
      await refreshPreferences(expected);
      assertContext();
    } catch (err: any) {
      if (!assertContext.isCurrent()) return;
      const message = err?.message || 'Failed to update notifications';
      try {
        const hasPending = memberNotificationOperations.hasPending(projectId, currentUserId);
        preferenceLockRef.current = hasPending;
        setPreferencePending(hasPending);
      } catch (storageError: any) { preferenceLockRef.current = true; setPreferenceError(storageError?.message || message); return; }
      setPreferenceError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      if (assertContext.isCurrent()) {
        preferenceBusyRef.current = false;
        setPreferenceBusy(false);
      }
    }
  };

  const handleResolveNotification = async () => {
    const expected = { projectId, currentUserId, native };
    const assertContext = assertPreferenceContext(expected);
    if (preferenceBusyRef.current) return;
    preferenceBusyRef.current = true;
    setPreferenceBusy(true);
    setPreferenceError(null);
    try {
      await memberNotificationOperations.resolvePending(projectId, currentUserId, assertContext);
      assertContext();
      setPreferencePending(false);
      await refreshProjectAfterPreference(expected, assertContext);
      await refreshPreferences(expected);
      assertContext();
    } catch (err: any) {
      if (!assertContext.isCurrent()) return;
      setPreferenceError(err?.message || 'Could not confirm the previous notification update');
    } finally {
      if (assertContext.isCurrent()) {
        preferenceBusyRef.current = false;
        setPreferenceBusy(false);
      }
    }
  };

  const handleRetryPreferenceRefresh = async () => {
    const expected = { projectId, currentUserId, native };
    const assertContext = assertPreferenceContext(expected);
    if (preferenceBusyRef.current) return;
    preferenceBusyRef.current = true;
    preferenceLockRef.current = true;
    setPreferenceBusy(true);
    setPreferenceError(null);
    try {
      await refreshProjectAfterPreference(expected, assertContext);
      await refreshPreferences(expected);
      assertContext();
    } catch (err: any) {
      if (assertContext.isCurrent()) setPreferenceError(err?.message || 'Failed to refresh saved project data');
    } finally {
      if (assertContext.isCurrent()) {
        preferenceBusyRef.current = false;
        preferenceLockRef.current = preferencePending;
        setPreferenceBusy(false);
      }
    }
  };

  // --- External recipient handlers ---

  const handleExtOpen = () => {
    setExtName('');
    setExtEmail('');
    setExtError(null);
    if (native && !openNativeDialog()) return;
    setExtOpen(true);
  };

  const handleAddExternal = async () => {
    if (!extName.trim()) { setExtError('Name is required'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(extEmail.trim())) { setExtError('Enter a valid email'); return; }

    if (native) {
      setExtError(null);
      const command = { kind: 'recipient_add', email: extEmail.trim(), name: extName.trim() };
      if (await runNative(command, dialogActionRef.current)) {
        toast({ title: 'Recipient added', description: extEmail.trim() });
        closeNativeDialog();
        setExtOpen(false);
      }
      return;
    }
    setExtAdding(true);
    setExtError(null);
    try {
      await addExternalRecipient(projectId, project, { name: extName.trim(), email: extEmail.trim() });
      const newRecipient: ExternalRecipient = { name: extName.trim(), email: extEmail.trim(), notificationsEnabled: true };
      publishProject({
        ...project,
        externalRecipients: [...(project.externalRecipients || []), newRecipient],
      });
      toast({ title: 'Recipient added', description: extEmail.trim() });
      setExtOpen(false);
    } catch (err: any) {
      setExtError(err.message || 'Failed to add recipient');
    } finally {
      setExtAdding(false);
    }
  };

  const handleRemoveExternal = async (email: string) => {
    if (native) {
      if (await runNative({ kind: 'recipient_remove', email })) toast({ title: 'Recipient removed' });
      return;
    }
    try {
      await removeExternalRecipient(projectId, project, email);
      publishProject({
        ...project,
        externalRecipients: (project.externalRecipients || []).filter(r => r.email !== email),
      });
      toast({ title: 'Recipient removed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove recipient', variant: 'destructive' });
    }
  };

  const handleToggleExternalNotifications = async (email: string, enabled: boolean) => {
    if (native) {
      await runNative({ kind: 'recipient_notifications', email, enabled });
      return;
    }
    try {
      await toggleExternalRecipientNotifications(projectId, project, email, enabled);
      publishProject({
        ...project,
        externalRecipients: (project.externalRecipients || []).map(r =>
          r.email.toLowerCase() === email.toLowerCase() ? { ...r, notificationsEnabled: enabled } : r
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to update notifications', variant: 'destructive' });
    }
  };

  // --- Send digest ---

  const handleSendDigestNow = async () => {
    const hasRecipients =
      members.some(m => m.notificationsEnabled !== false) ||
      externalRecipients.some(r => r.notificationsEnabled !== false);

    if (!hasRecipients) {
      toast({ title: 'No recipients', description: 'Enable notifications for at least one member.', variant: 'destructive' });
      return;
    }
    setSendingDigest(true);
    try {
      const sendBOMDigest = httpsCallable(functions, 'sendBOMDigestNow');
      await sendBOMDigest({ projectId });
      toast({ title: 'Digest sent' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to send digest', variant: 'destructive' });
    } finally {
      setSendingDigest(false);
    }
  };

  const selectedIsExternal = selectedUser ? isExternal(selectedUser.email) : false;
  const canManageMembers = isAdmin && !pendingMemberCommand && (native ? nativeReady && permissions.manage_members !== false : Boolean(authoritativeProject))
    && !preferenceLockRef.current && !preferenceBusy && !preferencePending && !projectRefreshFailed;
  const canNotifyRecipient = !native || (nativeReady && permissions.notifications !== false);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Members & Notifications</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleSendDigestNow} disabled={sendingDigest}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {sendingDigest ? 'Sending…' : 'Send Update Now'}
            </Button>
          )}
          {canManageMembers && (
            <Button size="sm" onClick={handleAddOpen} disabled={pending}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      {/* Unified table */}
      {native && nativeError && <p role="alert" className="text-sm text-destructive">{nativeError}</p>}
      {native && actionError && !addOpen && !editMember && !extOpen && (
        <p role="alert" className="text-sm text-destructive">{actionError}</p>
      )}
      {native && isAdmin && nativeManageDenied && (
        <p role="status" className="text-sm text-muted-foreground">
          Member and recipient editing is currently unavailable for this project. Existing access is unchanged.
        </p>
      )}
      {native && !nativeError && !nativeProject && (
        <p className="text-sm text-muted-foreground">Loading project members…</p>
      )}
      {native && pendingMemberCommand && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-2" role="status">
          <p className="font-medium">A project access change still needs confirmation.</p>
          <p className="text-sm">{pendingCommandLabel(pendingMemberCommand)}</p>
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => void runNative(pendingMemberCommand, recoveryActionRef.current)}>
              {pending ? 'Checking…' : 'Retry saved change'}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void resolveNativeMemberRequest()}>
              Check outcome or cancel
            </Button>
          </div>
        </div>
      )}
      {preferenceError && <p role="alert" className="text-sm text-destructive">{preferenceError}</p>}
      {preferencePending && preferenceContextMatches && (
        <div className="flex items-center gap-2 text-sm" role="status">
          <span>The previous notification update is unconfirmed.</span>
          <Button variant="outline" size="sm" onClick={handleResolveNotification} disabled={preferenceBusy}>Check previous update</Button>
        </div>
      )}
      {preferenceError && !preferencePending && (
        <Button variant="outline" size="sm" onClick={handleRetryPreferenceRefresh} disabled={preferenceBusy}>Refresh saved project and preferences</Button>
      )}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Email</th>
              <th className="text-center px-4 py-2.5 font-medium">
                <span className="flex items-center justify-center gap-1"><Bell className="h-3.5 w-3.5" /> Notify</span>
              </th>
              {canManageMembers && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map(member => {
              const external = isExternal(member.email);
              const isSelf = member.userId === currentUserId;
              const notifOn = isAdmin || isSelf
                ? preferenceContextMatches && memberPreferences[member.userId] === true
                : member.notificationsEnabled !== false;
              return (
                <tr key={member.userId} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{member.displayName || member.email}</span>
                      {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                      {external && <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">Partner</Badge>}
                    </div>
                    {external && member.categoryScope && member.categoryScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {member.categoryScope.map(cat => (
                          <Badge key={cat} variant="outline" className="text-xs px-1 py-0">{cat}</Badge>
                        ))}
                      </div>
                    )}
                    {external && (!member.categoryScope || member.categoryScope.length === 0) && (
                      <span className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3" /> No categories scoped
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground sm:hidden">{member.email}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{member.email}</td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={notifOn}
                      onCheckedChange={enabled => handleToggleMemberNotifications(member, enabled)}
                      disabled={!preferenceReady || !preferenceContextMatches || !!preferenceError || preferenceBusy || preferencePending || pending || !!pendingMemberCommand || (!isAdmin && !isSelf)}
                      aria-label={notifOn ? 'Disable notifications' : 'Enable notifications'}
                    />
                  </td>
                  {canManageMembers && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {external && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit category scope" onClick={() => handleEditOpen(member)} disabled={pending}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Remove member"
                          onClick={() => handleRemove(member)}
                          disabled={pending || (isSelf && members.length === 1)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {externalRecipients.map(r => (
              <tr key={r.email} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Email only
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground sm:hidden">{r.email}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.email}</td>
                <td className="px-4 py-3 text-center">
                  <Switch
                    checked={r.notificationsEnabled !== false}
                    onCheckedChange={enabled => handleToggleExternalNotifications(r.email, enabled)}
                    disabled={!canNotifyRecipient || pending || !!pendingMemberCommand || preferenceBusy || preferencePending}
                    aria-label="Toggle notifications"
                  />
                </td>
                {canManageMembers && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Remove recipient"
                        onClick={() => handleRemoveExternal(r.email)}
                        disabled={pending || preferenceBusy || preferencePending || preferenceLockRef.current}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {members.length === 0 && externalRecipients.length === 0 && (
              <tr>
              <td colSpan={canManageMembers ? 4 : 3} className="px-4 py-8 text-center text-muted-foreground">
                  No members yet. Add members to grant project access.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {canManageMembers && (
          <div className="px-4 py-2 border-t bg-muted/20 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleExtOpen} disabled={pending} className="text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Add email-only recipient
            </Button>
          </div>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={o => { if (!pending) setAddOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {native && actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">User</Label>
              <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm">
                    {selectedUser ? (
                      <span>{selectedUser.displayName || selectedUser.email} <span className="text-muted-foreground">({selectedUser.email})</span></span>
                    ) : (
                      <span className="text-muted-foreground">Search users…</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name or email…" />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {nonMembers.map(u => (
                          <CommandItem key={u.uid} onSelect={() => handleUserSelect(u)}>
                            <div>
                              <div className="text-sm font-medium">{u.displayName || u.email}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedUser && selectedIsExternal && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Categories (partner access)</Label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-md p-2">
                  {categoryNames.map(cat => (
                    <div key={cat} className="flex items-center gap-2">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={selectedCategories.includes(cat)}
                        onCheckedChange={checked => toggleCategory(cat, !!checked, selectedCategories, setSelectedCategories)}
                      />
                      <label htmlFor={`cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                    </div>
                  ))}
                </div>
                {selectedCategories.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => { closeNativeDialog(); setAddOpen(false); }}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!selectedUser || adding || pending}>
              {adding || pending ? 'Adding…' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Scope Dialog */}
      <Dialog open={!!editMember} onOpenChange={o => { if (!o && !pending) { closeNativeDialog(); setEditMember(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category Scope — {editMember?.displayName || editMember?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {native && actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <Label className="text-sm font-medium">Categories this partner can access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded-md p-2">
              {categoryNames.map(cat => (
                <div key={cat} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-cat-${cat}`}
                    checked={editCategories.includes(cat)}
                    onCheckedChange={checked => toggleCategory(cat, !!checked, editCategories, setEditCategories)}
                  />
                  <label htmlFor={`edit-cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                </div>
              ))}
            </div>
            {editCategories.length === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => { closeNativeDialog(); setEditMember(null); }}>Cancel</Button>
            <Button onClick={handleSaveScope} disabled={saving || pending}>{saving || pending ? 'Saving…' : 'Save Scope'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add External Recipient Dialog */}
      <Dialog open={extOpen} onOpenChange={o => { if (!pending) { if (!o) closeNativeDialog(); setExtOpen(o); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Email-Only Recipient</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This person has no BOM Tracker account. They will receive BOM notification emails only.
            </p>
            {extError && <p className="text-sm text-destructive">{extError}</p>}
            {native && actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="ext-name">Name</Label>
              <Input id="ext-name" value={extName} onChange={e => setExtName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ext-email">Email</Label>
              <Input id="ext-email" type="email" value={extEmail} onChange={e => setExtEmail(e.target.value)} placeholder="contact@company.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => { closeNativeDialog(); setExtOpen(false); }}>Cancel</Button>
            <Button onClick={handleAddExternal} disabled={extAdding || pending || !extName.trim() || !extEmail.trim()}>
              {extAdding || pending ? 'Adding…' : 'Add Recipient'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default ProjectMembersTab;
