import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentLinkAction, isDefinitiveDocumentLinkFailure } from '../documentLinkAction';

const h = vi.hoisted(() => ({ uid: 'alice', current: true, command: vi.fn() }));
const client = {
  currentUid: async () => h.uid,
  command: (...args: unknown[]) => h.command(...args),
} as any;
const open = (version = '4:9') => createDocumentLinkAction({ projectId: 'P', uid: 'alice', version, client, isCurrent: () => h.current });
const delta = (add: string[] = ['c'], remove: string[] = ['b']) => ({ kind: 'link_document_delta' as const, document_id: 'D', add_item_ids: add, remove_item_ids: remove });

beforeEach(() => {
  h.uid = 'alice'; h.current = true;
  h.command.mockReset();
  h.command.mockImplementation(async (projectId: string, input: any) => ({ ok: true, project_id: projectId, operation_id: input.operation_id, command_kind: input.command.kind }));
});

describe('document link action', () => {
  it('sends the exact explicit delta against the opening version and opening account', async () => {
    await open('4:9').submit(delta(['c'], ['b']));
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command).toHaveBeenCalledWith('P', {
      expected_version: '4:9', operation_id: expect.stringMatching(/^[-\w]{1,128}$/),
      command: { kind: 'link_document_delta', document_id: 'D', add_item_ids: ['c'], remove_item_ids: ['b'] },
    }, 'alice');
  });

  it('reuses the operation id for the same command and issues a new one only for a different draft, on the same version', async () => {
    const action = open();
    h.command.mockRejectedValueOnce(Object.assign(new Error('lost'), { code: 'native-material/request-failed' }));
    await expect(action.submit(delta())).rejects.toThrow('lost');
    await action.submit(delta());
    await action.submit(delta(['c', 'd'], []));
    const [first, retry, edited] = h.command.mock.calls.map(call => call[1]);
    expect(retry).toEqual(first);
    expect(edited.operation_id).not.toBe(first.operation_id);
    expect([first, retry, edited].map(call => call.expected_version)).toEqual(['4:9', '4:9', '4:9']);
  });

  it('is not changed by later edits to the object the caller passed in', async () => {
    const command = delta(['c'], ['b']);
    const action = open();
    h.command.mockImplementationOnce(async () => { throw Object.assign(new Error('lost'), { code: 'native-material/request-failed' }); });
    await expect(action.submit(command)).rejects.toThrow();
    command.add_item_ids.push('x');
    await action.submit(delta(['c'], ['b']));
    expect(h.command.mock.calls[1][1].command.add_item_ids).toEqual(['c']);
  });

  it('allows only one request at a time', async () => {
    let finish!: (value: unknown) => void;
    h.command.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const action = open();
    const first = action.submit(delta());
    await expect(action.submit(delta(['z'], []))).rejects.toThrow(/already pending/);
    await vi.waitFor(() => expect(h.command).toHaveBeenCalled());
    finish({ ok: true, project_id: 'P', operation_id: h.command.mock.calls[0][1].operation_id, command_kind: 'link_document_delta' });
    await first;
    expect(h.command).toHaveBeenCalledTimes(1);
  });

  it('refuses any other command kind before the transport', async () => {
    await expect(open().submit({ kind: 'delete_items', item_ids: ['a'] } as any)).rejects.toThrow(/document link/i);
    expect(h.command).not.toHaveBeenCalled();
  });

  it('refuses when the signed-in account or request context changed before sending', async () => {
    const action = open();
    h.uid = 'mallory';
    await expect(action.submit(delta())).rejects.toMatchObject({ code: 'native-material/identity-changed' });
    h.uid = 'alice'; h.current = false;
    await expect(action.submit(delta())).rejects.toMatchObject({ code: 'native-material/context-changed' });
    expect(h.command).not.toHaveBeenCalled();
  });

  it('does not report success when the account or context changed during the request', async () => {
    h.command.mockImplementationOnce(async (projectId: string, input: any) => { h.uid = 'mallory'; return { ok: true, project_id: projectId, operation_id: input.operation_id, command_kind: 'link_document_delta' }; });
    await expect(open().submit(delta())).rejects.toMatchObject({ code: 'native-material/identity-changed' });
    h.uid = 'alice';
    h.command.mockImplementationOnce(async (projectId: string, input: any) => { h.current = false; return { ok: true, project_id: projectId, operation_id: input.operation_id, command_kind: 'link_document_delta' }; });
    await expect(open().submit(delta())).rejects.toMatchObject({ code: 'native-material/context-changed' });
  });

  it('requires a displayed version and signed-in account to open', () => {
    expect(() => createDocumentLinkAction({ projectId: 'P', uid: 'alice', version: '', client, isCurrent: () => true })).toThrow(/revision/);
    expect(() => createDocumentLinkAction({ projectId: 'P', uid: '', version: '1:1', client, isCurrent: () => true })).toThrow(/Sign in/);
  });

  it('classifies only explicit server decisions as definitive, never a lost reply', () => {
    for (const code of ['material_version_conflict', 'material_forbidden', 'project_forbidden', 'actor_forbidden', 'native-material/invalid-input', 'functions/permission-denied']) {
      expect(isDefinitiveDocumentLinkFailure({ code })).toBe(true);
    }
    for (const code of ['native-material/identity-changed', 'native-material/context-changed', 'native-material/request-failed', 'native-material/invalid-response', 'functions/unavailable', 'functions/deadline-exceeded', 'internal', undefined]) {
      expect(isDefinitiveDocumentLinkFailure({ code })).toBe(false);
    }
    expect(isDefinitiveDocumentLinkFailure(new Error('plain'))).toBe(false);
  });
});
