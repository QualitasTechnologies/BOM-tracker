import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MilestoneList from '../MilestoneList';

const mocks = vi.hoisted(() => ({
  native: false, scoped: false, uid: 'u1', rows: [] as any[], load: vi.fn(), issue: vi.fn(), factory: vi.fn(),
  getProject: vi.fn(),
  legacy: {
    applyMilestoneTemplate: vi.fn(), lockMilestonesBaseline: vi.fn(), validateMilestonesForBaseline: vi.fn(), lockProjectBaseline: vi.fn(),
    updateMilestoneStatus: vi.fn(), deleteMilestone: vi.fn(),
  },
}));

vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: mocks.uid }; } } }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => mocks.scoped }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => mocks.native }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: mocks.uid, displayName: 'U' } }) }));
vi.mock('@/utils/nativeMilestoneOperations', () => ({
  createNativeMilestoneSession: (...a: unknown[]) => {
    mocks.factory(...a);
    return { load: mocks.load, issue: mocks.issue, resolve: vi.fn(), pending: null };
  },
}));
vi.mock('@/utils/milestoneFirestore', () => ({
  DEFAULT_MILESTONE_TEMPLATE: [{ name: 'Plan', percentageOfTimeline: 25 }],
  subscribeToMilestones: (_p: string, cb: any) => { cb(mocks.rows); return () => {}; },
  applyMilestoneTemplate: (...a: unknown[]) => mocks.legacy.applyMilestoneTemplate(...a),
  lockMilestonesBaseline: (...a: unknown[]) => mocks.legacy.lockMilestonesBaseline(...a),
  validateMilestonesForBaseline: (...a: unknown[]) => mocks.legacy.validateMilestonesForBaseline(...a),
  updateMilestoneStatus: (...a: unknown[]) => mocks.legacy.updateMilestoneStatus(...a),
  deleteMilestone: (...a: unknown[]) => mocks.legacy.deleteMilestone(...a),
}));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...a: unknown[]) => mocks.getProject(...a),
  lockProjectBaseline: (...a: unknown[]) => mocks.legacy.lockProjectBaseline(...a),
}));
vi.mock('@/utils/delayLogFirestore', () => ({
  subscribeToDelayLogs: (_p: string, cb: any) => { cb([]); return () => {}; },
  getDelayStats: vi.fn().mockResolvedValue({ totalDelayDays: 0, internalDays: 0, externalDays: 0 }),
  addDelayLog: vi.fn(),
}));
vi.mock('../DelayHistoryView', () => ({ default: () => null }));
vi.mock('../AddEditMilestoneDialog', () => ({ default: () => null }));
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

const row = { id: 'm1', name: 'Design', currentPlannedEndDate: '2099-02-01', status: 'not-started' };
const snapshot = (milestones: any[]) => ({
  ok: true, project_id: 'p1', project: { projectId: 'p1', deadline: '2099-01-01', isBaselined: false }, milestones,
  project_version: '1:0', schedule_version: 'a'.repeat(64), permissions: { edit: true },
});
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };
const mount = async () => { const view = render(<MilestoneList projectId="p1" />); await settle(); return view; };
const legacyWrites = () => Object.values(mocks.legacy).flatMap(fn => fn.mock.calls);
const disabled = (name: string) => screen.getAllByRole('button', { name }).every(b => (b as HTMLButtonElement).disabled);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { native: false, scoped: false, uid: 'u1', rows: [row] });
  mocks.getProject.mockResolvedValue({ projectId: 'p1', deadline: '2099-01-01', isBaselined: false });
  mocks.load.mockImplementation(async () => snapshot([row]));
  mocks.issue.mockResolvedValue({ ok: true });
  vi.stubGlobal('confirm', () => true);
});

describe('MilestoneList scoped-read routing', () => {
  it('keeps the original editable legacy controls when scoped reads and native edits are both off', async () => {
    await mount();
    expect(disabled('Lock Baseline')).toBe(false);
    expect(disabled('Add Milestone')).toBe(false);
    expect(screen.getByText('edit-m1')).toBeTruthy();
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
  });

  it('scoped reads alone read the schedule but offer no legacy mutation', async () => {
    mocks.scoped = true;
    await mount();
    expect(screen.getByText('Design')).toBeTruthy();
    expect(disabled('Lock Baseline')).toBe(true);
    expect(disabled('Add Milestone')).toBe(true);
    expect(screen.queryByText('edit-m1')).toBeNull();
    expect(screen.queryByText('done-m1')).toBeNull();
    expect(screen.queryByText('del-m1')).toBeNull();
    expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: /Lock Baseline|Add Milestone/ })) fireEvent.click(button);
    await settle();
    expect(legacyWrites()).toEqual([]);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('scoped reads with no milestones also disable template and add', async () => {
    mocks.scoped = true; mocks.rows = [];
    await mount();
    expect(disabled('Apply Template')).toBe(true);
    expect(disabled('Add Milestone')).toBe(true);
    expect(legacyWrites()).toEqual([]);
  });

  it('scoped reads with native edits use the native session and never the raw project or legacy writers', async () => {
    mocks.scoped = true; mocks.native = true;
    await mount();
    expect(mocks.factory).toHaveBeenCalledOnce();
    expect(mocks.factory.mock.calls[0].slice(0, 2)).toEqual(['p1', 'u1']);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(disabled('Lock Baseline')).toBe(false);
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
    fireEvent.click(screen.getByText('done-m1'));
    await settle();
    expect(mocks.issue).toHaveBeenCalledWith({ kind: 'status', milestone_id: 'm1', status: 'completed' });
    expect(legacyWrites()).toEqual([]);
  });

  it('a denied native read shows the failure and never falls back to the raw project or legacy writers', async () => {
    mocks.scoped = true; mocks.native = true;
    mocks.load.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    await mount();
    expect(screen.getByText(/forbidden/)).toBeTruthy();
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(screen.queryByText('Design')).toBeNull();
    expect(screen.queryByText('edit-m1')).toBeNull();
    expect(legacyWrites()).toEqual([]);
  });

  it('a rejected native command never reaches a legacy writer', async () => {
    mocks.scoped = true; mocks.native = true;
    mocks.issue.mockRejectedValue(new Error('unconfirmed'));
    await mount();
    fireEvent.click(screen.getByText('del-m1'));
    await settle();
    expect(screen.getByText(/unconfirmed/)).toBeTruthy();
    expect(legacyWrites()).toEqual([]);
  });
});
