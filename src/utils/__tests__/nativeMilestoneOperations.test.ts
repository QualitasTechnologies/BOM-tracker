import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeMilestoneClient, createNativeMilestoneSession } from '../nativeMilestoneOperations';

const HASH = 'a'.repeat(64);
const REASON = 'Client approval was delayed by two weeks';
const snapshotData = (over: Record<string, unknown> = {}) => ({
  ok: true, project_id: 'p1', project: { projectId: 'p1', projectName: 'Plant', deadline: '2026-12-01', secret: 'x' },
  milestones: [{ id: 'm1', name: 'A', order: 1, currentPlannedEndDate: '2026-11-01', status: 'not-started' }, { id: 'm2', name: 'B', order: 2 }],
  project_version: '4:7', schedule_version: HASH, permissions: { edit: true }, ...over,
});
const resultData = (over: Record<string, unknown> = {}) => ({ ok: true, project_id: 'p1', operation_id: 'op1', kind: 'status', milestone_id: 'm1', ...over });
const input = (command: any = { kind: 'status', milestone_id: 'm1', status: 'completed' }, over: Record<string, unknown> = {}) =>
  ({ expected_project_version: '4:7', expected_schedule_version: HASH, operation_id: 'op1', command, ...over });
const makeClient = (uid = () => 'u1', callable = vi.fn()) => ({ client: createNativeMilestoneClient({ currentUid: async () => uid(), callable }), callable });

describe('native milestone client', () => {
  it('gets with the exact payload and keeps only the allow-listed project fields', async () => {
    const { client, callable } = makeClient();
    callable.mockResolvedValue({ data: snapshotData() });
    const snap = await client.get('p1', 'u1');
    expect(callable.mock.calls[0][0]).toEqual({ operation: 'get', project_id: 'p1', expected_actor_uid: 'u1' });
    expect(snap.project).toEqual({ projectId: 'p1', projectName: 'Plant', deadline: '2026-12-01' });
    expect(snap.milestones).toHaveLength(2);
    expect(client.currentUid).toBeTypeOf('function');
  });
  it('rejects malformed snapshots', async () => {
    const bad = [{ project_id: 'other' }, { project: { id: 'other' } }, { project_version: 'x' }, { project_version: 'missing' }, { schedule_version: 'abc' },
      { schedule_version: 'A'.repeat(64) }, { permissions: { edit: 'yes' } }, { permissions: null }, { milestones: {} }, { milestones: [{ id: 'm1' }, { id: 'm1' }] },
      { milestones: [{ id: 'a/b' }] }, { milestones: [{ name: 'no id' }] }, { milestones: Array.from({ length: 401 }, (_, i) => ({ id: `m${i}` })) }, { ok: false }];
    for (const over of bad) {
      const { client, callable } = makeClient();
      callable.mockResolvedValue({ data: snapshotData(over) });
      await expect(client.get('p1', 'u1')).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
    }
  });
  it('accepts a 400-milestone schedule and an empty one', async () => {
    const { client, callable } = makeClient();
    callable.mockResolvedValue({ data: snapshotData({ milestones: Array.from({ length: 400 }, (_, i) => ({ id: `m${i}` })) }) });
    expect((await client.get('p1', 'u1')).milestones).toHaveLength(400);
    callable.mockResolvedValue({ data: snapshotData({ milestones: [] }) });
    expect((await client.get('p1', 'u1')).milestones).toEqual([]);
  });
  it('sends the exact command payload and resolve adds only resolve_only', async () => {
    const { client, callable } = makeClient();
    callable.mockResolvedValue({ data: resultData() });
    const i = input();
    await client.command('p1', 'u1', i);
    expect(callable.mock.calls[0][0]).toEqual({ operation: 'command', project_id: 'p1', expected_actor_uid: 'u1', expected_project_version: '4:7', expected_schedule_version: HASH, operation_id: 'op1', command: i.command });
    callable.mockResolvedValue({ data: resultData({ resolution: 'committed' }) });
    const r = await client.resolve('p1', 'u1', i);
    expect(callable.mock.calls[1][0]).toEqual({ ...callable.mock.calls[0][0], resolve_only: true });
    expect(r.resolution).toBe('committed');
  });
  const validCommands: any[] = [
    { kind: 'add', milestone_id: 'n1', input: { name: 'N', currentPlannedEndDate: '2026-11-01' } },
    { kind: 'add', milestone_id: 'n1', input: { name: 'N', description: 'd', currentPlannedEndDate: '2026-11-01', status: 'in-progress' } },
    { kind: 'edit', milestone_id: 'm1', patch: { name: 'x', description: null } },
    { kind: 'edit', milestone_id: 'm1', patch: { currentPlannedEndDate: '2026-11-09' }, delay: { reason: REASON, attribution: 'external-client' } },
    { kind: 'status', milestone_id: 'm1', status: 'blocked' },
    { kind: 'status', milestone_id: 'm1', status: 'completed', progress_note: 'done' },
    { kind: 'date', milestone_id: 'm1', new_date: '2026-11-09' },
    { kind: 'date', milestone_id: 'm1', new_date: '2026-11-09', delay: { reason: REASON, attribution: 'internal-team' } },
    { kind: 'delete', milestone_id: 'm1' },
    { kind: 'reorder', milestone_ids: ['m2', 'm1'] },
    { kind: 'template' }, { kind: 'baseline_lock' },
  ];
  it('accepts every documented command shape', async () => {
    for (const command of validCommands) {
      const { client, callable } = makeClient();
      callable.mockResolvedValue({ data: resultData({ kind: command.kind, milestone_id: command.milestone_id }) });
      await expect(client.command('p1', 'u1', input(command))).resolves.toMatchObject({ kind: command.kind });
    }
  });
  it('rejects malformed input before any network call', async () => {
    const bads: any[] = [
      input(undefined, { expected_project_version: 'missing' }), input(undefined, { expected_project_version: '1' }), input(undefined, { expected_schedule_version: 'zz' }),
      input(undefined, { operation_id: '' }), input(undefined, { operation_id: 'bad nonce!' }), input(undefined, { extra: 1 }), input(null), input('status'),
      input({ kind: 'nope' }), input({ kind: 'template', extra: 1 }), input({ kind: 'baseline_lock', milestone_id: 'm1' }), input({ kind: 'delete' }), input({ kind: 'delete', milestone_id: 'a/b' }),
      input({ kind: 'add', milestone_id: 'n1', input: { currentPlannedEndDate: '2026-11-01' } }), input({ kind: 'add', milestone_id: 'n1', input: { name: 'N', currentPlannedEndDate: '2026-11-01', order: 3 } }),
      input({ kind: 'add', milestone_id: 'n1' }), input({ kind: 'edit', milestone_id: 'm1', patch: {} }), input({ kind: 'edit', milestone_id: 'm1', patch: { originalPlannedEndDate: '2026-01-01' } }),
      input({ kind: 'edit', milestone_id: 'm1', patch: { name: 5 } }), input({ kind: 'edit', milestone_id: 'm1', patch: { description: 5 } }),
      input({ kind: 'edit', milestone_id: 'm1', patch: { name: 'x' }, delay: { reason: 'too short', attribution: 'internal-team' } }),
      input({ kind: 'edit', milestone_id: 'm1', patch: { name: 'x' }, delay: { reason: REASON, attribution: 'martians' } }),
      input({ kind: 'date', milestone_id: 'm1', new_date: '2026-11-09', delay: { reason: REASON, attribution: 'external-other', previousDate: 'x' } }),
      input({ kind: 'date', milestone_id: 'm1' }), input({ kind: 'status', milestone_id: 'm1' }), input({ kind: 'status', milestone_id: 'm1', status: 'completed', actor: 'u9' }),
      input({ kind: 'reorder', milestone_ids: [] }), input({ kind: 'reorder', milestone_ids: ['m1', 'm1'] }), input({ kind: 'reorder', milestone_ids: ['a/b'] }),
      input({ kind: 'reorder', milestone_ids: Array.from({ length: 401 }, (_, i) => `m${i}`) }), input({ kind: 'reorder', milestone_ids: 'm1' }),
    ];
    for (const bad of bads) {
      const { client, callable } = makeClient();
      await expect(client.command('p1', 'u1', bad)).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
      await expect(client.resolve('p1', 'u1', bad)).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
      expect(callable).not.toHaveBeenCalled();
    }
  });
  it('trims the delay reason when counting its minimum length', async () => {
    const { client } = makeClient();
    await expect(client.command('p1', 'u1', input({ kind: 'date', milestone_id: 'm1', new_date: '2026-11-09', delay: { reason: `  ${'x'.repeat(19)}  `, attribution: 'internal-team' } }))).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
  });
  it('rejects invalid project ids and opening uids', async () => {
    const { client, callable } = makeClient();
    await expect(client.get('', 'u1')).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
    await expect(client.get('a/b', 'u1')).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
    await expect(client.get('p1', '')).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
    expect(callable).not.toHaveBeenCalled();
  });
  it('validates results against the request', async () => {
    const i = input();
    const mismatches: any[] = [{ project_id: 'other' }, { operation_id: 'op2' }, { kind: 'delete' }, { milestone_id: 'm2' }, { milestone_id: undefined }, { ok: false }, { milestone_id: 'a/b' }];
    for (const over of mismatches) {
      const { client, callable } = makeClient();
      callable.mockResolvedValue({ data: resultData(over) });
      await expect(client.command('p1', 'u1', i)).rejects.toMatchObject({ code: expect.stringMatching(/invalid-response|^[a-z0-9_-]+$/) });
    }
    const { client, callable } = makeClient();
    callable.mockResolvedValue({ data: resultData({ milestone_id: 'm1' }) });
    await expect(client.command('p1', 'u1', input({ kind: 'template' }))).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
    callable.mockResolvedValue({ data: { ok: true, project_id: 'p1', operation_id: 'op1', kind: 'template' } });
    await expect(client.command('p1', 'u1', input({ kind: 'template' }))).resolves.toMatchObject({ kind: 'template' });
    callable.mockResolvedValue({ data: { ok: true, project_id: 'p1', operation_id: 'op1', kind: 'reorder', milestone_id: 'm1' } });
    await expect(client.command('p1', 'u1', input({ kind: 'reorder', milestone_ids: ['m1'] }))).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
  });
  it('requires a strict resolution value and rejects it on a plain command', async () => {
    const { client, callable } = makeClient();
    for (const resolution of [undefined, 'maybe', true]) {
      callable.mockResolvedValue({ data: resultData({ resolution }) });
      await expect(client.resolve('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
    }
    callable.mockResolvedValue({ data: resultData({ resolution: 'cancelled' }) });
    await expect(client.resolve('p1', 'u1', input())).resolves.toMatchObject({ resolution: 'cancelled' });
    callable.mockResolvedValue({ data: resultData({ resolution: 'committed' }) });
    await expect(client.command('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
  });
  it('never treats error bodies or transport errors as commit or cancel', async () => {
    const { client, callable } = makeClient();
    callable.mockResolvedValue({ data: { ok: false, error: 'milestone_request_cancelled', status: 409, resolution: 'cancelled' } });
    await expect(client.resolve('p1', 'u1', input())).rejects.toMatchObject({ code: 'milestone_request_cancelled' });
    callable.mockResolvedValue({ data: { ok: false, error: 'Weird <script> text', resolution: 'cancelled' } });
    await expect(client.resolve('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/invalid-response' });
    callable.mockRejectedValue(Object.assign(new Error('x'.repeat(1000)), { code: 'milestone_request_cancelled', details: { resolution: 'cancelled' } }));
    const err: any = await client.resolve('p1', 'u1', input()).catch(e => e);
    expect(err.code).toBe('native-milestone/request-failed');
    expect(err.message.length).toBeLessThanOrEqual(300);
    callable.mockRejectedValue('weird');
    await expect(client.command('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/request-failed' });
  });
  it('checks identity before and after every call, including when the call fails', async () => {
    let uid = 'u1';
    const { client, callable } = makeClient(() => uid);
    callable.mockImplementation(async () => { uid = 'u2'; return { data: snapshotData() }; });
    await expect(client.get('p1', 'u1')).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    uid = 'u1';
    callable.mockImplementation(async () => { uid = 'u2'; throw new Error('boom'); });
    await expect(client.command('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    uid = 'u2'; callable.mockClear();
    await expect(client.resolve('p1', 'u1', input())).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    expect(callable).not.toHaveBeenCalled();
  });
  it('checks the context guard before and after the call, even on error', async () => {
    let ok = true;
    const guard = () => { if (!ok) throw new Error('ctx'); };
    const { client, callable } = makeClient();
    callable.mockImplementation(async () => { ok = false; throw new Error('boom'); });
    await expect(client.get('p1', 'u1', guard)).rejects.toThrow('ctx');
    ok = false; callable.mockClear();
    await expect(client.get('p1', 'u1', guard)).rejects.toThrow('ctx');
    expect(callable).not.toHaveBeenCalled();
  });
});

const makeStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: vi.fn((k: string) => map.get(k) ?? null), setItem: vi.fn((k: string, v: string) => { map.set(k, v); }), removeItem: vi.fn((k: string) => { map.delete(k); }) };
};
const makeFake = (uid = () => 'u1') => ({
  currentUid: vi.fn(async () => uid()),
  get: vi.fn(async (): Promise<any> => snapshotData()),
  command: vi.fn(async (_p: string, _u: string, i: any): Promise<any> => resultData({ operation_id: i.operation_id, kind: i.command.kind, milestone_id: i.command.milestone_id })),
  resolve: vi.fn(async (_p: string, _u: string, i: any): Promise<any> => resultData({ operation_id: i.operation_id, kind: i.command.kind, milestone_id: i.command.milestone_id, resolution: 'committed' })),
});
const STATUS = { kind: 'status', milestone_id: 'm1', status: 'completed' } as const;

describe('native milestone session', () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => { storage = makeStorage(); vi.stubGlobal('sessionStorage', storage); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const session = (fake = makeFake(), ...rest: any[]) => ({ fake, s: createNativeMilestoneSession('p1', rest[0], rest[1], fake as any) });

  it('loads a snapshot and pins the opening uid', async () => {
    const { fake, s } = session(makeFake(), 'u1');
    expect((await s.load()).project_version).toBe('4:7');
    expect(s.currentUid).toBe('u1');
    expect(fake.get).toHaveBeenCalledWith('p1', 'u1', expect.any(Function));
  });
  it('rejects a load for a different expected uid', async () => {
    const { s } = session(makeFake(), 'u9');
    await expect(s.load()).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
  });
  it('fails a load whose context is stale', async () => {
    const { fake, s } = session(makeFake(), undefined, () => false);
    await expect(s.load()).rejects.toMatchObject({ code: 'native-milestone/context-changed' });
    expect(fake.get).not.toHaveBeenCalled();
  });
  it('requires a loaded snapshot with edit permission before issuing', async () => {
    const { fake, s } = session();
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/reload-required' });
    fake.get.mockResolvedValue(snapshotData({ permissions: { edit: false } }));
    await s.load();
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'forbidden' });
    expect(fake.command).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });
  it('captures command, both versions and a nonce, persists them before calling', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockImplementation(async () => {
      const [[, raw]] = [...storage.map.entries()];
      const saved = JSON.parse(raw);
      expect(Object.keys(saved).sort()).toEqual(['command', 'expected_project_version', 'expected_schedule_version', 'operation_id', 'v']);
      expect(saved.command).toEqual(STATUS);
      throw new Error('lost');
    });
    await s.issue(STATUS).catch(() => undefined);
    expect(s.pending).toEqual({ command: STATUS, expected_project_version: '4:7', expected_schedule_version: HASH, operation_id: expect.stringMatching(/^[a-zA-Z0-9_-]{1,128}$/) });
  });
  it('keys storage per uid and project and stores no tokens or responses', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValue(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    const [[key, raw]] = [...storage.map.entries()];
    expect(key).toContain('u1'); expect(key).toContain('p1');
    expect(raw).not.toMatch(/Plant|secret|token/i);
  });
  it('clears pending and invalidates the opening on success, then reloads separately', async () => {
    const { fake, s } = session();
    await s.load();
    fake.get.mockClear();
    const out = await s.issue(STATUS);
    expect(out).toMatchObject({ kind: 'status', milestone_id: 'm1' });
    expect(storage.map.size).toBe(0);
    expect(s.pending).toBeUndefined();
    expect(fake.get).toHaveBeenCalledTimes(1);
  });
  it('keeps a committed save committed when the follow-up reload fails and demands an explicit load', async () => {
    const { fake, s } = session();
    await s.load();
    fake.get.mockRejectedValue(new Error('offline'));
    await expect(s.issue(STATUS)).resolves.toMatchObject({ kind: 'status' });
    expect(s.pending).toBeUndefined();
    await expect(s.issue({ kind: 'delete', milestone_id: 'm2' })).rejects.toMatchObject({ code: 'native-milestone/reload-required' });
    fake.get.mockResolvedValue(snapshotData({ project_version: '5:0' }));
    await s.load();
    await expect(s.issue({ kind: 'delete', milestone_id: 'm2' })).resolves.toMatchObject({ kind: 'delete' });
    expect(fake.command.mock.calls[1][2]).toMatchObject({ expected_project_version: '5:0' });
  });
  it('retains the identical payload and nonce after every error kind', async () => {
    const { fake, s } = session();
    await s.load();
    const errors = [new Error('lost'), Object.assign(new Error('known'), { code: 'milestone_flags_off' }), Object.assign(new Error('known'), { code: 'milestone_request_cancelled' })];
    for (const e of errors) { fake.command.mockRejectedValueOnce(e); await s.issue(STATUS).catch(() => undefined); }
    fake.get.mockResolvedValue(snapshotData({ project_version: '9:9', schedule_version: 'b'.repeat(64) }));
    await s.load();
    await s.issue(STATUS);
    const sent = fake.command.mock.calls.map(c => c[2]);
    expect(sent).toHaveLength(4);
    for (const i of sent) expect(i).toEqual(sent[0]);
    expect(sent[0].expected_project_version).toBe('4:7');
    expect(sent[0].expected_schedule_version).toBe(HASH);
  });
  it('retains the nonce when the body error code is a known one', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValue(Object.assign(new Error('flags'), { code: 'native_milestone_mutations_disabled' }));
    await s.issue(STATUS).catch(() => undefined);
    expect(s.pending?.operation_id).toBeTruthy();
    expect(storage.map.size).toBe(1);
  });
  it('compares commands by canonical key order, not insertion order', async () => {
    const { fake, s } = session();
    await s.load();
    const a = { kind: 'edit', milestone_id: 'm1', patch: { name: 'x', description: 'y' }, delay: { reason: REASON, attribution: 'internal-team' } } as const;
    const b = { delay: { attribution: 'internal-team', reason: REASON }, patch: { description: 'y', name: 'x' }, milestone_id: 'm1', kind: 'edit' } as any;
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(a).catch(() => undefined);
    await expect(s.issue(b)).resolves.toMatchObject({ kind: 'edit' });
    expect(fake.command.mock.calls[1][2]).toEqual(fake.command.mock.calls[0][2]);
  });
  it('rejects a different mutation while one is pending, with no network call', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    fake.command.mockClear();
    await expect(s.issue({ kind: 'delete', milestone_id: 'm1' })).rejects.toMatchObject({ code: 'operation_conflict' });
    expect(fake.command).not.toHaveBeenCalled();
    expect(s.pending?.command).toEqual(STATUS);
  });
  it('lets the same command retry despite a fresh load, even when the snapshot is invalid', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    fake.get.mockRejectedValue(new Error('offline'));
    await s.load().catch(() => undefined);
    await expect(s.issue(STATUS)).resolves.toMatchObject({ kind: 'status' });
  });
  it('does not alter the pending captured command when the caller mutates its object', async () => {
    const { fake, s } = session();
    await s.load();
    const cmd: any = { kind: 'reorder', milestone_ids: ['m2', 'm1'] };
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(cmd).catch(() => undefined);
    cmd.milestone_ids.push('m3');
    expect(s.pending?.command).toEqual({ kind: 'reorder', milestone_ids: ['m2', 'm1'] });
    const p: any = s.pending; p.command.milestone_ids.push('zz');
    expect(s.pending?.command).toEqual({ kind: 'reorder', milestone_ids: ['m2', 'm1'] });
  });
  it('load never discards or rewrites pending', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    const before = storage.map.values().next().value;
    fake.get.mockResolvedValue(snapshotData({ project_version: '8:8' }));
    await s.load();
    expect(storage.map.values().next().value).toBe(before);
  });
  it('resolve replays the exact pending payload and clears pending on committed and on cancelled', async () => {
    for (const resolution of ['committed', 'cancelled']) {
      storage.map.clear();
      const { fake, s } = session();
      await s.load();
      fake.command.mockRejectedValueOnce(new Error('lost'));
      await s.issue(STATUS).catch(() => undefined);
      const original = fake.command.mock.calls[0][2];
      fake.resolve.mockImplementation(async (_p: string, _u: string, i: any) => resultData({ operation_id: i.operation_id, resolution }));
      const out = await s.resolve();
      expect(out.resolution).toBe(resolution);
      expect(fake.resolve.mock.calls[0][2]).toEqual(original);
      expect(s.pending).toBeUndefined();
      expect(storage.map.size).toBe(0);
    }
  });
  it('resolve failure of any kind retains pending', async () => {
    const { fake, s } = session();
    await s.load();
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    fake.resolve.mockRejectedValue(Object.assign(new Error('x'), { code: 'milestone_request_cancelled' }));
    await expect(s.resolve()).rejects.toBeTruthy();
    expect(s.pending).toBeTruthy();
    await expect(createNativeMilestoneSession('p9', 'u1', () => true, makeFake() as any).resolve()).rejects.toMatchObject({ code: 'native-milestone/nothing-pending' });
  });
  it('resolve with nothing pending is refused without a network call', async () => {
    const { fake, s } = session();
    await s.load();
    await expect(s.resolve()).rejects.toMatchObject({ code: 'native-milestone/nothing-pending' });
    expect(fake.resolve).not.toHaveBeenCalled();
  });
  it('shares one pending request across session instances for the same uid and project', async () => {
    const a = session(); await a.s.load();
    a.fake.command.mockRejectedValueOnce(new Error('lost'));
    await a.s.issue(STATUS).catch(() => undefined);
    const b = session(); await b.s.load();
    expect(b.s.pending).toEqual(a.s.pending);
    await expect(b.s.issue({ kind: 'delete', milestone_id: 'm1' })).rejects.toMatchObject({ code: 'operation_conflict' });
    await b.s.issue(STATUS);
    expect(b.fake.command.mock.calls[0][2]).toEqual(a.fake.command.mock.calls[0][2]);
    expect(a.s.pending).toBeUndefined();
  });
  it('isolates pending by account and by project', async () => {
    const a = session(); await a.s.load();
    a.fake.command.mockRejectedValueOnce(new Error('lost'));
    await a.s.issue(STATUS).catch(() => undefined);
    const other = makeFake(() => 'u2');
    const s2 = createNativeMilestoneSession('p1', 'u2', () => true, other as any);
    await s2.load();
    expect(s2.pending).toBeUndefined();
    const s3 = createNativeMilestoneSession('p2', 'u1', () => true, makeFake() as any);
    await s3.load();
    expect(s3.pending).toBeUndefined();
    expect(JSON.stringify([...storage.map.keys()])).not.toContain('p2');
  });
  it('survives a module reload', async () => {
    const { fake, s } = session(); await s.load();
    fake.command.mockRejectedValueOnce(new Error('lost'));
    await s.issue(STATUS).catch(() => undefined);
    const original = fake.command.mock.calls[0][2];
    vi.resetModules();
    const fresh = await import('../nativeMilestoneOperations');
    const fake2 = makeFake();
    const s2 = fresh.createNativeMilestoneSession('p1', 'u1', () => true, fake2 as any);
    await s2.load();
    expect(s2.pending).toEqual(original);
    await s2.issue(STATUS);
    expect(fake2.command.mock.calls[0][2]).toEqual(original);
  });
  it('fails closed when storage is missing, throws on write, or loses the write', async () => {
    const { fake, s } = session(); await s.load();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
    storage.setItem.mockImplementation(() => undefined);
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
    vi.stubGlobal('sessionStorage', undefined);
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
    expect(fake.command).not.toHaveBeenCalled();
  });
  it('fails closed on unreadable, corrupt, oversized or mismatched stored pending', async () => {
    const { fake, s } = session(); await s.load();
    const key = `bom-native-milestone-pending:v1:u1:p1`;
    const good = { v: 1, command: STATUS, expected_project_version: '4:7', expected_schedule_version: HASH, operation_id: 'op1' };
    const bads = ['{not json', '[]', JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, extra: 1 }), JSON.stringify({ ...good, operation_id: 'bad id' }),
      JSON.stringify({ ...good, command: { kind: 'nope' } }), JSON.stringify({ ...good, expected_project_version: 'x' }),
      JSON.stringify({ ...good, command: { kind: 'reorder', milestone_ids: ['m1'], pad: 'x'.repeat(300 * 1024) } }), 'x'.repeat(271 * 1024)];
    for (const raw of bads) {
      storage.map.set(key, raw);
      let thrown: any; try { void s.pending; } catch (e) { thrown = e; }
      expect(thrown).toMatchObject({ code: 'native-milestone/storage-failed' });
      await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
      await expect(s.resolve()).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
    }
    storage.map.delete(key);
    storage.getItem.mockImplementation(() => { throw new Error('denied'); });
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/storage-failed' });
    expect(fake.command).not.toHaveBeenCalled();
  });
  it('accepts a stored command near the 256KiB cap', async () => {
    const { fake, s } = session(); await s.load();
    const ids = Array.from({ length: 400 }, (_, i) => `m${i}`);
    await expect(s.issue({ kind: 'reorder', milestone_ids: ids })).resolves.toMatchObject({ kind: 'reorder' });
    expect(fake.command).toHaveBeenCalled();
  });
  it('never silently falls back to memory when storage fails', async () => {
    const { fake, s } = session(); await s.load();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    await s.issue(STATUS).catch(() => undefined);
    storage.setItem.mockImplementation((k: string, v: string) => { storage.map.set(k, v); });
    await s.issue(STATUS);
    expect(fake.command).toHaveBeenCalledTimes(1);
  });
  it('guards uid and context before and after calls, even on error, and keeps pending', async () => {
    let uid = 'u1', ok = true;
    const fake = makeFake(() => uid);
    const s = createNativeMilestoneSession('p1', 'u1', () => ok, fake as any);
    await s.load();
    fake.command.mockImplementation(async () => { uid = 'u2'; throw new Error('boom'); });
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    expect(storage.map.size).toBe(1);
    uid = 'u1';
    fake.command.mockImplementation(async () => { ok = false; throw new Error('boom'); });
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/context-changed' });
    ok = true; uid = 'u2';
    await expect(s.resolve()).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    expect(fake.resolve).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(1);
  });
  it('does not clear pending when the account changes after a committed reply', async () => {
    let uid = 'u1';
    const fake = makeFake(() => uid);
    const s = createNativeMilestoneSession('p1', 'u1', () => true, fake as any);
    await s.load();
    fake.command.mockImplementation(async (_p: string, _u: string, i: any) => { uid = 'u2'; return resultData({ operation_id: i.operation_id }); });
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/identity-changed' });
    expect(storage.map.size).toBe(1);
  });
  it('refuses overlapping calls on one session', async () => {
    const { fake, s } = session(); await s.load();
    let release!: () => void;
    fake.command.mockImplementation(() => new Promise(r => { release = () => r(resultData({ operation_id: [...storage.map.values()].map(v => JSON.parse(v).operation_id)[0] })); }));
    const first = s.issue(STATUS);
    await vi.waitFor(() => expect(fake.command).toHaveBeenCalled());
    await expect(s.issue(STATUS)).rejects.toMatchObject({ code: 'native-milestone/busy' });
    release(); await first;
  });
  it('validates commands in the session before persisting anything', async () => {
    const { fake, s } = session(); await s.load();
    await expect(s.issue({ kind: 'edit', milestone_id: 'm1', patch: {} } as any)).rejects.toMatchObject({ code: 'native-milestone/invalid-input' });
    expect(storage.map.size).toBe(0);
    expect(fake.command).not.toHaveBeenCalled();
  });
  it('a stale-revision server error retains pending and a later explicit resolve settles it', async () => {
    const { fake, s } = session(); await s.load();
    fake.command.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'stale_schedule' }));
    await s.issue(STATUS).catch(() => undefined);
    expect(s.pending).toBeTruthy();
    const out = await s.resolve();
    expect(out.resolution).toBe('committed');
    expect(s.pending).toBeUndefined();
  });
  it('exports a lazy production client singleton', async () => {
    const mod = await import('../nativeMilestoneOperations');
    expect(mod.nativeMilestoneOperations.get).toBeTypeOf('function');
    expect(mod.nativeMilestoneOperations.currentUid).toBeTypeOf('function');
  });
});
