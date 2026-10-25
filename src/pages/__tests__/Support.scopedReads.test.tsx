import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Support from '../Support';

const h = vi.hoisted(() => ({
  user: { uid: 'alice', displayName: 'Alice' },
  subscriptions: [] as Array<{ onValue: (projects: any[]) => void; onError: (error: Error) => void }>,
  ticketSubscriptions: [] as Array<{ projectIds: string[]; onValue: (tickets: any[]) => void }>,
  subscribeToProjects: vi.fn(),
  rawGetDocs: vi.fn(),
  rawGetDoc: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, isAdmin: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/utils/projectFirestore', () => ({
  subscribeToProjects: (...args: any[]) => h.subscribeToProjects(...args),
}));
vi.mock('@/utils/settingsFirestore', () => ({ subscribeToClients: (callback: (items: unknown[]) => void) => { callback([]); return () => {}; } }));
vi.mock('@/utils/supportFirestore', () => ({
  createSupportTicket: vi.fn(),
  getSupportDocumentCounts: vi.fn().mockResolvedValue({}),
  subscribeToSupportTickets: vi.fn((projectIds: string[], onValue: (tickets: unknown[]) => void) => { h.ticketSubscriptions.push({ projectIds, onValue }); return () => {}; }),
}));
vi.mock('@/utils/supportLogic', () => ({
  coverageExpiryLabel: () => 'Coverage recorded',
  determineCoverage: () => 'warranty',
  isOverdue: () => false,
  isTicketOpen: () => false,
  getInstalledMachines: () => [],
  needsCommercialAction: () => false,
}));
vi.mock('firebase/firestore', () => ({ getDocs: (...args: unknown[]) => h.rawGetDocs(...args), getDoc: (...args: unknown[]) => h.rawGetDoc(...args) }));
vi.mock('@/components/Support/CreateSupportTicketDialog', () => ({ CreateSupportTicketDialog: () => null }));
vi.mock('@/components/Support/SupportProjectDialog', () => ({
  SupportProjectDialog: ({ open, project }: { open: boolean; project: { projectName: string } | null }) =>
    <div data-testid="project-dialog">{open ? project?.projectName || 'No selected project' : 'Closed'}</div>,
}));
vi.mock('@/components/Support/SupportBadges', () => ({ CoverageBadge: () => null, PriorityBadge: () => null, StatusBadge: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: React.PropsWithChildren) => <>{children}</>, SelectContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children }: React.PropsWithChildren) => <>{children}</>, SelectTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>, SelectValue: () => null,
}));
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>, TabsTrigger: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
}));
vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: React.PropsWithChildren) => <table>{children}</table>, TableBody: ({ children }: React.PropsWithChildren) => <tbody>{children}</tbody>,
  TableCell: ({ children }: React.PropsWithChildren) => <td>{children}</td>, TableHead: ({ children }: React.PropsWithChildren) => <th>{children}</th>,
  TableHeader: ({ children }: React.PropsWithChildren) => <thead>{children}</thead>, TableRow: ({ children }: React.PropsWithChildren) => <tr>{children}</tr>,
}));

const project = (projectId: string, projectName: string) => ({ projectId, projectName, clientName: 'Acme', status: 'Ongoing', supportProfile: {} });

describe('Support scoped project reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user.uid = 'alice';
    h.subscriptions = [];
    h.ticketSubscriptions = [];
    h.subscribeToProjects.mockImplementation((_onValue, _actor, onError) => {
      const subscription = { onValue: _onValue, onError };
      h.subscriptions.push(subscription);
      return vi.fn();
    });
  });

  it('clears previously visible project and dialog context on scoped catalog denial', async () => {
    const view = render(<MemoryRouter><Support /></MemoryRouter>);
    const subscription = h.subscriptions[0];
    act(() => subscription.onValue([project('P1', 'Scoped Project')]));
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & docs' }));
    expect(screen.getByTestId('project-dialog')).toHaveTextContent('Scoped Project');
    await vi.waitFor(() => expect(h.ticketSubscriptions.some(item => item.projectIds.includes('P1'))).toBe(true));
    const staleTickets = h.ticketSubscriptions.find(item => item.projectIds.includes('P1'))!;
    act(() => staleTickets.onValue([{ id: 'T1', ticketNumber: 'SUP-1', title: 'Old project ticket', projectId: 'P1', projectName: 'Scoped Project', clientName: 'Acme', status: 'in-progress', priority: 'medium', coverageType: 'warranty', firstResponseTargetAt: new Date() }]));
    expect(await screen.findByText('Old project ticket')).toBeInTheDocument();

    act(() => subscription.onError(new Error('Project access denied.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Project access denied.');
    expect(screen.queryByRole('button', { name: 'Coverage & docs' })).toBeNull();
    expect(screen.getByTestId('project-dialog')).toHaveTextContent('No selected project');
    expect(screen.queryByText('Old project ticket')).toBeNull();
    act(() => staleTickets.onValue([{ id: 'T1', ticketNumber: 'SUP-1', title: 'Old project ticket', projectId: 'P1', projectName: 'Scoped Project', clientName: 'Acme', status: 'in-progress', priority: 'medium', coverageType: 'warranty', firstResponseTargetAt: new Date() }]));
    expect(screen.queryByText('Old project ticket')).toBeNull();
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    expect(h.rawGetDocs).not.toHaveBeenCalled();
    expect(h.rawGetDoc).not.toHaveBeenCalled();
  });

  it('ignores catalog callbacks owned by the previous signed-in user', async () => {
    const view = render(<MemoryRouter><Support /></MemoryRouter>);
    const alice = h.subscriptions[0];
    act(() => alice.onValue([project('P1', 'Alice Project')]));
    expect(await screen.findByRole('button', { name: 'Coverage & docs' })).toBeInTheDocument();

    h.user.uid = 'bob';
    view.rerender(<MemoryRouter><Support /></MemoryRouter>);
    const bob = h.subscriptions[1];
    act(() => {
      alice.onError(new Error('Stale Alice denial.'));
      alice.onValue([project('P2', 'Stale Alice Project')]);
    });
    expect(screen.queryByText('Stale Alice denial.')).toBeNull();
    expect(screen.queryByText('Stale Alice Project')).toBeNull();

    act(() => bob.onValue([project('P3', 'Bob Project')]));
    expect(await screen.findByText('Bob Project')).toBeInTheDocument();
    expect(screen.queryByText('Alice Project')).toBeNull();
    expect(h.subscribeToProjects).toHaveBeenCalledWith(expect.any(Function), { uid: 'alice', isAdmin: false }, expect.any(Function));
    expect(h.subscribeToProjects).toHaveBeenLastCalledWith(expect.any(Function), { uid: 'bob', isAdmin: false }, expect.any(Function));
  });
});
