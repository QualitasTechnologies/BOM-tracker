import { beforeEach, expect, it, vi } from 'vitest';
import { createNativeProjectClient, createNativeProjectWorkspace, hasPendingNativeProjectCostFields, NativeProjectError, type NativeProjectCommand } from '../nativeProjectOperations';

const opening = { ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', projectName: 'Project', costPerHour: 10 }, permissions: { edit: true, manage_members: true, notifications: true, restore: true, restore_resolve: true } };
type CallablePayload = { operation: string; operation_id: string; [key: string]: unknown };
const KEY = `pulse.project-cost-fields.v1:${JSON.stringify(['alice', 'P'])}`;
const cost = (field: 'costPerHour' | 'miscCost' | 'poValue', amount: number) => ({ kind: 'cost_field', field, amount }) as NativeProjectCommand;

function fixture() {
  const calls: CallablePayload[] = [];
  const journalAtCall: (string | null)[] = [];
  const transport = vi.fn(async (payload: CallablePayload): Promise<{ data: unknown }> => {
    calls.push(structuredClone(payload)); journalAtCall.push(sessionStorage.getItem(KEY));
    return { data: payload.operation === 'get' ? structuredClone(opening) : { ok: true, project_id: 'P', operation_id: payload.operation_id, ...(payload.resolve_only ? { resolution: 'committed' } : {}) } };
  });
  const client = createNativeProjectClient({ currentUid: async () => 'alice', callable: transport });
  return { client, transport, calls, journalAtCall };
}
const open = async (f: ReturnType<typeof fixture>) => { const workspace = createNativeProjectWorkspace('P', f.client, 'alice'); await workspace.load(); return workspace; };

beforeEach(() => sessionStorage.clear());

it('sends one exact frozen cost_field command bound to UID, opening revision and nonce, journaled before dispatch', async () => {
  for (const command of [cost('costPerHour', 450), cost('miscCost', 0), cost('poValue', -1200)]) {
    sessionStorage.clear();
    const f = fixture(), action = (await open(f)).capture('cost-fields');
    await action.submit(command);
    const sent = f.calls.at(-1)!;
    expect(Object.keys(sent).sort()).toEqual(['command', 'expected_actor_uid', 'expected_version', 'operation', 'operation_id', 'project_id']);
    expect(sent).toMatchObject({ operation: 'command', project_id: 'P', expected_actor_uid: 'alice', expected_version: '10:1', command });
    expect(JSON.parse(f.journalAtCall.at(-1)!)).toEqual({ expected_version: '10:1', operation_id: sent.operation_id, command });
  }
});

it('rejects malformed cost_field commands before storage or transport', async () => {
  const bad: unknown[] = [
    { kind: 'cost_field', field: 'internalBudget', amount: 1 }, { kind: 'cost_field', field: 'costPerHour' }, { kind: 'cost_field', amount: 1 },
    { kind: 'cost_field', field: 'costPerHour', amount: null }, { kind: 'cost_field', field: 'costPerHour', amount: '5' },
    { kind: 'cost_field', field: 'costPerHour', amount: NaN }, { kind: 'cost_field', field: 'costPerHour', amount: Infinity },
    { kind: 'cost_field', field: 'costPerHour', amount: 1, extra: true }, { kind: 'cost_field', field: '__proto__', amount: 1 },
  ];
  for (const command of bad) {
    const f = fixture(), action = (await open(f)).capture('cost-fields'), before = f.calls.length;
    await expect(action.submit(command as NativeProjectCommand)).rejects.toBeInstanceOf(NativeProjectError);
    expect(f.calls).toHaveLength(before); expect(sessionStorage.getItem(KEY)).toBeNull();
  }
});

it('keeps the journal through submit and resolve until an explicit acknowledgement, then recovers exactly', async () => {
  const f = fixture(), workspace = await open(f), action = workspace.capture('cost-fields'), command = cost('costPerHour', 0);
  await action.submit(command);
  expect(action.pendingCommand).toEqual(command);
  const reopened = await open(f), recovery = reopened.recover('cost-fields')!;
  expect(recovery.pendingCommand).toEqual(command);
  expect((await recovery.resolve()).resolution).toBe('committed');
  expect(f.calls.at(-1)).toMatchObject({ resolve_only: true, expected_version: '10:1', command });
  expect(reopened.recover('cost-fields')?.pendingCommand).toEqual(command);
  expect(hasPendingNativeProjectCostFields('P', 'alice')).toEqual({ kind: 'pending' });
  await recovery.acknowledge();
  expect(reopened.recover('cost-fields')).toBeNull();
  expect(hasPendingNativeProjectCostFields('P', 'alice')).toEqual({ kind: 'absent' });
});

it('a lost reply keeps the original revision and nonce for retry and refuses a changed payload or second field', async () => {
  const f = fixture(), action = (await open(f)).capture('cost-fields'), command = cost('miscCost', 75);
  f.transport.mockRejectedValueOnce(new Error('lost cost reply'));
  await expect(action.submit(command)).rejects.toThrow(/lost cost reply/);
  const firstId = JSON.parse(sessionStorage.getItem(KEY)!).operation_id;
  await expect(action.submit(cost('miscCost', 76))).rejects.toMatchObject({ code: 'operation_conflict' });
  await expect(action.submit(cost('poValue', 75))).rejects.toMatchObject({ code: 'operation_conflict' });
  const reopened = await open(f), retry = reopened.capture('cost-fields');
  expect(retry.pendingCommand).toEqual(command);
  await expect(retry.submit(cost('costPerHour', 1))).rejects.toMatchObject({ code: 'operation_conflict' });
  await retry.submit(command);
  expect(f.calls.at(-1)).toMatchObject({ operation_id: firstId, expected_version: '10:1', command });
});

it('unreadable or non-exact saved cost requests block editing and report the unreadable state', async () => {
  for (const raw of ['not json', JSON.stringify({ expected_version: '10:1', operation_id: 'x', command: { kind: 'cost_field', field: 'costPerHour', amount: null } }),
    JSON.stringify({ expected_version: '10:1', operation_id: 'x', command: { kind: 'cost_field', field: 'other', amount: 1 } }),
    JSON.stringify({ expected_version: '10:1', operation_id: 'x', extra: 1, command: { kind: 'cost_field', field: 'costPerHour', amount: 1 } }),
    JSON.stringify({ expected_version: '10:1', operation_id: 'x', command: { kind: 'budget', amount: 1 } })]) {
    sessionStorage.setItem(KEY, raw);
    const f = fixture(), workspace = await open(f);
    expect(() => workspace.capture('cost-fields')).toThrowError(expect.objectContaining({ code: 'native-project/storage-unavailable' }));
    expect(hasPendingNativeProjectCostFields('P', 'alice').kind).toBe('error');
  }
});

it('journals are isolated per account and project', async () => {
  const f = fixture(); await (await open(f)).capture('cost-fields').submit(cost('poValue', 5));
  expect(hasPendingNativeProjectCostFields('P', 'bob')).toEqual({ kind: 'absent' });
  expect(hasPendingNativeProjectCostFields('Q', 'alice')).toEqual({ kind: 'absent' });
  expect(hasPendingNativeProjectCostFields('P', 'alice')).toEqual({ kind: 'pending' });
});
