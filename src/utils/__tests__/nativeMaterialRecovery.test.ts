import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeMaterialOperationsClient } from '../nativeMaterialOperations';
import { createNativeMaterialCommandClient } from '../nativeMaterialCommands';

const KEY = (uid: string, project: string) => `pulse.material-write.v1:${JSON.stringify([uid, project])}`;
const VERSION = '42:7';
const patchInput = (operation_id = 'op-1') => ({ item_id: 'motor', expected_version: '42:6', operation_id, patch: { quantity: 3 } });
const patchOk = (operation_id = 'op-1') => ({ ok: true, project_id: 'P', item_id: 'motor', operation_id, item: { id: 'motor' } });
const getOk = (version = VERSION) => ({ ok: true, project_id: 'P', categories: [], version, permissions: { review: true, edit: false, command: false } });
const network = () => Object.assign(new Error('offline'), { code: 'functions/unavailable' });
const projectInput = { operation_id: 'create-1', project: { projectName: 'A', clientName: 'B', description: '', status: 'Planning' as const, deadline: '2026-12-01', poValue: 0 } };

const typed = (uid = 'u1') => {
  const state = { uid: uid as string | null, calls: [] as Record<string, unknown>[] };
  const handler = vi.fn(async (_payload: Record<string, unknown>): Promise<unknown> => ({ ok: true }));
  const client = createNativeMaterialOperationsClient({
    getCurrentUser: () => (state.uid ? { uid: state.uid } : null),
    callable: async payload => { state.calls.push(JSON.parse(JSON.stringify(payload))); return { data: await handler(payload) }; },
  });
  return { client, state, handler };
};

beforeEach(() => sessionStorage.clear());

describe('typed material client: durable frozen request journal', () => {
  it('persists the exact payload per uid+project before the outbound write', async () => {
    const { client, handler } = typed();
    let seen: string | null = null;
    handler.mockImplementation(async () => { seen = sessionStorage.getItem(KEY('u1', 'P')); return patchOk(); });
    await client.patch('P', patchInput());
    expect(seen).toContain('"operation_id":"op-1"');
    expect(seen).toContain('"quantity":3');
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull(); // success settles and releases
  });

  it.each([
    ['patch', (c: ReturnType<typeof typed>['client']) => c.patch('P', patchInput('n1'), 'u1'), patchOk('n1')],
    ['fulfill', (c: ReturnType<typeof typed>['client']) => c.fulfill('P', { item_id: 'motor', expected_version: '42:6', operation_id: 'n1', fulfillment: { kind: 'fulfillment', quantity: 1 } }, 'u1'), patchOk('n1')],
    ['command', (c: ReturnType<typeof typed>['client']) => c.command('P', { expected_version: '42:6', operation_id: 'n1', command: { kind: 'delete_items', item_ids: ['motor'] } }, 'u1'), { ok: true, project_id: 'P', operation_id: 'n1', command_kind: 'delete_items' }],
    ['create_project', (c: ReturnType<typeof typed>['client']) => c.createProject('P', { ...projectInput, operation_id: 'n1' }, 'u1'), { ok: true, project_id: 'P', operation_id: 'n1' }],
  ])('%s: ambiguous failure retains and a fresh nonce cannot become a new business write', async (_name, send, okResult) => {
    const { client, handler, state } = typed();
    handler.mockRejectedValueOnce(network());
    await expect(send(client)).rejects.toMatchObject({ code: 'functions/unavailable' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    await expect(client.patch('P', patchInput('fresh'), 'u1')).rejects.toMatchObject({ code: 'native-material/recovery-required' });
    expect(state.calls).toHaveLength(1);
    // Same nonce + same payload resends the identical frozen request.
    handler.mockResolvedValueOnce(okResult);
    await send(client);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1]).toEqual(state.calls[0]);
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('refuses the same nonce with different values', async () => {
    const { client, handler, state } = typed();
    handler.mockRejectedValueOnce(network());
    await expect(client.patch('P', patchInput('op-1'))).rejects.toBeTruthy();
    await expect(client.patch('P', { ...patchInput('op-1'), patch: { quantity: 4 } })).rejects.toMatchObject({ code: 'native-material/recovery-required' });
    expect(state.calls).toHaveLength(1);
  });

  it('releases a definite first-attempt rejection, but retains one that follows an ambiguous attempt', async () => {
    const a = typed();
    a.handler.mockResolvedValueOnce({ ok: false, error: 'material_version_conflict' });
    await expect(a.client.patch('P', patchInput('op-1'))).rejects.toMatchObject({ code: 'material_version_conflict' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();

    const b = typed();
    b.handler.mockRejectedValueOnce(network());
    await expect(b.client.patch('P', patchInput('op-2'))).rejects.toBeTruthy();
    b.handler.mockResolvedValueOnce({ ok: false, error: 'material_mutations_disabled' });
    await expect(b.client.patch('P', patchInput('op-2'))).rejects.toMatchObject({ code: 'material_mutations_disabled' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it.each(['project_operations_unavailable', 'identity_provider_unavailable', 'some_new_unknown_code'])('retains an ambiguous or unknown first response (%s)', async code => {
    const t = typed();
    t.handler.mockResolvedValueOnce({ ok: false, error: code });
    await expect(t.client.patch('P', patchInput('op-1'))).rejects.toMatchObject({ code });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    await expect(t.client.patch('P', patchInput('fresh'))).rejects.toMatchObject({ code: 'native-material/recovery-required' });
  });

  it('releases a known deterministic first-attempt refusal', async () => {
    const t = typed();
    t.handler.mockResolvedValueOnce({ ok: false, error: 'material_initialization_conflict' });
    await expect(t.client.patch('P', patchInput('op-1'))).rejects.toMatchObject({ code: 'material_initialization_conflict' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('retains when the response is malformed or the account changed mid-flight', async () => {
    const a = typed();
    a.handler.mockResolvedValueOnce({ ok: true, project_id: 'OTHER' });
    await expect(a.client.patch('P', patchInput('op-1'))).rejects.toMatchObject({ code: 'native-material/invalid-response' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    sessionStorage.clear();
    const b = typed();
    b.handler.mockImplementation(async () => { b.state.uid = 'u2'; return patchOk('op-1'); });
    await expect(b.client.patch('P', patchInput('op-1'))).rejects.toMatchObject({ code: 'native-material/identity-changed' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('blocks writes when the saved request is corrupt or storage is unavailable', async () => {
    const { client, state } = typed();
    sessionStorage.setItem(KEY('u1', 'P'), '{not json');
    await expect(client.patch('P', patchInput())).rejects.toMatchObject({ code: 'native-material/storage-unavailable' });
    sessionStorage.clear();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(client.patch('P', patchInput())).rejects.toMatchObject({ code: 'native-material/storage-unavailable' });
    spy.mockRestore();
    expect(state.calls).toHaveLength(0);
  });

  it('does not block another project or another account', async () => {
    const { client, handler, state } = typed();
    handler.mockRejectedValueOnce(network());
    await expect(client.patch('P', patchInput('op-1'))).rejects.toBeTruthy();
    handler.mockResolvedValueOnce({ ...patchOk('op-9'), project_id: 'Q' });
    await client.patch('Q', patchInput('op-9'));
    expect(state.calls).toHaveLength(2);
  });
});

describe('typed material client: explicit resolution', () => {
  const pend = async (t: ReturnType<typeof typed>) => {
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.patch('P', patchInput('op-1'), 'u1')).rejects.toBeTruthy();
  };

  it('resends the frozen payload with resolve_only and keeps the journal until an authoritative read', async () => {
    const t = typed(); await pend(t);
    t.handler.mockResolvedValueOnce({ ...patchOk('op-1'), resolution: 'committed' });
    const out = await t.client.resolve('P');
    expect(out).toMatchObject({ resolution: 'committed', result: { item_id: 'motor' } });
    expect(t.state.calls[1]).toEqual({ ...t.state.calls[0], resolve_only: true });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    await expect(client_blocked(t)).rejects.toMatchObject({ code: 'native-material/recovery-required' });
    t.handler.mockResolvedValueOnce(getOk('42:8'));
    await t.client.acknowledge('P');
    expect(t.state.calls[2]).toEqual({ operation: 'get', project_id: 'P' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });
  const client_blocked = (t: ReturnType<typeof typed>) => t.client.patch('P', patchInput('op-1'), 'u1');

  it('cancelled resolution requires a successful authoritative read before clearing', async () => {
    const t = typed(); await pend(t);
    t.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'op-1', item_id: 'motor', resolution: 'cancelled' }); // exact backend shape: no item
    const cancelled = await t.client.resolve('P');
    expect(cancelled).toMatchObject({ resolution: 'cancelled', result: { item_id: 'motor' } });
    expect(cancelled.result).not.toHaveProperty('item');
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.acknowledge('P')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    t.handler.mockResolvedValueOnce(getOk());
    await t.client.acknowledge('P');
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('refuses to acknowledge a commit while the read still shows the pre-write version', async () => {
    const t = typed(); await pend(t);
    t.handler.mockResolvedValueOnce({ ...patchOk('op-1'), resolution: 'committed' });
    await t.client.resolve('P');
    t.handler.mockResolvedValueOnce(getOk('42:6'));
    await expect(t.client.acknowledge('P')).rejects.toMatchObject({ code: 'native-material/read-not-current' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('cannot acknowledge before resolution', async () => {
    const t = typed(); await pend(t);
    await expect(t.client.acknowledge('P')).rejects.toMatchObject({ code: 'native-material/not-resolved' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('accepts the exact backend cancelled fulfill shape and still requires item on commit', async () => {
    const t = typed();
    t.handler.mockRejectedValueOnce(network());
    const fulfillment = { item_id: 'motor', expected_version: '42:6', operation_id: 'f-1', fulfillment: { kind: 'fulfillment' as const, quantity: 1 } };
    await expect(t.client.fulfill('P', fulfillment, 'u1')).rejects.toBeTruthy();
    t.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'f-1', item_id: 'motor', resolution: 'committed' });
    await expect(t.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/invalid-response' });
    t.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'f-1', item_id: 'motor', resolution: 'cancelled' });
    await expect(t.client.resolve('P')).resolves.toMatchObject({ resolution: 'cancelled' });
  });

  it('rejects an invalid resolution response and retains the request', async () => {
    const t = typed(); await pend(t);
    t.handler.mockResolvedValueOnce({ ...patchOk('op-1'), resolution: 'maybe' });
    await expect(t.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/invalid-response' });
    t.handler.mockResolvedValueOnce(patchOk('op-1'));
    await expect(t.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/invalid-response' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('resolves create_project and command requests with the same protection', async () => {
    const t = typed();
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.createProject('P', projectInput, 'u1')).rejects.toBeTruthy();
    t.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'create-1', resolution: 'cancelled' });
    await expect(t.client.resolve('P')).resolves.toMatchObject({ resolution: 'cancelled', result: { project_id: 'P' } });
    expect(t.state.calls[1]).toMatchObject({ operation: 'create_project', resolve_only: true, expected_actor_uid: 'u1' });
  });

  it('never releases another account\'s or project\'s pending request', async () => {
    const t = typed(); await pend(t);
    t.state.uid = 'u2';
    await expect(t.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/nothing-pending' });
    await expect(t.client.acknowledge('P')).rejects.toMatchObject({ code: 'native-material/nothing-pending' });
    t.state.uid = 'u1';
    await expect(t.client.resolve('Q')).rejects.toMatchObject({ code: 'native-material/nothing-pending' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    expect(t.state.calls).toHaveLength(1);
  });

  it('fails closed when the account changes during resolution', async () => {
    const t = typed(); await pend(t);
    t.handler.mockImplementationOnce(async () => { t.state.uid = 'u2'; return { ...patchOk('op-1'), resolution: 'committed' }; });
    await expect(t.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/identity-changed' });
    t.state.uid = 'u1';
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('exposes a non-technical pending probe', async () => {
    const t = typed();
    expect(await t.client.pending('P')).toEqual({ kind: 'absent' });
    await pend(t);
    expect(await t.client.pending('P')).toMatchObject({ kind: 'pending', resolved: false });
    sessionStorage.setItem(KEY('u1', 'P'), 'garbage');
    expect(await t.client.pending('P')).toMatchObject({ kind: 'error' });
  });
});

describe('direct command client shares the same journal', () => {
  const setup = (uid: () => string | null = () => 'u1') => {
    const calls: Record<string, unknown>[] = [];
    const call = vi.fn(async (input: Record<string, unknown>) => { calls.push(JSON.parse(JSON.stringify(input))); return responses.shift() ?? { ok: true }; });
    const responses: unknown[] = [];
    let n = 0;
    const client = createNativeMaterialCommandClient({ uid, call: call as never, operationId: () => `gen-${++n}` });
    return { client, calls, responses, call };
  };
  const snap = (command = true) => ({ ok: true, project_id: 'P', version: VERSION, categories: [], permissions: { command } });
  const del = { kind: 'delete_items' as const, item_ids: ['motor'] };

  it('persists before the write, retains ambiguity, and reuses the frozen nonce/version for the same command', async () => {
    const s = setup();
    let seen: string | null = null;
    s.call.mockImplementation(async (input: Record<string, unknown>) => {
      s.calls.push(JSON.parse(JSON.stringify(input)));
      if (input.operation === 'get') return snap();
      seen = sessionStorage.getItem(KEY('u1', 'P'));
      throw network();
    });
    await expect(s.client.submit('P', del, '41:2')).rejects.toMatchObject({ code: 'functions/unavailable' });
    expect(seen).toContain('"operation_id":"gen-1"');
    s.call.mockImplementation(async (input: Record<string, unknown>) => {
      s.calls.push(JSON.parse(JSON.stringify(input)));
      return input.operation === 'get' ? snap() : { ok: true, project_id: 'P', operation_id: 'gen-1', command_kind: 'delete_items' };
    });
    await s.client.submit('P', del, '40:0');
    const writes = s.calls.filter(c => c.operation === 'command');
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[1]).toMatchObject({ operation_id: 'gen-1', expected_version: '41:2' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('blocks a different command and a different operation while one is unresolved', async () => {
    const s = setup();
    s.call.mockImplementation(async (input: Record<string, unknown>) => { if (input.operation === 'get') return snap(); throw network(); });
    await expect(s.client.submit('P', del)).rejects.toBeTruthy();
    const before = s.call.mock.calls.length;
    await expect(s.client.submit('P', { kind: 'delete_items', item_ids: ['other'] })).rejects.toMatchObject({ code: 'native-material/recovery-required' });
    await expect(s.client.fulfill('P', 'motor', { kind: 'fulfillment', quantity: 1 })).rejects.toMatchObject({ code: 'native-material/recovery-required' });
    expect(s.call.mock.calls.slice(before).filter(([i]) => (i as { operation: string }).operation !== 'get')).toHaveLength(0);
  });

  it('protects fulfillment and releases a definite first-attempt rejection', async () => {
    const s = setup();
    s.responses.push(snap(), { ok: false, error: 'material_version_conflict' });
    await expect(s.client.fulfill('P', 'motor', { kind: 'fulfillment', quantity: 1 }, '42:6')).rejects.toMatchObject({ code: 'material_version_conflict' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
    s.call.mockImplementation(async (input: Record<string, unknown>) => { if (input.operation === 'get') return snap(); throw network(); });
    await expect(s.client.fulfill('P', 'motor', { kind: 'fulfillment', quantity: 1 }, '42:6')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('is blocked by a pending request written by the typed client (shared journal)', async () => {
    const t = typed();
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.patch('P', patchInput('op-1'), 'u1')).rejects.toBeTruthy();
    const s = setup();
    s.responses.push(snap());
    await expect(s.client.submit('P', del)).rejects.toMatchObject({ code: 'native-material/recovery-required' });
  });

  it('blocks writes on corrupt storage', async () => {
    sessionStorage.setItem(KEY('u1', 'P'), '[]');
    const s = setup();
    s.responses.push(snap());
    await expect(s.client.submit('P', del)).rejects.toMatchObject({ code: 'native-material/storage-unavailable' });
    expect(s.calls.filter(c => c.operation === 'command')).toHaveLength(0);
  });

  it('resolves with no snapshot/permission read, then acknowledges after an authoritative read', async () => {
    const s = setup();
    s.call.mockImplementation(async (input: Record<string, unknown>) => { if (input.operation === 'get') return snap(true); throw network(); });
    await expect(s.client.submit('P', del, '41:2')).rejects.toBeTruthy();
    s.calls.length = 0;
    s.call.mockImplementation(async (input: Record<string, unknown>) => {
      s.calls.push(JSON.parse(JSON.stringify(input)));
      return input.operation === 'get' ? snap(false) : { ok: true, project_id: 'P', operation_id: 'gen-1', command_kind: 'delete_items', resolution: 'cancelled' };
    });
    await expect(s.client.resolve('P')).resolves.toMatchObject({ resolution: 'cancelled' });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ operation: 'command', resolve_only: true, operation_id: 'gen-1', expected_version: '41:2', expected_actor_uid: 'u1' });
    await s.client.acknowledge('P');
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('does not let a different account resolve or acknowledge', async () => {
    let user: string | null = 'u1';
    const s = setup(() => user);
    s.call.mockImplementation(async (input: Record<string, unknown>) => { if (input.operation === 'get') return snap(); throw network(); });
    await expect(s.client.submit('P', del)).rejects.toBeTruthy();
    user = 'u2';
    await expect(s.client.resolve('P')).rejects.toMatchObject({ code: 'native-material/nothing-pending' });
    user = null;
    await expect(s.client.resolve('P')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });
});
