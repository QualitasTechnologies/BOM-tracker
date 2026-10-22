import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { SupportTicket as Ticket } from '@/types/support';
import SupportTicket from '../SupportTicket';

const h = vi.hoisted(() => ({
  user: { uid: 'alice', displayName: 'Alice' },
  getProject: vi.fn(),
  subscribeTicket: vi.fn(),
  rawGetDoc: vi.fn(),
  rawGetDocs: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { uid: 'alice' } }, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({ getDoc: (...args: unknown[]) => h.rawGetDoc(...args), getDocs: (...args: unknown[]) => h.rawGetDocs(...args) }));
vi.mock('@/utils/projectFirestore', () => ({ getProject: (...args: unknown[]) => h.getProject(...args) }));
vi.mock('@/utils/supportFirestore', () => ({
  addSupportActivity: vi.fn(), sendSupportCommunication: vi.fn(), updateSupportTicket: vi.fn(),
  changeSupportTicketAssignee: vi.fn(), changeSupportTicketStatus: vi.fn(), saveSupportTicketResolution: vi.fn(),
  getPendingSupportTicketAssignee: () => null, getPendingSupportTicketResolution: () => null, getPendingSupportTicketStatus: () => null,
  resolvePendingSupportTicketAssignee: vi.fn(), resolvePendingSupportTicketResolution: vi.fn(), resolvePendingSupportTicketStatus: vi.fn(),
  subscribeToSupportActivities: (_projectId: string, _ticketId: string, callback: (items: unknown[]) => void) => { callback([]); return () => {}; },
  subscribeToSupportDocuments: (_projectId: string, callback: (items: unknown[]) => void) => { callback([]); return () => {}; },
  subscribeToSupportTicket: (...args: unknown[]) => h.subscribeTicket(...args),
}));
vi.mock('@/utils/supportLogic', () => ({
  COMMERCIAL_STATUS_LABELS: {}, COVERAGE_LABELS: {}, SUPPORT_STATUS_LABELS: {}, SUPPORT_STATUS_ORDER: [],
  getTransitionBlocker: () => null, isOverdue: () => false, shouldShowInvoiceTracking: () => false,
  getInstalledMachines: (profile?: { siteLocation?: string }) => profile?.siteLocation ? [{ id: 'legacy-primary-machine', siteLocation: profile.siteLocation }] : [],
  validatePaymentTracking: () => null,
}));
vi.mock('@/utils/settingsFirestore', () => ({
  getClientContacts: () => [], getPrimaryClientContact: () => undefined,
  subscribeToClients: (callback: (items: unknown[]) => void) => { callback([]); return () => {}; },
}));
vi.mock('@/components/Support/SupportBadges', () => ({ CoverageBadge: () => null, PriorityBadge: () => null, StatusBadge: () => null }));
vi.mock('@/components/Support/SupportDocuments', () => ({ SupportDocuments: () => null }));
vi.mock('@/components/Support/AddClientContactDialog', () => ({ AddClientContactDialog: () => null }));
vi.mock('@/components/Support/SupportEngineerFollowUpDialog', () => ({ SupportEngineerFollowUpDialog: () => null }));
vi.mock('@/components/Support/SupportQuotationDialog', () => ({ SupportQuotationDialog: () => null }));
vi.mock('@/components/ui/alert', () => ({ Alert: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>, AlertTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>, CardTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: React.PropsWithChildren) => <label>{children}</label> }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>, SelectValue: () => null }));
vi.mock('@/components/ui/separator', () => ({ Separator: () => <hr /> }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} /> }));

function ticketFor(projectId: string, ticketId: string): Ticket {
  return {
    id: ticketId, ticketNumber: `${projectId}-SUP-1`, projectId, projectName: `${projectId} Project`, clientName: 'Acme',
    title: `${projectId} Ticket`, description: 'Issue details', category: 'mechanical', priority: 'medium',
    status: 'in-progress', channel: 'phone', reportedByName: 'Bob', reportedAt: new Date(), createdAt: new Date(),
    createdBy: 'bob', createdByName: 'Bob', updatedAt: new Date(), coverageType: 'warranty',
    commercialStatus: 'assessment-required', siteVisitRequired: false, downtime: false, machineStopped: false,
    customerConfirmation: 'pending',
  } as Ticket;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let navigateTo: ReturnType<typeof useNavigate> | null = null;
function RouteControls() {
  navigateTo = useNavigate();
  return null;
}
const renderRoute = () => render(
  <MemoryRouter initialEntries={['/support/projects/A/tickets/T']}>
    <RouteControls />
    <Routes><Route path="/support/projects/:projectId/tickets/:ticketId" element={<SupportTicket />} /></Routes>
  </MemoryRouter>,
);

describe('SupportTicket scoped project reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user.uid = 'alice';
    navigateTo = null;
    h.subscribeTicket.mockImplementation((projectId: string, ticketId: string, callback: (ticket: Ticket) => void) => {
      callback(ticketFor(projectId, ticketId));
      return vi.fn();
    });
  });

  it('shows a denied server project read and does not fall back to raw SDK reads', async () => {
    h.getProject.mockRejectedValueOnce(new Error('Project access denied.'));
    const view = renderRoute();
    expect(await screen.findByRole('alert')).toHaveTextContent('Project access denied.');
    expect(screen.getByRole('heading', { name: 'Support ticket not found' })).toBeInTheDocument();
    expect(h.getProject).toHaveBeenCalledWith('A', 'alice', expect.any(Function));
    expect(h.rawGetDoc).not.toHaveBeenCalled();
    expect(h.rawGetDocs).not.toHaveBeenCalled();
    expect(view.container.querySelector('.animate-spin')).toBeNull();
  });

  it('ignores old project successes when the route leaves and returns to the same project', async () => {
    const firstA = deferred<any>();
    const routeB = deferred<any>();
    const currentA = deferred<any>();
    h.getProject.mockReturnValueOnce(firstA.promise).mockReturnValueOnce(routeB.promise).mockReturnValueOnce(currentA.promise);
    renderRoute();
    await screen.findByRole('heading', { name: 'A Ticket' });
    act(() => navigateTo!('/support/projects/B/tickets/U'));
    await screen.findByRole('heading', { name: 'B Ticket' });
    act(() => navigateTo!('/support/projects/A/tickets/T'));
    await screen.findByRole('heading', { name: 'A Ticket' });

    await act(async () => {
      firstA.resolve({ projectId: 'A', projectName: 'Old A', clientName: 'Acme', supportProfile: { siteLocation: 'Stale Site' } });
      routeB.resolve({ projectId: 'B', projectName: 'B', clientName: 'Acme', supportProfile: { siteLocation: 'Wrong B Site' } });
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale Site')).toBeNull();
    expect(screen.queryByText('Wrong B Site')).toBeNull();

    await act(async () => {
      currentA.resolve({ projectId: 'A', projectName: 'Current A', clientName: 'Acme', supportProfile: { siteLocation: 'Current A Site' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Current A Site')).toBeInTheDocument());
    expect(screen.queryByText('Stale Site')).toBeNull();
  });

  it('ignores a project success from the prior account on the same ticket route', async () => {
    const aliceRead = deferred<any>();
    const bobRead = deferred<any>();
    h.getProject.mockReturnValueOnce(aliceRead.promise).mockReturnValueOnce(bobRead.promise);
    const view = renderRoute();
    await screen.findByRole('heading', { name: 'A Ticket' });

    h.user.uid = 'bob';
    view.rerender(
      <MemoryRouter initialEntries={['/support/projects/A/tickets/T']}>
        <RouteControls />
        <Routes><Route path="/support/projects/:projectId/tickets/:ticketId" element={<SupportTicket />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(h.getProject).toHaveBeenCalledTimes(2));
    await act(async () => {
      aliceRead.resolve({ projectId: 'A', projectName: 'Alice A', clientName: 'Acme', supportProfile: { siteLocation: 'Alice Only Site' } });
      await Promise.resolve();
    });
    expect(screen.queryByText('Alice Only Site')).toBeNull();

    await act(async () => {
      bobRead.resolve({ projectId: 'A', projectName: 'Bob A', clientName: 'Acme', supportProfile: { siteLocation: 'Bob Site' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Bob Site')).toBeInTheDocument());
    expect(screen.queryByText('Alice Only Site')).toBeNull();
  });
});
