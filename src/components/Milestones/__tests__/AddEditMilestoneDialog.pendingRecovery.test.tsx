import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddEditMilestoneDialog from '../AddEditMilestoneDialog';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', displayName: 'U' } }) }));
vi.mock('@/utils/milestoneFirestore', () => ({ addMilestone: vi.fn(), updateMilestone: vi.fn(), updateMilestoneDate: vi.fn() }));
vi.mock('@/utils/delayLogFirestore', () => ({ addDelayLog: vi.fn() }));
vi.mock('@/utils/projectFirestore', () => ({ getProject: vi.fn() }));

const REASON = 'Vendor slipped the casting delivery date';
const milestone: any = { id: 'm1', name: 'Design', description: 'Server copy', currentPlannedEndDate: '2099-02-01', status: 'not-started' };
const state = vi.hoisted(() => ({ pending: null as any, issue: vi.fn() }));
const nativeCtx = () => ({
  canMutate: true,
  isCurrent: () => true,
  scheduleVersion: 'v1',
  pendingCommand: () => state.pending,
  issue: (command: any) => state.issue(command),
});
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise(r => setTimeout(r, 0)); }); };
const open = async (props: Record<string, unknown> = {}) => {
  const view = render(<AddEditMilestoneDialog open onOpenChange={vi.fn()} projectId="P" milestone={null} isBaselined={false} currentDeadline="2099-12-31" native={nativeCtx()} {...props} />);
  await settle();
  return view;
};
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); await settle(); };

const pendingAdd = { expected_project_version: '1:0', expected_schedule_version: 'a'.repeat(64), operation_id: 'op-add', command: { kind: 'add', milestone_id: 'frozen-id', input: { name: 'Frozen plan', description: 'Frozen text', currentPlannedEndDate: '2099-05-05', status: 'in-progress' } } };
const pendingEdit = { expected_project_version: '1:0', expected_schedule_version: 'a'.repeat(64), operation_id: 'op-edit', command: { kind: 'edit', milestone_id: 'm1', patch: { name: 'Frozen design', description: null, currentPlannedEndDate: '2099-03-03', status: 'completed' } } };
const pendingDelay = { ...pendingEdit, operation_id: 'op-delay', command: { ...pendingEdit.command, delay: { reason: REASON, attribution: 'external-vendor' } } };

beforeEach(() => {
  vi.clearAllMocks();
  state.pending = null;
  state.issue.mockImplementation(async () => true);
});

describe('AddEditMilestoneDialog saved native request', () => {
  it('reopens a pending add with its frozen values locked and retries the exact command', async () => {
    state.pending = pendingAdd.command;
    await open();
    expect(field('name').value).toBe('Frozen plan');
    expect(field('description').value).toBe('Frozen text');
    expect(field('endDate').value).toBe('2099-05-05');
    for (const id of ['name', 'description', 'endDate']) expect(field(id).disabled).toBe(true);
    expect(screen.getByText(/awaiting confirmation/i)).toBeTruthy();
    fireEvent.change(field('name'), { target: { value: 'Changed after reopen' } });
    expect(field('name').value).toBe('Frozen plan');
    await click('Add Milestone');
    expect(state.issue).toHaveBeenCalledOnce();
    expect(state.issue.mock.calls[0][0]).toEqual(pendingAdd.command);
  });

  it('reopens a pending edit with every frozen field including status locked', async () => {
    state.pending = pendingEdit.command;
    await open({ milestone });
    expect(field('name').value).toBe('Frozen design');
    expect(field('description').value).toBe('');
    expect(field('endDate').value).toBe('2099-03-03');
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('combobox').textContent).toMatch(/completed/i);
    for (const id of ['name', 'description', 'endDate']) expect(field(id).disabled).toBe(true);
    await click('Save Changes');
    expect(state.issue.mock.calls[0][0]).toEqual(pendingEdit.command);
  });

  it('refuses a changed draft rather than replaying the old values', async () => {
    state.pending = pendingEdit.command;
    const view = await open({ milestone });
    // A stale controlled value that no longer matches the frozen request must never be silently replaced.
    view.rerender(<AddEditMilestoneDialog open onOpenChange={vi.fn()} projectId="P" milestone={{ ...milestone, name: 'Server rename' }} isBaselined={false} currentDeadline="2099-12-31" native={nativeCtx()} />);
    await settle();
    expect(field('name').value).toBe('Frozen design');
    await click('Save Changes');
    expect(state.issue.mock.calls[0][0]).toEqual(pendingEdit.command);
  });

  it('shows the original delay reason and attribution locked when replaying a pending dated edit', async () => {
    state.pending = pendingDelay.command;
    await open({ milestone, isBaselined: true });
    await click('Save Changes');
    const reason = document.getElementById('reason') as HTMLTextAreaElement;
    expect(reason.value).toBe(REASON);
    expect(reason.disabled).toBe(true);
    expect((document.getElementById('external-vendor') as HTMLElement).getAttribute('data-state')).toBe('checked');
    expect(screen.getAllByRole('radio').every(r => r.hasAttribute('disabled') || r.getAttribute('aria-disabled') === 'true' || (r as HTMLButtonElement).disabled)).toBe(true);
    expect(state.issue).not.toHaveBeenCalled();
    await click('Log & Save');
    expect(state.issue).toHaveBeenCalledOnce();
    expect(state.issue.mock.calls[0][0]).toEqual(pendingDelay.command);
  });

  it('locks the nested delay reason after an uncertain save and retries the captured reason only', async () => {
    state.issue.mockImplementationOnce(async (command: any) => {
      state.pending = command;
      throw new Error('outcome unconfirmed');
    });
    await open({ milestone, isBaselined: true });
    fireEvent.change(field('endDate'), { target: { value: '2099-03-03' } });
    await click('Save Changes');
    fireEvent.change(document.getElementById('reason') as HTMLTextAreaElement, { target: { value: REASON } });
    fireEvent.click(document.getElementById('external-vendor') as HTMLElement);
    await click('Log & Save');
    expect(state.issue).toHaveBeenCalledOnce();
    const sent = state.issue.mock.calls[0][0];
    expect(sent.delay).toEqual({ reason: REASON, attribution: 'external-vendor' });
    await waitFor(() => expect((document.getElementById('reason') as HTMLTextAreaElement).disabled).toBe(true));
    fireEvent.change(document.getElementById('reason') as HTMLTextAreaElement, { target: { value: 'A completely different explanation here' } });
    expect((document.getElementById('reason') as HTMLTextAreaElement).value).toBe(REASON);
    await click('Log & Save');
    expect(state.issue).toHaveBeenCalledTimes(2);
    expect(state.issue.mock.calls[1][0]).toEqual(sent);
  });

  it('keeps the normal form editable and sends the visible values when nothing is pending', async () => {
    await open({ milestone });
    for (const id of ['name', 'description', 'endDate']) expect(field(id).disabled).toBe(false);
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/awaiting confirmation/i)).toBeNull();
    fireEvent.change(field('name'), { target: { value: 'Fresh name' } });
    await click('Save Changes');
    expect(state.issue.mock.calls[0][0]).toMatchObject({ kind: 'edit', milestone_id: 'm1', patch: { name: 'Fresh name' } });
  });

  it('guards every field while a save is in flight', async () => {
    let release!: () => void;
    state.issue.mockImplementation(() => new Promise<boolean>(resolve => { release = () => resolve(false); }));
    await open();
    fireEvent.change(field('name'), { target: { value: 'New one' } });
    fireEvent.change(field('endDate'), { target: { value: '2099-07-07' } });
    await click('Add Milestone');
    for (const id of ['name', 'description', 'endDate']) expect(field(id).disabled).toBe(true);
    await act(async () => release());
    await settle();
    for (const id of ['name', 'description', 'endDate']) expect(field(id).disabled).toBe(false);
  });
});
