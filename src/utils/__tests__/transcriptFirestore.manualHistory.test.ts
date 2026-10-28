import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  getDocs: vi.fn(), getDoc: vi.fn(), activities: vi.fn(), transcript: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, auth: h.auth }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name, doc: (_col: unknown, id: string) => id, query: (...a: unknown[]) => ({ q: a }),
  where: (...a: unknown[]) => a, orderBy: vi.fn(), limit: vi.fn(), getDocs: h.getDocs, getDoc: h.getDoc,
  onSnapshot: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), Timestamp: {},
}));
vi.mock('../nativeProjectReads', () => ({ nativeProjectReads: { activities: h.activities, transcript: h.transcript } }));
import { getProjectSourceTranscript, readScopedProjectActivities } from '../transcriptFirestore';

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
