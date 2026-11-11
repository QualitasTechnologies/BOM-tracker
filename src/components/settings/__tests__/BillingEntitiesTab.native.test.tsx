import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillingEntitiesTab from '../BillingEntitiesTab';
const mocks = vi.hoisted(() => ({ enabled: true, uid: 'admin', pending: false, catalog: vi.fn(), open: vi.fn(), mutate: vi.fn(), retry: vi.fn(), resolve: vi.fn(), acknowledge: vi.fn(), subscribe: vi.fn(), legacyUpdate: vi.fn(), legacyCreate: vi.fn(), legacyDelete: vi.fn(), legacyDefault: vi.fn(), toast: vi.fn(), upload: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: mocks.uid } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/utils/imageUpload', () => ({ uploadCompanyLogo: (...args: unknown[]) => mocks.upload(...args) }));
vi.mock('@/utils/nativeBillingEntityOperations', () => ({
  isNativeBillingEntityEnabled: () => mocks.enabled,
  hasPendingNativeBillingEntityRequest: () => mocks.pending,
  createNativeBillingEntitySession: () => ({ catalog: mocks.catalog, open: mocks.open, mutate: mocks.mutate, retry: mocks.retry, resolve: mocks.resolve, acknowledge: mocks.acknowledge, pending: () => mocks.pending }),
}));
vi.mock('@/utils/settingsFirestore', () => ({
  subscribeToBillingEntities: (...args: unknown[]) => mocks.subscribe(...args), updateBillingEntity: mocks.legacyUpdate, addBillingEntity: mocks.legacyCreate,
  deleteBillingEntity: mocks.legacyDelete, setDefaultBillingEntity: mocks.legacyDefault, getDefaultBillingEntity: (rows: any[]) => rows[0],
}));
const entity = { id: 'B', legalName: 'Fresh legal name', displayName: 'Entity', companyAddress: 'Address', gstin: '29AAACQ1872F1ZE', nextPoNumber: 10 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true; mocks.pending = false; mocks.uid = 'admin';
  mocks.catalog.mockResolvedValue({ entities: [{ ...entity, legalName: 'Old card name' }], catalog_version: 'a'.repeat(64), permissions: { create: true, set_default: true } });
  mocks.open.mockResolvedValue({ entity, entity_version: '10:5', permissions: { edit: true, delete: true } });
  mocks.mutate.mockImplementation(async () => { mocks.pending = true; return 'committed'; });
  mocks.acknowledge.mockImplementation(async () => { mocks.pending = false; return { entities: [entity], catalog_version: 'b'.repeat(64), permissions: { create: true, set_default: true } }; });
  mocks.resolve.mockResolvedValue('cancelled'); mocks.retry.mockResolvedValue('committed');
  mocks.subscribe.mockImplementation((callback: (rows: any[]) => void) => { callback([entity]); return () => {}; });
  mocks.upload.mockResolvedValue({ url: 'confirmed-logo', path: 'company-logos/confirmed.png' });
});
it('opens the authoritative entity and saves the original form with its opening version, without legacy writes', async () => {
  render(<BillingEntitiesTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(await screen.findByDisplayValue('Fresh legal name')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save entity' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'update', entity_id: 'B', expected_version: '10:5', patch: expect.objectContaining({ nextPoNumber: 10 }) })));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
  expect(mocks.subscribe).not.toHaveBeenCalled(); expect(mocks.legacyUpdate).not.toHaveBeenCalled();
});
it('keeps the form and confirmed logo after an uncertain save and exposes saved-request recovery', async () => {
  mocks.mutate.mockImplementation(async () => { mocks.pending = true; throw Error('unconfirmed'); });
  const { container } = render(<BillingEntitiesTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' })); await screen.findByDisplayValue('Fresh legal name');
  fireEvent.change(container.ownerDocument.querySelector('input[type=file]')!, { target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save entity' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: 'Check saved change', hidden: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save entity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved change', hidden: true }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce()); expect(mocks.upload).toHaveBeenCalledOnce();
});
it('shows saved-request recovery on remount and does not allow a new action to replace it', async () => {
  mocks.pending = true; render(<BillingEntitiesTab />);
  expect(await screen.findByRole('button', { name: 'Check saved change' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add entity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
});
it('preserves the original subscription and write path while the native client flag is off', async () => {
  mocks.enabled = false; render(<BillingEntitiesTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save entity' }));
  await waitFor(() => expect(mocks.legacyUpdate).toHaveBeenCalledOnce()); expect(mocks.catalog).not.toHaveBeenCalled();
});

it('creates the original form as a new versioned identity', async () => {
  render(<BillingEntitiesTab />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add entity' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add entity' }));
  for (const [label, value] of [['Legal name *', 'New entity'], ['Registered address *', 'Address'], ['GSTIN *', entity.gstin]]) {
    fireEvent.change(screen.getByText(label).parentElement!.querySelector('input,textarea')!, { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save entity' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create', entity_id: expect.any(String), expected_version: 'missing', entity: expect.objectContaining({ legalName: 'New entity', nextPoNumber: 1, nextQuotationNumber: 1 }) })));
  expect(mocks.legacyCreate).not.toHaveBeenCalled();
});

it('pins deletion before confirmation so a change during confirmation conflicts on the server', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => { expect(mocks.open).toHaveBeenCalledOnce(); return true; });
  render(<BillingEntitiesTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Entity' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({ operation: 'delete', entity_id: 'B', expected_version: '10:5' }));
  expect(mocks.legacyDelete).not.toHaveBeenCalled(); confirm.mockRestore();
});

it('pins the displayed complete catalog for default selection', async () => {
  mocks.catalog.mockResolvedValue({ entities: [{ ...entity, id: 'company' }, { ...entity, id: 'B', displayName: 'Other' }], catalog_version: 'c'.repeat(64), permissions: { create: true, set_default: true } });
  render(<BillingEntitiesTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Set default' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({ operation: 'set_default', entity_id: 'B', expected_catalog_version: 'c'.repeat(64) }));
  expect(mocks.legacyDefault).not.toHaveBeenCalled();
});

it('shows paused edits without permitting a save or changing to the legacy path', async () => {
  mocks.open.mockResolvedValue({ entity, entity_version: '10:5', permissions: { edit: false, delete: false } });
  render(<BillingEntitiesTab />); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(await screen.findByText('Billing changes are paused or unavailable with your current access.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save entity' })).toBeDisabled(); expect(mocks.legacyUpdate).not.toHaveBeenCalled();
});

it('refreshes the native catalog on focus without rebasing an open form', async () => {
  render(<BillingEntitiesTab />); await screen.findByRole('button', { name: 'Edit' });
  mocks.catalog.mockResolvedValue({ entities: [{ ...entity, displayName: 'Updated elsewhere' }], catalog_version: 'd'.repeat(64), permissions: { create: true, set_default: true } });
  fireEvent.focus(window); expect(await screen.findByText('Updated elsewhere')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' })); await screen.findByDisplayValue('Fresh legal name');
  const count = mocks.catalog.mock.calls.length; fireEvent.focus(window);
  expect(mocks.catalog).toHaveBeenCalledTimes(count); expect(screen.getByDisplayValue('Fresh legal name')).toBeInTheDocument();
});

it('retains native recovery and blocks legacy fallback when the client gate is rolled back', async () => {
  mocks.enabled = false; mocks.pending = true; render(<BillingEntitiesTab />);
  expect(await screen.findByRole('button', { name: 'Check saved change' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add entity' })).toBeDisabled(); expect(mocks.subscribe).not.toHaveBeenCalled();
});
