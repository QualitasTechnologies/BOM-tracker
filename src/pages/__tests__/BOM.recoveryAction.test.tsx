import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BOM from '../BOM';

const h = vi.hoisted(() => ({
  getProject: vi.fn(), getBOMData: vi.fn(), subscriptionError: null as null | ((error: Error) => void),
  uid: 'alice', pending: vi.fn(), resolve: vi.fn(), acknowledge: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'P' }), useSearchParams: () => [new URLSearchParams()] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid }, isAdmin: true }) }));
vi.mock('@/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
// The scoped root read is native now; this fixture serves the same project the file already provides.
vi.mock('@/utils/nativeProjectOperations', () => ({
  createNativeProjectWorkspace: () => ({
    load: async () => { const project = await h.getProject(); if (!project) throw Object.assign(new Error('project_not_found'), { code: 'project_not_found' }); return { ok: true, version: '1:0', project }; },
    recover: () => null, capture: () => ({ pendingCommand: undefined }), invalidate: vi.fn(),
  }),
}));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => true }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ getPendingNativeMaterialRequest: (...a: unknown[]) => h.pending(...a), resolveNativeMaterialRequest: (...a: unknown[]) => h.resolve(...a), acknowledgeNativeMaterialRequest: (...a: unknown[]) => h.acknowledge(...a), isNativeMaterialCommandEnabled: () => false, loadNativeMaterialSnapshot: vi.fn(), submitNativeMaterialCommand: vi.fn(), submitNativeMaterialFulfillment: vi.fn() }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => h.getProject(...args), getBOMData: (...args: unknown[]) => h.getBOMData(...args),
  subscribeToBOM: (_id: string, _onValue: (value: unknown[]) => void, onError: (error: Error) => void) => { h.subscriptionError = onError; return vi.fn(); },
  updateBOMData: vi.fn(), updateBOMItem: vi.fn(), deleteBOMItem: vi.fn(), updateProject: vi.fn(), getTotalBOMCost: () => 0,
}));
vi.mock('@/utils/accessControl', () => ({ getVisibleCategories: (_email: unknown, _role: unknown, _member: unknown, categories: unknown[]) => categories }));
vi.mock('@/utils/projectDocumentFirestore', () => ({ getProjectDocuments: vi.fn().mockResolvedValue([]), linkDocumentToBOMItems: vi.fn() }));
vi.mock('@/utils/settingsFirestore', () => ({ getVendors: vi.fn().mockResolvedValue([]), getBOMSettings: vi.fn().mockResolvedValue({ categories: [] }) }));
vi.mock('@/utils/brandFirestore', () => ({ getBrands: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/userService', () => ({ fetchAllUsers: vi.fn().mockResolvedValue({ users: [] }) }));
vi.mock('@/utils/bomDocumentLinking', () => ({ syncPODocumentLinks: vi.fn().mockResolvedValue([]), getOutgoingPODocuments: () => [] }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('@/components/BOM/BOMHeader', () => ({ default: () => null }));
vi.mock('@/components/BOM/BOMCategoryCard', () => ({ default: ({ category }: { category: { name: string } }) => <div>{category.name}</div> }));
vi.mock('@/components/BOM/BOMPartRow', () => ({ default: () => null }));
vi.mock('@/components/BOM/ImportBOMDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/PurchaseRequestDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/CreatePODialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/OrderItemDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/ReceiveItemDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/InwardTracking', () => ({ default: () => null }));
vi.mock('@/components/BOM/ProjectDocuments', () => ({ default: () => null }));
vi.mock('@/components/BOM/POListSection', () => ({ default: () => null }));
vi.mock('@/components/BOM/ComplianceChecker', () => ({ default: () => null }));
vi.mock('@/components/BOM/OverheadsTab', () => ({ default: () => null }));
vi.mock('@/components/BOM/ProjectCostBar', () => ({ default: () => null }));
vi.mock('@/components/Milestones', () => ({ MilestoneList: () => null }));
vi.mock('@/components/Transcripts', () => ({ ProjectActivityTimeline: () => null }));
vi.mock('@/components/Project/ProjectContextEditor', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectMembersTab', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectCommunicationsTab', () => ({ ProjectCommunicationsTab: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>, DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>, DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p> }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectValue: () => null }));
vi.mock('@/components/ui/alert', () => ({ Alert: ({ children }: React.PropsWithChildren) => <div role="alert">{children}</div>, AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: React.PropsWithChildren) => <label>{children}</label> }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/ui/collapsible', () => ({ Collapsible: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CollapsibleContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CollapsibleTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('@/components/ui/alert-dialog', () => ({ AlertDialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>, AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogAction: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));


beforeEach(() => { vi.clearAllMocks(); h.uid = 'alice'; h.subscriptionError = null; });

describe('BOM page recovery action', () => {
  it('offers Check status with native editing off, resolves, confirms the read, and reloads the BOM', async () => {
    h.getProject.mockResolvedValue({ projectId: 'P', projectName: 'Plant', clientName: 'Acme' });
    h.getBOMData.mockResolvedValue([]);
    h.pending.mockResolvedValueOnce({ kind: 'pending', operation: 'patch', resolved: false }).mockResolvedValue({ kind: 'absent' });
    h.resolve.mockResolvedValue({ resolution: 'cancelled', result: {} });
    h.acknowledge.mockResolvedValue({ version: '1:1' });
    render(<BOM />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    await screen.findByText(/was not applied/i);
    expect(h.pending).toHaveBeenCalledWith('P');
    expect(h.resolve).toHaveBeenCalledWith('P');
    expect(h.acknowledge).toHaveBeenCalledWith('P');
    await waitFor(() => expect(h.getBOMData.mock.calls.length).toBeGreaterThanOrEqual(2)); // reloaded after confirmation
  });
});
