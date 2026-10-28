import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  pending: vi.fn(), resolve: vi.fn(), acknowledge: vi.fn(), list: vi.fn(),
}));
vi.mock('@/utils/nativeMaterialCommands', () => ({
  // Editing flag is closed: recovery must still be offered.
  isNativeMaterialCommandEnabled: () => false,
  getPendingNativeMaterialRequest: (...a: unknown[]) => h.pending(...a),
  resolveNativeMaterialRequest: (...a: unknown[]) => h.resolve(...a),
  acknowledgeNativeMaterialRequest: (...a: unknown[]) => h.acknowledge(...a),
}));

import MaterialRecoveryBanner from '../MaterialRecoveryBanner';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('MaterialRecoveryBanner', () => {
  it('renders nothing when no change is pending', async () => {
    h.pending.mockResolvedValue({ kind: 'absent' });
    const { container } = render(<MaterialRecoveryBanner projectId="P" />);
    await waitFor(() => expect(h.pending).toHaveBeenCalledWith('P'));
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a plain-language check even though editing is switched off, then resolves, confirms and refreshes', async () => {
    h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'patch', resolved: false }).mockResolvedValue({ kind: 'absent' });
    h.resolve.mockResolvedValue({ resolution: 'cancelled', result: {} });
    h.acknowledge.mockResolvedValue({ version: '1:1' });
    const onRefresh = vi.fn(async () => undefined);
    render(<MaterialRecoveryBanner projectId="P" onRefresh={onRefresh} />);
    const button = await screen.findByRole('button', { name: 'Check status' });
    expect(screen.getByText(/was not confirmed/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nonce|operation_id|resolve_only|journal/i);
    fireEvent.click(button);
    await screen.findByText(/was not applied/i);
    expect(h.resolve).toHaveBeenCalledWith('P');
    expect(h.acknowledge).toHaveBeenCalledWith('P');
    expect(h.resolve.mock.invocationCallOrder[0]).toBeLessThan(h.acknowledge.mock.invocationCallOrder[0]);
    expect(onRefresh).toHaveBeenCalled();
  });

  it('says a committed change was saved', async () => {
    h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'command', resolved: false }).mockResolvedValue({ kind: 'absent' });
    h.resolve.mockResolvedValue({ resolution: 'committed', result: {} });
    h.acknowledge.mockResolvedValue({ version: '2:1' });
    render(<MaterialRecoveryBanner projectId="P" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    await screen.findByText(/was saved/i);
  });

  it('keeps the request and offers a retry when the status check fails, without confirming', async () => {
    h.pending.mockResolvedValue({ kind: 'pending', operation: 'patch', resolved: false });
    h.resolve.mockRejectedValueOnce(new Error('offline'));
    render(<MaterialRecoveryBanner projectId="P" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    await screen.findByRole('alert');
    expect(h.acknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled();
  });

  it('after a confirmed answer whose read failed, only the confirmation is retried', async () => {
    // The journal records the answer once the status check succeeds, so later scans see it resolved.
    h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'patch', resolved: false })
      .mockResolvedValue({ kind: 'pending', operation: 'patch', resolved: true, resolution: 'committed' });
    h.resolve.mockResolvedValue({ resolution: 'committed', result: {} });
    h.acknowledge.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ version: '2:1' });
    render(<MaterialRecoveryBanner projectId="P" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    await screen.findByRole('alert');
    fireEvent.click(await screen.findByRole('button', { name: 'Finish checking' }));
    h.pending.mockResolvedValue({ kind: 'absent' });
    await screen.findByText(/was saved/i);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.acknowledge).toHaveBeenCalledTimes(2);
  });

  it('already-resolved requests go straight to confirmation', async () => {
    h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'patch', resolved: true, resolution: 'cancelled' }).mockResolvedValue({ kind: 'absent' });
    h.acknowledge.mockResolvedValue(null);
    render(<MaterialRecoveryBanner projectId="P" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish checking' }));
    await screen.findByText(/was not applied/i);
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it('reports an unreadable saved change without offering to continue', async () => {
    h.pending.mockResolvedValue({ kind: 'error', message: 'A saved BOM change could not be read.' });
    render(<MaterialRecoveryBanner projectId="P" />);
    await screen.findByText(/could not be read/i);
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
  });

  it('ignores a stale answer after the project changes', async () => {
    let release!: (v: unknown) => void;
    h.pending.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ kind: 'absent' });
    const view = render(<MaterialRecoveryBanner projectId="A" />);
    view.rerender(<MaterialRecoveryBanner projectId="B" />);
    release({ kind: 'pending', operation: 'patch', resolved: false });
    await waitFor(() => expect(h.pending).toHaveBeenCalledWith('B'));
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
  });
});
