import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNativeMaterialOperationsClient } from '../nativeMaterialOperations';
import { createNativeMaterialCommandClient } from '../nativeMaterialCommands';

// Exercise the real callable factory and the real browser clients together. No
// hand-authored success/cancellation response can hide a transport-shape drift.
const require = createRequire(import.meta.url);
let backendPath: string;
try { backendPath = require.resolve('../../../functions/nativeMaterialOperations.cjs'); }
catch { backendPath = require.resolve('../../../../../integration/bom-project-review/nativeMaterialOperations.cjs'); }
const { createNativeMaterialOperations } = require(backendPath);
type Value = Record<string, any>;

function fixture() {
  const actor = { uid: 'paired-admin', email: 'paired@qualitastech.com', emailVerified: true,
    customClaims: { role: 'admin', status: 'approved' } };
  const documents = new Map<string, Value>([
    ['projects/P', { memberIds: [actor.uid] }],
    ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [
      { id: 'motor', name: 'Original', itemType: 'service', quantity: 2, unit: 'hours' },
    ] }] }],
  ]);
  const revisions = new Map<string, number>();
  let nextRevision = 20;
  let enabled = true;
  let drop: 'before' | 'after' | undefined;
  const reference = (path: string): any => ({ path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
  });
  const db = { collection: (name: string) => reference(name), runTransaction: async (callback: any) => {
    const writes: Array<() => void> = [];
    const store = (ref: Value, data: Value, merge: boolean) => writes.push(() => {
      documents.set(ref.path, structuredClone(merge ? { ...documents.get(ref.path), ...data } : data));
      revisions.set(ref.path, ++nextRevision);
    });
    const result = await callback({
      get: async (ref: Value) => ({ exists: documents.has(ref.path),
        data: () => structuredClone(documents.get(ref.path)),
        updateTime: { seconds: revisions.get(ref.path) ?? 10, nanoseconds: 1 } }),
      update: (ref: Value, data: Value) => store(ref, data, true),
      create: (ref: Value, data: Value) => { if (documents.has(ref.path)) throw Error('Already exists'); store(ref, data, false); },
      set: (ref: Value, data: Value) => store(ref, data, false),
    });
    writes.forEach(write => write());
    return result;
  } };
  const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email, auth_time: 1800000000 }), getUser: async () => actor };
  const handler = createNativeMaterialOperations({ db, auth, mutationsEnabled: () => enabled, getServerTimestamp: () => 'server-time' });
  const invoke = (payload: Value) => handler({ auth: { uid: actor.uid }, rawRequest: { get: () => 'Bearer paired-token' }, data: payload });
  const call = async (payload: Value) => {
    const loss = drop;
    drop = undefined;
    const network = () => Object.assign(Error('Response lost'), { code: 'functions/unavailable' });
    if (loss === 'before') throw network();
    const result = await invoke(payload);
    if (loss === 'after') throw network();
    return result;
  };
  const client = createNativeMaterialOperationsClient({ getCurrentUser: () => ({ uid: actor.uid }), callable: async payload => ({ data: await call(payload) }) });
  return { actor, documents, client, call, invoke, drop: (when: 'before' | 'after') => { drop = when; },
    pause: () => { enabled = false; documents.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); },
    resume: () => { enabled = true; documents.set('pulseRuntimeControl/cutover', { mode: 'coexist' }); } };
}

const project = { projectName: 'Unsent project', clientName: 'Customer', description: '', status: 'Planning' as const, deadline: '2026-12-01', poValue: 0 };
beforeEach(() => sessionStorage.clear());

describe('paired native material callable/client recovery contract', () => {
  it.each(['patch', 'fulfill', 'command', 'create_project'] as const)('%s cancels an unsent request while paused and prevents a late write', async operation => {
    const f = fixture();
    const projectId = operation === 'create_project' ? 'NEW' : 'P';
    const before = structuredClone(f.documents.get('projects/P/bom/data'));
    f.drop('before');
    const pending = operation === 'patch'
      ? f.client.patch('P', { item_id: 'motor', operation_id: 'paired-op', expected_version: '10:1', patch: { name: 'Proposed' } }, f.actor.uid)
      : operation === 'fulfill'
        ? f.client.fulfill('P', { item_id: 'motor', operation_id: 'paired-op', expected_version: '10:1', fulfillment: { kind: 'fulfillment', quantity: 0.5 } }, f.actor.uid)
        : operation === 'command'
          ? f.client.command('P', { operation_id: 'paired-op', expected_version: '10:1', command: { kind: 'category_state', category: 'Mech', isExpanded: true } }, f.actor.uid)
          : f.client.createProject('NEW', { operation_id: 'paired-op', project }, f.actor.uid);
    await expect(pending).rejects.toMatchObject({ code: 'functions/unavailable' });
    const saved = JSON.parse(sessionStorage.getItem(`pulse.material-write.v1:${JSON.stringify([f.actor.uid, projectId])}`)!);
    f.pause();
    const resolution = await f.client.resolve(projectId);
    expect(resolution.resolution).toBe('cancelled');
    expect(resolution.result).not.toHaveProperty('item');
    expect(f.documents.get('projects/P/bom/data')).toEqual(before);
    const opening = await f.client.acknowledge(projectId);
    if (operation === 'create_project') expect(opening).toBeNull();
    else expect(opening?.permissions.command).toBe(false);
    expect(await f.client.pending(projectId)).toEqual({ kind: 'absent' });
    f.resume();
    expect(await f.invoke(saved.payload)).toMatchObject({ ok: false, error: 'material_request_cancelled' });
    expect(f.documents.get('projects/P/bom/data')).toEqual(before);
    expect(f.documents.has('projects/NEW')).toBe(false);
  });

  it('resolves a real committed patch after acknowledgement loss and refreshes before releasing it', async () => {
    const f = fixture();
    f.drop('after');
    await expect(f.client.patch('P', { item_id: 'motor', operation_id: 'committed', expected_version: '10:1', patch: { name: 'Committed' } }, f.actor.uid))
      .rejects.toMatchObject({ code: 'functions/unavailable' });
    f.pause();
    expect(await f.client.resolve('P')).toMatchObject({ resolution: 'committed', result: { item: { id: 'motor', name: 'Committed' } } });
    expect(await f.client.pending('P')).toMatchObject({ kind: 'pending', resolved: true });
    const snapshot = await f.client.acknowledge('P');
    expect(snapshot?.version).not.toBe('10:1');
    expect(snapshot?.permissions.command).toBe(false);
    expect(await f.client.pending('P')).toEqual({ kind: 'absent' });
  });

  it('the direct command client accepts the same real cancellation and read-only acknowledgement', async () => {
    const f = fixture();
    let loseCommand = true;
    const direct = createNativeMaterialCommandClient({ uid: () => f.actor.uid, operationId: () => 'direct-op', call: async payload => {
      if (payload.operation === 'command' && !payload.resolve_only && loseCommand) { loseCommand = false; f.drop('before'); }
      return f.call(payload);
    } });
    await expect(direct.submit('P', { kind: 'category_state', category: 'Mech', isExpanded: true })).rejects.toMatchObject({ code: 'functions/unavailable' });
    f.pause();
    expect(await direct.resolve('P')).toMatchObject({ resolution: 'cancelled' });
    expect(await direct.acknowledge('P')).toMatchObject({ canCommand: false });
    expect(direct.pending('P')).toEqual({ kind: 'absent' });
  });
});
