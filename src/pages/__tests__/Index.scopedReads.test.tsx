import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import KPI from '../Index';

const h = vi.hoisted(() => ({
  user: { uid: 'alice', isAdmin: true }, getProjects: vi.fn(), getBOMData: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => true }));
vi.mock('@/utils/projectFirestore', () => ({ getProjects: (...args: unknown[]) => h.getProjects(...args), getBOMData: (...args: unknown[]) => h.getBOMData(...args) }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn((...args) => args), query: vi.fn((...args) => args), orderBy: vi.fn(), limit: vi.fn(), getDocs: (...args: unknown[]) => h.getDocs(...args), doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('@/utils/pulseProxyFirestore', () => ({ getProjectCosts: vi.fn().mockResolvedValue({ projects: [] }) }));
vi.mock('@/utils/overheadFirestore', () => ({ getOverheads: vi.fn().mockResolvedValue({ travelVisits: [] }) }));
vi.mock('@/utils/poFirestore', () => ({ getPurchaseOrders: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/userService', () => ({ fetchPendingUsers: vi.fn().mockResolvedValue({ users: [] }) }));
vi.mock('@/utils/meetingFirestore', () => ({ getUnassignedMeetings: vi.fn().mockResolvedValue([]), assignUnassignedMeeting: vi.fn(), discardUnassignedMeeting: vi.fn() }));
vi.mock('@/utils/emailFirestore', () => ({ getUnassignedEmails: vi.fn().mockResolvedValue([]), assignUnassignedEmail: vi.fn(), discardUnassignedEmail: vi.fn() }));

describe('KPI scoped project reads', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    h.getProjects.mockReset().mockResolvedValue([{ id: 'P1', projectName: 'Scoped Project', status: 'Ongoing', members: [] }]);
    h.getBOMData.mockReset().mockResolvedValue([{ id: 'c', items: [{ id: 'one' }, { id: 'two' }] }]);
    h.getDocs.mockReset().mockResolvedValue({ size: 0 });
  });

  it('loads the scoped catalog and BOM data without issuing a raw projects catalog query', async () => {
    render(<MemoryRouter><KPI /></MemoryRouter>);
    await vi.waitFor(() => expect(h.getBOMData).toHaveBeenCalled());
    expect(h.getProjects).toHaveBeenCalledWith({ uid: 'alice', isAdmin: true }, expect.any(Function));
    expect(h.getBOMData).toHaveBeenCalledWith('P1', 'alice', expect.any(Function));
    expect(h.getDocs).toHaveBeenCalledTimes(1); // vendors only
    expect(screen.getByText('Total Parts').parentElement?.parentElement).toHaveTextContent('2');
  });

  it('clears the dashboard list and shows a readable error when scoped access is denied', async () => {
    h.getProjects.mockRejectedValueOnce(new Error('Project access denied.'));
    render(<MemoryRouter><KPI /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Project access denied.');
    expect(screen.queryByText('Scoped Project')).toBeNull();
  });
});
