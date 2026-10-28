import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ list: vi.fn(), pending: vi.fn() }));
vi.mock('@/utils/nativeMaterialCommands', () => ({
  listPendingNativeMaterialRequests: (...a: unknown[]) => h.list(...a),
  getPendingNativeMaterialRequest: (...a: unknown[]) => h.pending(...a),
  resolveNativeMaterialRequest: vi.fn(), acknowledgeNativeMaterialRequest: vi.fn(),
}));

import PendingProjectCreations from '../PendingProjectCreations';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PendingProjectCreations', () => {
  it('offers recovery for each saved creation or unreadable request, even after a reload with flags closed', async () => {
    h.list.mockReturnValue([{ projectId: 'NEW', operation: 'create_project' }, { projectId: 'BAD', operation: 'unknown' }, { projectId: 'P', operation: 'patch' }]);
    h.pending.mockResolvedValue({ kind: 'pending', operation: 'create_project', resolved: false });
    render(<PendingProjectCreations uid="u1" />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Check status' })).toHaveLength(2));
    expect(h.pending).toHaveBeenCalledWith('NEW');
    expect(h.pending).toHaveBeenCalledWith('BAD');
    expect(h.pending).not.toHaveBeenCalledWith('P'); // BOM changes are recovered on their own BOM page
  });

  it('renders nothing without a user or saved creation', () => {
    h.list.mockReturnValue([]);
    const { container } = render(<PendingProjectCreations uid="u1" />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const none = render(<PendingProjectCreations uid={undefined} />);
    expect(none.container).toBeEmptyDOMElement();
  });
});
