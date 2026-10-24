import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Projects from '../Projects';
import { webcrypto } from 'node:crypto';
vi.stubGlobal('crypto', webcrypto);

const mocks = vi.hoisted(() => ({
  native: true, uid: 'alice', add: vi.fn(), create: vi.fn(), get: vi.fn(), command: vi.fn(), update: vi.fn(), template: vi.fn(),
  submit: undefined as undefined | ((project: any, template?: string) => Promise<void>),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'alice', email: 'alice@qualitas.tech' }, isAdmin: true }) }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/Transcripts', () => ({ TranscriptPasteDialog: () => null }));
vi.mock('@/components/Project/EditProjectDialog', () => ({ default: () => null }));
vi.mock('@/components/Project/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('@/components/Project/AddProjectDialog', () => ({ default: (props: any) => { mocks.submit = props.onAddProject; return props.open ? <div>Project dialog</div> : null; } }));
vi.mock('@/utils/projectFirestore', () => ({ addProject: (...args: any[]) => mocks.add(...args), subscribeToProjects: () => () => {}, updateBOMData: (...args: any[]) => mocks.update(...args), updateProject: vi.fn(), archiveProject: vi.fn() }));
vi.mock('@/utils/settingsFirestore', () => ({ getTemplate: (...args: any[]) => mocks.template(...args), subscribeToClients: () => () => {} }));
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => mocks.native }));
vi.mock('@/utils/nativeMaterialOperations', async importOriginal => ({ ...await importOriginal<any>(), nativeMaterialOperations: { createProject: (...args: any[]) => mocks.create(...args), currentUid: async () => mocks.uid, get: (...args: any[]) => mocks.get(...args), command: (...args: any[]) => mocks.command(...args) } }));

const project = { id: 'p1', name: 'Project One', client: 'Acme', description: '', status: 'Planning', deadline: '2026-10-14', poValue: 0 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = true; mocks.uid = 'alice';
  mocks.add.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ ok: true });
  mocks.get.mockResolvedValue({ version: 'missing', categories: [], permissions: { command: true } });
  mocks.template.mockResolvedValue({ id: 't1', items: [{ id: 'a', itemType: 'component', name: 'Motor', description: '', category: 'Parts', quantity: 1 }] });
  mocks.command.mockResolvedValue({ ok: true });
});

it('shows partial creation recovery and retries only the captured initialization request', async () => {
  mocks.command.mockRejectedValueOnce(new Error('Receipt outcome uncertain'));
  render(<MemoryRouter><Projects /></MemoryRouter>);
  fireEvent.click(screen.getByText('Add New Project'));
  await act(async () => { await mocks.submit!(project, 't1'); });
  expect(screen.getByText(/Project creation or template completion needs confirmation/)).toBeInTheDocument();
  expect(screen.queryByText('Project dialog')).not.toBeInTheDocument();
  const initial = structuredClone(mocks.command.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry project completion' }));
  await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
  expect(mocks.command.mock.calls[1]).toEqual(initial);
  expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.get).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText(/Project creation or template completion needs confirmation/)).not.toBeInTheDocument());
});

it('keeps the original template whole-array flow when native edits are disabled', async () => {
  mocks.native = false;
  render(<MemoryRouter><Projects /></MemoryRouter>);
  await act(async () => { await mocks.submit!(project, 't1'); });
  expect(mocks.add).toHaveBeenCalledOnce(); expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
});

it('rejects creation when cached creator metadata belongs to a different SDK account', async () => {
  mocks.uid = 'bob';
  render(<MemoryRouter><Projects /></MemoryRouter>);
  await expect(mocks.submit!(project, 't1')).rejects.toThrow('account changed');
  expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
});

it('routes native creation without a template through conditional creation only', async () => {
  render(<MemoryRouter><Projects /></MemoryRouter>);
  await act(async () => { await mocks.submit!(project); });
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
});

it('retains the creation identity after a lost confirmation and never falls back to another project', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Creation confirmation lost'));
  render(<MemoryRouter><Projects /></MemoryRouter>);
  await act(async () => { await mocks.submit!(project); });
  const opening = structuredClone(mocks.create.mock.calls[0]);
  expect(screen.getByText(/needs confirmation/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry project completion' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1]).toEqual(opening);
  expect(mocks.add).not.toHaveBeenCalled();
});
