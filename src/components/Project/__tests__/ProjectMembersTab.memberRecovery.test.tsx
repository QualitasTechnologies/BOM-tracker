import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectMembersTab from '../ProjectMembersTab';
import { createNativeProjectWorkspace } from '@/utils/nativeProjectOperations';
import { hasPendingNativeProjectMembers } from '@/utils/nativeProjectJournal';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { memberNotificationOperations } from '@/utils/memberNotificationOperations';

vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: vi.fn() }));
vi.mock('@/utils/nativeProjectOperations', () => ({ createNativeProjectWorkspace: vi.fn(), hasPendingNativeProjectMembers: vi.fn() }));
vi.mock('@/utils/nativeProjectJournal', () => ({ hasPendingNativeProjectMembers: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@/firebase', () => ({ functions: {} }));
vi.mock('@/utils/projectFirestore', () => ({
  addProjectMember: vi.fn(), removeProjectMember: vi.fn(), updateProjectMemberScope: vi.fn(), getProject: vi.fn(),
  addExternalRecipient: vi.fn(), removeExternalRecipient: vi.fn(), toggleExternalRecipientNotifications: vi.fn(),
}));
vi.mock('@/utils/memberNotificationOperations', () => ({ memberNotificationOperations: {
  load: vi.fn(), setPreference: vi.fn(), resolvePending: vi.fn(), hasPending: vi.fn(() => false),
} }));
vi.mock('@/utils/accessControl', () => ({ isInternalUser: (email: string) => email.endsWith('@qualitastech.com') }));

const project: any = { memberIds: ['u1'], members: [{ userId: 'u1', email: 'a@qualitastech.com', displayName: 'Alice' }], externalRecipients: [] };
const savedCommand = { kind: 'member_remove', user_id: 'u2' };
const loaded = (permissions = { edit: false, manage_members: false, notifications: false }) => ({
  ok: true, project_id: 'P1', version: '4:2', project, permissions,
});
const onProjectUpdated = vi.fn();
const action = { pendingCommand: savedCommand, submit: vi.fn(), resolve: vi.fn(), acknowledge: vi.fn() };
let load: ReturnType<typeof vi.fn>;
let recover: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(isScopedProjectReadEnabled).mockReturnValue(true);
  vi.mocked(hasPendingNativeProjectMembers).mockReturnValue({ kind: 'absent' });
  load = vi.fn().mockResolvedValue(loaded());
  recover = vi.fn(() => action);
  vi.mocked(createNativeProjectWorkspace).mockReturnValue({ load, recover, capture: vi.fn(), invalidate: vi.fn() } as any);
  vi.mocked(memberNotificationOperations.load).mockResolvedValue({ ok: true, project_id: 'P1', version: '3:0', preferences: [{ member_uid: 'u1', notifications_enabled: true }] } as any);
  action.submit.mockResolvedValue({ ok: true });
  action.resolve.mockResolvedValue({ resolution: 'cancelled' });
});

const renderTab = () => render(<ProjectMembersTab projectId="P1" project={{ id: 'P1' } as any} currentUserId="u1" isAdmin
  categoryNames={[]} availableUsers={[]} onProjectUpdated={onProjectUpdated} />);

it('recovers the saved request even when writes are closed and offers outcome resolution', async () => {
  const user = userEvent.setup(); renderTab();
  expect(await screen.findByText('Remove project member u2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
  await user.click(screen.getByRole('button', { name: /check outcome or cancel/i }));
  await waitFor(() => expect(action.resolve).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText(/still needs confirmation/i)).toBeNull());
  expect(action.submit).not.toHaveBeenCalled();
});

it('keeps pending recovery ahead of a local read-flag rollback', async () => {
  vi.mocked(isScopedProjectReadEnabled).mockReturnValue(false);
  vi.mocked(hasPendingNativeProjectMembers).mockReturnValue({ kind: 'pending' });
  const user = userEvent.setup(); renderTab();
  expect(await screen.findByText('Remove project member u2')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /check outcome or cancel/i }));
  await waitFor(() => expect(action.resolve).toHaveBeenCalledTimes(1));
  expect(action.submit).not.toHaveBeenCalled();
});

it('blocks legacy editing when the local read flag is off and the saved journal is unreadable', async () => {
  vi.mocked(isScopedProjectReadEnabled).mockReturnValue(false);
  vi.mocked(hasPendingNativeProjectMembers).mockReturnValue({ kind: 'error', message: 'A saved access change could not be read.' });
  recover.mockReturnValue(null);
  renderTab();
  expect(await screen.findByText('A saved access change could not be read.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /add email-only recipient/i })).toBeNull();
});

it('keeps the recovery prompt and frozen action when the post-command refresh fails', async () => {
  load.mockResolvedValueOnce(loaded()).mockResolvedValueOnce({ ok: false, error: 'refresh failed' });
  const user = userEvent.setup(); renderTab();
  expect(await screen.findByText('Remove project member u2')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /retry saved change/i }));
  await waitFor(() => expect(action.submit).toHaveBeenCalledWith(savedCommand));
  expect((await screen.findAllByText(/refresh failed/i)).length).toBeGreaterThan(0);
  expect(screen.getByText('Remove project member u2')).toBeTruthy();
  expect(action.acknowledge).not.toHaveBeenCalled();
});

it('keeps self notification preferences on their separate preference service', async () => {
  const user = userEvent.setup(); recover.mockReturnValue(null);
  const { setPreference } = memberNotificationOperations;
  vi.mocked(setPreference).mockResolvedValue({ ok: true } as any);
  renderTab();
  const toggle = await screen.findByRole('switch', { name: 'Disable notifications' });
  await user.click(toggle);
  await waitFor(() => expect(setPreference).toHaveBeenCalledWith('P1', 'u1', false, '3:0', 'u1', expect.any(Function)));
  expect(action.submit).not.toHaveBeenCalled();
});
