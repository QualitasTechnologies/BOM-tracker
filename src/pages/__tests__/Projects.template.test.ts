import { describe, expect, it, vi } from 'vitest';
import { createProjectTemplateInitialization } from '@/utils/projectTemplateInitialization';
import { createNativeMaterialOperationsClient } from '@/utils/nativeMaterialOperations';
import { webcrypto } from 'node:crypto';
vi.stubGlobal('crypto', webcrypto);

const template = { id: 't1', items: [{ id: 'i1', itemType: 'component' as const, name: 'Motor', description: '', category: 'Parts', quantity: 1 }] };
function fixture() {
  let uid = 'alice';
  let version = 'missing';
  let fail = false;
  let commandAllowed = true;
  const calls: Record<string, unknown>[] = [];
  const client = createNativeMaterialOperationsClient({
    getCurrentUser: () => ({ uid }),
    callable: async payload => {
      calls.push(structuredClone(payload));
      if (payload.operation === 'get') return { data: { ok: true, project_id: 'p1', categories: [], version, permissions: { review: true, edit: true, command: commandAllowed } } };
      if (fail) throw new Error('uncertain network outcome');
      return { data: { ok: true, project_id: 'p1', operation_id: payload.operation_id, command_kind: 'add_items' } };
    },
  });
  const addProject = vi.fn(async () => {});
  const getTemplate = vi.fn(async () => structuredClone(template));
  const creationRequests: unknown[] = [];
  const flow = createProjectTemplateInitialization({ projectId: 'p1', templateId: 't1', client: { ...client, createProject: async (...args: any[]) => { creationRequests.push(structuredClone(args)); await addProject(); return { ok: true, project_id: 'p1', operation_id: args[1].operation_id }; } } as any, project: { projectName: 'One', clientName: 'Acme', description: '', status: 'Planning', deadline: '2026-10-13', poValue: 0 }, cachedUid: 'alice', getTemplate });
  return { flow, calls, creationRequests, addProject, getTemplate, deny: () => { commandAllowed = false; }, switchUid: () => { uid = 'bob'; }, fail: (value: boolean) => { fail = value; }, version: (value: string) => { version = value; } };
}

describe('project template creation recovery with actual native client', () => {
  it.each(['missing', '1:0'])('initializes authoritative %s BOM with the captured SDK actor', async version => {
    const f = fixture(); f.version(version);
    await f.flow.start();
    expect(f.addProject).toHaveBeenCalledOnce();
    expect(f.calls[1]).toMatchObject({ operation: 'command', expected_version: version, expected_actor_uid: 'alice', command: { kind: 'add_items', initialize: true } });
  });
  it('retries uncertain outcomes with identical revision, item IDs and operation ID without creating again', async () => {
    const f = fixture(); f.fail(true);
    await expect(f.flow.start()).rejects.toThrow('uncertain');
    expect(f.flow.projectCreated).toBe(true);
    f.version('2:0'); f.fail(false);
    await f.flow.retry();
    expect(f.calls[2]).toEqual(f.calls[1]);
    expect(f.calls.filter(c => c.operation === 'get')).toHaveLength(1);
    expect(f.addProject).toHaveBeenCalledOnce();
  });
  it('blocks an SDK switch during project creation and recovery', async () => {
    const f = fixture(); f.addProject.mockImplementation(async () => { f.switchUid(); });
    await expect(f.flow.start()).rejects.toThrow('account changed');
    expect(f.flow.projectCreated).toBe(true);
    await expect(f.flow.retry()).rejects.toThrow('account changed');
    expect(f.calls).toHaveLength(0);
  });
  it('blocks an SDK switch during template loading', async () => {
    const f = fixture(); f.getTemplate.mockImplementation(async () => { f.switchUid(); return template; });
    await expect(f.flow.start()).rejects.toThrow('account changed');
    expect(f.calls).toHaveLength(1);
  });
  it('fails visibly for an invalid template without sending items', async () => {
    const f = fixture(); f.getTemplate.mockResolvedValue({ ...template, items: [{ ...template.items[0], quantity: 0 }] });
    await expect(f.flow.start()).rejects.toThrow();
    expect(f.flow.projectCreated).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
  it('keeps a missing template recoverable and never creates a second project', async () => {
    const f = fixture(); f.getTemplate.mockResolvedValueOnce(null as never);
    await expect(f.flow.start()).rejects.toThrow('template');
    await f.flow.retry();
    expect(f.addProject).toHaveBeenCalledOnce();
    expect(f.calls.filter(c => c.operation === 'get')).toHaveLength(1);
  });
  it('does not bypass denied initialization permission on retry', async () => {
    const f = fixture(); f.deny();
    await expect(f.flow.start()).rejects.toThrow('permission');
    await expect(f.flow.retry()).rejects.toThrow('permission');
    expect(f.calls).toHaveLength(1);
  });
  it('derives the same persisted IDs for the same project/template/item identities', async () => {
    const one = fixture(); const two = fixture();
    await one.flow.start(); await two.flow.start();
    expect((one.calls[1].command as any).items).toEqual((two.calls[1].command as any).items);
    expect(one.calls[1].operation_id).not.toBe(two.calls[1].operation_id);
  });
  it('blocks duplicate creation while the first submission is pending', async () => {
    const f = fixture(); let release!: () => void;
    f.addProject.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const first = f.flow.start();
    await vi.waitFor(() => expect(f.addProject).toHaveBeenCalledOnce());
    await expect(f.flow.start()).rejects.toThrow('already in progress');
    release(); await first;
    expect(f.addProject).toHaveBeenCalledOnce();
  });
  it('retains exact creation request after unknown acknowledgment and retries creation receipt first', async () => {
    const f = fixture(); f.addProject.mockRejectedValueOnce(new Error('Creation committed but ACK lost'));
    await expect(f.flow.start()).rejects.toThrow('ACK lost');
    expect(f.flow.creationAttempted).toBe(true);
    expect(f.flow.projectCreated).toBe(false);
    expect(f.calls).toHaveLength(0);
    await f.flow.retry();
    expect(f.creationRequests[1]).toEqual(f.creationRequests[0]);
    expect(f.calls).toHaveLength(2);
  });
});
