import { expect, it, vi } from 'vitest';
import { createNativeProjectWorkspace, nativeProjectOperations } from '../nativeProjectOperations';

type CallablePayload = { operation: string; operation_id: string; [key: string]: unknown };
const mocks = vi.hoisted(() => {
  let resolve!: () => void;
  const loaded = new Promise<void>(r => { resolve = r; });
  return { uid: 'alice', anonymous: false, started: false, loaded, resolve, dispatch: vi.fn(async (payload: CallablePayload) => ({ data: { ok: true, project_id: 'P', operation_id: payload.operation_id } })) };
});
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return mocks.uid ? { uid: mocks.uid, isAnonymous: mocks.anonymous } : null; } }, functions: {} }));
vi.mock('firebase/functions', async () => {
  mocks.started = true; await mocks.loaded; return { httpsCallable: () => mocks.dispatch };
});
const opened = {
  ...nativeProjectOperations,
  get: async () => ({ ok: true as const, project_id: 'P', version: '10:1', project: { projectId: 'P' }, permissions: { edit: true, manage_members: true, notifications: true, restore: true, restore_resolve: true } }),
};

it('invalidating the workspace during lazy callable loading prevents member command dispatch', async () => {
  const workspace = createNativeProjectWorkspace('P', opened);
  await workspace.load();
  const request = workspace.capture().submit({ kind: 'member_remove', user_id: 'u2' }).then(() => undefined, error => error);
  await vi.waitFor(() => expect(mocks.started).toBe(true));
  workspace.invalidate(); mocks.resolve();
  expect((await request).message).toMatch(/context changed/i);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it('dispatches the pinned UID through the callable and refuses anonymous or signed-out sessions', async () => {
  const workspace = createNativeProjectWorkspace('P', opened, 'alice');
  expect(await nativeProjectOperations.currentUid()).toBe('alice');
  await workspace.load();
  await workspace.capture().submit({ kind: 'recipient_remove', email: 'z@z.com' });
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ operation: 'command', expected_actor_uid: 'alice', command: { kind: 'recipient_remove', email: 'z@z.com' } }));
  mocks.anonymous = true; await expect(nativeProjectOperations.currentUid()).rejects.toThrow(/sign in/i);
  mocks.anonymous = false; mocks.uid = ''; await expect(nativeProjectOperations.currentUid()).rejects.toThrow(/sign in/i);
  mocks.uid = 'alice';
});
