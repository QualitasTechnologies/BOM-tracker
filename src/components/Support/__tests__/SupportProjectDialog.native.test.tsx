import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SupportProjectDialog } from '../SupportProjectDialog';

const mocks = vi.hoisted(() => ({ native: true, scoped: false, pending: undefined as any, probe: { kind: 'absent' } as any, load: vi.fn(), submit: vi.fn(), resolve: vi.fn(), capture: vi.fn(), invalidate: vi.fn(), factory: vi.fn(), update: vi.fn(), close: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/utils/projectFirestore', () => ({ updateProject: mocks.update }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => mocks.scoped }));
vi.mock('@/utils/settingsFirestore', () => ({ getClientContacts: () => [{ id: 'contact', name: 'Contact' }], getPrimaryClientContact: () => ({ id: 'contact', name: 'Contact' }) }));
vi.mock('../AddClientContactDialog', () => ({ AddClientContactDialog: () => null }));
vi.mock('../SupportDocuments', () => ({ SupportDocuments: () => <div>Existing documents</div> }));
vi.mock('@/utils/nativeSupportProfile', async importOriginal => ({ ...await importOriginal<any>(), isNativeSupportProfileEnabled: () => mocks.native, hasPendingNativeSupportProfile: () => mocks.probe, createNativeSupportProfileWorkspace: mocks.factory }));
vi.mock('@/components/ui/select', () => ({ Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>, SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ value, children }: any) => <option value={value}>{children}</option> }));
const profile = () => ({ amcStatus: 'none', machines: [], supportContactId: 'contact', internalNotes: 'Authoritative opening' });
const snapshot = () => ({ ok: true, actor_uid: 'partner', project_id: 'P', version: '10:1', support_profile: profile(), permissions: { edit: true, resolve: true } });
const project: any = { projectId: 'P', projectName: 'Project', supportProfile: { internalNotes: 'Stale list profile' } };
const props = (extra = {}) => ({ open: true, project, client: null, userId: 'partner', userName: 'Partner', onOpenChange: mocks.close, ...extra });
const notes = () => screen.getByPlaceholderText(/Access constraints/);
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = true; mocks.scoped = false; mocks.pending = undefined; mocks.probe = { kind: 'absent' };
  mocks.load.mockResolvedValue(snapshot()); mocks.submit.mockResolvedValue({ ok: true }); mocks.resolve.mockResolvedValue({ ok: true, resolution: 'cancelled' });
  mocks.capture.mockImplementation(() => ({ baseline: snapshot(), get pendingCommand() { return mocks.pending; }, submit: mocks.submit, resolve: mocks.resolve }));
  mocks.factory.mockReturnValue({ load: mocks.load, capture: mocks.capture, invalidate: mocks.invalidate });
});

it('uses the existing form with a fresh Support opening and sends only explicit changed fields', async () => {
  render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Authoritative opening');
  fireEvent.change(notes(), { target: { value: 'Inspected' } }); fireEvent.click(screen.getByRole('button', { name: 'Save support profile' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ kind: 'support_profile', patch: { internalNotes: 'Inspected' } }));
  expect(mocks.update).not.toHaveBeenCalled(); await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
});

it('keeps a failed draft and frozen opening for retry without reloading or falling back', async () => {
  mocks.submit.mockRejectedValueOnce(new Error('Outcome uncertain'));
  render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Authoritative opening');
  fireEvent.change(notes(), { target: { value: 'Draft retained' } }); fireEvent.click(screen.getByRole('button', { name: 'Save support profile' }));
  await screen.findByText('Outcome uncertain'); expect(notes()).toHaveValue('Draft retained'); expect(notes()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved changes' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2)); expect(mocks.submit.mock.calls[1]).toEqual(mocks.submit.mock.calls[0]);
  expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.capture).toHaveBeenCalledOnce(); expect(mocks.update).not.toHaveBeenCalled();
});

it('read enablement with native edits off cannot reach legacy profile replacement', async () => {
  mocks.native = false; mocks.scoped = true;
  render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Authoritative opening');
  expect(screen.getByRole('button', { name: 'Save support profile' })).toBeDisabled(); expect(mocks.update).not.toHaveBeenCalled();
});

it('a saved request remains resolvable when the client write flag is off', async () => {
  mocks.native = false; mocks.probe = { kind: 'pending' }; mocks.pending = { kind: 'support_profile', patch: { internalNotes: 'Pending' } };
  render(<SupportProjectDialog {...props()} />); await screen.findByRole('button', { name: 'Confirm or cancel saved request' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm or cancel saved request' })); await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it('reopening a pending request displays the frozen changes that retry would send', async () => {
  mocks.probe = { kind: 'pending' }; mocks.pending = { kind: 'support_profile', patch: { internalNotes: 'Original unsent draft' } };
  render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Original unsent draft');
  expect(notes()).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Retry saved changes' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(mocks.pending));
});

it('opening denial is visible and disables saving without legacy fallback', async () => {
  mocks.load.mockRejectedValue(new Error('Access unavailable'));
  render(<SupportProjectDialog {...props()} />); await screen.findByText('Access unavailable');
  expect(screen.getByRole('button', { name: 'Save support profile' })).toBeDisabled(); expect(mocks.update).not.toHaveBeenCalled();
});

it('a successful read with editing paused keeps every write path disabled', async () => {
  mocks.load.mockResolvedValue({ ...snapshot(), permissions: { edit: false, resolve: true } });
  render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Authoritative opening');
  expect(notes()).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save support profile' })).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it('unreadable pending storage is visible and cannot enter the legacy save path', async () => {
  mocks.native = false; mocks.probe = { kind: 'error', message: 'Saved request unavailable' };
  render(<SupportProjectDialog {...props()} />); await screen.findByText('Saved request unavailable');
  expect(screen.getByRole('button', { name: 'Save support profile' })).toBeDisabled();
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
});

it('late replies after an account change cannot close the new context or overwrite its draft', async () => {
  let finish: any; mocks.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Authoritative opening');
  fireEvent.change(notes(), { target: { value: 'First account draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save support profile' }));
  mocks.load.mockResolvedValue({ ...snapshot(), actor_uid: 'second', support_profile: { ...profile(), internalNotes: 'Second account' } });
  view.rerender(<SupportProjectDialog {...props({ userId: 'second' })} />); await screen.findByDisplayValue('Second account');
  await act(async () => finish({ ok: true })); expect(mocks.close).not.toHaveBeenCalled(); expect(mocks.invalidate).toHaveBeenCalled(); expect(notes()).toHaveValue('Second account');
});

it('flag-off coexistence retains the original form save when no saved request exists', async () => {
  mocks.native = false; render(<SupportProjectDialog {...props()} />); await screen.findByDisplayValue('Stale list profile');
  fireEvent.click(screen.getByRole('button', { name: 'Save support profile' })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce()); expect(mocks.factory).not.toHaveBeenCalled();
});
