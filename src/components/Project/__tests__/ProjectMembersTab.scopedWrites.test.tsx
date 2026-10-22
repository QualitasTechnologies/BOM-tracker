import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectMembersTab from '../ProjectMembersTab';
import { createNativeProjectWorkspace } from '@/utils/nativeProjectOperations';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import * as projectFirestore from '@/utils/projectFirestore';
import { httpsCallable } from 'firebase/functions';
import { memberNotificationOperations } from '@/utils/memberNotificationOperations';

vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: vi.fn() }));
vi.mock('@/utils/nativeProjectOperations', () => ({ createNativeProjectWorkspace: vi.fn() }));
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
vi.mock('@/utils/accessControl', () => ({ isInternalUser: (e: string) => e.endsWith('@qualitastech.com') }));

const base: any = {
  memberIds: ['u1', 'p1'],
  members: [
    { userId: 'u1', email: 'a@qualitastech.com', displayName: 'Alice', notificationsEnabled: true },
    { userId: 'p1', email: 'p@partner.com', displayName: 'Pat', notificationsEnabled: true, categoryScope: ['Mech'] },
  ],
  externalRecipients: [{ name: 'Ext', email: 'ext@x.com', notificationsEnabled: true }],
};
// A scoped DTO omits the raw management fields and may carry a different roster.
const scopedProp: any = { id: 'P1', projectId: 'P1', members: [{ userId: 'stale', email: 'stale@qualitastech.com', displayName: 'Stale' }] };
const users = [
  { uid: 'u2', email: 'b@qualitastech.com', displayName: 'Bob' },
  { uid: 'p2', email: 'q@partner.com', displayName: 'Quinn' },
];
const loaded = (project: any = base, permissions: any = { edit: true, manage_members: true, notifications: true }) =>
  ({ ok: true, project_id: 'P1', version: '3:0', project, permissions });
const notificationSnapshot = () => ({ ok: true, project_id: 'P1', version: '3:0', preferences: [
  { member_uid: 'u1', notifications_enabled: true }, { member_uid: 'p1', notifications_enabled: true },
] });

let submit: ReturnType<typeof vi.fn>;
let capture: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;
let invalidate: ReturnType<typeof vi.fn>;
const onProjectUpdated = vi.fn();

const renderTab = (props: Record<string, any> = {}) =>
  render(
    <ProjectMembersTab projectId="P1" project={scopedProp} currentUserId="u1" isAdmin categoryNames={['Mech', 'Elec']}
      availableUsers={users} onProjectUpdated={onProjectUpdated} {...props} />
  );
const addMember = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('button', { name: /add member/i }));
  await user.click(screen.getByRole('button', { name: /search users/i }));
  await user.click(await screen.findByText(name));
};
const dialogAdd = () => within(screen.getByRole('dialog')).getByRole('button', { name: /^add member$/i });
const legacyHelpersUntouched = () => Object.values(projectFirestore).forEach(fn => expect(fn).not.toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(isScopedProjectReadEnabled).mockReturnValue(true);
  submit = vi.fn().mockResolvedValue({ ok: true });
  capture = vi.fn(() => ({ submit }));
  load = vi.fn().mockResolvedValue(loaded());
  invalidate = vi.fn();
  vi.mocked(createNativeProjectWorkspace).mockReturnValue({ load, capture, invalidate } as any);
  vi.mocked(memberNotificationOperations.load).mockResolvedValue(notificationSnapshot() as any);
  vi.mocked(memberNotificationOperations.setPreference).mockResolvedValue({ ok: true } as any);
  vi.mocked(memberNotificationOperations.hasPending).mockReturnValue(false);
});

describe('ProjectMembersTab under scoped project reads', () => {
  it('shows only the server management view, never the scoped prop roster, and writes through no legacy helper', async () => {
    renderTab();
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Stale')).toBeNull();
    expect(createNativeProjectWorkspace).toHaveBeenCalledWith('P1', undefined, 'u1');
    legacyHelpersUntouched();
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(projectFirestore.getProject).not.toHaveBeenCalled();
  });

  it('keeps admin controls hidden and the roster empty until the server view has loaded', async () => {
    load.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(await screen.findByText(/loading project members/i)).toBeTruthy();
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add email-only recipient/i })).toBeNull();
  });

  it('adds an internal member as an exact delta, then publishes the refreshed server project', async () => {
    const after = { ...base, memberIds: [...base.memberIds, 'u2'] };
    load.mockResolvedValueOnce(loaded()).mockResolvedValueOnce(loaded(after));
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await addMember(user, 'Bob');
    await user.click(dialogAdd());
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ kind: 'member_add', user_id: 'u2' }));
    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledWith(after));
    expect(capture).toHaveBeenCalledTimes(1);
    legacyHelpersUntouched();
  });

  it('adds a partner with only the chosen categories and edits scope as a delta', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await addMember(user, 'Quinn');
    await user.click(screen.getByLabelText('Elec'));
    await user.click(dialogAdd());
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ kind: 'member_add', user_id: 'p2', category_scope: ['Elec'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByTitle('Edit category scope'));
    await user.click(screen.getByLabelText('Elec'));
    await user.click(screen.getByRole('button', { name: /save scope/i }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ kind: 'member_scope', user_id: 'p1', category_scope: ['Mech', 'Elec'] }));
    legacyHelpersUntouched();
  });

  it('removes members and manages recipients only through versioned commands', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await user.click(screen.getAllByTitle('Remove member')[1]);
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ kind: 'member_remove', user_id: 'p1' }));
    await user.click(screen.getByRole('switch', { name: 'Toggle notifications' }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ kind: 'recipient_notifications', email: 'ext@x.com', enabled: false }));
    await user.click(screen.getByTitle('Remove recipient'));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ kind: 'recipient_remove', email: 'ext@x.com' }));
    await user.click(screen.getByRole('button', { name: /add email-only recipient/i }));
    await user.type(screen.getByLabelText('Name'), ' Zed ');
    await user.type(screen.getByLabelText('Email'), 'z@z.com');
    await user.click(screen.getByRole('button', { name: /add recipient/i }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ kind: 'recipient_add', email: 'z@z.com', name: 'Zed' }));
    legacyHelpersUntouched();
  });

  it('does not remove the last member and sends nothing', async () => {
    load.mockResolvedValue(loaded({ ...base, memberIds: ['u1'], members: [base.members[0]] }));
    const user = userEvent.setup();
    renderTab({ currentUserId: 'someone-else' });
    await screen.findByText('Alice');
    await user.click(screen.getByTitle('Remove member'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('retains the frozen action after a lost reply and reuses it on retry', async () => {
    submit.mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await addMember(user, 'Bob');
    await user.click(dialogAdd());
    expect((await screen.findAllByText(/network lost/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(dialogAdd());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('reuses the original nonce when an uncertain dialog request is retried after closing and reopening the dialog', async () => {
    const actions: Array<{ submit: ReturnType<typeof vi.fn> }> = [];
    capture.mockImplementation(() => {
      const action = { submit: vi.fn().mockResolvedValue({ ok: true }) };
      if (!actions.length) action.submit.mockRejectedValueOnce(new Error('network lost'));
      actions.push(action);
      return action;
    });
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await addMember(user, 'Bob');
    await user.click(dialogAdd());
    await screen.findAllByText(/network lost/);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await addMember(user, 'Bob');
    await user.click(dialogAdd());
    await waitFor(() => expect(actions[0].submit).toHaveBeenCalledTimes(2));
    // The reopened dialog captured a fresh action, but it must never carry the request.
    expect(actions[1]?.submit).not.toHaveBeenCalled();
    expect(actions[0].submit.mock.calls[1][0]).toEqual({ kind: 'member_add', user_id: 'u2' });
  });

  it('never submits a different command through an abandoned dialog capture', async () => {
    const actions: Array<{ submit: ReturnType<typeof vi.fn> }> = [];
    capture.mockImplementation(() => { const action = { submit: vi.fn().mockResolvedValue({ ok: true }) }; actions.push(action); return action; });
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await user.click(screen.getByRole('button', { name: /add member/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByTitle('Remove recipient'));
    await waitFor(() => expect(submit).not.toHaveBeenCalled());
    await waitFor(() => expect(actions.at(-1)!.submit).toHaveBeenCalledWith({ kind: 'recipient_remove', email: 'ext@x.com' }));
    expect(actions[0].submit).not.toHaveBeenCalled();
  });

  it('does not upgrade a retained action when the post-save refresh fails; retry resubmits the same action', async () => {
    load.mockResolvedValueOnce(loaded()).mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValue(loaded());
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await user.click(screen.getByTitle('Remove recipient'));
    expect((await screen.findAllByText(/refresh failed/)).length).toBeGreaterThan(0);
    await user.click(screen.getByTitle('Remove recipient'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate clicks and disables every mutating control while a command is in flight', async () => {
    let release: (v?: unknown) => void = () => {};
    submit.mockReturnValue(new Promise(r => { release = r; }));
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await user.click(screen.getByTitle('Remove recipient'));
    await waitFor(() => expect((screen.getByTitle('Remove recipient') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: /add member/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /add email-only recipient/i }) as HTMLButtonElement).disabled).toBe(true);
    screen.getAllByRole('switch').forEach(item => expect((item as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByTitle('Remove recipient'));
    expect(submit).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalled());
  });

  it('shows a visible error and offers no legacy fallback when the server view fails to load', async () => {
    load.mockResolvedValue({ ok: false, error: 'Project editing is not enabled here yet.' });
    renderTab();
    expect(await screen.findByText('Project editing is not enabled here yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
    expect(screen.queryByText('Stale')).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    legacyHelpersUntouched();
  });

  it('shows that editing is unavailable, with no controls, when the server withholds member management', async () => {
    load.mockResolvedValue(loaded(base, { edit: false, manage_members: false, notifications: false }));
    renderTab();
    expect(await screen.findByText(/editing is currently unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
    expect(screen.queryByTitle('Remove member')).toBeNull();
    expect(screen.queryByTitle('Remove recipient')).toBeNull();
    expect(screen.queryByRole('button', { name: /add email-only recipient/i })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Toggle notifications' }) as HTMLButtonElement).disabled).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows no unavailable notice to non-admins, who keep their own notification preference', async () => {
    load.mockResolvedValue(loaded(base, { edit: true, manage_members: false, notifications: true }));
    const user = userEvent.setup();
    renderTab({ isAdmin: false });
    await screen.findByText('Alice');
    expect(screen.queryByText(/editing is currently unavailable/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
    await user.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(memberNotificationOperations.setPreference).toHaveBeenCalledWith('P1', 'u1', false, '3:0', 'u1', expect.any(Function)));
    expect(submit).not.toHaveBeenCalled();
  });

  it('lets an external partner change only their own preference through the dedicated preference client', async () => {
    load.mockResolvedValue(loaded(base, { edit: false, manage_members: false, notifications: false }));
    const user = userEvent.setup();
    renderTab({ currentUserId: 'p1', isAdmin: false });
    const switches = await screen.findAllByRole('switch');
    expect((switches[0] as HTMLButtonElement).disabled).toBe(true);
    expect((switches[1] as HTMLButtonElement).disabled).toBe(false);
    expect((switches[2] as HTMLButtonElement).disabled).toBe(true);
    await user.click(switches[1]);
    await waitFor(() => expect(memberNotificationOperations.setPreference).toHaveBeenCalledWith('P1', 'p1', false, '3:0', 'p1', expect.any(Function)));
    expect(submit).not.toHaveBeenCalled();
  });

  it('refreshes the server project, not a legacy read, after a self preference change', async () => {
    const fresh = { ...base, members: base.members.map((row: any) => row.userId === 'u1' ? { ...row, notificationsEnabled: false } : row) };
    load.mockResolvedValueOnce(loaded()).mockResolvedValue(loaded(fresh));
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Alice');
    await user.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(onProjectUpdated).toHaveBeenLastCalledWith(fresh));
    expect(projectFirestore.getProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('invalidates the workspace and ignores late responses when the project or user changes', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const first = { load: vi.fn(() => new Promise(r => { resolveFirst = r; })), capture, invalidate };
    vi.mocked(createNativeProjectWorkspace).mockReturnValueOnce(first as any);
    const { rerender } = renderTab();
    rerender(
      <ProjectMembersTab projectId="P2" project={{ id: 'P2' } as any} currentUserId="u1" isAdmin categoryNames={[]}
        availableUsers={users} onProjectUpdated={onProjectUpdated} />
    );
    expect(invalidate).toHaveBeenCalled();
    expect(createNativeProjectWorkspace).toHaveBeenLastCalledWith('P2', undefined, 'u1');
    resolveFirst(loaded({ ...base, members: [{ userId: 'x', email: 'old@qualitastech.com', displayName: 'Old' }] }));
    await screen.findByText('Alice');
    expect(screen.queryByText('Old')).toBeNull();

    rerender(
      <ProjectMembersTab projectId="P2" project={{ id: 'P2' } as any} currentUserId="u9" isAdmin categoryNames={[]}
        availableUsers={users} onProjectUpdated={onProjectUpdated} />
    );
    expect(createNativeProjectWorkspace).toHaveBeenCalledTimes(3);
  });

  it('drops a pending preference response across a project A to B to A cycle', async () => {
    let release: () => void = () => {};
    vi.mocked(memberNotificationOperations.setPreference).mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      args[5]?.();
      return { ok: true } as any;
    });
    const user = userEvent.setup(); const { rerender } = renderTab(); await screen.findByText('Alice');
    await user.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(memberNotificationOperations.setPreference).toHaveBeenCalledTimes(1));
    rerender(<ProjectMembersTab projectId="P2" project={scopedProp} currentUserId="u1" isAdmin categoryNames={[]} availableUsers={users} onProjectUpdated={onProjectUpdated} />);
    rerender(<ProjectMembersTab projectId="P1" project={scopedProp} currentUserId="u1" isAdmin categoryNames={[]} availableUsers={users} onProjectUpdated={onProjectUpdated} />);
    await act(async () => { release(); });
    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  it('keeps legacy direct writes only while scoped reads are off', async () => {
    vi.mocked(isScopedProjectReadEnabled).mockReturnValue(false);
    vi.mocked(projectFirestore.getProject).mockResolvedValue(base);
    vi.mocked(projectFirestore.removeExternalRecipient).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTab({ project: base });
    await screen.findByTitle('Remove recipient');
    await user.click(screen.getByTitle('Remove recipient'));
    await waitFor(() => expect(projectFirestore.removeExternalRecipient).toHaveBeenCalled());
    expect(createNativeProjectWorkspace).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
