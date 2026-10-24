import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MilestoneCard from '../MilestoneCard';

const mocks = vi.hoisted(() => ({ deleteMilestone: vi.fn(), updateMilestoneStatus: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('@/utils/milestoneFirestore', () => ({
  deleteMilestone: (...a: unknown[]) => mocks.deleteMilestone(...a),
  updateMilestoneStatus: (...a: unknown[]) => mocks.updateMilestoneStatus(...a),
  updateMilestoneDate: vi.fn(),
}));
vi.mock('@/utils/delayLogFirestore', () => ({ addDelayLog: vi.fn() }));
vi.mock('../DelayLogDialog', () => ({ default: () => null }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>,
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

const milestone: any = { id: 'm1', name: 'Design', currentPlannedEndDate: '2099-02-01', originalPlannedEndDate: '2099-02-01', status: 'not-started' };
const setup = (native: any) => render(<MilestoneCard milestone={milestone} index={1} isBaselined projectId="p1" onEdit={() => {}} currentDeadline="2099-01-01" native={native} />);

describe('MilestoneCard native', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a status command and no SDK write', async () => {
    const native = { canMutate: true, isCurrent: () => true, issue: vi.fn().mockResolvedValue(true) };
    setup(native);
    await act(async () => { fireEvent.click(screen.getByText(/Mark Completed|Completed/)); });
    expect(native.issue).toHaveBeenCalledWith({ kind: 'status', milestone_id: 'm1', status: 'completed' });
    expect(mocks.updateMilestoneStatus).not.toHaveBeenCalled();
  });

  it('keeps the delete confirmation open with the error when the command fails, never using the SDK', async () => {
    const native = { canMutate: true, isCurrent: () => true, issue: vi.fn().mockRejectedValue(new Error('not confirmed')) };
    setup(native);
    await act(async () => { fireEvent.click(screen.getByText('Delete', { selector: 'button' })); });
    await act(async () => { fireEvent.click(screen.getAllByText('Delete', { selector: 'button' }).at(-1) as HTMLElement); });
    expect(native.issue).toHaveBeenCalledWith({ kind: 'delete', milestone_id: 'm1' });
    expect(screen.getByText('not confirmed')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(mocks.deleteMilestone).not.toHaveBeenCalled();
  });
});
