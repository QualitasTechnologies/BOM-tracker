import { expect, it, vi } from 'vitest';
import { createNativeReceiptPhotoAttempt } from '../nativeUploadOperations';
const mocks = vi.hoisted(() => {
  let resolve!: () => void;
  const loaded = new Promise<void>(r => { resolve = r; });
  return { uid: 'u1', started: false, loaded, resolve, dispatch: vi.fn() };
});
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: mocks.uid }; } }, functions: {}, storage: {} }));
vi.mock('firebase/functions', async () => {
  mocks.started = true;
  await mocks.loaded;
  return { httpsCallable: () => mocks.dispatch };
});
it('rechecks SDK account after lazy callable loading before dispatch', async () => {
  vi.stubGlobal('crypto', { randomUUID: () => 'operation-1', subtle: { digest: async () => new Uint8Array(32).buffer } });
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  blob.arrayBuffer = async () => new Uint8Array([1, 2, 3, 4]).buffer;
  const attempt = createNativeReceiptPhotoAttempt({ projectId: 'P1', itemId: 'motor', expectedActorUid: 'u1', blob, isCurrent: () => true });
  const request = attempt.run().then(() => undefined, error => error);
  await vi.waitFor(() => expect(mocks.started).toBe(true));
  mocks.uid = 'u2'; mocks.resolve(); expect((await request).message).toMatch(/account changed/i);
  expect(mocks.dispatch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
