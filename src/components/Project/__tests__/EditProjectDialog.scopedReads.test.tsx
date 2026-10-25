import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditProjectDialog from '../EditProjectDialog';

const mocks = vi.hoisted(() => ({
  scoped: true, native: false, legacy: vi.fn(), direct: vi.fn(), update: vi.fn(),
  bom: vi.fn(), docs: vi.fn(), close: vi.fn(), load: vi.fn(), capture: vi.fn(),
  submit: vi.fn(), invalidate: vi.fn(), factory: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'alice' }, isAdmin: true }) }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ deleteField: vi.fn(), doc: vi.fn(), updateDoc: mocks.direct }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => mocks.scoped }));
vi.mock('@/utils/projectFirestore', () => ({
  subscribeToProjects: () => () => {}, getBOMData: mocks.bom, updateProject: mocks.update,
}));
vi.mock('@/utils/projectDocumentFirestore', () => ({ getProjectDocuments: mocks.docs }));
vi.mock('@/utils/pulseProxyFirestore', () => ({ listPulseProjects: async () => [{ id: 7, name: 'Deal' }] }));
vi.mock('@/utils/settingsFirestore', () => ({
  subscribeToClients: (cb: any) => { cb([{ id: 'C', company: 'Acme' }]); return () => {}; },
  subscribeToBillingEntities: (cb: any) => { cb([{ id: 'company', displayName: 'Company', isDefault: true }]); return () => {}; },
  getDefaultBillingEntity: (rows: any[]) => rows[0],
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
const project: any = {
  projectId: 'P', projectName: 'Project', clientName: 'Acme', billingEntityId: 'company',
  status: 'Planning', description: 'Delivery', deadline: '2026-11-01', pulseProjectId: 7,
};
const view = () => render(<EditProjectDialog open project={project} onUpdateProject={mocks.legacy} onOpenChange={mocks.close} />);
beforeEach(() => {
  vi.clearAllMocks(); mocks.scoped = true; mocks.native = false;
  mocks.bom.mockResolvedValue([{ items: [] }]); mocks.docs.mockResolvedValue([{ type: 'customer-po' }]);
});

it('disables the unpaired legacy editor while scoped reads are enabled', async () => {
  view(); await screen.findByDisplayValue('Project');
  expect(screen.getByRole('button', { name: 'Update Project' })).toBeDisabled();
  expect(screen.getByLabelText('Project Name')).toBeDisabled();
  expect(screen.getByText(/Project editing is temporarily unavailable/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

it('rejects forced form submissions before callbacks, snapshots or direct unlink writes', async () => {
  view(); await screen.findByDisplayValue('Project');
  // A disabled button alone is insufficient: programmatic submit bypasses it.
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  fireEvent.submit(screen.getByRole('button', { name: 'Update Project' }).closest('form')!);
  await waitFor(() => expect(screen.getByText(/Project editing is temporarily unavailable/)).toBeVisible());
  for (const mutation of [mocks.legacy, mocks.direct, mocks.update, mocks.bom, mocks.docs]) expect(mutation).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it('keeps the original legacy editor available with scoped reads off', async () => {
  mocks.scoped = false; view(); await screen.findByDisplayValue('Project');
  fireEvent.click(screen.getByRole('button', { name: 'Update Project' }));
  await waitFor(() => expect(mocks.legacy).toHaveBeenCalledOnce());
  expect(mocks.direct).not.toHaveBeenCalled();
});

