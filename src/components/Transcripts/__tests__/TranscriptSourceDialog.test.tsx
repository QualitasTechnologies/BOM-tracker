import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ read: vi.fn(), uid: 'alice' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.uid ? { uid: h.uid } : null }) }));
vi.mock('@/utils/transcriptFirestore', () => ({ getProjectSourceTranscript: (...a: unknown[]) => h.read(...a) }));

import TranscriptSourceDialog from '../TranscriptSourceDialog';

const RAW = '<img src=x onerror=alert(1)> List<String>\n  indented <john@acme.com>';
const transcript = { id: 'T1', rawText: RAW, meetingDate: '2026-10-01', meetingTitle: 'Weekly sync', fileName: 'sync.txt', processed: true, createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'u9', createdByName: 'Bob' };
const source = (rawText = RAW, id = 'T1') => ({ transcript: { ...transcript, id, rawText }, linkedProjectCount: 1 });

beforeEach(() => { h.uid = 'alice'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TranscriptSourceDialog', () => {
  it('does nothing while closed', () => {
    render(<TranscriptSourceDialog open={false} onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('reads fresh on open and shows the stored text as inert text with provenance', async () => {
    h.read.mockResolvedValue(source());
    const { baseElement } = render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    await waitFor(() => expect(screen.getByTestId('source-transcript-text')).toBeTruthy());
    expect(h.read).toHaveBeenCalledWith('P', 'T1', expect.objectContaining({ isCurrent: expect.any(Function) }));
    expect(screen.getByTestId('source-transcript-text').textContent).toBe(RAW);
    expect(baseElement.querySelector('img')).toBeNull();
    expect(screen.getByText(/Weekly sync/)).toBeTruthy();
    expect(screen.getByText(/Saved by Bob/)).toBeTruthy();
    expect(screen.queryByText(/covers .* projects/i)).toBeNull();
  });

  it('warns with a count only when the text covers several projects', async () => {
    h.read.mockResolvedValue({ ...source(), linkedProjectCount: 3 });
    render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(await screen.findByText(/covers 3 projects/i)).toBeTruthy();
  });

  it('shows an explicit error and retries with a fresh read', async () => {
    h.read.mockRejectedValueOnce(Object.assign(new Error('Project data is temporarily unavailable. Try again.'), { code: 'request_failed' }))
      .mockResolvedValue(source());
    render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByTestId('source-transcript-text')).toBeTruthy());
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('hides Alice’s ready transcript and reads again when the signed-in user changes', async () => {
    h.read.mockResolvedValueOnce(source('Alice private text')).mockResolvedValueOnce(source('Bob text'));
    const view = render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(await screen.findByText('Alice private text')).toBeTruthy();
    h.uid = 'bob';
    view.rerender(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(screen.queryByText('Alice private text')).toBeNull();
    expect(await screen.findByText('Bob text')).toBeTruthy();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('ignores an old user read that resolves after an account switch', async () => {
    let resolveAlice: (v: unknown) => void = () => {};
    h.read.mockImplementationOnce(() => new Promise(resolve => { resolveAlice = resolve; })).mockResolvedValue(source('Bob text'));
    const view = render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    h.uid = 'bob';
    view.rerender(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    expect(await screen.findByText('Bob text')).toBeTruthy();
    expect(h.read.mock.calls[0][2].isCurrent()).toBe(false);
    await act(async () => { resolveAlice(source('Alice late text')); });
    expect(screen.queryByText('Alice late text')).toBeNull();
  });

  it('does not show cached text after closing and reopening while the fresh read is pending', async () => {
    let resolveFresh: (v: unknown) => void = () => {};
    h.read.mockResolvedValueOnce(source('Previous text')).mockImplementationOnce(() => new Promise(resolve => { resolveFresh = resolve; }));
    const props = { onOpenChange: () => {}, projectId: 'P', transcriptId: 'T1' };
    const view = render(<TranscriptSourceDialog {...props} open />);
    expect(await screen.findByText('Previous text')).toBeTruthy();
    view.rerender(<TranscriptSourceDialog {...props} open={false} />);
    view.rerender(<TranscriptSourceDialog {...props} open />);
    expect(screen.queryByText('Previous text')).toBeNull();
    expect(screen.getByText('Loading transcript...')).toBeTruthy();
    await act(async () => { resolveFresh(source('Fresh text')); });
    expect(await screen.findByText('Fresh text')).toBeTruthy();
  });

  it('hides the previous transcript immediately when the project changes', async () => {
    let resolveNew: (v: unknown) => void = () => {};
    h.read.mockResolvedValueOnce(source('Project A text')).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const view = render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="A" transcriptId="T1" />);
    expect(await screen.findByText('Project A text')).toBeTruthy();
    view.rerender(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="B" transcriptId="T1" />);
    expect(screen.queryByText('Project A text')).toBeNull();
    expect(screen.getByText('Loading transcript...')).toBeTruthy();
    await act(async () => { resolveNew(source('Project B text')); });
    expect(await screen.findByText('Project B text')).toBeTruthy();
  });

  it('ignores a late reply after the transcript changed', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    h.read.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(source('second', 'T2'));
    const view = render(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T1" />);
    view.rerender(<TranscriptSourceDialog open onOpenChange={() => {}} projectId="P" transcriptId="T2" />);
    await waitFor(() => expect(screen.getByTestId('source-transcript-text').textContent).toBe('second'));
    expect(h.read.mock.calls[0][2].isCurrent()).toBe(false);
    await act(async () => { resolveFirst(source()); });
    expect(screen.getByTestId('source-transcript-text').textContent).toBe('second');
  });
});
