import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  get: vi.fn(), list: vi.fn(), subscribe: vi.fn(), material: vi.fn(),
  getDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, auth: mocks.auth }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: mocks.getDoc, getDocFromServer: mocks.getDoc,
  getDocs: mocks.getDocs, onSnapshot: mocks.onSnapshot, query: vi.fn(), where: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
}));
vi.mock('../nativeProjectReads', () => ({ nativeProjectReads: { get: mocks.get, list: mocks.list } }));
vi.mock('../projectReadSubscriptions', () => ({ subscribeProjectRead: mocks.subscribe }));
vi.mock('../nativeMaterialCommands', () => ({
  isNativeMaterialCommandEnabled: () => false, submitNativeMaterialCommand: vi.fn(),
  loadNativeMaterialSnapshot: mocks.material,
}));
import { getProject, getProjects, getBOMData, subscribeToProjects, subscribeToBOM } from '../projectFirestore';

const row = (id: string) => ({
  project_id: id, version: '10:1', project: { projectId: id, projectName: id, status: 'Planning' },
});
const categories = [{ name: 'Visible', items: [{ id: 'motor', name: 'Motor', quantity: 1 }] }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
  mocks.auth.currentUser = { uid: 'alice' };
  mocks.get.mockResolvedValue({ ...row('P'), actor_uid: 'alice' });
  mocks.list.mockResolvedValue({ projects: [row('P')], next_cursor: null });
  mocks.material.mockResolvedValue({ actorUid: 'alice', categories, version: '10:1' });
  mocks.subscribe.mockReturnValue(() => {});
});
afterEach(() => vi.unstubAllEnvs());

it('reads the scoped project with captured UID/context and never reads a raw root', async () => {
  const guard = vi.fn();
  expect((await getProject('P', 'alice', guard))?.projectName).toBe('P');
  expect(mocks.get).toHaveBeenCalledWith('P', 'alice', expect.any(Function));
  expect(guard).toHaveBeenCalled();
  expect(mocks.getDoc).not.toHaveBeenCalled();
});

it('exhausts catalog pages including empty filtered pages and keeps route IDs authoritative', async () => {
  mocks.list.mockResolvedValueOnce({ projects: [], next_cursor: 'page-2' })
    .mockResolvedValueOnce({ projects: [row('P')], next_cursor: 'page-3' })
    .mockResolvedValueOnce({ projects: [row('Q')], next_cursor: null });
  expect((await getProjects({ uid: 'alice', isAdmin: false })).map(p => p.id)).toEqual(['P', 'Q']);
  expect(mocks.list.mock.calls.map(call => call[0].cursor)).toEqual([null, 'page-2', 'page-3']);
  expect(mocks.getDocs).not.toHaveBeenCalled();
});

it.each(['cursor', 'duplicate'])('rejects a repeated %s rather than returning a partial catalog', async kind => {
  mocks.list.mockResolvedValueOnce({ projects: [row('P')], next_cursor: 'page-2' })
    .mockResolvedValueOnce({ projects: kind === 'duplicate' ? [row('P')] : [], next_cursor: kind === 'cursor' ? 'page-2' : null });
  await expect(getProjects({ uid: 'alice', isAdmin: false })).rejects.toThrow();
  expect(mocks.getDocs).not.toHaveBeenCalled();
});

it('keeps project denial distinct from not-found without any SDK fallback', async () => {
  mocks.get.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { code: 'not_found' }));
  expect(await getProject('P')).toBeNull();
  mocks.get.mockRejectedValueOnce(Object.assign(new Error('No access'), { code: 'access' }));
  await expect(getProject('P')).rejects.toThrow('No access');
  expect(mocks.getDoc).not.toHaveBeenCalled();
});

it('does not publish a late project or catalog across an account/context change', async () => {
  mocks.get.mockImplementationOnce(async () => {
    mocks.auth.currentUser = { uid: 'bob' };
    return { ...row('P'), actor_uid: 'alice' };
  });
  await expect(getProject('P', 'alice')).rejects.toThrow(/account|identity|context/i);
  mocks.auth.currentUser = { uid: 'alice' };
  let active = true;
  mocks.list.mockImplementationOnce(async () => { active = false; return { projects: [row('P')], next_cursor: null }; });
  await expect(getProjects({ uid: 'alice', isAdmin: true }, () => { if (!active) throw new Error('context changed'); })).rejects.toThrow(/context/);
});

it('uses the existing scoped material read without enabling material edits', async () => {
  vi.stubEnv('VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'false');
  expect(await getBOMData('P')).toEqual(categories);
  expect(mocks.material).toHaveBeenCalledWith('P');
  expect(mocks.getDoc).not.toHaveBeenCalled();
  mocks.material.mockRejectedValueOnce(new Error('Material denied'));
  await expect(getBOMData('P')).rejects.toThrow('Material denied');
  expect(mocks.getDoc).not.toHaveBeenCalled();
});

it('uses known-notice subscriptions and clears previous catalog/material data on denied refresh', async () => {
  const catalog = vi.fn(), bom = vi.fn(), error = vi.fn();
  subscribeToProjects(catalog, { uid: 'alice', isAdmin: true }, error);
  const catalogOptions = mocks.subscribe.mock.calls[0][0];
  expect(catalogOptions).toMatchObject({ uid: 'alice', isAdmin: true });
  expect(await catalogOptions.read(() => {})).toHaveLength(1);
  catalogOptions.onValue([row('P').project]);
  catalogOptions.onError(new Error('Access revoked'));
  expect(catalog).toHaveBeenLastCalledWith([]);
  subscribeToBOM('P', bom, error);
  const bomOptions = mocks.subscribe.mock.calls[1][0];
  expect(bomOptions).toMatchObject({ projectId: 'P', uid: 'alice' });
  expect(await bomOptions.read(() => {})).toEqual(categories);
  bomOptions.onError(new Error('Access revoked'));
  expect(bom).toHaveBeenLastCalledWith([]);
  expect(error).toHaveBeenCalledTimes(2);
  expect(mocks.onSnapshot).not.toHaveBeenCalled();
});

it('rejects signed-out scoped reads and clears old subscriptions before touching raw source', async () => {
  mocks.auth.currentUser = null;
  await expect(getProjects()).rejects.toThrow(/sign in/i);
  await expect(getProject('P')).rejects.toThrow(/sign in/i);
  await expect(getBOMData('P')).rejects.toThrow(/sign in/i);
  const projects = vi.fn(), bom = vi.fn(), error = vi.fn();
  subscribeToProjects(projects, undefined, error);
  subscribeToBOM('P', bom, error);
  expect(projects).toHaveBeenCalledWith([]);
  expect(bom).toHaveBeenCalledWith([]);
  expect(mocks.getDoc).not.toHaveBeenCalled();
  expect(mocks.getDocs).not.toHaveBeenCalled();
  expect(mocks.onSnapshot).not.toHaveBeenCalled();
});
