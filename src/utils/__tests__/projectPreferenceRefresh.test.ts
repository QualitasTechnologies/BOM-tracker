import { beforeEach, expect, it, vi } from 'vitest';
import { auth } from '@/firebase';
import { getDoc, getDocFromServer } from 'firebase/firestore';
import { getProject } from '../projectFirestore';
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocFromServer: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), deleteDoc: vi.fn(), addDoc: vi.fn(), query: vi.fn(), onSnapshot: vi.fn(), where: vi.fn(),
}));
const project = { projectId: 'P', members: [{ userId: 'alice', notificationsEnabled: false }] };
const snapshot = { exists: () => true, data: () => project };
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(auth, { currentUser: { uid: 'alice' } });
  vi.mocked(getDoc).mockResolvedValue(snapshot as any);
  vi.mocked(getDocFromServer).mockResolvedValue(snapshot as any);
});
it('refreshes the actual server project for a pinned actor instead of using cached state', async () => {
  const check = vi.fn();
  expect(await getProject('P', 'alice', check)).toEqual(project);
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDoc).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(2);
});
it('blocks a refresh after an SDK account change before dispatch', async () => {
  Object.assign(auth, { currentUser: { uid: 'bob' } });
  await expect(getProject('P', 'alice')).rejects.toThrow(/account changed/i);
  expect(getDocFromServer).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
});
it('does not publish a project loaded across an SDK account or context change', async () => {
  vi.mocked(getDocFromServer).mockImplementationOnce(async () => {
    Object.assign(auth, { currentUser: { uid: 'bob' } }); return snapshot as any;
  });
  await expect(getProject('P', 'alice')).rejects.toThrow(/account changed/i);
  Object.assign(auth, { currentUser: { uid: 'alice' } });
  let active = true;
  vi.mocked(getDocFromServer).mockImplementationOnce(async () => { active = false; return snapshot as any; });
  await expect(getProject('P', 'alice', () => { if (!active) throw new Error('context changed'); })).rejects.toThrow(/context changed/);
});
it('retains existing unpinned callers behavior', async () => {
  expect(await getProject('P')).toEqual(project);
  expect(getDoc).toHaveBeenCalledTimes(1); expect(getDocFromServer).not.toHaveBeenCalled();
});
