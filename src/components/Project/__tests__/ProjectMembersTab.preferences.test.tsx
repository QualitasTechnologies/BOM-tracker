import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectMembersTab from '../ProjectMembersTab';
import * as projectFirestore from '@/utils/projectFirestore';
import { httpsCallable } from 'firebase/functions';
import { memberNotificationOperations } from '@/utils/memberNotificationOperations';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@/firebase', () => ({ functions: {} }));
vi.mock('@/utils/projectFirestore', () => ({
  addProjectMember: vi.fn(), removeProjectMember: vi.fn(), updateProjectMemberScope: vi.fn(),
  getProject: vi.fn(), toggleMemberNotifications: vi.fn(), addExternalRecipient: vi.fn(), removeExternalRecipient: vi.fn(),
  toggleExternalRecipientNotifications: vi.fn(),
}));
vi.mock('@/utils/memberNotificationOperations', () => ({ memberNotificationOperations: {
  load: vi.fn(), setPreference: vi.fn(), resolvePending: vi.fn(), hasPending: vi.fn(() => false),
} }));
vi.mock('@/utils/accessControl', () => ({ isInternalUser: (email: string) => email.endsWith('@qualitastech.com') }));

const base: any = {
  memberIds: ['u1', 'p1'],
  members: [
    { userId: 'u1', email: 'a@qualitastech.com', displayName: 'Alice', notificationsEnabled: true },
    { userId: 'p1', email: 'p@partner.com', displayName: 'Pat', notificationsEnabled: true, categoryScope: ['Mech'] },
  ],
  externalRecipients: [{ name: 'Ext', email: 'ext@x.com', notificationsEnabled: true }],
};
const snapshot = (version = '10:2', preferences = [
  { member_uid: 'u1', notifications_enabled: true },
  { member_uid: 'p1', notifications_enabled: true },
]) => ({ ok: true, project_id: 'P1', version, preferences });
const renderTab = (props: Record<string, any> = {}) => render(
  <ProjectMembersTab projectId="P1" project={base} currentUserId="u1" isAdmin categoryNames={['Mech']}
    availableUsers={[]} onProjectUpdated={vi.fn()} {...props} />
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectFirestore.getProject).mockResolvedValue(base);
  vi.mocked(projectFirestore.removeProjectMember).mockResolvedValue(undefined);
  vi.mocked(projectFirestore.toggleExternalRecipientNotifications).mockResolvedValue(undefined);
  vi.mocked(memberNotificationOperations.load).mockResolvedValue(snapshot() as any);
  vi.mocked(memberNotificationOperations.setPreference).mockResolvedValue({ ok: true } as any);
  vi.mocked(memberNotificationOperations.hasPending).mockReturnValue(false);
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ProjectMembersTab versioned notification preferences', () => {
  it('uses the post-preference project snapshot for a later legacy member removal without parent rerender', async () => {
    const fresh = { ...base, members: base.members.map((member: any) => member.userId === 'u1' ? { ...member, notificationsEnabled: false } : member) };
    vi.mocked(projectFirestore.getProject).mockResolvedValueOnce(base).mockResolvedValueOnce(fresh);
    vi.mocked(memberNotificationOperations.load).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot('11:0', [
      { member_uid: 'u1', notifications_enabled: false }, { member_uid: 'p1', notifications_enabled: true },
    ]) as any);
    const onProjectUpdated = vi.fn();
    const user = userEvent.setup();
    renderTab({ onProjectUpdated });
    await screen.findByText('Alice');

    const aliceRow = screen.getByText('Alice').closest('tr')!;
    await user.click(within(aliceRow).getByRole('switch'));
    await waitFor(() => expect(onProjectUpdated).toHaveBeenLastCalledWith(fresh));

    await user.click(screen.getAllByTitle('Remove member')[1]);
    await waitFor(() => expect(projectFirestore.removeProjectMember).toHaveBeenCalledWith('P1', fresh, 'p1'));
  });

  it('preserves the locally removed member through a subsequent recipient notification edit', async () => {
    const onProjectUpdated = vi.fn();
    const user = userEvent.setup();
    renderTab({ onProjectUpdated });
    await screen.findByText('Alice');

    await user.click(screen.getAllByTitle('Remove member')[1]);
    await waitFor(() => expect(projectFirestore.removeProjectMember).toHaveBeenCalledWith('P1', base, 'p1'));
    const locallyUpdated = onProjectUpdated.mock.calls.at(-1)?.[0];
    expect(locallyUpdated.members.map((member: any) => member.userId)).toEqual(['u1']);

    await user.click(screen.getByRole('switch', { name: 'Toggle notifications' }));
    await waitFor(() => expect(projectFirestore.toggleExternalRecipientNotifications).toHaveBeenCalledWith(
      'P1', locallyUpdated, 'ext@x.com', false,
    ));
    expect(onProjectUpdated.mock.calls.at(-1)?.[0].members.map((member: any) => member.userId)).toEqual(['u1']);
  });

  it('lets an external non-admin change only their own preference with the pinned UID and displayed revision', async () => {
    vi.mocked(memberNotificationOperations.load).mockResolvedValue(snapshot('12:34') as any);
    const user = userEvent.setup();
    renderTab({ currentUserId: 'p1', isAdmin: false });
    await screen.findByText('Pat');

    const aliceRow = screen.getByText('Alice').closest('tr')!;
    const patRow = screen.getByText('Pat').closest('tr')!;
    expect((within(aliceRow).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect((within(patRow).getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(patRow).getByRole('switch'));

    await waitFor(() => expect(memberNotificationOperations.setPreference).toHaveBeenCalledWith(
      'P1', 'p1', false, '12:34', 'p1', expect.any(Function),
    ));
    expect(memberNotificationOperations.load).toHaveBeenCalledWith('P1', 'p1', expect.any(Function));
    expect(projectFirestore.toggleMemberNotifications).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  });
});
