import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Projects from '../Projects';

const h = vi.hoisted(() => ({ list: vi.fn(), pending: vi.fn(), resolve: vi.fn(), acknowledge: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'alice', email: 'alice@qualitas.tech' }, isAdmin: true }) }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/Transcripts', () => ({ TranscriptPasteDialog: () => null }));
vi.mock('@/components/Project/EditProjectDialog', () => ({ default: () => null }));
vi.mock('@/components/Project/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('@/components/Project/AddProjectDialog', () => ({ default: () => null }));
vi.mock('@/utils/projectFirestore', () => ({ addProject: vi.fn(), subscribeToProjects: () => () => {}, updateBOMData: vi.fn(), updateProject: vi.fn(), archiveProject: vi.fn() }));
vi.mock('@/utils/settingsFirestore', () => ({ getTemplate: vi.fn(), subscribeToClients: () => () => {} }));
// Native lifecycle switched OFF: recovery must still be reachable.
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => false }));
vi.mock('@/utils/nativeMaterialCommands', () => ({
  isNativeMaterialCommandEnabled: () => false,
  listPendingNativeMaterialRequests: (...a: unknown[]) => h.list(...a),
  getPendingNativeMaterialRequest: (...a: unknown[]) => h.pending(...a),
  resolveNativeMaterialRequest: (...a: unknown[]) => h.resolve(...a),
  acknowledgeNativeMaterialRequest: (...a: unknown[]) => h.acknowledge(...a),
}));

beforeEach(() => vi.clearAllMocks());

it('offers the saved project-creation check on the Projects page and runs resolve then acknowledge', async () => {
  h.list.mockReturnValueOnce([{ projectId: 'NEW', operation: 'create_project' }]).mockReturnValue([]);
  h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'create_project', resolved: false }).mockResolvedValue({ kind: 'absent' });
  h.resolve.mockResolvedValue({ resolution: 'cancelled', result: {} });
  h.acknowledge.mockResolvedValue(null);
  render(<MemoryRouter><Projects /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
  await screen.findByText(/was not applied/i);
  expect(h.pending).toHaveBeenCalledWith('NEW');
  expect(h.resolve).toHaveBeenCalledWith('NEW');
  expect(h.acknowledge).toHaveBeenCalledWith('NEW');
});
