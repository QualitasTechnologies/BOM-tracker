import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BOM from '../BOM';

// Real BOM page + real ProjectDocuments + real document-link action. Faked: the Firebase boundary, the material
// read client and the native material transport (`nativeMaterialOperations.command`).
const h = vi.hoisted(() => ({
  uid: 'alice', projectId: 'P', native: true, scopedReads: true, toast: vi.fn(),
  version: '1:1', categories: [] as any[], docs: [] as any[],
  onValue: null as null | ((value: unknown[]) => void),
  load: vi.fn(), command: vi.fn(), submitLive: vi.fn(), legacyLink: vi.fn(), updateItem: vi.fn(),
  uploadDocument: null as null | ((document: any) => void),
  orderDocuments: [] as any[],
  po: null as any, getDocs: null as any,
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: h.projectId }), useSearchParams: () => [new URLSearchParams()] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid, email: 'a@qualitastech.com' }, isAdmin: true }) }));
vi.mock('@/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: { get currentUser() { return { uid: h.uid }; } } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: h.toast }), toast: h.toast }));
// The scoped root read is native now; this fixture serves the same project the file already provides.
vi.mock('@/utils/nativeProjectOperations', () => ({
  createNativeProjectWorkspace: () => ({
    load: async () => ({ ok: true, version: '1:0', project: { projectId: h.projectId, projectName: 'Proj', clientName: 'Client' } }),
    recover: () => null, capture: () => ({ pendingCommand: undefined }), invalidate: vi.fn(),
  }),
}));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scopedReads }));
vi.mock('@/utils/nativeMaterialCommands', () => ({
  isNativeMaterialCommandEnabled: () => h.native, loadNativeMaterialSnapshot: (...a: unknown[]) => h.load(...a),
  submitNativeMaterialCommand: (...a: unknown[]) => h.submitLive(...a), submitNativeMaterialFulfillment: vi.fn(),
}));
vi.mock('@/utils/nativeMaterialOperations', async importOriginal => ({
  ...(await importOriginal<any>()),
  nativeMaterialOperations: { currentUid: async () => h.uid, command: (...a: unknown[]) => h.command(...a) },
}));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: async () => ({ projectId: h.projectId, projectName: 'Proj', clientName: 'Client' }), getBOMData: vi.fn(async () => h.categories),
  subscribeToBOM: (_id: string, onValue: (value: unknown[]) => void) => { h.onValue = onValue; return vi.fn(); },
  updateBOMData: vi.fn(), updateBOMItem: (...a: unknown[]) => h.updateItem(...a), deleteBOMItem: vi.fn(), updateProject: vi.fn(), getTotalBOMCost: () => 0,
}));
// A restricted view: the "Hidden" category is not visible to this member but still holds linked item ids.
vi.mock('@/utils/accessControl', () => ({ getVisibleCategories: (_e: unknown, _r: unknown, _m: unknown, categories: any[]) => categories.filter(c => c.name !== 'Hidden') }));
vi.mock('@/utils/projectDocumentFirestore', () => ({
  getProjectDocuments: vi.fn(async (...a: unknown[]) => { h.getDocs(...a); return h.docs; }), linkDocumentToBOMItems: (...a: unknown[]) => h.legacyLink(...a),
  uploadProjectDocument: vi.fn(), deleteProjectDocument: vi.fn(), acknowledgeProjectDocumentUpload: vi.fn(), acknowledgeProjectDocumentDeletion: vi.fn(),
  getPendingProjectDocumentOperations: () => ({ uploads: [], deletions: [] }),
}));
vi.mock('@/utils/settingsFirestore', () => ({ getVendors: vi.fn().mockResolvedValue([]), getBOMSettings: vi.fn().mockResolvedValue({ categories: [] }) }));
vi.mock('@/utils/brandFirestore', () => ({ getBrands: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/userService', () => ({ fetchAllUsers: vi.fn().mockResolvedValue({ users: [] }) }));
vi.mock('@/utils/bomDocumentLinking', async importOriginal => ({ ...(await importOriginal<any>()), syncPODocumentLinks: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, disabled, onCheckedChange }: any) => <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onCheckedChange(e.target.checked)} />,
}));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('@/components/BOM/BOMHeader', () => ({ default: () => null }));
vi.mock('@/components/BOM/BOMCategoryCard', () => ({ default: ({ category }: { category: { name: string } }) => <div>{category.name}</div> }));
vi.mock('@/components/BOM/BOMPartRow', () => ({ default: () => null }));
vi.mock('@/components/BOM/ImportBOMDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/PurchaseRequestDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/CreatePODialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/OrderItemDialog', () => ({ default: ({ onDocumentUploaded, availablePODocuments }: any) => { h.uploadDocument = onDocumentUploaded; h.orderDocuments = availablePODocuments; return null; } }));
vi.mock('@/components/BOM/ReceiveItemDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/InwardTracking', () => ({ default: () => null }));
vi.mock('@/components/BOM/POListSection', () => ({ default: (props: any) => { h.po = props; return null; } }));
vi.mock('@/components/BOM/ComplianceChecker', () => ({ default: () => null }));
vi.mock('@/components/BOM/OverheadsTab', () => ({ default: () => null }));
vi.mock('@/components/BOM/ProjectCostBar', () => ({ default: () => null }));
vi.mock('@/components/Milestones', () => ({ MilestoneList: () => null }));
vi.mock('@/components/Transcripts', () => ({ ProjectActivityTimeline: () => null }));
vi.mock('@/components/Project/ProjectContextEditor', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectMembersTab', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectCommunicationsTab', () => ({ ProjectCommunicationsTab: () => null }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectValue: () => null }));
vi.mock('@/components/ui/alert', () => ({ Alert: ({ children }: React.PropsWithChildren) => <div role="alert">{children}</div>, AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: React.PropsWithChildren) => <label>{children}</label> }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/ui/collapsible', () => ({ Collapsible: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CollapsibleContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CollapsibleTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('@/components/ui/alert-dialog', () => ({ AlertDialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>, AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDialogAction: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));

const item = (id: string, category: string) => ({ id, name: `Item ${id.toUpperCase()}`, category, quantity: 1, price: 0, status: 'not-ordered', itemType: 'component' });
const categories = () => [
  { name: 'Mech', isExpanded: true, items: [item('a', 'Mech'), item('b', 'Mech'), item('c', 'Mech')] },
  { name: 'Hidden', isExpanded: true, items: [item('x', 'Hidden')] },
];
const quote = (linked: string[]) => ({ id: 'D', projectId: 'P', name: 'quote.pdf', type: 'vendor-quote', url: 'https://files.example/q', uploadedAt: new Date('2026-01-01'), uploadedBy: 'bob', linkedBOMItems: linked });
const flush = () => act(async () => { await new Promise(done => setTimeout(done, 0)); });
const ok = (_p: string, input: any) => ({ ok: true, project_id: 'P', operation_id: input.operation_id, command_kind: 'link_document_delta' });
const lostReply = () => Object.assign(new Error('Material request failed'), { code: 'native-material/request-failed' });

const mount = async () => {
  const view = render(<BOM />);
  await screen.findByTitle('Link to BOM items');
  await waitFor(() => expect(h.load).toHaveBeenCalled());
  await flush();
  return view;
};
const advance = async (version: string) => { h.version = version; await act(async () => { h.onValue?.([]); }); await flush(); };
const openLinks = () => fireEvent.click(screen.getByTitle('Link to BOM items'));
const toggle = (name: string) => fireEvent.click(screen.getByLabelText(new RegExp(name)));
const save = async () => { fireEvent.click(screen.getByRole('button', { name: /Save Links|Saving/ })); await flush(); };
const delta = (add: string[], remove: string[]) => ({ kind: 'link_document_delta', document_id: 'D', add_item_ids: add, remove_item_ids: remove });
const sentVersion = (n: number) => h.command.mock.calls[n][1].expected_version;
const sentId = (n: number) => h.command.mock.calls[n][1].operation_id;

beforeEach(() => {
  vi.clearAllMocks();
  h.uid = 'alice'; h.projectId = 'P'; h.native = true; h.scopedReads = true; h.version = '1:1'; h.onValue = null;
  h.getDocs = vi.fn(); h.po = null;
  h.categories = categories(); h.docs = [quote(['a', 'x'])];
  h.load.mockImplementation(async () => ({ categories: h.categories, version: h.version }));
  h.command.mockImplementation(async (p: string, input: any) => ok(p, input));
});


const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('PO completion refreshes the authoritative BOM view', () => {
  it('does not pass the client BOM-write callback, so a server finalize cannot be written twice', async () => {
    await mount();
    expect(h.po.onPOSent).toBeUndefined();
    expect(h.po.onNativeSaved).toBeTypeOf('function');
  });

  it('re-reads materials and documents after an email, manual or recovery completion and shows the server state', async () => {
    await mount();
    for (const label of ['Ordered by email', 'Ordered by manual mark', 'Ordered by recovery']) {
      const loads = h.load.mock.calls.length;
      const docReads = h.getDocs.mock.calls.length;
      h.version = `${loads + 1}:1`;
      h.categories = [{ name: label, isExpanded: true, items: [item('a', label)] }];
      await act(async () => { h.po.onNativeSaved(); });
      await flush();
      expect(await screen.findByText(label)).toBeTruthy();
      expect(h.load.mock.calls.length).toBeGreaterThan(loads);
      expect(h.getDocs.mock.calls.length).toBeGreaterThan(docReads);
    }
    expect(h.submitLive).not.toHaveBeenCalled();
    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('does not publish an old project when the route changes while the refresh is in flight', async () => {
    const view = await mount();
    const late = deferred<{ categories: any[]; version: string }>();
    h.load.mockImplementationOnce(() => late.promise);
    await act(async () => { h.po.onNativeSaved(); });
    h.projectId = 'Q';
    h.categories = [{ name: 'Project Q', isExpanded: true, items: [item('q', 'Project Q')] }];
    view.rerender(<BOM />);
    await flush();
    await act(async () => { late.resolve({ categories: [{ name: 'Old project P', isExpanded: true, items: [] }], version: '9:9' }); });
    await flush();
    expect(screen.queryByText('Old project P')).toBeNull();
    expect(await screen.findByText('Project Q')).toBeTruthy();
  });

  it('ignores a completion callback captured for another account or project', async () => {
    const view = await mount();
    const stale = h.po.onNativeSaved;
    h.uid = 'mallory';
    view.rerender(<BOM />);
    await flush();
    await waitFor(() => expect(h.load.mock.calls.length).toBeGreaterThan(1));
    await flush();
    const loads = h.load.mock.calls.length;
    h.categories = [{ name: 'Stale publish', isExpanded: true, items: [] }];
    await act(async () => { stale(); });
    await flush();
    expect(h.load.mock.calls.length).toBe(loads);
    expect(screen.queryByText('Stale publish')).toBeNull();
  });
});
