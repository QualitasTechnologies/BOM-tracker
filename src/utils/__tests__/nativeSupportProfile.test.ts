import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeSupportProfileClient,
  createNativeSupportProfileWorkspace,
  createNativeSupportProfileDiff,
  hasPendingNativeSupportProfile,
  isNativeSupportProfileEnabled,
} from '../nativeSupportProfile';

const id = () => 'operation-1';

it('reports blocked browser session storage access instead of crashing pending discovery', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw Error('blocked browser storage'); } });
    expect(hasPendingNativeSupportProfile('P', 'partner')).toMatchObject({ kind: 'error' });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

it('rejects damaged saved scalar or required-machine fields before the form can preview them', () => {
  for (const command of [
    { kind: 'support_profile', patch: { internalNotes: { invalid: true } } },
    { kind: 'support_profile', machines: [{ kind: 'add', machine: { id: 'm' } }] },
    { kind: 'support_profile', machines: [{ kind: 'patch', id: 'm', patch: { name: null } }] },
  ]) {
    const raw = JSON.stringify({ expected_version: '10:1', operation_id: 'one', command });
    expect(hasPendingNativeSupportProfile('P', 'partner', { getItem: () => raw })).toMatchObject({ kind: 'error' });
  }
});
const base = { version: '2:4', actor_uid: 'u1', project_id: 'p1', support_profile: {
  internalNotes: 'old', machines: [{ id: 'm1', name: 'Line A', serialNumber: 'A', vendorSecret: 'retain' }],
  supportContacts: [{ name: 'legacy' }], rootUnknown: 'retain',
} };

describe('native Support profile diff', () => {
  it('turns undefined optional clears into explicit null and never freezes undefined payload fields', () => {
    const command = createNativeSupportProfileDiff({ supportContactId: 'old', machines: [{ id: 'm', name: 'N', serialNumber: 'S', notes: 'Old' }] }, {
      supportContactId: undefined, internalNotes: undefined, machines: [{ id: 'm', name: 'N', serialNumber: 'S', notes: undefined }],
    });
    expect(command).toEqual({ kind: 'support_profile', patch: { supportContactId: null }, machines: [{ kind: 'patch', id: 'm', patch: { notes: null } }] });
    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
  });
  it('emits only explicit known changes and preserves machine order and unknown data by omission', () => {
    const command = createNativeSupportProfileDiff(base.support_profile, {
      internalNotes: 'new', machines: [{ id: 'm1', name: 'Line B', serialNumber: 'A', vendorSecret: 'changed' }, { id: 'm2', name: 'Line C', serialNumber: 'C', raw: 1 }],
      supportContacts: [], raw: 'never send',
    });
    expect(command).toEqual({ kind: 'support_profile', patch: { internalNotes: 'new' }, machines: [
      { kind: 'patch', id: 'm1', patch: { name: 'Line B' } },
      { kind: 'add', machine: { id: 'm2', name: 'Line C', serialNumber: 'C' } },
    ] });
    expect(JSON.stringify(command)).not.toContain('supportContacts');
    expect(JSON.stringify(command)).not.toContain('vendorSecret');
  });
  it('clears an optional draft field only when it existed in the captured profile', () => {
    expect(createNativeSupportProfileDiff({ warrantyEndDate: '2026-01-01' }, {})).toEqual({ kind: 'support_profile', patch: { warrantyEndDate: null } });
    expect(createNativeSupportProfileDiff({}, {})).toBeNull();
  });
  it('migrates a legacy primary machine before applying machine changes', () => {
    const legacy = { machineSerialNumber: 'S', machineModel: 'X', siteLocation: 'West' };
    expect(createNativeSupportProfileDiff(legacy, { ...legacy, machines: [{ id: 'm1', name: 'Primary', serialNumber: 'S' }] })).toEqual({
      kind: 'support_profile', machines: [{ kind: 'migrate_legacy' }, { kind: 'remove', id: 'legacy-primary-machine' }, { kind: 'add', machine: { id: 'm1', name: 'Primary', serialNumber: 'S' } }],
    });
  });
  it('rejects duplicate or invalid machine IDs instead of inferring removals', () => {
    expect(() => createNativeSupportProfileDiff({}, { machines: [{ id: 'same' }, { id: 'same' }] })).toThrow(/valid and unique/);
    expect(() => createNativeSupportProfileDiff({ machines: [{ name: 'missing id' }] }, { machines: [] })).toThrow(/valid and unique/);
  });
  it('preserves document IDs containing spaces and up to 512 characters', () => {
    const machineId = `machine ${'x'.repeat(500)}`;
    expect(createNativeSupportProfileDiff({ machines: [] }, { machines: [{ id: machineId, name: 'Named' }] })).toEqual({
      kind: 'support_profile', machines: [{ kind: 'add', machine: { id: machineId, name: 'Named' } }],
    });
  });
});

describe('native Support profile client', () => {
  it('uses the exact default-off feature flag', () => {
    expect(isNativeSupportProfileEnabled({ VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED: 'true' })).toBe(true);
    expect(isNativeSupportProfileEnabled({ VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED: 'TRUE' })).toBe(false);
    expect(isNativeSupportProfileEnabled({})).toBe(false);
  });
  it('discovers pending requests while the flag is off and fails closed on malformed saved state', () => {
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    expect(isNativeSupportProfileEnabled({ VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED: 'false' })).toBe(false);
    expect(hasPendingNativeSupportProfile('p1', 'u1', store)).toEqual({ kind: 'absent' });
    store.setItem('bom.support-profile.v1:["u1","p1"]', JSON.stringify({ expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { internalNotes: 'saved' } } }));
    expect(hasPendingNativeSupportProfile('p1', 'u1', store)).toEqual({ kind: 'pending' });
    store.setItem('bom.support-profile.v1:["u1","p1"]', JSON.stringify({ expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { supportContacts: [] } } }));
    expect(hasPendingNativeSupportProfile('p1', 'u1', store).kind).toBe('error');
    expect(hasPendingNativeSupportProfile('p1', 'u1', { getItem() { throw Error('blocked'); } }).kind).toBe('error');
  });
  it('binds callable replies to UID, project, revision, operation ID, and context across awaits', async () => {
    let current = 'u1';
    const callable = vi.fn(async (payload: Record<string, unknown>) => ({ data: { ok: true, project_id: payload.project_id, actor_uid: 'u1', version: '2:4', support_profile: null, permissions: { edit: true, resolve: true }, operation_id: payload.operation_id } }));
    const client = createNativeSupportProfileClient({ currentUid: () => current, callable });
    const snap = await client.get('p1', 'u1');
    expect(snap.support_profile).toBeNull();
    const req = { expected_version: snap.version, operation_id: id(), command: { kind: 'support_profile' as const, patch: { internalNotes: 'safe' } } };
    await client.command('p1', req, 'u1');
    expect(callable.mock.calls[0][0]).toMatchObject({ operation: 'support_get', expected_actor_uid: 'u1' });
    expect(callable.mock.calls[1][0]).toMatchObject({ operation: 'command', expected_actor_uid: 'u1', command: req.command });
    current = 'u2';
    await expect(client.get('p1', 'u1')).rejects.toMatchObject({ code: 'native-support/actor_session_changed' });
  });
  it('rejects mismatched actor, project, revision and operation receipt', async () => {
    const client = createNativeSupportProfileClient({ currentUid: () => 'u1', callable: async () => ({ data: { ok: true, project_id: 'other', actor_uid: 'someone', version: 'nope', support_profile: {}, permissions: { edit: true, resolve: true }, operation_id: 'wrong' } }) });
    await expect(client.get('p1', 'u1')).rejects.toMatchObject({ code: 'native-support/invalid-response' });
  });
  it('accepts write receipt shape and rejects malformed get revisions', async () => {
    const payloads: Record<string, unknown>[] = [];
    const writeClient = createNativeSupportProfileClient({ currentUid: () => 'u1', callable: async payload => {
      payloads.push(payload);
      return { data: { ok: true, project_id: 'p1', ...(payload.operation === 'support_get' ? { actor_uid: 'u1', version: '1:0', support_profile: null, permissions: { edit: true, resolve: true } } : { operation_id: 'operation-1', ...(payload.resolve_only ? { resolution: 'cancelled' } : {}) }) } };
    } });
    await expect(writeClient.command('p1', { expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { internalNotes: 'x' } } }, 'u1')).resolves.toMatchObject({ operation_id: 'operation-1' });
    await expect(writeClient.resolve('p1', { expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { internalNotes: 'x' } } }, 'u1')).resolves.toMatchObject({ resolution: 'cancelled' });
    expect(payloads[1]).toMatchObject({ expected_version: '1:0', operation_id: 'operation-1', command: { patch: { internalNotes: 'x' } }, resolve_only: true });
    expect(payloads[1]).not.toHaveProperty('cancel');
    const badRead = createNativeSupportProfileClient({ currentUid: () => 'u1', callable: async () => ({ data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: 'missing', support_profile: null, permissions: { edit: true, resolve: true } } }) });
    await expect(badRead.get('p1', 'u1')).rejects.toMatchObject({ code: 'native-support/invalid-response' });
  });
  it('validates the write operation ID while accepting project IDs with spaces', async () => {
    const longProjectId = `project ${'x'.repeat(500)}`;
    const client = createNativeSupportProfileClient({ currentUid: () => 'u1', callable: async payload => ({ data: { ok: true, project_id: payload.project_id, operation_id: 'wrong' } }) });
    await expect(client.command(longProjectId, { expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { internalNotes: 'x' } } }, 'u1')).rejects.toMatchObject({ code: 'native-support/invalid-response' });
  });
  it('refuses deprecated contacts and unknown raw fields even when a caller bypasses the diff helper', async () => {
    const client = createNativeSupportProfileClient({ currentUid: () => 'u1', callable: async () => ({ data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:1', operation_id: 'operation-1' } }) });
    await expect(client.command('p1', { expected_version: '1:0', operation_id: 'operation-1', command: { kind: 'support_profile', patch: { supportContacts: [] } } } as never, 'u1')).rejects.toMatchObject({ code: 'native-support/invalid-response' });
  });
  it('rejects an in-flight reply when the actor or captured context changes before it returns', async () => {
    let current = 'u1';
    let finish!: (result: { data: unknown }) => void;
    let invalidate = false;
    const client = createNativeSupportProfileClient({
      currentUid: () => current,
      callable: async () => new Promise(resolve => { finish = resolve; }),
    });
    const pending = client.get('p1', 'u1', () => { if (invalidate) throw Object.assign(new Error('stale'), { code: 'stale-context' }); });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    current = 'u2';
    finish({ data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:0', support_profile: null, permissions: { edit: true, resolve: true } } });
    await expect(pending).rejects.toMatchObject({ code: 'native-support/actor_session_changed' });

    current = 'u1';
    const pendingContext = client.get('p1', 'u1', () => { if (invalidate) throw Object.assign(new Error('stale'), { code: 'stale-context' }); });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    invalidate = true;
    finish({ data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:0', support_profile: null, permissions: { edit: true, resolve: true } } });
    await expect(pendingContext).rejects.toMatchObject({ code: 'stale-context' });
  });
});

describe('native Support profile workspace', () => {
  let values: Map<string, string>;
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
  beforeEach(() => { values = new Map(); });
  const snapshot = { ok: true as const, project_id: 'p1', actor_uid: 'u1', version: '1:0', support_profile: { internalNotes: 'a' }, permissions: { edit: true, resolve: true } };

  it('freezes a command and nonce across uncertain retry and reload, then resolves the same payload', async () => {
    const calls: unknown[] = [];
    let failOnce = true;
    const client = { currentUid: () => 'u1', get: async () => snapshot, command: async (_p: string, input: unknown) => { calls.push(input); if (failOnce) { failOnce = false; throw Error('lost ack'); } return { ok: true }; }, resolve: async (_p: string, input: unknown) => { calls.push({ resolve_only: true, ...input as object }); return { ok: true, resolution: 'committed' as const }; } };
    const first = createNativeSupportProfileWorkspace('p1', client, 'u1', { storage: storage(), operationId: id });
    await first.load();
    const draft = first.capture();
    const command = { kind: 'support_profile' as const, patch: { internalNotes: 'b' } };
    await expect(draft.submit(command)).rejects.toThrow('lost ack');
    const persisted = [...values.values()][0];
    expect(hasPendingNativeSupportProfile('p1', 'u1', storage())).toEqual({ kind: 'pending' });
    const reloaded = createNativeSupportProfileWorkspace('p1', client, 'u1', { storage: storage(), operationId: () => 'new-id' });
    await reloaded.load();
    const recovered = reloaded.capture();
    await expect(recovered.submit({ kind: 'support_profile', patch: { internalNotes: 'different' } })).rejects.toMatchObject({ code: 'native-support/operation-conflict' });
    await recovered.submit(command);
    expect(persisted).toContain('operation-1');
    expect(values.size).toBe(0); // Confirmed success retires the saved request.
    await recovered.resolve();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[2]).toMatchObject({ expected_version: '1:0', operation_id: 'operation-1', command, resolve_only: true });
  });
  it('resolves cancellation using only resolve_only and the frozen revision, nonce and exact payload', async () => {
    const valuesClient = { currentUid: () => 'u1', get: async () => snapshot, command: async () => { throw Error('unconfirmed'); }, resolve: async (_p: string, input: unknown) => ({ ok: true, resolution: 'cancelled' as const, input }) };
    const workspace = createNativeSupportProfileWorkspace('p1', valuesClient, 'u1', { storage: storage(), operationId: id });
    await workspace.load();
    const draft = workspace.capture();
    const command = { kind: 'support_profile' as const, patch: { internalNotes: 'frozen' } };
    await expect(draft.submit(command)).rejects.toThrow('unconfirmed');
    const reloaded = createNativeSupportProfileWorkspace('p1', valuesClient, 'u1', { storage: storage(), operationId: () => 'different-id' });
    await reloaded.load();
    expect(await reloaded.capture().cancel()).toMatchObject({ resolution: 'cancelled', input: { expected_version: '1:0', operation_id: 'operation-1', command } });
    expect(values.size).toBe(0);
  });
  it('invalidates captured workspace after an A-B-A context change and fails closed on storage errors', async () => {
    const client = { currentUid: () => 'u1', get: async () => snapshot, command: async () => ({ ok: true }), resolve: async () => ({ ok: true, resolution: 'cancelled' as const }) };
    const blocked = createNativeSupportProfileWorkspace('p1', client, 'u1', { storage: { getItem() { throw Error('blocked'); }, setItem() {}, removeItem() {} }, operationId: id });
    await blocked.load();
    expect(() => blocked.capture()).toThrow(/saved Support profile request could not be read/);
    const workspace = createNativeSupportProfileWorkspace('p1', client, 'u1', { storage: storage(), operationId: id });
    await workspace.load();
    const draft = workspace.capture();
    workspace.invalidate(); // A -> B invalidates the old instance; returning to A creates a new workspace.
    const returnedToA = createNativeSupportProfileWorkspace('p1', client, 'u1', { storage: storage(), operationId: () => 'operation-2' });
    await returnedToA.load();
    await expect(draft.resolve()).rejects.toMatchObject({ code: 'native-support/context-changed' });
  });
});
