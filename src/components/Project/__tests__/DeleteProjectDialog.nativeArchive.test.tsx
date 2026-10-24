import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeleteProjectDialog, { ArchiveProjectRecoveryAction } from '../DeleteProjectDialog';

const mocks = vi.hoisted(() => ({
  enabled: true,
  onConfirm: vi.fn(),
  onNativeArchived: vi.fn(),
  onOpenChange: vi.fn(),
  pending: false,
  resolution: 'committed' as 'committed' | 'cancelled',
  archived: false,
  events: [] as string[],
  edit: true,
  resolvePermission: true,
  archiveProbe: { kind: 'absent' } as { kind: 'absent' | 'pending' } | { kind: 'error'; message: string },
  submit: vi.fn(),
  resolve: vi.fn(),
  acknowledge: vi.fn(),
  workspace: {} as any,
  action: {} as any,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => mocks.enabled }));
vi.mock('@/utils/nativeProjectOperations', () => ({
  createNativeProjectWorkspace: () => mocks.workspace,
  hasPendingNativeProjectArchive: () => mocks.archiveProbe,
}));

const renderDialog = () => render(<DeleteProjectDialog open onOpenChange={mocks.onOpenChange} onConfirm={mocks.onConfirm} onNativeArchived={mocks.onNativeArchived} projectId="p1" projectName="Project One" />);

beforeEach(() => {
  vi.clearAllMocks(); mocks.events = [];
  mocks.enabled = true; mocks.pending = false; mocks.resolution = 'committed'; mocks.archived = false; mocks.edit = true; mocks.resolvePermission = true; mocks.archiveProbe = { kind: 'absent' };
  mocks.action = {
    get pendingCommand() { return mocks.pending ? { kind: 'archive' } : undefined; },
    submit: mocks.submit.mockImplementation(async () => { mocks.archived = true; return { ok: true }; }),
    resolve: mocks.resolve.mockImplementation(async () => { if (mocks.resolution === 'committed') mocks.archived = true; return { ok: true, resolution: mocks.resolution }; }),
    acknowledge: mocks.acknowledge.mockImplementation(async () => { mocks.events.push('ack'); }),
  };
  mocks.workspace = {
    load: vi.fn(async () => { if (mocks.archived) mocks.events.push('refresh'); return { project: { projectId: 'p1', projectName: 'Project One', status: mocks.archived ? 'Archived' : 'Planning' }, permissions: { edit: mocks.edit, restore_resolve: mocks.resolvePermission } }; }),
    recover: vi.fn(() => mocks.pending ? mocks.action : null),
    capture: vi.fn(() => mocks.action),
    invalidate: vi.fn(),
  };
});

describe('native project archive dialog', () => {
  it('submits the archive command and acknowledges only after the project list callback', async () => {
    mocks.onNativeArchived.mockImplementation(() => { mocks.events.push('reconcile'); expect(mocks.acknowledge).not.toHaveBeenCalled(); });
    mocks.onOpenChange.mockImplementation(open => { if (!open) mocks.events.push('close'); });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({ kind: 'archive' });
    expect(mocks.onNativeArchived).toHaveBeenCalledOnce();
    expect(mocks.onConfirm).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.events).toEqual(['refresh', 'reconcile', 'ack', 'close']);
  });

  it('reconciles the latest server status if a restore follows the committed archive before refresh', async () => {
    mocks.workspace.load.mockResolvedValueOnce({ project: { projectId: 'p1', projectName: 'Project One', status: 'Planning' }, permissions: { edit: true, restore_resolve: true } })
      .mockResolvedValueOnce({ project: { projectId: 'p1', projectName: 'Project One', status: 'Planning' }, permissions: { edit: true, restore_resolve: true } });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
    expect(mocks.onNativeArchived).toHaveBeenCalledWith(expect.objectContaining({ status: 'Planning' }));
    expect(mocks.onConfirm).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers resolution for a saved archive when writes are closed and refreshes only a committed result', async () => {
    mocks.pending = true; mocks.edit = false;
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve saved archive' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.onNativeArchived).toHaveBeenCalledOnce();
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps a stored archive resolvable after reload when the local write flags are closed', async () => {
    mocks.enabled = false; mocks.pending = true; mocks.edit = false; mocks.archiveProbe = { kind: 'pending' };
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve saved archive' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.onNativeArchived).toHaveBeenCalledOnce();
  });

  it('keeps the archived-row recovery entry visible from the saved journal while local writes are disabled', async () => {
    mocks.enabled = false; mocks.archiveProbe = { kind: 'pending' };
    render(<ArchiveProjectRecoveryAction projectId="p1" projectName="Project One" />);
    expect(await screen.findByRole('button', { name: 'Resolve saved archive' })).toBeInTheDocument();
  });

  it('does not update the project list when resolution confirms cancellation', async () => {
    mocks.pending = true; mocks.edit = false; mocks.resolution = 'cancelled';
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve saved archive' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    expect(mocks.onNativeArchived).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('does not enable native archive when the paired lifecycle gate is off', async () => {
    mocks.enabled = false;
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.onConfirm).toHaveBeenCalledOnce();
  });
});
