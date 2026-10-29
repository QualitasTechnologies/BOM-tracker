import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  uid: 'alice', scoped: false, subscribe: vi.fn(), read: vi.fn(), live: vi.fn(), update: vi.fn(), remove: vi.fn(), dialog: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.uid ? { uid: h.uid } : null }) }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scoped }));
vi.mock('@/utils/transcriptFirestore', () => ({
  subscribeToProjectActivities: (...a: unknown[]) => h.subscribe(...a),
  readScopedProjectActivities: (...a: unknown[]) => h.read(...a),
  subscribeScopedProjectActivities: (id: string, uid: string, onValue: (rows: unknown[]) => void, onError: (error: Error) => void) => {
    h.live(id, uid, onValue, onError);
    h.read(id).then(onValue, onError);
    return () => {};
  },
  updateActivity: (...a: unknown[]) => h.update(...a),
  deleteActivity: (...a: unknown[]) => h.remove(...a),
}));
vi.mock('@/utils/transcriptService', () => ({ generateStatusUpdate: vi.fn() }));
vi.mock('../TranscriptSourceDialog', () => ({
  default: (props: { open: boolean; projectId: string; transcriptId: string }) => { h.dialog(props); return props.open ? <div data-testid="source-dialog">{props.projectId}:{props.transcriptId}</div> : null; },
}));

import ProjectActivityTimeline from '../ProjectActivityTimeline';

const base = { projectId: 'P', projectName: 'Build', type: 'note', source: 'transcript', meetingDate: '2026-10-01', createdAt: '', createdBy: '', createdByName: '' };
const linked = { ...base, id: 'a1', summary: 'from transcript', transcriptId: 'T1' };
const manual = { ...base, id: 'a2', summary: 'typed by hand', source: 'manual' };

beforeEach(() => {
  h.uid = 'alice';
  h.scoped = false;
  h.subscribe.mockImplementation((_id: string, cb: (rows: unknown[]) => void) => { cb([linked, manual]); return () => {}; });
  h.read.mockResolvedValue([linked, manual]);
  h.update.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = () => fireEvent.click(screen.getByText('(2)'));

describe('ProjectActivityTimeline source transcript access', () => {
  it.each(['account', 'project'])('hides already-loaded history and its dialog immediately when the %s changes', async change => {
    h.scoped = true;
    h.read.mockResolvedValueOnce([linked, manual]).mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    await waitFor(() => expect(screen.getByText('(2)')).toBeTruthy());
    open();
    fireEvent.click(screen.getByRole('button', { name: /view source transcript/i }));
    expect(screen.getByTestId('source-dialog')).toBeTruthy();
    if (change === 'account') h.uid = 'bob';
    rerender(<ProjectActivityTimeline projectId={change === 'project' ? 'Q' : 'P'} projectName="Other" />);
    expect(screen.queryByText('(2)')).toBeNull();
    expect(screen.queryByText('from transcript')).toBeNull();
    expect(screen.queryByTestId('source-dialog')).toBeNull();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('offers the source transcript only on activities that carry a transcript id', async () => {
    render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    open();
    expect(screen.getAllByRole('button', { name: /view source transcript/i })).toHaveLength(1);
    expect(h.read).not.toHaveBeenCalled();
    expect(screen.queryByTestId('source-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /view source transcript/i }));
    expect(screen.getByTestId('source-dialog').textContent).toBe('P:T1');
  });

  it('uses scoped live invalidation with the current account for history refreshes', async () => {
    h.scoped = true;
    render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    await waitFor(() => expect(screen.getByText('(2)')).toBeTruthy());
    expect(h.live).toHaveBeenCalledWith('P', 'alice', expect.any(Function), expect.any(Function));
    const refresh = h.live.mock.calls[0][2] as (rows: unknown[]) => void;
    act(() => refresh([{ ...linked, id: 'a3', summary: 'server refresh' }]));
    fireEvent.click(screen.getByText('(1)'));
    expect(await screen.findByText('server refresh')).toBeTruthy();
  });

  it('keeps inline edit working after the new button was added', async () => {
    render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    open();
    fireEvent.click(screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-pencil'))!);
    fireEvent.change(screen.getByPlaceholderText('Activity summary'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('a1', { summary: 'edited', type: 'note' }));
  });

  it('with scoped reads on, reads only through the server and refreshes after an edit', async () => {
    h.scoped = true;
    render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    await waitFor(() => expect(screen.getByText('(2)')).toBeTruthy());
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.live).toHaveBeenCalledWith('P', 'alice', expect.any(Function), expect.any(Function));
    open();
    fireEvent.click(screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-pencil'))!);
    fireEvent.change(screen.getByPlaceholderText('Activity summary'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(h.live).toHaveBeenCalledTimes(2));
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('with scoped reads on, shows an explicit error with Retry instead of falling back to the SDK', async () => {
    h.scoped = true;
    h.read.mockRejectedValueOnce(new Error('Meeting history is available to internal team members only.')).mockResolvedValue([linked, manual]);
    render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    expect(await screen.findByText(/internal team members only/i)).toBeTruthy();
    expect(h.subscribe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('(2)')).toBeTruthy());
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('ignores a late scoped reply after the project changed', async () => {
    h.scoped = true;
    let late: (rows: unknown[]) => void = () => {};
    h.read.mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockResolvedValue([manual]);
    const { rerender } = render(<ProjectActivityTimeline projectId="P" projectName="Build" />);
    rerender(<ProjectActivityTimeline projectId="Q" projectName="Other" />);
    await waitFor(() => expect(screen.getByText('(1)')).toBeTruthy());
    late([linked, manual]);
    await Promise.resolve();
    expect(screen.queryByText('(2)')).toBeNull();
  });
});
