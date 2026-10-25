import { beforeEach, expect, it, vi } from 'vitest';
import { createNativeProjectClient, createNativeProjectWorkspace, hasPendingNativeProjectArchive, hasPendingNativeProjectMembers, hasPendingNativeProjectRestore } from '../nativeProjectOperations';

const opening = { ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' }, permissions: { edit: false, manage_members: false, notifications: false, restore: false, restore_resolve: true } };
const pendingCommand = { kind: 'recipient_add' as const, email: 'guest@example.com', name: 'Guest' };

function fixture() {
  let uid = 'alice';
  const calls: Array<Record<string, unknown>> = [];
  const callable = vi.fn(async (payload: Record<string, unknown>): Promise<{ data: unknown }> => {
    calls.push(structuredClone(payload));
    const projectId = payload.project_id;
    if (payload.operation === 'get') return { data: { ...structuredClone(opening), project_id: projectId, project: { projectId } } };
    if (payload.resolve_only) return { data: { ok: true, project_id: projectId, operation_id: payload.operation_id, resolution: 'cancelled' } };
    return { data: { ok: true, project_id: projectId, operation_id: payload.operation_id } };
  });
  const client = createNativeProjectClient({ currentUid: async () => uid, callable });
  const workspace = () => createNativeProjectWorkspace('P', client, 'alice');
  return { calls, callable, workspace, setUid: (next: string) => { uid = next; } };
}

beforeEach(() => sessionStorage.clear());

it('reloads a persisted member command with the same frozen revision and nonce', async () => {
  const f = fixture();
  const first = f.workspace(); await first.load();
  f.callable.mockImplementationOnce(async (payload: Record<string, unknown>): Promise<{ data: unknown }> => { f.calls.push(structuredClone(payload)); throw new Error('network lost'); });
  const action = first.capture('members');
  await expect(action.submit(pendingCommand)).rejects.toThrow(/network lost/);
  const original = f.calls.filter(call => call.operation === 'command').at(-1)!;
  first.invalidate();

  const reopened = f.workspace(); await reopened.load();
  const recovered = reopened.capture('members');
  expect(recovered.pendingCommand).toEqual(pendingCommand);
  await recovered.submit(pendingCommand);
  expect(f.calls.filter(call => call.operation === 'command').at(-1)).toEqual(original);
});

it('keeps the journal after command success until the caller acknowledges refreshed state', async () => {
  const f = fixture(); const workspace = f.workspace(); await workspace.load();
  const action = workspace.capture('members'); await action.submit(pendingCommand);
  workspace.invalidate();
  const reopened = f.workspace(); await reopened.load();
  expect(reopened.capture('members').pendingCommand).toEqual(pendingCommand);
  const acknowledged = reopened.capture('members');
  await acknowledged.acknowledge();
  reopened.invalidate();
  const after = f.workspace(); await after.load();
  expect(after.capture('members').pendingCommand).toBeUndefined();
});

it('resolve-only cancels an uncommitted member request while writes are closed', async () => {
  const f = fixture(); const first = f.workspace(); await first.load();
  const action = first.capture('members');
  f.callable.mockImplementationOnce(async (payload: Record<string, unknown>): Promise<{ data: unknown }> => {
    f.calls.push(structuredClone(payload));
    return { data: { ok: false, error: 'project_mutations_disabled' } };
  });
  await expect(action.submit(pendingCommand)).rejects.toThrow(/not enabled/i);
  first.invalidate();
  const reopened = f.workspace(); await reopened.load();
  const recovered = reopened.capture('members');
  const result = await recovered.resolve();
  expect(result.resolution).toBe('cancelled');
  expect(f.calls.at(-1)).toMatchObject({ operation: 'command', project_id: 'P', expected_actor_uid: 'alice', expected_version: '10:1', operation_id: expect.any(String), command: pendingCommand, resolve_only: true });
  reopened.invalidate(); const after = f.workspace(); await after.load();
  expect(after.capture('members').pendingCommand).toBeUndefined();
});

it('resolve-only returns a prior committed receipt without resubmitting the member write', async () => {
  const f = fixture(); const first = f.workspace(); await first.load();
  const action = first.capture('members');
  f.callable.mockImplementationOnce(async (payload: Record<string, unknown>): Promise<{ data: unknown }> => { f.calls.push(structuredClone(payload)); throw new Error('reply lost'); });
  await expect(action.submit(pendingCommand)).rejects.toThrow(/reply lost/i);
  first.invalidate(); const reopened = f.workspace(); await reopened.load();
  f.callable.mockImplementationOnce(async payload => {
    f.calls.push(structuredClone(payload));
    return { data: { ok: true, project_id: 'P', operation_id: payload.operation_id, resolution: 'committed' } };
  });
  const result = await reopened.recover('members')!.resolve!();
  expect(result.resolution).toBe('committed');
  expect(f.calls.filter(call => call.operation === 'command')).toHaveLength(2);
  expect(f.calls.at(-1)).toMatchObject({ resolve_only: true, command: pendingCommand });
});

it('recovers a durable archive request and resolves it without retrying its write', async () => {
  const f = fixture(); const first = f.workspace(); await first.load();
  const action = first.capture('archive');
  f.callable.mockImplementationOnce(async payload => {
    f.calls.push(structuredClone(payload));
    return { data: { ok: false, error: 'project_mutations_disabled' } };
  });
  await expect(action.submit({ kind: 'archive' })).rejects.toThrow(/not enabled/i);
  first.invalidate(); const reopened = f.workspace(); await reopened.load();
  const recovered = reopened.recover('archive');
  expect(recovered?.pendingCommand).toEqual({ kind: 'archive' });
  const result = await recovered!.resolve!();
  expect(result.resolution).toBe('cancelled');
  expect(f.calls.filter(call => call.operation === 'command')).toHaveLength(2);
  expect(f.calls.at(-1)).toMatchObject({ operation: 'command', command: { kind: 'archive' }, resolve_only: true, expected_version: '10:1' });
});

it('discovers only the saved archive request for the exact actor and project', async () => {
  const f = fixture(); const workspace = f.workspace(); await workspace.load();
  const action = workspace.capture('archive');
  f.callable.mockImplementationOnce(async (payload: Record<string, unknown>): Promise<{ data: unknown }> => { f.calls.push(structuredClone(payload)); throw new Error('reply lost'); });
  await expect(action.submit({ kind: 'archive' })).rejects.toThrow(/reply lost/i);
  expect(hasPendingNativeProjectArchive('P', 'alice').kind).toBe('pending');
  expect(hasPendingNativeProjectArchive('P2', 'alice').kind).toBe('absent');
  expect(hasPendingNativeProjectArchive('P', 'bob').kind).toBe('absent');
  sessionStorage.setItem('pulse.project-archive.v1:["alice","P"]', '{bad');
  expect(hasPendingNativeProjectArchive('P', 'alice').kind).toBe('error');
});

it('fails closed on malformed storage and isolates journals by UID and project', async () => {
  const f = fixture(); const workspace = f.workspace(); await workspace.load();
  sessionStorage.setItem('pulse.project-members.v1:["alice","P"]', '{bad');
  expect(() => workspace.capture('members')).toThrow(/saved project request cannot be read/i);
  sessionStorage.clear();
  const action = workspace.capture('members'); await action.submit(pendingCommand);
  f.setUid('bob');
  await expect(workspace.capture('members').submit(pendingCommand)).rejects.toThrow(/signed-in account changed/i);
  f.setUid('alice'); workspace.invalidate();
  const other = createNativeProjectWorkspace('P2', createNativeProjectClient({ currentUid: async () => 'alice', callable: f.callable }), 'alice');
  await other.load(); expect(other.capture('members').pendingCommand).toBeUndefined();
});

it('discovers a pending membership request only for its exact actor and project', async () => {
  const f = fixture(); const workspace = f.workspace(); await workspace.load();
  const action = workspace.capture('members');
  f.callable.mockImplementationOnce(async payload => { f.calls.push(structuredClone(payload)); throw new Error('reply lost'); });
  await expect(action.submit(pendingCommand)).rejects.toThrow(/reply lost/i);
  expect(hasPendingNativeProjectMembers('P', 'alice').kind).toBe('pending');
  expect(hasPendingNativeProjectMembers('P2', 'alice').kind).toBe('absent');
  expect(hasPendingNativeProjectMembers('P', 'bob').kind).toBe('absent');
  sessionStorage.setItem('pulse.project-members.v1:["alice","P"]', JSON.stringify({ expected_version: '10:1', operation_id: 'bad-email', command: { kind: 'recipient_add', email: 'sales team@example.com', name: 'Guest' } }));
  expect(hasPendingNativeProjectMembers('P', 'alice').kind).toBe('error');
});

it('rejects empty journals, reserved IDs, and extra fields on archive or restore envelopes', async () => {
  const f = fixture(); const workspace = f.workspace(); await workspace.load();
  const membersKey = 'pulse.project-members.v1:["alice","P"]';
  sessionStorage.setItem(membersKey, '');
  expect(() => workspace.capture('members')).toThrow(/saved project request cannot be read/i);
  sessionStorage.removeItem(membersKey);
  await expect(workspace.capture('members').submit({ kind: 'member_remove', user_id: '__reserved__' })).rejects.toThrow(/unexpected/i);
  expect(f.calls.filter(call => call.operation === 'command')).toHaveLength(0);

  sessionStorage.setItem('pulse.project-archive.v1:["alice","P"]', JSON.stringify({ expected_version: '10:1', operation_id: 'bad', command: { kind: 'archive', extra: true } }));
  expect(hasPendingNativeProjectArchive('P', 'alice').kind).toBe('error');
  expect(() => workspace.capture('archive')).toThrow(/saved project request cannot be read/i);
  sessionStorage.setItem('pulse.project-restore.v1:["alice","P"]', JSON.stringify({ expected_version: '10:1', operation_id: 'bad', command: { kind: 'restore', extra: true } }));
  expect(hasPendingNativeProjectRestore('P', 'alice').kind).toBe('error');
  expect(() => workspace.capture('restore')).toThrow(/saved project request cannot be read/i);
});
