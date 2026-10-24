import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BOM from '../BOM';

const h = vi.hoisted(() => ({
  getProject: vi.fn(), getBOMData: vi.fn(), subscriptionError: null as null | ((error: Error) => void), refresh: null as null | (() => void),
  uid: 'alice', scoped: true, lifecycle: true, factory: vi.fn(), load: vi.fn(), submit: vi.fn(), resolve: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ projectId: 'P' }), useSearchParams: () => [new URLSearchParams()] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid }, isAdmin: true }) }));
vi.mock('@/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => false, loadNativeMaterialSnapshot: vi.fn(), submitNativeMaterialCommand: vi.fn(), submitNativeMaterialFulfillment: vi.fn() }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => h.getProject(...args), getBOMData: (...args: unknown[]) => h.getBOMData(...args),
  subscribeToBOM: (_id: string, onValue: (value: unknown[]) => void, onError: (error: Error) => void) => { h.subscriptionError = onError; h.refresh = () => onValue([]); return vi.fn(); },
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
vi.mock('@/components/Milestones', () => ({ MilestoneList: () => null }));
vi.mock('@/components/Transcripts', () => ({ ProjectActivityTimeline: () => null }));
vi.mock('@/components/Project/ProjectContextEditor', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectMembersTab', () => ({ default: () => null }));
vi.mock('@/components/Project/ProjectCommunicationsTab', () => ({ ProjectCommunicationsTab: () => null }));
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

vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scoped }));
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => h.lifecycle }));
vi.mock('@/utils/nativeProjectOperations', () => ({ createNativeProjectWorkspace: (...args: unknown[]) => h.factory(...args) }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => <button {...props}>{children}</button> }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const snapshot = (internalBudget?: number, version = '10:1') => ({ ok: true, project_id: 'P', version, project: { projectId: 'P', projectName: 'Project', clientName: 'Acme', ...(internalBudget === undefined ? {} : { internalBudget }) } });

// A stateful stand-in for the session-storage backed action: it journals before sending, like the real one.
function makeWorkspace(options: { initial?: { kind: 'budget'; amount: number | null } } = {}) {
  const state = { journal: options.initial as any, loads: [] as any[] };
  const action = {
    submit: vi.fn(async (command: any) => { state.journal = command; return h.submit(command); }),
    resolve: vi.fn(() => h.resolve()),
    acknowledge: vi.fn(async () => { state.journal = undefined; }),
    get pendingCommand() { return state.journal; },
  };
  const workspace = {
    load: vi.fn(() => h.load()),
    recover: vi.fn(() => (state.journal ? action : null)),
    capture: vi.fn(() => action),
    invalidate: vi.fn(),
  };
  return { state, action, workspace };
}
const startEdit = async (value: string) => {
  fireEvent.click(await screen.findByTitle('Set budget'));
  fireEvent.change(screen.getByPlaceholderText('e.g. 500000'), { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.uid = 'alice'; h.scoped = true; h.lifecycle = true;
  h.getProject.mockResolvedValue({ projectId: 'P', projectName: 'Project', clientName: 'Acme', internalBudget: 500000 });
  h.getBOMData.mockResolvedValue([]);
  h.submit.mockResolvedValue({ ok: true });
  h.load.mockResolvedValue(snapshot(500000));
});

describe('BOM budget wiring through the mounted page', () => {
  it('shows recovery immediately on a first transport failure and keeps the same frozen request on retry', async () => {
    const ws = makeWorkspace();
    h.factory.mockReturnValue(ws.workspace);
    const send = deferred<unknown>();
    h.submit.mockReturnValueOnce(send.promise);
    render(<BOM />);
    await startEdit('650000');
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByRole('button', { name: 'Check saved change' })).toBeInTheDocument();
    expect(screen.getByText(/Saved amount: ₹6,?50,?000/)).toBeInTheDocument();
    await act(async () => { send.reject(new Error('network down')); });
    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check saved change' })).toBeInTheDocument();
    expect(ws.action.acknowledge).not.toHaveBeenCalled();
    expect(ws.state.journal).toEqual({ kind: 'budget', amount: 650000 });
    expect(ws.workspace.capture).toHaveBeenCalledTimes(1);
  });

  it('reconciles with a fresh authoritative read before acknowledging, and keeps the journal when that read fails', async () => {
    const ws = makeWorkspace();
    h.factory.mockReturnValue(ws.workspace);
    render(<BOM />);
    await startEdit('650000');
    h.load.mockRejectedValueOnce(new Error('Fresh project read failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText('Fresh project read failed')).toBeInTheDocument();
    expect(ws.action.acknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check saved change' })).toBeInTheDocument();

    h.resolve.mockResolvedValueOnce({ resolution: 'committed' });
    h.load.mockResolvedValueOnce(snapshot(650000, '10:2'));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
    await waitFor(() => expect(ws.action.acknowledge).toHaveBeenCalledOnce());
    const loadOrder = ws.workspace.load.mock.invocationCallOrder, ackOrder = ws.action.acknowledge.mock.invocationCallOrder[0];
    expect(Math.max(...loadOrder)).toBeLessThan(ackOrder);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Check saved change' })).not.toBeInTheDocument());
    expect(screen.getByText(/^₹6,?50,?000$/)).toBeInTheDocument();
  });

  it('acknowledges only after the post-save read and shows the authoritative amount', async () => {
    const ws = makeWorkspace();
    h.factory.mockReturnValue(ws.workspace);
    render(<BOM />);
    await startEdit('650000');
    h.load.mockResolvedValueOnce(snapshot(650000, '10:2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(ws.action.acknowledge).toHaveBeenCalledOnce());
    expect(h.submit).toHaveBeenCalledWith({ kind: 'budget', amount: 650000 });
    expect(h.submit.mock.invocationCallOrder[0]).toBeLessThan(ws.action.acknowledge.mock.invocationCallOrder[0]);
    expect((await screen.findAllByText(/^₹6,?50,?000$/)).length).toBeGreaterThan(0);
  });

  it('sends null for an explicit clear and never writes through the legacy project replacement', async () => {
    const ws = makeWorkspace();
    h.factory.mockReturnValue(ws.workspace);
    const { updateProject } = await import('@/utils/projectFirestore');
    render(<BOM />);
    await startEdit('');
    h.load.mockResolvedValueOnce(snapshot(undefined, '10:2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith({ kind: 'budget', amount: null }));
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('recovers a saved request on open, shows its amount, blocks new edits and resolves it with the same request', async () => {
    const ws = makeWorkspace({ initial: { kind: 'budget', amount: 700000 } });
    h.factory.mockReturnValue(ws.workspace);
    render(<BOM />);
    expect(await screen.findByText(/Saved amount: ₹7,?00,?000/)).toBeInTheDocument();
    expect(screen.queryByTitle('Set budget')).not.toBeInTheDocument();
    h.resolve.mockResolvedValueOnce({ resolution: 'cancelled' });
    h.load.mockResolvedValueOnce(snapshot(500000, '10:3'));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
    await waitFor(() => expect(ws.action.acknowledge).toHaveBeenCalledOnce());
    expect(h.submit).not.toHaveBeenCalled();
    expect(await screen.findByTitle('Set budget')).toBeInTheDocument();
  });

  it('keeps recovery available but offers no new edits when the project writer gate closes', async () => {
    h.lifecycle = false;
    const ws = makeWorkspace({ initial: { kind: 'budget', amount: 700000 } });
    h.factory.mockReturnValue(ws.workspace);
    render(<BOM />);
    expect(await screen.findByRole('button', { name: 'Check saved change' })).toBeInTheDocument();
    expect(screen.queryByTitle('Set budget')).not.toBeInTheDocument();
    h.resolve.mockResolvedValueOnce({ resolution: 'committed' });
    h.load.mockResolvedValueOnce(snapshot(700000, '10:3'));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
    await waitFor(() => expect(ws.action.acknowledge).toHaveBeenCalledOnce());
    expect(screen.queryByTitle('Set budget')).not.toBeInTheDocument();
  });

  it('rejects a different draft while an earlier request is pending instead of letting the old one win silently', async () => {
    const ws = makeWorkspace();
    h.factory.mockReturnValue(ws.workspace);
    h.submit.mockRejectedValueOnce(new Error('network down'));
    render(<BOM />);
    await startEdit('650000');
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.queryByTitle('Set budget')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 500000')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeDisabled();
    expect(h.submit).toHaveBeenCalledOnce();
    expect(ws.state.journal).toEqual({ kind: 'budget', amount: 650000 });
  });

  it('does not rebase an open draft onto a refreshed workspace', async () => {
    const first = makeWorkspace(), second = makeWorkspace();
    h.factory.mockReturnValueOnce(first.workspace).mockReturnValue(second.workspace);
    render(<BOM />);
    await startEdit('650000');
    await act(async () => { h.refresh?.(); });
    await waitFor(() => expect(h.factory).toHaveBeenCalledTimes(2));
    expect(first.workspace.invalidate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText('Reopen the budget editor before saving.')).toBeInTheDocument();
    expect(h.submit).not.toHaveBeenCalled();
    expect(second.workspace.capture).not.toHaveBeenCalled();
  });

  it('isolates a pending request and a late result per account and project (A-B-A)', async () => {
    const alice = makeWorkspace({ initial: { kind: 'budget', amount: 700000 } }), bob = makeWorkspace();
    h.factory.mockImplementation((_project: string, _client: unknown, uid: string) => uid === 'alice' ? alice.workspace : bob.workspace);
    const view = render(<BOM />);
    expect(await screen.findByText(/Saved amount: ₹7,?00,?000/)).toBeInTheDocument();
    const late = deferred<any>();
    h.resolve.mockReturnValueOnce(late.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
    h.uid = 'bob'; view.rerender(<BOM />);
    await waitFor(() => expect(screen.queryByText(/Saved amount/)).not.toBeInTheDocument());
    expect(screen.getByTitle('Set budget')).toBeInTheDocument();
    h.uid = 'alice'; view.rerender(<BOM />);
    expect(await screen.findByText(/Saved amount: ₹7,?00,?000/)).toBeInTheDocument();
    await act(async () => { late.resolve({ resolution: 'committed' }); });
    // The stale resolve belongs to the first alice mount; it must not have released the journal.
    expect(alice.action.acknowledge).not.toHaveBeenCalled();
    expect(alice.state.journal).toEqual({ kind: 'budget', amount: 700000 });
    expect(screen.getByText(/Saved amount: ₹7,?00,?000/)).toBeInTheDocument();
  });
});
