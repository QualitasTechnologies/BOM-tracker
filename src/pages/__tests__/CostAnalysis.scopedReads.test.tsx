import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CostAnalysis from '../CostAnalysis';

const h = vi.hoisted(() => ({
  uid: 'alice', admin: true, project: 'P', scoped: false,
  load: vi.fn(), upload: vi.fn(), remove: vi.fn(), toast: vi.fn(),
  getProject: vi.fn(), getBOMData: vi.fn(), getTotalBOMCost: vi.fn(),
}));

vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: h.uid }; } }, db: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid, isAdmin: h.admin }, isAdmin: h.admin }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams({ project: h.project })], Link: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/CostAnalysis/WeekNavigator', () => ({ WeekNavigator: () => null, weekRangeFromDate: () => ({ start: '2026-10-12', end: '2026-10-18' }) }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => h.getProject(...args), getBOMData: (...args: unknown[]) => h.getBOMData(...args),
  getTotalBOMCost: (...args: unknown[]) => h.getTotalBOMCost(...args), updateProject: vi.fn(), subscribeToProjects: vi.fn(() => vi.fn()),
}));
vi.mock('@/utils/pulseProxyFirestore', () => ({ getProjectCosts: vi.fn().mockResolvedValue({ projects: [] }) }));
vi.mock('@/utils/settingsFirestore', () => ({ subscribeToClients: vi.fn(() => vi.fn()) }));
vi.mock('@/utils/projectDocumentFirestore', () => ({ getProjectDocuments: (...args: unknown[]) => h.load(...args), uploadProjectDocument: (...args: unknown[]) => h.upload(...args), deleteProjectDocument: (...args: unknown[]) => h.remove(...args) }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scoped }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/ui/progress', () => ({ Progress: () => <div /> }));

const doc = { id: 'PO', projectId: 'P', name: 'customer.pdf', url: 'https://example.test/customer', type: 'customer-po', uploadedAt: new Date(), uploadedBy: 'alice' };

beforeEach(() => {
  vi.clearAllMocks();
  h.uid = 'alice'; h.admin = true; h.project = 'P'; h.scoped = false;
  h.getProject.mockResolvedValue({ projectId: 'P', projectName: 'Example project', clientName: 'Acme', status: 'Ongoing' });
  h.getBOMData.mockResolvedValue([]); h.getTotalBOMCost.mockReturnValue(0);
  h.load.mockResolvedValue([doc]); h.upload.mockResolvedValue(doc); h.remove.mockResolvedValue(undefined);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

const renderPage = () => render(<CostAnalysis />);
let renderPageRef: ReturnType<typeof renderPage>;

describe('CostAnalysis scoped Customer PO controls', () => {
  it('blocks legacy Customer PO upload and delete when scoped reads are on without a paired writer', async () => {
    h.scoped = true;
    renderPageRef = renderPage();
    await screen.findByText('customer.pdf');
    const input = renderPageRef.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const deleteButton = screen.getByTitle('Delete document') as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Upload PO' })).toBeDisabled();
    expect(deleteButton.disabled).toBe(true);

    fireEvent.change(input, { target: { files: [new File(['po'], 'forced.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(deleteButton);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('keeps the legacy Customer PO upload and delete flow available when scoped reads are off', async () => {
    renderPageRef = renderPage();
    await screen.findByText('customer.pdf');
    const input = renderPageRef.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const deleteButton = screen.getByTitle('Delete document') as HTMLButtonElement;
    expect(input.disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Upload PO' })).toBeEnabled();
    expect(deleteButton.disabled).toBe(false);

    fireEvent.change(input, { target: { files: [new File(['po'], 'legacy.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(h.upload).toHaveBeenCalledWith(expect.any(File), 'P', 'customer-po', 'alice'));
    fireEvent.click(deleteButton);
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('PO', doc.url));
  });
});
