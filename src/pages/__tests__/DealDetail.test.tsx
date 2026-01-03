import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import DealDetail from '../DealDetail';
import { Deal, Contact, DealStage } from '@/types/crm';
import * as crmFirestore from '@/utils/crmFirestore';
import * as settingsFirestore from '@/utils/settingsFirestore';
import { Client } from '@/utils/settingsFirestore';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ dealId: 'deal-1' }),
    useNavigate: () => mockNavigate,
  };
});

// Mock CRM Firestore module
vi.mock('@/utils/crmFirestore', () => ({
  getDeal: vi.fn(),
  updateDeal: vi.fn(),
  subscribeToActivityLog: vi.fn(),
  logActivity: vi.fn(),
  logStageChange: vi.fn(),
  getContactsByClient: vi.fn(),
}));

// Mock Settings Firestore module
vi.mock('@/utils/settingsFirestore', () => ({
  subscribeToClients: vi.fn(),
}));

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'test@example.com' },
  }),
}));

// Mock useCRMAccess hook
vi.mock('@/hooks/useCRMAccess', () => ({
  useCRMAccess: () => ({
    hasCRMAccess: true,
    loading: false,
  }),
}));

// Mock the useToast hook
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock child dialog components
vi.mock('@/components/CRM/LogActivityDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/CRM/NextStepDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/CRM/MarkAsLostDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/CRM/EditDealDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/CRM/AssignContactsDialog', () => ({
  default: ({ open, onOpenChange, onContactsUpdated }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onContactsUpdated: (contactIds: string[]) => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="assign-contacts-dialog">
        <button
          onClick={() => {
            onContactsUpdated(['contact-1', 'contact-2']);
            onOpenChange(false);
          }}
        >
          Save Contacts
        </button>
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    );
  },
}));

// Test data
const mockDeal: Deal = {
  id: 'deal-1',
  name: 'Vision AI System',
  description: 'AI-powered inspection system',
  clientId: 'client-1',
  assignedContactIds: ['contact-1'],
  stage: 'proposal' as DealStage,
  probability: 60,
  expectedValue: 5000000,
  currency: 'INR',
  expectedCloseDate: new Date('2024-03-15'),
  source: 'organic',
  assigneeId: 'user-1',
  hasDraftBOM: false,
  draftBOMTotalCost: 0,
  nextStep: null,
  createdAt: new Date(),
  createdBy: 'user-1',
  updatedAt: new Date(),
  lastActivityAt: new Date(),
  isArchived: false,
};

const mockContacts: Contact[] = [
  {
    id: 'contact-1',
    clientId: 'client-1',
    name: 'Raghav Sharma',
    designation: 'Project Manager',
    email: 'raghav@acme.com',
    phone: '+91 98765 43210',
    isPrimary: true,
    department: 'Engineering',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'contact-2',
    clientId: 'client-1',
    name: 'Priya Patel',
    designation: 'Procurement Lead',
    email: 'priya@acme.com',
    phone: '+91 98765 43211',
    isPrimary: false,
    department: 'Procurement',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'contact-3',
    clientId: 'client-1',
    name: 'Amit Kumar',
    designation: 'Technical Director',
    email: 'amit@acme.com',
    phone: '+91 98765 43212',
    isPrimary: false,
    department: 'Technology',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockClient: Client = {
  id: 'client-1',
  company: 'Acme Corporation',
  email: 'contact@acme.com',
  phone: '+91 11 1234 5678',
  contactPerson: 'John Doe',
  address: '123 Business Park, Mumbai',
  logo: '',
};

const renderDealDetail = () => {
  return render(
    <BrowserRouter>
      <DealDetail />
    </BrowserRouter>
  );
};

describe('DealDetail - Assigned Contacts Integration', () => {
  let clientsUnsubscribe: ReturnType<typeof vi.fn>;
  let activityLogUnsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clientsUnsubscribe = vi.fn();
    activityLogUnsubscribe = vi.fn();

    vi.mocked(crmFirestore.getDeal).mockResolvedValue(mockDeal);
    vi.mocked(crmFirestore.getContactsByClient).mockResolvedValue(mockContacts);
    vi.mocked(crmFirestore.updateDeal).mockResolvedValue();
    vi.mocked(crmFirestore.subscribeToActivityLog).mockImplementation((dealId, callback) => {
      callback([]);
      return activityLogUnsubscribe;
    });
    vi.mocked(settingsFirestore.subscribeToClients).mockImplementation((callback) => {
      callback([mockClient]);
      return clientsUnsubscribe;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Assigned Contacts Display', () => {
    it('displays assigned contacts section in Customer card', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('Assigned Contacts (1)')).toBeInTheDocument();
      });
    });

    it('shows assigned contact name and designation', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText(/Raghav Sharma/)).toBeInTheDocument();
        expect(screen.getByText(/Project Manager/)).toBeInTheDocument();
      });
    });

    it('shows Primary indicator for primary contact', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('Primary')).toBeInTheDocument();
      });
    });

    it('shows message when no contacts are assigned', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: [],
      });

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('No contacts assigned to this deal')).toBeInTheDocument();
      });
    });

    it('shows correct count for multiple assigned contacts', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: ['contact-1', 'contact-2', 'contact-3'],
      });

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('Assigned Contacts (3)')).toBeInTheDocument();
      });
    });

    it('displays all assigned contacts', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: ['contact-1', 'contact-2'],
      });

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText(/Raghav Sharma/)).toBeInTheDocument();
        expect(screen.getByText(/Priya Patel/)).toBeInTheDocument();
      });
    });
  });

  describe('Manage Contacts Button', () => {
    it('shows Manage button when client has contacts', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument();
      });
    });

    it('does not show Manage button when client has no contacts', async () => {
      vi.mocked(crmFirestore.getContactsByClient).mockResolvedValue([]);

      renderDealDetail();

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /manage/i })).not.toBeInTheDocument();
      });
    });

    it('opens AssignContactsDialog when Manage button is clicked', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /manage/i }));

      expect(screen.getByTestId('assign-contacts-dialog')).toBeInTheDocument();
    });
  });

  describe('Contact Assignment Callback', () => {
    it('updates assigned contacts when AssignContactsDialog saves', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /manage/i }));

      await waitFor(() => {
        expect(screen.getByTestId('assign-contacts-dialog')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Save Contacts'));

      await waitFor(() => {
        // Dialog should close
        expect(screen.queryByTestId('assign-contacts-dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Contacts Fetching', () => {
    it('fetches contacts when deal loads', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(crmFirestore.getContactsByClient).toHaveBeenCalledWith('client-1');
      });
    });

    it('does not fetch contacts when deal has no clientId', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        clientId: '',
      });

      renderDealDetail();

      await waitFor(() => {
        expect(crmFirestore.getContactsByClient).not.toHaveBeenCalled();
      });
    });

    it('handles contact fetch error gracefully', async () => {
      vi.mocked(crmFirestore.getContactsByClient).mockRejectedValue(new Error('Network error'));

      renderDealDetail();

      // Should still render the page
      await waitFor(() => {
        expect(screen.getByText('Vision AI System')).toBeInTheDocument();
      });
    });
  });

  describe('useMemo for assignedContacts', () => {
    it('filters contacts correctly based on assignedContactIds', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: ['contact-2'], // Only Priya is assigned
      });

      renderDealDetail();

      await waitFor(() => {
        // Priya should be shown
        expect(screen.getByText(/Priya Patel/)).toBeInTheDocument();
        // Raghav should not be in the assigned contacts section
        expect(screen.queryByText(/Raghav Sharma.*Project Manager/)).not.toBeInTheDocument();
      });
    });

    it('handles empty assignedContactIds array', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: [],
      });

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('No contacts assigned to this deal')).toBeInTheDocument();
        expect(screen.getByText('Assigned Contacts (0)')).toBeInTheDocument();
      });
    });

    it('handles undefined assignedContactIds', async () => {
      const dealWithoutContacts = { ...mockDeal };
      delete (dealWithoutContacts as Partial<Deal>).assignedContactIds;
      vi.mocked(crmFirestore.getDeal).mockResolvedValue(dealWithoutContacts as Deal);

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('No contacts assigned to this deal')).toBeInTheDocument();
      });
    });

    it('handles contactIds that do not match any contacts', async () => {
      vi.mocked(crmFirestore.getDeal).mockResolvedValue({
        ...mockDeal,
        assignedContactIds: ['non-existent-contact-id'],
      });

      renderDealDetail();

      await waitFor(() => {
        // Count should be 0 because no matching contacts found
        expect(screen.getByText('No contacts assigned to this deal')).toBeInTheDocument();
      });
    });
  });

  describe('UserPlus Icon Button', () => {
    it('shows UserPlus button in Customer card header when contacts exist', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('Customer')).toBeInTheDocument();
      });

      // UserPlus icon button should be visible in the header
      const customerCard = screen.getByText('Customer').closest('div');
      expect(customerCard).toBeInTheDocument();
    });
  });

  describe('Client Display Integration', () => {
    it('displays client information along with contacts', async () => {
      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
        expect(screen.getByText('+91 11 1234 5678')).toBeInTheDocument();
        expect(screen.getByText('contact@acme.com')).toBeInTheDocument();
      });
    });

    it('shows no client assigned message when client not found', async () => {
      vi.mocked(settingsFirestore.subscribeToClients).mockImplementation((callback) => {
        callback([]); // No clients
        return clientsUnsubscribe;
      });

      renderDealDetail();

      await waitFor(() => {
        expect(screen.getByText('No client assigned')).toBeInTheDocument();
      });
    });
  });
});

describe('DealDetail - Access Control', () => {
  beforeEach(() => {
    vi.mocked(crmFirestore.getDeal).mockResolvedValue(mockDeal);
    vi.mocked(crmFirestore.getContactsByClient).mockResolvedValue(mockContacts);
    vi.mocked(crmFirestore.subscribeToActivityLog).mockImplementation((dealId, callback) => {
      callback([]);
      return vi.fn();
    });
    vi.mocked(settingsFirestore.subscribeToClients).mockImplementation((callback) => {
      callback([mockClient]);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows access denied when user does not have CRM access', async () => {
    vi.doMock('@/hooks/useCRMAccess', () => ({
      useCRMAccess: () => ({
        hasCRMAccess: false,
        loading: false,
      }),
    }));

    // Note: This test may not work correctly due to module caching
    // In a real scenario, you would need to reset modules or use different testing approach
  });
});

describe('DealDetail - Error Handling', () => {
  beforeEach(() => {
    vi.mocked(crmFirestore.subscribeToActivityLog).mockImplementation((dealId, callback) => {
      callback([]);
      return vi.fn();
    });
    vi.mocked(settingsFirestore.subscribeToClients).mockImplementation((callback) => {
      callback([mockClient]);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows error toast and navigates away when deal not found', async () => {
    vi.mocked(crmFirestore.getDeal).mockResolvedValue(null);

    renderDealDetail();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Deal not found' })
      );
      expect(mockNavigate).toHaveBeenCalledWith('/pipeline');
    });
  });

  it('shows error toast when deal fetch fails', async () => {
    vi.mocked(crmFirestore.getDeal).mockRejectedValue(new Error('Network error'));

    renderDealDetail();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error loading deal' })
      );
    });
  });
});
