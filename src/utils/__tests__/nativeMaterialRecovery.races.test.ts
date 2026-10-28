import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeMaterialOperationsClient } from '../nativeMaterialOperations';
import { createNativeMaterialCommandClient } from '../nativeMaterialCommands';

const KEY = (uid: string, project: string) => `pulse.material-write.v1:${JSON.stringify([uid, project])}`;
const VERSION = '42:7';
const patchInput = (operation_id = 'op-1') => ({ item_id: 'motor', expected_version: '42:6', operation_id, patch: { quantity: 3 } });
const patchOk = (operation_id = 'op-1') => ({ ok: true, project_id: 'P', item_id: 'motor', operation_id, item: { id: 'motor' } });
const getOk = (version = VERSION) => ({ ok: true, project_id: 'P', categories: [], version, permissions: { review: true, edit: false, command: false } });
const network = () => Object.assign(new Error('offline'), { code: 'functions/unavailable' });
const cancelledPatch = { ok: true, project_id: 'P', operation_id: 'op-1', item_id: 'motor', resolution: 'cancelled' };
const projectInput = { operation_id: 'create-1', project: { projectName: 'A', clientName: 'B', description: '', status: 'Planning' as const, deadline: '2026-12-01', poValue: 0 } };

const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const quiet = (promise: Promise<unknown>) => { promise.catch(() => undefined); return promise; };

const gated = () => {
  const gates: ReturnType<typeof deferred<unknown>>[] = [];
  const client = createNativeMaterialOperationsClient({
    getCurrentUser: () => ({ uid: 'u1' }),
    callable: async () => { const gate = deferred<unknown>(); gates.push(gate); return { data: await gate.promise }; },
  });
  return { client, gates };
};

beforeEach(() => sessionStorage.clear());

describe('journal clears are bound to the original entry', () => {
  it.each(['success', 'rejection'])('a late %s from an old attempt cannot clear a newer request', async kind => {
    const { client, gates } = gated();
    const first = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick();
    const second = quiet(client.patch('P', patchInput('op-1'), 'u1')); // same frozen request, attempt 2, while attempt 1 is in flight
    await tick();
    expect(gates).toHaveLength(2);
    gates[0].resolve(patchOk('op-1'));
    await first;
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
    quiet(client.patch('P', patchInput('op-C'), 'u1'));
    await tick();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('op-C');
    gates[1].resolve(kind === 'success' ? patchOk('op-1') : { ok: false, error: 'material_version_conflict' });
    await second.catch(() => undefined);
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('op-C');
  });

  it('a first-attempt rejection does not release once a second attempt has begun', async () => {
    const { client, gates } = gated();
    const first = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick();
    const second = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick();
    gates[0].resolve({ ok: false, error: 'material_version_conflict' });
    await first.catch(() => undefined);
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('op-1');
    gates[1].resolve(patchOk('op-1'));
    await second;
  });

  it('a late second acknowledge cannot clear a newer request', async () => {
    const { client, gates } = gated();
    const write = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick(); gates[0].reject(network()); await write.catch(() => undefined);
    const resolving = client.resolve('P'); await tick();
    gates[1].resolve(cancelledPatch); await resolving;
    const ack1 = quiet(client.acknowledge('P'));
    const ack2 = quiet(client.acknowledge('P'));
    await tick();
    expect(gates).toHaveLength(4);
    gates[2].resolve(getOk()); await ack1;
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
    quiet(client.patch('P', patchInput('op-C'), 'u1'));
    await tick();
    gates[3].resolve(getOk());
    await expect(ack2).rejects.toMatchObject({ code: 'native-material/recovery-changed' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('op-C');
  });

  it('a resolution that lands after the entry was replaced is not written onto the new entry', async () => {
    const { client, gates } = gated();
    const write = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick(); gates[0].reject(network()); await write.catch(() => undefined);
    const resolving = quiet(client.resolve('P'));
    await tick();
    sessionStorage.removeItem(KEY('u1', 'P')); // e.g. another tab acknowledged it
    quiet(client.patch('P', patchInput('op-C'), 'u1'));
    await tick();
    gates[1].resolve(cancelledPatch);
    await expect(resolving).rejects.toMatchObject({ code: 'native-material/recovery-changed' });
    expect(JSON.parse(sessionStorage.getItem(KEY('u1', 'P'))!)).not.toHaveProperty('resolution');
  });

  it('the same nonce and payload recreated after a clear is a different entry', async () => {
    const { client, gates } = gated();
    const first = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick();
    const second = quiet(client.patch('P', patchInput('op-1'), 'u1'));
    await tick();
    gates[0].resolve(patchOk('op-1')); await first;
    const again = quiet(client.patch('P', patchInput('op-1'), 'u1')); // identical request, brand-new entry
    await tick();
    gates[2].reject(network()); await again.catch(() => undefined);
    gates[1].resolve(patchOk('op-1')); await second;
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });
});

describe('cancelled creation acknowledgement', () => {
  const typed = () => {
    const handler = vi.fn(async (_payload: Record<string, unknown>): Promise<unknown> => ({ ok: true }));
    const client = createNativeMaterialOperationsClient({ getCurrentUser: () => ({ uid: 'u1' }), callable: async payload => ({ data: await handler(payload) }) });
    return { client, handler };
  };
  const cancelledCreate = async (readResult: () => unknown) => {
    const t = typed();
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.createProject('P', projectInput, 'u1')).rejects.toBeTruthy();
    t.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'create-1', resolution: 'cancelled' });
    await t.client.resolve('P');
    t.handler.mockImplementationOnce(async () => { const out = readResult(); if (out instanceof Error) throw out; return out; });
    return t;
  };

  it('accepts only the authoritative project_not_found for the same user', async () => {
    const t = await cancelledCreate(() => ({ ok: false, error: 'project_not_found' }));
    await expect(t.client.acknowledge('P')).resolves.toBeNull();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it.each([
    ['network', () => network()],
    ['forbidden', () => ({ ok: false, error: 'project_forbidden' })],
    ['transport not-found', () => Object.assign(new Error('nf'), { code: 'functions/not-found' })],
    ['unavailable', () => ({ ok: false, error: 'project_operations_unavailable' })],
  ])('keeps the journal on %s', async (_name, read) => {
    const t = await cancelledCreate(read as () => unknown);
    await expect(t.client.acknowledge('P')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('is not accepted for a cancelled patch or a committed creation', async () => {
    const a = typed();
    a.handler.mockRejectedValueOnce(network());
    await expect(a.client.patch('P', patchInput('op-1'), 'u1')).rejects.toBeTruthy();
    a.handler.mockResolvedValueOnce(cancelledPatch);
    await a.client.resolve('P');
    a.handler.mockResolvedValueOnce({ ok: false, error: 'project_not_found' });
    await expect(a.client.acknowledge('P')).rejects.toMatchObject({ code: 'project_not_found' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
    sessionStorage.clear();
    const b = typed();
    b.handler.mockRejectedValueOnce(network());
    await expect(b.client.createProject('P', projectInput, 'u1')).rejects.toBeTruthy();
    b.handler.mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'create-1', resolution: 'committed' });
    await b.client.resolve('P');
    b.handler.mockResolvedValueOnce({ ok: false, error: 'project_not_found' });
    await expect(b.client.acknowledge('P')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it('direct command client: cancelled creation never reaches it, but its acknowledge also needs a real read', async () => {
    const snap = { ok: true, project_id: 'P', version: VERSION, categories: [], permissions: { command: true } };
    const call = vi.fn(async (input: Record<string, unknown>): Promise<unknown> => { if (input.operation === 'get') return snap; throw network(); });
    const client = createNativeMaterialCommandClient({ uid: () => 'u1', call: call as never, operationId: () => 'gen-1' });
    await expect(client.submit('P', { kind: 'delete_items', item_ids: ['motor'] }, '41:2')).rejects.toBeTruthy();
    call.mockImplementation(async (input: Record<string, unknown>) => input.operation === 'get' ? { ok: false, error: 'project_not_found' } : { ok: true, project_id: 'P', operation_id: 'gen-1', command_kind: 'delete_items', resolution: 'cancelled' });
    await client.resolve('P');
    await expect(client.acknowledge('P')).rejects.toBeTruthy();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });
});

describe('direct command client: races and classification', () => {
  const snapOk = { ok: true, project_id: 'P', version: VERSION, categories: [], permissions: { command: true } };
  it('a late old completion cannot clear a newer request; unknown refusals are retained', async () => {
    const gates: ReturnType<typeof deferred<unknown>>[] = [];
    let n = 0;
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.operation === 'get') return snapOk;
      const gate = deferred<unknown>(); gates.push(gate); return (await gate.promise) as never;
    });
    const client = createNativeMaterialCommandClient({ uid: () => 'u1', call: call as never, operationId: () => `gen-${++n}` });
    const del = { kind: 'delete_items' as const, item_ids: ['motor'] };
    const first = quiet(client.submit('P', del, '41:2'));
    await tick();
    const second = quiet(client.submit('P', del, '41:2'));
    await tick();
    expect(gates).toHaveLength(2);
    gates[0].resolve({ ok: true, project_id: 'P', operation_id: 'gen-1', command_kind: 'delete_items' }); await first;
    const other = quiet(client.submit('P', { kind: 'delete_items', item_ids: ['other'] }, '41:2'));
    await tick();
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('other');
    gates[2].resolve({ ok: false, error: 'project_operations_unavailable' });
    await other.catch(() => undefined);
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('other');
    gates[1].resolve({ ok: true, project_id: 'P', operation_id: 'gen-1', command_kind: 'delete_items' });
    await second.catch(() => undefined);
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toContain('other');
  });

  it('accepts the exact backend cancelled patch shape (no item) through the direct client', async () => {
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.operation === 'get') return snapOk;
      if (input.resolve_only) return { ok: true, project_id: 'P', operation_id: 'gen-1', item_id: 'motor', resolution: 'cancelled' };
      throw network();
    });
    const client = createNativeMaterialCommandClient({ uid: () => 'u1', call: call as never, operationId: () => 'gen-1' });
    await expect(client.fulfill('P', 'motor', { kind: 'fulfillment', quantity: 1 }, '41:2')).rejects.toBeTruthy();
    await expect(client.resolve('P')).resolves.toMatchObject({ resolution: 'cancelled' });
  });
});

describe('listing pending requests for entry points without a project page', () => {
  it('lists only this user\'s saved requests, including unreadable ones', async () => {
    const { listPendingNativeMaterialProjects } = await import('../nativeMaterialRecovery');
    const handler = vi.fn(async (_payload?: unknown): Promise<unknown> => { throw network(); });
    const client = createNativeMaterialOperationsClient({ getCurrentUser: () => ({ uid: 'u1' }), callable: async payload => ({ data: await handler(payload as never) }) });
    await expect(client.createProject('NEW', projectInput, 'u1')).rejects.toBeTruthy();
    await expect(client.patch('P', patchInput('op-1'), 'u1')).rejects.toBeTruthy();
    sessionStorage.setItem(KEY('u2', 'OTHER'), '{}');
    sessionStorage.setItem(KEY('u1', 'BAD'), 'garbage');
    sessionStorage.setItem('unrelated', 'x');
    const list = listPendingNativeMaterialProjects('u1');
    expect(list.map(entry => entry.projectId).sort()).toEqual(['BAD', 'NEW', 'P']);
    expect(list.find(entry => entry.projectId === 'NEW')).toMatchObject({ operation: 'create_project' });
    expect(list.find(entry => entry.projectId === 'BAD')).toMatchObject({ operation: 'unknown' });
    expect(listPendingNativeMaterialProjects('')).toEqual([]);
  });
});

describe('validation refusals and resolved entries (final review)', () => {
  const typedClient = () => {
    const handler = vi.fn(async (_payload?: unknown): Promise<unknown> => ({ ok: true }));
    const client = createNativeMaterialOperationsClient({ getCurrentUser: () => ({ uid: 'u1' }), callable: async payload => ({ data: await handler(payload) }) });
    return { client, handler };
  };

  it.each([
    'invalid_material_patch', 'invalid_material_fulfillment', 'invalid_material_command', 'invalid_material_version',
    'invalid_receipt_photo', 'invalid_resource', 'invalid_project_create', 'invalid_material_request', 'invalid_material_state',
    'invalid_material_category', 'invalid_item_id', 'invalid_operation_id', 'invalid_project_id', 'actor_forbidden',
  ])('first-attempt %s releases without getting stuck', async code => {
    const t = typedClient();
    t.handler.mockResolvedValueOnce({ ok: false, error: code });
    await expect(t.client.patch('P', patchInput('op-1'), 'u1')).rejects.toMatchObject({ code });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it('a non-member project_id_conflict on first create releases', async () => {
    const t = typedClient();
    t.handler.mockResolvedValueOnce({ ok: false, error: 'project_id_conflict' });
    await expect(t.client.createProject('P', projectInput, 'u1')).rejects.toMatchObject({ code: 'project_id_conflict' });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
  });

  it.each(['invalid_material_patch', 'project_id_conflict'])('%s after an earlier ambiguous attempt is retained', async code => {
    const t = typedClient();
    t.handler.mockRejectedValueOnce(network());
    await expect(t.client.patch('P', patchInput('op-1'), 'u1')).rejects.toBeTruthy();
    t.handler.mockResolvedValueOnce({ ok: false, error: code });
    await expect(t.client.patch('P', patchInput('op-1'), 'u1')).rejects.toMatchObject({ code });
    expect(sessionStorage.getItem(KEY('u1', 'P'))).not.toBeNull();
  });

  it.each([['success', patchOk('op-1')], ['cancelled rejection', { ok: false, error: 'material_request_cancelled' }]])(
    'a late original %s cannot clear an entry already resolved; it stays until acknowledged', async (_name, late) => {
      const { client, gates } = gated();
      const first = quiet(client.patch('P', patchInput('op-1'), 'u1'));
      await tick();
      const second = quiet(client.patch('P', patchInput('op-1'), 'u1'));
      await tick();
      gates[0].reject(network()); await first.catch(() => undefined);
      const resolving = client.resolve('P'); await tick();
      gates[2].resolve(cancelledPatch); await resolving;
      gates[1].resolve(late); await second.catch(() => undefined);
      expect(JSON.parse(sessionStorage.getItem(KEY('u1', 'P'))!)).toMatchObject({ resolution: 'cancelled' });
      const ack = quiet(client.acknowledge('P')); await tick();
      gates[3].resolve(getOk()); await ack;
      expect(sessionStorage.getItem(KEY('u1', 'P'))).toBeNull();
    });
});
