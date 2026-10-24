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
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: h.projectId }), useSearchParams: () => [new URLSearchParams()] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid, email: 'a@qualitastech.com' }, isAdmin: true }) }));
vi.mock('@/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: { get currentUser() { return { uid: h.uid }; } } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: h.toast }), toast: h.toast }));
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
  getProjectDocuments: vi.fn(async () => h.docs), linkDocumentToBOMItems: (...a: unknown[]) => h.legacyLink(...a),
  uploadProjectDocument: vi.fn(), deleteProjectDocument: vi.fn(), acknowledgeProjectDocumentUpload: vi.fn(), acknowledgeProjectDocumentDeletion: vi.fn(),
  getPendingProjectDocumentOperations: () => ({ uploads: [], deletions: [] }),
}));
vi.mock('@/utils/settingsFirestore', () => ({ getVendors: vi.fn().mockResolvedValue([]), getBOMSettings: vi.fn().mockResolvedValue({ categories: [] }) }));
vi.mock('@/utils/brandFirestore', () => ({ getBrands: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/userService', () => ({ fetchAllUsers: vi.fn().mockResolvedValue({ users: [] }) }));
vi.mock('@/utils/bomDocumentLinking', async importOriginal => ({ ...(await importOriginal<any>()), syncPODocumentLinks: vi.fn().mockResolvedValue([]), getOutgoingPODocuments: () => [] }));
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
vi.mock('@/components/BOM/OrderItemDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/ReceiveItemDialog', () => ({ default: () => null }));
vi.mock('@/components/BOM/InwardTracking', () => ({ default: () => null }));
vi.mock('@/components/BOM/POListSection', () => ({ default: () => null }));
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
  h.categories = categories(); h.docs = [quote(['a', 'x'])];
  h.load.mockImplementation(async () => ({ categories: h.categories, version: h.version }));
  h.command.mockImplementation(async (p: string, input: any) => ok(p, input));
});

describe('original BOM document links with native material commands', () => {
  it('sends the explicit delta against the version displayed at opening, not a version that arrived in the background', async () => {
    await mount();
    openLinks();
    await advance('1:2');
    toggle('Item B');
    await save();

    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command).toHaveBeenCalledWith('P', { expected_version: '1:1', operation_id: expect.any(String), command: delta(['b'], []) }, 'alice');
    expect(h.submitLive).not.toHaveBeenCalled();
    expect(h.legacyLink).not.toHaveBeenCalled();
    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves a linked item the member cannot see out of both lists', async () => {
    await mount();
    openLinks();
    expect(screen.queryByLabelText(/Item X/)).toBeNull();
    toggle('Item A'); // unlink visible a
    toggle('Item C'); // link visible c
    await save();
    expect(h.command.mock.calls[0][1].command).toEqual(delta(['c'], ['a']));
    expect(JSON.stringify(h.command.mock.calls[0][1].command)).not.toContain('"x"');
  });

  it('retries a lost reply with the identical request even after the background version advanced', async () => {
    h.command.mockRejectedValueOnce(lostReply());
    await mount();
    openLinks();
    toggle('Item B');
    await save();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));

    await advance('1:3');
    await save();
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(h.command.mock.calls[1]).toEqual(h.command.mock.calls[0]);
    expect(sentVersion(1)).toBe('1:1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the uncertain request identity when the dialog is closed and reopened after the version advanced', async () => {
    h.command.mockRejectedValueOnce(lostReply());
    await mount();
    openLinks();
    toggle('Item B');
    await save();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await advance('1:4');

    openLinks();
    toggle('Item B');
    await save();
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(sentVersion(1)).toBe('1:1');
    expect(sentId(1)).toBe(sentId(0));
  });

  it('after a definitive version conflict a reopened dialog captures the newly displayed version and a new request', async () => {
    h.command.mockRejectedValueOnce(Object.assign(new Error('material_version_conflict'), { code: 'material_version_conflict' }));
    await mount();
    openLinks();
    toggle('Item B');
    await save();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await advance('1:5');

    openLinks();
    toggle('Item B');
    await save();
    expect(sentVersion(0)).toBe('1:1');
    expect(sentVersion(1)).toBe('1:5');
    expect(sentId(1)).not.toBe(sentId(0));
  });

  it('shows a denial, keeps the draft, and never falls back to a direct or live-version write', async () => {
    h.command.mockRejectedValue(Object.assign(new Error('You do not have access to change these BOM items.'), { code: 'material_forbidden' }));
    await mount();
    openLinks();
    toggle('Item B');
    await save();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'You do not have access to change these BOM items.' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText(/Item B/) as HTMLInputElement).checked).toBe(true);
    expect(h.submitLive).not.toHaveBeenCalled();
    expect(h.legacyLink).not.toHaveBeenCalled();
    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.command).toHaveBeenCalledTimes(1);
  });

  it('refuses to open before a BOM revision has been displayed and sends nothing', async () => {
    h.load.mockImplementation(() => new Promise(() => undefined));
    render(<BOM />);
    await screen.findByTitle('Link to BOM items');
    await flush();
    openLinks();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cannot open material links', variant: 'destructive' }));
    expect(h.command).not.toHaveBeenCalled();
  });

  it('discards an open dialog and its action when the account changes, and sends nothing for the old account', async () => {
    const view = await mount();
    openLinks();
    toggle('Item B');
    h.uid = 'mallory';
    view.rerender(<BOM />);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.command).not.toHaveBeenCalled();

    await waitFor(() => expect(h.load.mock.calls.length).toBeGreaterThan(1));
    await flush();
    openLinks();
    toggle('Item B');
    await save();
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command.mock.calls[0][2]).toBe('mallory');
  });

  it('does not reuse an uncertain request across an account change', async () => {
    h.command.mockRejectedValueOnce(lostReply());
    const view = await mount();
    openLinks();
    toggle('Item B');
    await save();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    h.uid = 'mallory';
    view.rerender(<BOM />);
    await flush();
    await waitFor(() => expect(h.load.mock.calls.length).toBeGreaterThan(1));
    await flush();

    openLinks();
    toggle('Item B');
    await save();
    expect(h.command.mock.calls[1][2]).toBe('mallory');
    expect(sentId(1)).not.toBe(sentId(0));
  });

  it('discards the dialog and sends nothing for the old project when the route project changes', async () => {
    const view = await mount();
    openLinks();
    toggle('Item B');
    h.projectId = 'Q';
    view.rerender(<BOM />);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('with native material commands off keeps the original mount: no captured action and the original link path', async () => {
    h.native = false;
    h.scopedReads = false;
    render(<BOM />);
    await screen.findByTitle('Link to BOM items');
    await flush();
    openLinks();
    toggle('Item B');
    await save();
    expect(h.command).not.toHaveBeenCalled();
    expect(h.submitLive).not.toHaveBeenCalled();
    expect(h.legacyLink).toHaveBeenCalledTimes(1);
  });

  it('with scoped reads on and native material commands off disables link entry without sending a write', async () => {
    h.native = false;
    render(<BOM />);
    const linkButton = await screen.findByTitle('Link to BOM items') as HTMLButtonElement;
    expect(linkButton.disabled).toBe(true);
    fireEvent.click(linkButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
    expect(h.submitLive).not.toHaveBeenCalled();
    expect(h.legacyLink).not.toHaveBeenCalled();
    expect(h.updateItem).not.toHaveBeenCalled();
  });
});
