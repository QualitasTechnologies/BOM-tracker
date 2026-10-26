import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CostAnalysis from '../CostAnalysis';

type Payload = { operation: string; project_id: string; operation_id?: string; expected_version?: string; resolve_only?: boolean; command?: { kind: string; field: string; amount: number } };
const h = vi.hoisted(() => ({
  uid: 'alice', admin: true, project: 'P', scoped: true, lifecycle: true,
  getProject: vi.fn(), updateProject: vi.fn(), getCosts: vi.fn(), native: vi.fn(),
}));

vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: h.uid }; } }, db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => (payload: Payload) => h.native(payload) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: h.uid, isAdmin: h.admin }, isAdmin: h.admin }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams({ project: h.project })], Link: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/CostAnalysis/WeekNavigator', () => ({ WeekNavigator: () => null, weekRangeFromDate: () => ({ start: '2026-10-12', end: '2026-10-18' }) }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => h.getProject(...args), getBOMData: vi.fn().mockResolvedValue([]), getTotalBOMCost: vi.fn(() => 0),
  updateProject: (...args: unknown[]) => h.updateProject(...args), subscribeToProjects: vi.fn(() => vi.fn()),
}));
vi.mock('@/utils/pulseProxyFirestore', () => ({ getProjectCosts: (...args: unknown[]) => h.getCosts(...args) }));
vi.mock('@/utils/settingsFirestore', () => ({ subscribeToClients: vi.fn(() => vi.fn()) }));
vi.mock('@/utils/projectDocumentFirestore', () => ({ getProjectDocuments: vi.fn().mockResolvedValue([]), uploadProjectDocument: vi.fn(), deleteProjectDocument: vi.fn() }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scoped }));
vi.mock('@/utils/projectLifecycleAccess', () => ({ isNativeProjectLifecycleEnabled: () => h.lifecycle }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@/components/ui/progress', () => ({ Progress: () => <div /> }));

// A small in-memory stand-in for the versioned project writer: one project per id, receipts per nonce.
const server = {
  projects: new Map<string, Record<string, unknown>>(), version: new Map<string, number>(), receipts: new Map<string, { hash: string; cancelled: boolean }>(),
  commands: [] as Payload[], calls: [] as Payload[], writesOn: true, lostAck: false, failGet: false, hold: null as Promise<void> | null,
};
const rev = (id: string) => `10:${server.version.get(id) ?? 1}`;
const handle = async (payload: Payload): Promise<{ data: unknown }> => {
  server.calls.push(structuredClone(payload));
  const project = server.projects.get(payload.project_id)!;
  if (payload.operation === 'get') {
    if (server.failGet) throw new Error('read unavailable');
    return { data: { ok: true, project_id: payload.project_id, version: rev(payload.project_id), project: { ...structuredClone(project), projectId: payload.project_id }, permissions: { edit: server.writesOn, manage_members: true, notifications: true, restore: true, restore_resolve: true } } };
  }
  server.commands.push(structuredClone(payload));
  if (server.hold) await server.hold;
  const key = `${payload.project_id}/${payload.operation_id}`, hash = JSON.stringify([payload.command, payload.expected_version]), receipt = server.receipts.get(key);
  const ok = { ok: true, project_id: payload.project_id, operation_id: payload.operation_id };
  if (receipt) return { data: receipt.hash !== hash ? { ok: false, error: 'operation_conflict' } : { ...ok, ...(payload.resolve_only ? { resolution: receipt.cancelled ? 'cancelled' : 'committed' } : {}) } };
  if (payload.resolve_only) { server.receipts.set(key, { hash, cancelled: true }); return { data: { ...ok, resolution: 'cancelled' } }; }
  if (!server.writesOn) return { data: { ok: false, error: 'project_mutations_disabled' } };
  if (payload.expected_version !== rev(payload.project_id)) return { data: { ok: false, error: 'project_version_conflict' } };
  project[payload.command!.field] = payload.command!.amount;
  server.version.set(payload.project_id, (server.version.get(payload.project_id) ?? 1) + 1);
  server.receipts.set(key, { hash, cancelled: false });
  if (server.lostAck) throw new Error('lost acknowledgement');
  return { data: ok };
};

const seed = (id = 'P', extra: Record<string, unknown> = {}) => { server.projects.set(id, { projectName: `Project ${id}`, clientName: 'Acme', status: 'Ongoing', deadline: '2026-12-01', costPerHour: 100, miscCost: 99, poValue: 5000, bomSnapshot: [{ snapshotCost: 7 }], ...extra }); server.version.set(id, 1); };
const KEY = (uid = 'alice', project = 'P') => `pulse.project-cost-fields.v1:${JSON.stringify([uid, project])}`;
const editButton = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const ready = async (name = 'Edit hourly rate') => { await waitFor(() => expect(editButton(name)).toBeEnabled()); };
const type = (value: string) => { const input = screen.getByRole('spinbutton'); fireEvent.change(input, { target: { value } }); return input; };
const nativeCommands = () => server.commands.filter(call => !call.resolve_only).map(call => call.command);

beforeEach(() => {
  cleanup(); sessionStorage.clear(); vi.clearAllMocks();
  h.uid = 'alice'; h.admin = true; h.project = 'P'; h.scoped = true; h.lifecycle = true;
  server.projects.clear(); server.version.clear(); server.receipts.clear(); server.commands = []; server.calls = [];
  server.writesOn = true; server.lostAck = false; server.failGet = false; server.hold = null;
  seed('P'); seed('Q');
  h.native.mockImplementation(handle);
  h.getCosts.mockResolvedValue({ projects: [] });
  h.getProject.mockImplementation(async (id: string) => ({ projectId: id, ...structuredClone(server.projects.get(id)) }));
  h.updateProject.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('CostAnalysis native cost fields', () => {
  it('saves each field as one exact native command, reconciles with a fresh read, then releases the journal', async () => {
    const cases: [string, string, string, number][] = [['Edit hourly rate', 'costPerHour', '450', 450], ['Edit miscellaneous cost', 'miscCost', '0', 0], ['Edit customer PO value', 'poValue', '-1200', -1200]];
    render(<CostAnalysis />);
    await ready();
    for (const [button, field, typed, amount] of cases) {
      const costsBefore = h.getCosts.mock.calls.length, callsBefore = server.calls.length;
      fireEvent.click(editButton(button));
      fireEvent.blur(type(typed));
      await waitFor(() => expect(sessionStorage.getItem(KEY())).toBeNull());
      await waitFor(() => expect(editButton(button)).toBeEnabled());
      expect(server.projects.get('P')![field]).toBe(amount);
      expect(nativeCommands().at(-1)).toEqual({ kind: 'cost_field', field, amount });
      // command, then a fresh authoritative read, never the other way round
      expect(server.calls.slice(callsBefore).map(call => call.operation)).toEqual(['command', 'get']);
      if (field === 'costPerHour') expect(h.getCosts.mock.calls.length).toBeGreaterThan(costsBefore); else expect(h.getCosts.mock.calls.length).toBe(costsBefore);
    }
    expect(nativeCommands()).toHaveLength(3);
    expect(server.projects.get('P')!.bomSnapshot).toEqual([{ snapshotCost: 7 }]);
    expect(h.updateProject).not.toHaveBeenCalled();
    expect(h.getProject).not.toHaveBeenCalled();
    expect(server.commands[0].expected_version).toBe('10:1');
    expect(server.commands[1].expected_version).toBe('10:2');
  });

  it('does not write when the displayed value is unchanged, including absent, null, decimal and string raw openings', async () => {
    seed('P', { costPerHour: undefined, miscCost: null, poValue: 1234.5 });
    render(<CostAnalysis />);
    await ready();
    for (const button of ['Edit hourly rate', 'Edit miscellaneous cost', 'Edit customer PO value']) {
      fireEvent.click(editButton(button));
      fireEvent.blur(screen.getByRole('spinbutton'));
      await waitFor(() => expect(editButton(button)).toBeEnabled());
    }
    cleanup(); sessionStorage.clear(); seed('P', { miscCost: '5000' });
    render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit miscellaneous cost'));
    fireEvent.blur(screen.getByRole('spinbutton'));
    await waitFor(() => expect(editButton('Edit miscellaneous cost')).toBeEnabled());
    expect(server.commands).toHaveLength(0);
    expect(h.updateProject).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY())).toBeNull();
    expect(server.projects.get('P')!.miscCost).toBe('5000');
  });

  it('shows a lost acknowledgement as pending at once, freezes every editor and recovers through the saved request', async () => {
    server.lostAck = true;
    render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit hourly rate'));
    fireEvent.blur(type('450'));
    const check = await screen.findByRole('button', { name: 'Check saved change' });
    expect(JSON.parse(sessionStorage.getItem(KEY())!).command).toEqual({ kind: 'cost_field', field: 'costPerHour', amount: 450 });
    for (const name of ['Edit hourly rate', 'Edit miscellaneous cost', 'Edit customer PO value']) expect(editButton(name)).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/450/);
    fireEvent.click(check);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Check saved change' })).toBeNull());
    expect(sessionStorage.getItem(KEY())).toBeNull();
    expect(server.commands.at(-1)).toMatchObject({ resolve_only: true, command: { kind: 'cost_field', field: 'costPerHour', amount: 450 } });
    expect(server.calls.at(-1)!.operation).toBe('get');
    expect(nativeCommands()).toHaveLength(1);
    await ready();
    expect(screen.getAllByText(/450/).length).toBeGreaterThan(0);
  });

  it('recovers a saved request on mount after the gates close and resolves it without enabling edits', async () => {
    server.lostAck = true;
    const first = render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit miscellaneous cost'));
    fireEvent.blur(type('-30'));
    await screen.findByRole('button', { name: 'Check saved change' });
    first.unmount();
    h.lifecycle = false; server.writesOn = false; server.lostAck = false; server.calls = [];
    render(<CostAnalysis />);
    const check = await screen.findByRole('button', { name: 'Check saved change' });
    expect(screen.getByRole('alert').textContent).toMatch(/30/);
    expect(editButton('Edit miscellaneous cost')).toBeDisabled();
    fireEvent.click(check);
    await waitFor(() => expect(sessionStorage.getItem(KEY())).toBeNull());
    expect(server.projects.get('P')!.miscCost).toBe(-30);
    await waitFor(() => expect(editButton('Edit miscellaneous cost')).toBeDisabled());
    expect(h.updateProject).not.toHaveBeenCalled();
  });

  it('keeps the journal when the confirming read fails and acknowledges only after a later fresh read', async () => {
    render(<CostAnalysis />);
    await ready();
    server.failGet = true;
    fireEvent.click(editButton('Edit customer PO value'));
    fireEvent.blur(type('777'));
    const check = await screen.findByRole('button', { name: 'Check saved change' });
    expect(sessionStorage.getItem(KEY())).not.toBeNull();
    fireEvent.click(check);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getByRole('button', { name: 'Check saved change' })).toBeEnabled();
    expect(sessionStorage.getItem(KEY())).not.toBeNull();
    server.failGet = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
    await waitFor(() => expect(sessionStorage.getItem(KEY())).toBeNull());
    expect(nativeCommands()).toHaveLength(1);
  });

  it('never falls back to the raw writer after a native denial and keeps the journal and typed amount visible', async () => {
    server.writesOn = true;
    render(<CostAnalysis />);
    await ready();
    server.writesOn = false;
    fireEvent.click(editButton('Edit hourly rate'));
    fireEvent.blur(type('555'));
    const check = await screen.findByRole('button', { name: 'Check saved change' });
    expect(h.updateProject).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/555/);
    fireEvent.click(check);
    await waitFor(() => expect(sessionStorage.getItem(KEY())).toBeNull());
    // The request was never committed: the old value stands and the outcome names the attempted amount.
    expect(server.projects.get('P')!.costPerHour).toBe(100);
    await waitFor(() => expect(screen.getAllByRole('status').map(node => node.textContent).join(' ')).toMatch(/555 was not saved/i));
    expect(h.updateProject).not.toHaveBeenCalled();
  });

  it('refuses to submit once the write gate has closed and keeps the draft for retry', async () => {
    render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit miscellaneous cost'));
    const input = type('321');
    h.lifecycle = false;
    fireEvent.blur(input);
    await screen.findByRole('alert');
    expect(server.commands).toHaveLength(0);
    expect(sessionStorage.getItem(KEY())).toBeNull();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('321');
    expect(h.updateProject).not.toHaveBeenCalled();
  });

  it('keeps cost controls read only when scoped reads are on without the native gate and makes no native call', async () => {
    h.lifecycle = false;
    render(<CostAnalysis />);
    await waitFor(() => expect(h.getProject).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Project P/).length).toBeGreaterThan(0));
    for (const name of ['Edit hourly rate', 'Edit miscellaneous cost', 'Edit customer PO value']) expect(editButton(name)).toBeDisabled();
    expect(screen.getByRole('status').textContent).toMatch(/read only/i);
    expect(h.native).not.toHaveBeenCalled();
  });

  it('keeps the original legacy writer when scoped reads are off', async () => {
    h.scoped = false; h.lifecycle = false;
    render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit hourly rate'));
    fireEvent.blur(type('450'));
    await waitFor(() => expect(h.updateProject).toHaveBeenCalledWith('P', { costPerHour: 450 }));
    await waitFor(() => expect(h.getCosts.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(editButton('Edit miscellaneous cost'));
    fireEvent.blur(screen.getByRole('spinbutton'));
    await waitFor(() => expect(editButton('Edit miscellaneous cost')).toBeEnabled());
    expect(h.updateProject).toHaveBeenCalledTimes(1);
    expect(h.native).not.toHaveBeenCalled();
  });

  it('does not apply or acknowledge a save that finishes after an account or project switch, and recovers on return (A-B-A)', async () => {
    let release!: () => void;
    server.hold = new Promise<void>(resolve => { release = resolve; });
    const view = render(<CostAnalysis />);
    await ready();
    fireEvent.click(editButton('Edit hourly rate'));
    fireEvent.blur(type('450'));
    await waitFor(() => expect(server.commands).toHaveLength(1));
    expect(JSON.parse(sessionStorage.getItem(KEY())!).command.amount).toBe(450);
    // B: another account opens the same project while the reply is outstanding
    h.uid = 'bob'; view.rerender(<CostAnalysis />);
    await ready();
    expect(screen.queryByRole('button', { name: 'Check saved change' })).toBeNull();
    expect(editButton('Edit hourly rate')).toBeEnabled();
    server.hold = null; release();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(sessionStorage.getItem(KEY('alice'))).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Check saved change' })).toBeNull();
    // Another project for the original account has no pending request
    h.uid = 'alice'; h.project = 'Q'; view.rerender(<CostAnalysis />);
    await ready();
    expect(screen.queryByRole('button', { name: 'Check saved change' })).toBeNull();
    // A again: the journal for alice/P is recovered, not acknowledged by the stale save
    h.project = 'P'; view.rerender(<CostAnalysis />);
    const check = await screen.findByRole('button', { name: 'Check saved change' });
    expect(editButton('Edit hourly rate')).toBeDisabled();
    fireEvent.click(check);
    await waitFor(() => expect(sessionStorage.getItem(KEY('alice'))).toBeNull());
    expect(server.projects.get('P')!.costPerHour).toBe(450);
    expect(nativeCommands()).toHaveLength(1);
  });
});
