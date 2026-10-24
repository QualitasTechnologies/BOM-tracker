import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MilestoneList from '../MilestoneList';

const mocks = vi.hoisted(() => ({
  native: true,
  uid: 'u1',
  load: vi.fn(),
  issue: vi.fn(),
  resolve: vi.fn(),
  pending: null as any,
  factory: vi.fn(),
  legacy: {
    applyMilestoneTemplate: vi.fn(), lockMilestonesBaseline: vi.fn(), validateMilestonesForBaseline: vi.fn(),
    lockProjectBaseline: vi.fn(), addDelayLog: vi.fn(), updateMilestone: vi.fn(), addMilestone: vi.fn(),
    updateMilestoneStatus: vi.fn(), deleteMilestone: vi.fn(), updateMilestoneDate: vi.fn(),
  },
}));

vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: mocks.uid }; } } }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => mocks.native }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: mocks.uid, displayName: 'U' } }) }));
vi.mock('@/utils/nativeMilestoneOperations', () => ({
  createNativeMilestoneSession: (...a: unknown[]) => {
    mocks.factory(...a);
    return { load: mocks.load, issue: mocks.issue, resolve: mocks.resolve, get pending() { return mocks.pending; } };
  },
}));
vi.mock('@/utils/milestoneFirestore', () => ({
  DEFAULT_MILESTONE_TEMPLATE: [{ name: 'Plan', percentageOfTimeline: 25 }],
  subscribeToMilestones: (_p: string, cb: any) => { cb([]); return () => {}; },
  applyMilestoneTemplate: (...a: unknown[]) => mocks.legacy.applyMilestoneTemplate(...a),
  lockMilestonesBaseline: (...a: unknown[]) => mocks.legacy.lockMilestonesBaseline(...a),
  validateMilestonesForBaseline: (...a: unknown[]) => mocks.legacy.validateMilestonesForBaseline(...a),
  updateMilestone: (...a: unknown[]) => mocks.legacy.updateMilestone(...a),
  addMilestone: (...a: unknown[]) => mocks.legacy.addMilestone(...a),
  updateMilestoneStatus: (...a: unknown[]) => mocks.legacy.updateMilestoneStatus(...a),
  deleteMilestone: (...a: unknown[]) => mocks.legacy.deleteMilestone(...a),
  updateMilestoneDate: (...a: unknown[]) => mocks.legacy.updateMilestoneDate(...a),
}));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'p1', deadline: '2099-01-01', isBaselined: false }),
  lockProjectBaseline: (...a: unknown[]) => mocks.legacy.lockProjectBaseline(...a),
}));
vi.mock('@/utils/delayLogFirestore', () => ({
  subscribeToDelayLogs: (_p: string, cb: any) => { cb([]); return () => {}; },
  getDelayStats: vi.fn().mockResolvedValue({ totalDelayDays: 0, internalDays: 0, externalDays: 0 }),
  addDelayLog: (...a: unknown[]) => mocks.legacy.addDelayLog(...a),
}));
vi.mock('../DelayHistoryView', () => ({ default: () => null }));
vi.mock('../MilestoneTableView', () => ({
  default: ({ milestones, onEdit, onStatusChange, onDelete }: any) => (
    <div>
      {milestones.map((m: any) => (
        <div key={m.id}>
          <span>{m.name}</span>
          {onEdit && <button onClick={() => onEdit(m)}>edit-{m.id}</button>}
          {onStatusChange && <button onClick={() => onStatusChange(m.id, 'completed')}>done-{m.id}</button>}
          {onDelete && <button onClick={() => onDelete(m.id)}>del-{m.id}</button>}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: any) => (open ? <div role="alertdialog">{children}</div> : null),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('../DelayLogDialog', () => ({
  default: ({ open, onSubmit, entityId, entityName, previousDate, newDate }: any) =>
    open ? (
      <button onClick={() => onSubmit({ entityType: 'milestone', entityId, entityName, previousDate, newDate, reason: 'Vendor slipped the casting delivery date', attribution: 'external-vendor' })}>submit-delay</button>
    ) : null,
}));

const row = { id: 'm1', name: 'Design', description: 'd', currentPlannedEndDate: '2099-02-01', originalPlannedEndDate: '2099-02-01', status: 'not-started' };
const snap = (over: any = {}, project: any = {}) => ({
  ok: true, project_id: 'p1', project: { projectId: 'p1', deadline: '2099-01-01', isBaselined: false, ...project },
  milestones: [row], project_version: '1:0', schedule_version: 'a'.repeat(64), permissions: { edit: true }, ...over,
});
const ok = (kind: string) => ({ ok: true, project_id: 'p1', operation_id: 'op', kind });
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const mount = async (projectId = 'p1') => { const r = render(<MilestoneList projectId={projectId} />); await settle(); return r; };
const click = async (target: string | RegExp | HTMLElement) => { const el = typeof target === 'string' || target instanceof RegExp ? screen.getByText(target) : target; await act(async () => { fireEvent.click(el); }); await settle(); };
const submitAdd = () => click(screen.getAllByRole('button', { name: 'Add Milestone' }).at(-1) as HTMLElement);
const pendingOf = (command: any) => ({ command, expected_project_version: '1:0', expected_schedule_version: 'a'.repeat(64), operation_id: 'op-p' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = true; mocks.uid = 'u1'; mocks.pending = null;
  mocks.load.mockResolvedValue(snap());
  mocks.issue.mockImplementation(async (c: any) => ok(c.kind));
  mocks.resolve.mockResolvedValue({ ...ok('add'), resolution: 'committed' });
  vi.stubGlobal('confirm', () => true);
});

describe('MilestoneList native schedule', () => {
  it('never falls back to SDK writes when load fails', async () => {
    mocks.load.mockRejectedValue(new Error('offline'));
    await mount();
    expect(screen.getByText(/offline/)).toBeTruthy();
    expect(screen.queryByText('Add Milestone')).toBeNull();
    expect(Object.values(mocks.legacy).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it('locks the baseline with ONE atomic issue and no validate/lock SDK calls', async () => {
    await mount();
    await click('Lock Baseline');
    await click(screen.getAllByRole('button', { name: 'Lock Baseline' }).at(-1) as HTMLElement);
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(1));
    expect(mocks.issue).toHaveBeenCalledWith({ kind: 'baseline_lock' });
    expect(mocks.legacy.validateMilestonesForBaseline).not.toHaveBeenCalled();
    expect(mocks.legacy.lockMilestonesBaseline).not.toHaveBeenCalled();
    expect(mocks.legacy.lockProjectBaseline).not.toHaveBeenCalled();
  });

  it('applies the default template with one issue', async () => {
    mocks.load.mockResolvedValue(snap({ milestones: [] }));
    await mount();
    await click('Apply Template');
    await click(screen.getAllByRole('button', { name: 'Apply Template' }).at(-1) as HTMLElement);
    expect(mocks.issue).toHaveBeenCalledWith({ kind: 'template',time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(mocks.legacy.applyMilestoneTemplate).not.toHaveBeenCalled();
  });

  it('issues matching status and delete commands from the table', async () => {
    await mount();
    await click('done-m1');
    expect(mocks.issue).toHaveBeenLastCalledWith({ kind: 'status', milestone_id: 'm1', status: 'completed' });
    await click('del-m1');
    expect(mocks.issue).toHaveBeenLastCalledWith({ kind: 'delete', milestone_id: 'm1' });
    expect(mocks.legacy.updateMilestoneStatus).not.toHaveBeenCalled();
    expect(mocks.legacy.deleteMilestone).not.toHaveBeenCalled();
  });

  it('saves a baselined date change plus reason as ONE edit and never writes the delay log via SDK', async () => {
    mocks.load.mockResolvedValue(snap({}, { isBaselined: true }));
    await mount();
    await click('edit-m1');
    fireEvent.change(screen.getByLabelText('Planned End Date *'), { target: { value: '2099-03-01' } });
    await click('Save Changes');
    expect(mocks.issue).not.toHaveBeenCalled();
    await click('submit-delay');
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(1));
    const cmd = mocks.issue.mock.calls[0][0];
    expect(cmd.kind).toBe('edit');
    expect(cmd.milestone_id).toBe('m1');
    expect(cmd.patch).toEqual({ name: 'Design', description: 'd', currentPlannedEndDate: '2099-03-01', status: 'not-started' });
    expect(cmd.delay).toEqual({ reason: 'Vendor slipped the casting delivery date', attribution: 'external-vendor' });
    expect(JSON.stringify(cmd)).not.toContain('previousDate');
    expect(mocks.legacy.addDelayLog).not.toHaveBeenCalled();
    expect(mocks.legacy.updateMilestone).not.toHaveBeenCalled();
  });

  it('adds with a stable id and reuses it when retrying after a failure', async () => {
    mocks.issue.mockRejectedValueOnce(new Error('unconfirmed')).mockImplementation(async (c: any) => ok(c.kind));
    await mount();
    await click('Add Milestone');
    fireEvent.change(screen.getByLabelText('Milestone Name *'), { target: { value: 'Build' } });
    fireEvent.change(screen.getByLabelText('Planned End Date *'), { target: { value: '2099-05-01' } });
    await submitAdd();
    expect(screen.getByText(/unconfirmed/)).toBeTruthy();
    await submitAdd();
    const [a, b] = mocks.issue.mock.calls.map((c) => c[0]);
    expect(a.kind).toBe('add');
    expect(a.milestone_id).toBeTruthy();
    expect(b.milestone_id).toBe(a.milestone_id);
    expect(a.input).toEqual({ name: 'Build', currentPlannedEndDate: '2099-05-01', status: 'not-started' });
    expect(mocks.legacy.addMilestone).not.toHaveBeenCalled();
  });

  it('restores a pending add into the form and retries the exact pending command', async () => {
    const command = { kind: 'add', milestone_id: 'fixed-id', input: { name: 'Pending one', description: 'x', currentPlannedEndDate: '2099-06-01' } };
    mocks.pending = pendingOf(command);
    await mount();
    await click('Reopen pending request');
    expect((screen.getByLabelText('Milestone Name *') as HTMLInputElement).value).toBe('Pending one');
    fireEvent.change(screen.getByLabelText('Milestone Name *'), { target: { value: 'Edited after reload' } });
    await submitAdd();
    expect(mocks.issue).toHaveBeenCalledWith(command);
  });

  it('blocks other commands while one is pending and explains', async () => {
    mocks.pending = pendingOf({ kind: 'delete', milestone_id: 'm1' });
    await mount();
    expect(screen.getByText(/Resolve the pending schedule request/i)).toBeTruthy();
    expect(screen.queryByText('done-m1')).toBeNull();
    expect((screen.getByText('Add Milestone').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('resolves the pending request without a new save and reloads', async () => {
    mocks.pending = pendingOf({ kind: 'delete', milestone_id: 'gone' });
    await mount();
    mocks.load.mockClear();
    await click('Resolve pending schedule request');
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalled();
  });

  it('keeps resolve available but disables mutation when permissions.edit is false', async () => {
    mocks.pending = pendingOf({ kind: 'template' });
    mocks.load.mockResolvedValue(snap({ permissions: { edit: false } }));
    await mount();
    expect((screen.getByText('Add Milestone').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Resolve pending schedule request')).toBeTruthy();
  });

  it('ignores a stale acknowledgement after the project changes', async () => {
    let release: (v: any) => void = () => {};
    mocks.issue.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const { rerender } = await mount('p1');
    await click('del-m1');
    rerender(<MilestoneList projectId="p2" />);
    await settle();
    mocks.load.mockClear();
    await act(async () => { release(ok('delete')); await Promise.resolve(); });
    await settle();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.factory.mock.calls.at(-1)?.slice(0, 2)).toEqual(['p2', 'u1']);
  });

  it('does not show an outgoing account failure in the new account workspace',async()=>{
    let reject!:(error:Error)=>void;mocks.issue.mockImplementationOnce(()=>new Promise((_yes,no)=>{reject=no;}));
    const view=await mount();await click('del-m1');mocks.uid='u2';view.rerender(<MilestoneList projectId="p1"/>);await settle();
    await act(async()=>reject(Error('old account save unconfirmed')));await settle();
    expect(screen.queryByText('old account save unconfirmed')).toBeNull();
  });
  it('keeps legacy behaviour when the flag is off', async () => {
    mocks.native = false;
    await mount();
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
