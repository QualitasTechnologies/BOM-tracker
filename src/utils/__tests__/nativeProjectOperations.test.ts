import { expect, it, vi } from 'vitest';
import { createNativeProjectClient, createNativeProjectWorkspace, NativeProjectError, type NativeProjectCommand } from '../nativeProjectOperations';

const opening = { ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', projectName: 'Project' }, permissions: { edit: true, manage_members: true, notifications: true, restore: true, restore_resolve: true } };
type CallablePayload = { operation: string; operation_id: string; [key: string]: unknown };
const memberCommands: NativeProjectCommand[] = [
  { kind: 'member_add' as const, user_id: 'u2' },
  { kind: 'member_add' as const, user_id: 'p2', category_scope: ['Mech'] },
  { kind: 'member_remove' as const, user_id: 'u2' },
  { kind: 'member_scope' as const, user_id: 'p2', category_scope: ['Mech', 'Elec'] },
  { kind: 'recipient_add' as const, email: 'z@z.com', name: 'Zed' },
  { kind: 'recipient_remove' as const, email: 'z@z.com' },
  { kind: 'recipient_notifications' as const, email: 'z@z.com', enabled: false },
];
const command: Extract<NativeProjectCommand, { kind: 'member_scope' }> = {
  kind: 'member_scope', user_id: 'p2', category_scope: ['Mech', 'Elec'],
};

function fixture() {
  let uid = 'alice';
  const calls: CallablePayload[] = [];
  const transport = vi.fn(async (payload: CallablePayload): Promise<{ data: unknown }> => { calls.push(structuredClone(payload)); return { data: payload.operation === 'get' ? structuredClone(opening) : { ok: true, project_id: 'P', operation_id: payload.operation_id } }; });
  const client = createNativeProjectClient({ currentUid: async () => uid, callable: transport });
  return { client, transport, calls, switchAccount: () => { uid = 'bob'; } };
}

it('retains a budget recovery record through resolve until a confirming read acknowledges it', async () => {
  sessionStorage.clear();
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client, 'alice'); await workspace.load();
  const action = workspace.capture('budget'), budget: NativeProjectCommand = { kind: 'budget', amount: 650000 };
  f.transport.mockRejectedValueOnce(new Error('lost budget reply'));
  await expect(action.submit(budget)).rejects.toThrow();
  const reopened = createNativeProjectWorkspace('P', f.client, 'alice'); await reopened.load();
  const recovery = reopened.recover('budget')!;
  f.transport.mockImplementationOnce(async payload => ({ data: { ok: true, project_id: 'P', operation_id: payload.operation_id, resolution: 'committed' } }));
  await recovery.resolve();
  expect(reopened.recover('budget')?.pendingCommand).toEqual(budget);
  await recovery.acknowledge();
  expect(reopened.recover('budget')).toBeNull();
  sessionStorage.clear();
});

it('sends every membership and recipient command as an exact explicit delta bound to UID, revision and nonce', async () => {
  for (const memberCommand of memberCommands) {
    const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client, 'alice'); await workspace.load();
    await workspace.capture().submit(memberCommand);
    expect(f.calls.at(-1)).toEqual({
      operation: 'command', project_id: 'P', expected_version: '10:1', expected_actor_uid: 'alice',
      operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/), command: memberCommand,
    });
    // Never a replacement roster, root or projected management field.
    expect(Object.keys(f.calls.at(-1))).not.toEqual(expect.arrayContaining(['members', 'memberIds', 'externalRecipients']));
    expect(JSON.stringify(f.calls.at(-1).command)).not.toMatch(/"members"|"memberIds"|"externalRecipients"/);
  }
});

it('an uncertain member command retries with the same nonce, opening revision and UID even after a display refresh', async () => {
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load();
  const action = workspace.capture();
  f.transport.mockImplementationOnce(async payload => { f.calls.push(structuredClone(payload)); throw new Error('lost reply'); });
  await expect(action.submit(command)).rejects.toThrow(/lost reply/);
  const first = f.calls.at(-1);
  expect(first).toMatchObject({ operation: 'command', expected_version: '10:1' });
  f.transport.mockResolvedValueOnce({ data: { ...opening, version: '11:4' } }); await workspace.load();
  await action.submit(command);
  expect(f.calls.at(-1)).toEqual(first);
  expect(f.calls.at(-1)).toMatchObject({ expected_version: '10:1', expected_actor_uid: 'alice' });
  // A rebased/different draft cannot ride the frozen nonce.
  await expect(action.submit({ ...command, category_scope: ['Elec'] })).rejects.toThrow(/saved request/);
  expect(f.calls.filter(call => call.operation === 'command')).toHaveLength(2);
});

it('a fresh capture after a refresh uses the newer revision with a new nonce, never the retained one', async () => {
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load();
  const first = workspace.capture(); await first.submit(command);
  f.transport.mockResolvedValueOnce({ data: { ...opening, version: '11:0' } }); await workspace.load();
  await workspace.capture().submit(command);
  const [a, b] = f.calls.filter(call => call.operation === 'command');
  expect(a.expected_version).toBe('10:1'); expect(b.expected_version).toBe('11:0');
  expect(a.operation_id).not.toBe(b.operation_id);
});

it('resolves member and archive receipts while rejecting unsupported resolve commands', async () => {
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load();
  f.transport.mockImplementationOnce(async payload => { f.calls.push(structuredClone(payload)); return { data: { ok: true, project_id: 'P', operation_id: 'op1', resolution: 'committed' } }; });
  await expect(f.client.resolve('P', { expected_version: '10:1', operation_id: 'op1', command }, 'alice')).resolves.toMatchObject({ resolution: 'committed' });
  expect(f.calls.at(-1)).toMatchObject({ operation: 'command', project_id: 'P', expected_version: '10:1', operation_id: 'op1', command, resolve_only: true, expected_actor_uid: 'alice' });
  f.transport.mockImplementationOnce(async payload => { f.calls.push(structuredClone(payload)); return { data: { ok: true, project_id: 'P', operation_id: 'op2', resolution: 'cancelled' } }; });
  await expect(f.client.resolve('P', { expected_version: '10:1', operation_id: 'op2', command: { kind: 'archive' } }, 'alice')).resolves.toMatchObject({ resolution: 'cancelled' });
  await expect(f.client.resolve('P', { expected_version: '10:1', operation_id: 'op3', command: { kind: 'unknown' } as any }, 'alice')).rejects.toThrow(/unexpected/);
  expect(f.calls.filter(call => call.operation === 'command' && call.resolve_only)).toHaveLength(2);
  await expect(workspace.capture().resolve()).rejects.toThrow(/nothing to resolve|no pending/i);
});

it('maps server membership refusals to safe messages and keeps unknown codes verbatim', async () => {
  const f = fixture(); await createNativeProjectWorkspace('P', f.client).load();
  for (const [code, text] of [
    ['project_mutations_disabled', /not enabled/], ['last_project_member', /at least one member/],
    ['legacy_membership_migration_required', /access list/], ['project_version_conflict', /changed while/],
  ] as const) {
    f.transport.mockResolvedValueOnce({ data: { ok: false, error: code } });
    await expect(f.client.command('P', { expected_version: '10:1', operation_id: 'op1', command }, 'alice')).rejects.toMatchObject({ code, message: expect.stringMatching(text) });
  }
  f.transport.mockResolvedValueOnce({ data: { ok: false, error: 'project_recipient_exists' } });
  await expect(f.client.command('P', { expected_version: '10:1', operation_id: 'op1', command }, 'alice')).rejects.toMatchObject({ code: 'project_recipient_exists', message: 'project_recipient_exists' });
});

it('SDK switches and invalidated contexts reject member commands before dispatch', async () => {
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load(); const action = workspace.capture();
  f.switchAccount(); await expect(action.submit(command)).rejects.toThrow(/account changed/); expect(f.calls).toHaveLength(1);
  const g = fixture(), old = createNativeProjectWorkspace('P', g.client); await old.load(); const stale = old.capture(); old.invalidate();
  await expect(stale.submit(command)).rejects.toThrow(/context changed/); expect(g.calls).toHaveLength(1);
});

it('identity switches during an await cannot publish an apparently successful reply', async () => {
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load();
  f.transport.mockImplementationOnce(async payload => { f.switchAccount(); return { data: { ok: true, project_id: 'P', operation_id: payload.operation_id } }; });
  await expect(workspace.capture().submit(command)).rejects.toThrow(/account changed/);
});

it('opening while the SDK has switched ahead of React does not adopt the other account', async () => {
  const f = fixture(); f.switchAccount();
  const workspace = createNativeProjectWorkspace('P', f.client, 'alice');
  await expect(workspace.load()).rejects.toThrow(/account changed/); expect(f.calls).toHaveLength(0);
});

it('rejects mismatched project identities, receipts and missing capability flags', async () => {
  const f = fixture(); f.transport.mockResolvedValueOnce({ data: { ...opening, project_id: 'Other' } });
  await expect(f.client.get('P', 'alice')).rejects.toThrow(/unexpected/);
  const g = fixture(), workspace = createNativeProjectWorkspace('P', g.client); await workspace.load();
  g.transport.mockResolvedValueOnce({ data: { ok: true, project_id: 'P', operation_id: 'different' } });
  await expect(workspace.capture().submit(command)).rejects.toThrow(/unexpected/);
  const h = fixture(); h.transport.mockResolvedValueOnce({ data: { ...opening, permissions: { edit: true, manage_members: true, notifications: true, restore: true } } });
  await expect(h.client.get('P', 'alice')).rejects.toThrow(/unexpected/);
});

it('invalidating the workspace during the client UID await prevents command dispatch', async () => {
  const currentUid = vi.fn(async () => 'alice');
  const callable = vi.fn(async (payload: CallablePayload): Promise<{ data: unknown }> => ({ data: payload.operation === 'get' ? opening : { ok: true, project_id: 'P', operation_id: payload.operation_id } }));
  const client = createNativeProjectClient({ currentUid, callable });
  const workspace = createNativeProjectWorkspace('P', client);
  await workspace.load(); const action = workspace.capture();
  currentUid.mockImplementationOnce(async () => 'alice').mockImplementationOnce(async () => { workspace.invalidate(); return 'alice'; });
  await expect(action.submit(command)).rejects.toThrow(/context changed/);
  expect(callable.mock.calls.filter(([payload]) => payload.operation === 'command')).toHaveLength(0);
});

it('captures a nullable budget command with its opening version and operation ID for retry', async () => {
  sessionStorage.clear();
  const f = fixture(), workspace = createNativeProjectWorkspace('P', f.client); await workspace.load();
  const command = { kind: 'budget', amount: null } as const;
  const action = workspace.capture('budget');
  f.transport.mockRejectedValueOnce(new Error('lost budget reply'));
  await expect(action.submit(command)).rejects.toThrow(/lost budget reply/);
  const reopened = createNativeProjectWorkspace('P', f.client); await reopened.load();
  const retry = reopened.capture('budget');
  expect(retry.pendingCommand).toEqual(command);
  await retry.submit(command);
  expect(f.calls.at(-1)).toMatchObject({ expected_version: '10:1', expected_actor_uid: 'alice', command });
  sessionStorage.clear();
});

it('exports a typed error carrying the stable code', () => {
  const failure = new NativeProjectError('native-project/pending', 'x');
  expect(failure).toBeInstanceOf(Error); expect(failure.code).toBe('native-project/pending');
});
