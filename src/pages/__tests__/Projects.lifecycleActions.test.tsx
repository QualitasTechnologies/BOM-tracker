import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Projects from '../Projects';

const mocks = vi.hoisted(() => ({ native: true, readOnly: true, projects: [] as any[] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'alice', email: 'alice@qualitas.tech' }, isAdmin: true }) }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/Transcripts', () => ({ TranscriptPasteDialog: () => null }));
vi.mock('@/components/Project/AddProjectDialog', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog">Add project form</div> : null }));
vi.mock('@/components/Project/EditProjectDialog', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog">Edit project form</div> : null }));
vi.mock('@/components/Project/DeleteProjectDialog', () => ({ default: () => null, ArchiveProjectRecoveryAction: () => null }));
vi.mock('@/components/Project/RestoreProjectDialog', () => ({ RestoreProjectAction: () => null }));
vi.mock('@/utils/projectFirestore', () => ({
  addProject: vi.fn(), updateProject: vi.fn(), archiveProject: vi.fn(), updateBOMData: vi.fn(),
  subscribeToProjects: (callback: (projects: any[]) => void) => { callback(mocks.projects); return () => {}; },
}));
vi.mock('@/utils/settingsFirestore', () => ({ getTemplate: vi.fn(), subscribeToClients: () => () => {} }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => mocks.readOnly }));
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => mocks.native }));

const project = { projectId: 'PRJ-001', projectName: 'Project One', clientName: 'Acme', description: 'Test', status: 'Planning', deadline: '2026-11-01' };
const renderProjects = () => render(<MemoryRouter><Projects /></MemoryRouter>);
beforeEach(() => { mocks.native = true; mocks.readOnly = true; mocks.projects = [project]; });

it('exposes Edit in the table when scoped reads and native lifecycle writes are paired', () => {
  renderProjects();
  fireEvent.click(screen.getByRole('button', { name: /Table/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByText('Edit project form')).toBeInTheDocument();
});

it('keeps edits and creation blocked when scoped reads are on but native writes are off', () => {
  mocks.native = false;
  mocks.projects = [];
  renderProjects();
  expect(screen.queryByRole('button', { name: 'Add New Project' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create New Project' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});

it('opens the Add dialog from the empty-state Create button when lifecycle writes are paired', () => {
  mocks.projects = [];
  renderProjects();
  fireEvent.click(screen.getByRole('button', { name: 'Create New Project' }));
  expect(screen.getByText('Add project form')).toBeInTheDocument();
});
