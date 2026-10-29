import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  getDocs: vi.fn(), getDoc: vi.fn(), activities: vi.fn(), transcript: vi.fn(), onSnapshot: vi.fn(), onIdTokenChanged: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ getAuth: () => h.auth, GoogleAuthProvider: class { setCustomParameters() {} }, onIdTokenChanged: h.onIdTokenChanged }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/analytics', () => ({ getAnalytics: () => ({}) }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), connectFunctionsEmulator: vi.fn() }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), connectStorageEmulator: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {}, auth: h.auth }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name, doc: (_col: unknown, id: string) => id, query: (...a: unknown[]) => ({ q: a }),
  where: (...a: unknown[]) => a, orderBy: vi.fn(), limit: vi.fn(), getDocs: h.getDocs, getDoc: h.getDoc,
  initializeFirestore: () => ({}), connectFirestoreEmulator: vi.fn(), onSnapshot: h.onSnapshot, setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), Timestamp: {},
}));
vi.mock('../nativeProjectReads', () => ({ nativeProjectReads: { activities: h.activities, transcript: h.transcript } }));
import { getProjectSourceTranscript, readScopedProjectActivities, subscribeScopedProjectActivities, subscribeScopedSourceTranscript } from '../transcriptFirestore';

const activity = (id: string, meetingDate: string, over: Record<string, unknown> = {}) => ({ id, projectId: 'P', projectName: 'Build', type: 'note', summary: id, meetingDate, source: 'transcript', ...over });
const page = (activities: unknown[], next_cursor: string | null = null) => ({ project_id: 'P', project_version: '1:1', activities, next_cursor });
const body = { id: 'T1', rawText: '<b>x</b>\n  List<String>', meetingDate: '2026-10-01', processed: true, createdBy: 'u9', createdByName: 'Bob' };
const read = { project_id: 'P', project_version: '1:1', transcript: body, linked_project_count: 2, transcript_version: '1:1' };
const scoped = () => vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
const snap = (rows: Array<Record<string, unknown>>) => ({ docs: rows.map((data, index) => ({ id: `a${index}`, data: () => data })) });

beforeEach(() => {
  vi.unstubAllEnvs();
  Object.values(h).forEach(value => { if (typeof value === 'function') (value as ReturnType<typeof vi.fn>).mockReset(); });
  h.auth.currentUser = { uid: 'alice' };
});

describe('scoped manual history reads', () => {
  it('scans every server page with the captured account and orders by meeting date without touching the SDK', async () => {
    h.activities.mockResolvedValueOnce(page([activity('a', '2026-10-01')], 'c1')).mockResolvedValueOnce(page([activity('b', '2026-10-05')], null));
    const rows = await readScopedProjectActivities('P');
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
    expect(h.activities.mock.calls.map(c => [c[0], c[1], c[2]])).toEqual([['P', { limit: 100 }, 'alice'], ['P', { limit: 100, cursor: 'c1' }, 'alice']]);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('rejects duplicate rows, repeated cursors, signed-out and changed accounts', async () => {
    h.activities.mockResolvedValueOnce(page([activity('a', '2026-10-01')], 'c1')).mockResolvedValueOnce(page([activity('a', '2026-10-01')]));
    await expect(readScopedProjectActivities('P')).rejects.toMatchObject({ code: 'integrity' });
    h.activities.mockReset().mockResolvedValue(page([], 'same'));
    await expect(readScopedProjectActivities('P')).rejects.toMatchObject({ code: 'integrity' });
    h.auth.currentUser = null;
    await expect(readScopedProjectActivities('P')).rejects.toMatchObject({ code: 'sign_in_required' });
    h.auth.currentUser = { uid: 'alice' };
    h.activities.mockReset().mockImplementation(async () => { h.auth.currentUser = { uid: 'bob' }; return page([]); });
    await expect(readScopedProjectActivities('P')).rejects.toMatchObject({ code: 'identity_changed' });
  });

  it('stops when the caller context is no longer current', async () => {
    h.activities.mockResolvedValue(page([activity('a', '2026-10-01')], 'c1'));
    let current = true;
    h.activities.mockImplementationOnce(async () => { current = false; return page([], null); });
    await expect(readScopedProjectActivities('P', { isCurrent: () => current })).rejects.toMatchObject({ code: 'identity_changed' });
  });

  it('reads one transcript through the server only and never falls back to the SDK after a denial', async () => {
    scoped(); h.transcript.mockResolvedValue(read);
    const result = await getProjectSourceTranscript('P', 'T1');
    expect(result).toEqual({ transcript: body, linkedProjectCount: 2 });
    expect(h.transcript.mock.calls[0].slice(0, 3)).toEqual(['P', 'T1', 'alice']);
    h.transcript.mockRejectedValue(Object.assign(new Error('denied'), { code: 'access' }));
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'access' });
    expect(h.getDoc).not.toHaveBeenCalled(); expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('refuses a result for another transcript, an oversized body or a changed account', async () => {
    scoped();
    h.transcript.mockResolvedValue({ ...read, transcript: { ...body, id: 'T9' } });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'integrity' });
    h.transcript.mockResolvedValue({ ...read, transcript: { ...body, rawText: 'x'.repeat(1048577) } });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'integrity' });
    h.transcript.mockImplementation(async () => { h.auth.currentUser = { uid: 'bob' }; return read; });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'identity_changed' });
  });
});

describe('legacy manual history reads (scoped reads off)', () => {
  it('requires a stored activity link for the project before reading the transcript', async () => {
    h.getDocs.mockResolvedValue(snap([{ projectId: 'Q', transcriptId: 'T1' }]));
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'not_found' });
    expect(h.getDoc).not.toHaveBeenCalled(); expect(h.transcript).not.toHaveBeenCalled();
  });

  it('returns the stored text verbatim with only a project count', async () => {
    h.getDocs.mockResolvedValue(snap([{ projectId: 'P', transcriptId: 'T1' }, { projectId: 'Q', transcriptId: 'T1' }, { projectId: 'Q', transcriptId: 'T1' }]));
    h.getDoc.mockResolvedValue({ exists: () => true, id: 'T1', data: () => ({ rawText: body.rawText, meetingDate: body.meetingDate, processed: true, createdBy: 'u9', createdByName: 'Bob' }) });
    const result = await getProjectSourceTranscript('P', 'T1');
    expect(result.linkedProjectCount).toBe(2);
    expect(result.transcript.rawText).toBe(body.rawText);
    expect(JSON.stringify(result)).not.toContain('"Q"');
  });

  it('fails explicitly for a dangling, malformed or oversized record', async () => {
    h.getDocs.mockResolvedValue(snap([{ projectId: 'P', transcriptId: 'T1' }]));
    h.getDoc.mockResolvedValue({ exists: () => false });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'not_found' });
    h.getDoc.mockResolvedValue({ exists: () => true, id: 'T1', data: () => ({ rawText: 5, meetingDate: 'x' }) });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'integrity' });
    h.getDoc.mockResolvedValue({ exists: () => true, id: 'T1', data: () => ({ rawText: 'x'.repeat(1048577), meetingDate: 'x' }) });
    await expect(getProjectSourceTranscript('P', 'T1')).rejects.toMatchObject({ code: 'integrity' });
  });
});

// Real subscribeProjectRead wiring; only the Firebase transport modules are fake.
const NOTICE = { version: 1, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' };
function wireTransport() {
  const listeners: Array<(snap: { exists: () => boolean; data: () => unknown }) => void> = [];
  let idCallback: ((user: { uid: string } | null) => void) | undefined;
  h.onSnapshot.mockImplementation((_ref: unknown, next: (snap: { exists: () => boolean; data: () => unknown }) => void) => { listeners.push(next); next({ exists: () => false, data: () => undefined }); return () => {}; });
  h.onIdTokenChanged.mockImplementation((_auth: unknown, next: (user: { uid: string } | null) => void) => { idCallback = next; next(h.auth.currentUser); return () => {}; });
  const notice = () => listeners.forEach(next => next({ exists: () => true, data: () => NOTICE }));
  return { notice, listenerCount: () => listeners.length, identity: (user: { uid: string } | null) => { h.auth.currentUser = user; idCallback?.(user); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

describe('scoped live history subscriptions', () => {
  it('delivers a valid live activity read instead of failing the context check', async () => {
    const transport = wireTransport();
    h.activities.mockResolvedValue(page([activity('a', '2026-10-01')]));
    const onValue = vi.fn(), onError = vi.fn();
    const stop = subscribeScopedProjectActivities('P', 'alice', onValue, onError);
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue.mock.calls[0][0].map((r: { id: string }) => r.id)).toEqual(['a']);
    h.activities.mockResolvedValue(page([activity('b', '2026-10-05')]));
    transport.notice();
    await settle();
    expect(onValue).toHaveBeenCalledTimes(2);
    expect(onValue.mock.calls[1][0].map((r: { id: string }) => r.id)).toEqual(['b']);
    stop();
  });

  it('refreshes an open source transcript on a notice and keeps the text verbatim', async () => {
    scoped();
    const transport = wireTransport();
    h.transcript.mockResolvedValue(read);
    const onValue = vi.fn(), onError = vi.fn();
    const stop = subscribeScopedSourceTranscript('P', 'T1', 'alice', onValue, onError);
    await settle();
    expect(onError).not.toHaveBeenCalled();
    h.transcript.mockResolvedValue({ ...read, transcript: { ...body, rawText: '<i>new</i>  ' } });
    transport.notice();
    await settle();
    expect(onValue.mock.calls.map(c => c[0].transcript.rawText)).toEqual([body.rawText, '<i>new</i>  ']);
    stop();
  });

  it('drops a late reply after an account switch and reports the error without data', async () => {
    const transport = wireTransport();
    let release!: (value: unknown) => void;
    h.activities.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const onValue = vi.fn(), onError = vi.fn();
    subscribeScopedProjectActivities('P', 'alice', onValue, onError);
    await settle();
    transport.identity({ uid: 'bob' });
    release(page([activity('a', '2026-10-01')]));
    await settle();
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('reports access loss on the next notice without keeping earlier rows', async () => {
    const transport = wireTransport();
    h.activities.mockResolvedValueOnce(page([activity('a', '2026-10-01')]));
    const onValue = vi.fn(), onError = vi.fn();
    subscribeScopedProjectActivities('P', 'alice', onValue, onError);
    await settle();
    expect(onValue).toHaveBeenCalledTimes(1);
    h.activities.mockRejectedValue(Object.assign(new Error('Access denied'), { code: 'access' }));
    transport.notice();
    await settle();
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'access' }));
  });
});
