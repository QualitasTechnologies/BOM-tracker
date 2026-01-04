import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactsDialog from '../ContactsDialog';
import { Contact } from '@/types/crm';
import * as crmFirestore from '@/utils/crmFirestore';

// Mock the CRM Firestore module
vi.mock('@/utils/crmFirestore', () => ({
  subscribeToClientContacts: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

// Mock the useToast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const mockClient = {
  id: 'client-1',
  company: 'Acme Corporation',
  email: 'contact@acme.com',
  phone: '555-1234',
  contactPerson: 'John Doe',
  address: '123 Main St',
  logo: '',
};

const mockContacts: Contact[] = [
  {
    id: 'contact-1',
    clientId: 'client-1',
    name: 'Jane Smith',
    designation: 'Project Manager',
    email: 'jane@acme.com',
    phone: '+91 98765 43210',
    department: 'Engineering',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'contact-2',
    clientId: 'client-1',
    name: 'Bob Wilson',
    designation: 'Procurement Lead',
    email: 'bob@acme.com',
    phone: '+91 98765 43211',
    department: 'Procurement',
    isPrimary: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('ContactsDialog', () => {
  let unsubscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unsubscribeMock = vi.fn();
    vi.mocked(crmFirestore.subscribeToClientContacts).mockImplementation((clientId, callback) => {
      // Simulate async loading
      setTimeout(() => callback(mockContacts), 0);
      return unsubscribeMock;
    });
    vi.mocked(crmFirestore.createContact).mockResolvedValue('new-contact-id');
    vi.mocked(crmFirestore.updateContact).mockResolvedValue();
    vi.mocked(crmFirestore.deleteContact).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders dialog with correct title when open', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      expect(screen.getByText(`Contacts for ${mockClient.company}`)).toBeInTheDocument();
    });

    it('does not render dialog content when closed', () => {
      render(
        <ContactsDialog
          open={false}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      expect(screen.queryByText(`Contacts for ${mockClient.company}`)).not.toBeInTheDocument();
    });

    it('shows loading spinner while fetching contacts', () => {
      // Don't trigger callback to keep loading state
      vi.mocked(crmFirestore.subscribeToClientContacts).mockImplementation(() => unsubscribeMock);

      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      expect(screen.getByRole('status', { hidden: true }) || screen.queryByTestId('loader')).toBeDefined();
    });

    it('shows empty state when no contacts exist', async () => {
      vi.mocked(crmFirestore.subscribeToClientContacts).mockImplementation((clientId, callback) => {
        setTimeout(() => callback([]), 0);
        return unsubscribeMock;
      });

      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No contacts added yet')).toBeInTheDocument();
      });
    });

    it('displays contacts table with all contacts', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
      });
    });

    it('shows Primary badge for primary contact', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Primary')).toBeInTheDocument();
      });
    });

    it('displays contact details correctly', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('jane@acme.com')).toBeInTheDocument();
        expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
        expect(screen.getByText('Project Manager')).toBeInTheDocument();
        expect(screen.getByText('Engineering')).toBeInTheDocument();
      });
    });
  });

  describe('Add Contact Form', () => {
    it('shows add contact form when Add Contact button is clicked', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      expect(screen.getByText('Add New Contact')).toBeInTheDocument();
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    it('hides form when Cancel button is clicked', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));
      expect(screen.getByText('Add New Contact')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByText('Add New Contact')).not.toBeInTheDocument();
    });

    it('renders all form fields', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/designation/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/department/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/primary contact/i)).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('requires name field for form submission', async () => {
      const toastMock = vi.fn();
      vi.mocked(await import('@/hooks/use-toast')).useToast = () => ({
        toast: toastMock,
      });

      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      // Try to submit without filling name
      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      // Verify createContact was NOT called
      expect(crmFirestore.createContact).not.toHaveBeenCalled();
    });

    it('allows submission when name is provided', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      const nameInput = screen.getByLabelText(/name/i);
      await userEvent.type(nameInput, 'New Contact');

      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(crmFirestore.createContact).toHaveBeenCalledWith(
          expect.objectContaining({
            clientId: 'client-1',
            name: 'New Contact',
          })
        );
      });
    });

    it('trims whitespace from name before validation', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      const nameInput = screen.getByLabelText(/name/i);
      await userEvent.type(nameInput, '   '); // Only whitespace

      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      // Should not call createContact for whitespace-only name
      expect(crmFirestore.createContact).not.toHaveBeenCalled();
    });
  });

  describe('Create Contact', () => {
    it('creates contact with all fields populated', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      await userEvent.type(screen.getByLabelText(/name/i), 'New Person');
      await userEvent.type(screen.getByLabelText(/designation/i), 'CEO');
      await userEvent.type(screen.getByLabelText(/email/i), 'new@acme.com');
      await userEvent.type(screen.getByLabelText(/phone/i), '+91 12345 67890');
      await userEvent.type(screen.getByLabelText(/department/i), 'Management');

      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(crmFirestore.createContact).toHaveBeenCalledWith(
          expect.objectContaining({
            clientId: 'client-1',
            name: 'New Person',
            designation: 'CEO',
            email: 'new@acme.com',
            phone: '+91 12345 67890',
            department: 'Management',
            isPrimary: false,
          })
        );
      });
    });

    it('resets form after successful creation', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));
      await userEvent.type(screen.getByLabelText(/name/i), 'Test Contact');

      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        // Form should be hidden after successful creation
        expect(screen.queryByText('Add New Contact')).not.toBeInTheDocument();
      });
    });
  });

  describe('Edit Contact', () => {
    it('populates form with contact data when Edit is clicked', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Find and click edit button for first contact
      const editButtons = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('svg') // Find buttons with icons
      );
      const editButton = editButtons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg?.classList.contains('lucide-edit') || btn.getAttribute('aria-label')?.includes('edit');
      });

      if (editButton) {
        await userEvent.click(editButton);
      } else {
        // Alternative: click the first edit-looking button in the table
        const tableRows = screen.getAllByRole('row');
        const firstDataRow = tableRows[1]; // Skip header row
        const editBtn = within(firstDataRow).getAllByRole('button')[0];
        await userEvent.click(editBtn);
      }

      await waitFor(() => {
        expect(screen.getByText('Edit Contact')).toBeInTheDocument();
      });

      expect(screen.getByDisplayValue('Jane Smith')).toBeInTheDocument();
    });

    it('calls updateContact when editing an existing contact', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Click edit on first contact
      const tableRows = screen.getAllByRole('row');
      const firstDataRow = tableRows[1];
      const editBtn = within(firstDataRow).getAllByRole('button')[0];
      await userEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.getByText('Edit Contact')).toBeInTheDocument();
      });

      const nameInput = screen.getByDisplayValue('Jane Smith');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Jane Smith Updated');

      const updateButton = screen.getByRole('button', { name: /update contact/i });
      await userEvent.click(updateButton);

      await waitFor(() => {
        expect(crmFirestore.updateContact).toHaveBeenCalledWith(
          'contact-1',
          expect.objectContaining({
            name: 'Jane Smith Updated',
          })
        );
      });
    });
  });

  describe('Delete Contact', () => {
    it('calls deleteContact when Delete is confirmed', async () => {
      // Mock window.confirm
      const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Click delete on first contact
      const tableRows = screen.getAllByRole('row');
      const firstDataRow = tableRows[1];
      const deleteBtn = within(firstDataRow).getAllByRole('button')[1];
      await userEvent.click(deleteBtn);

      await waitFor(() => {
        expect(crmFirestore.deleteContact).toHaveBeenCalledWith('contact-1');
      });

      confirmMock.mockRestore();
    });

    it('does not delete when confirmation is cancelled', async () => {
      // Mock window.confirm to return false
      const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(false);

      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Click delete on first contact
      const tableRows = screen.getAllByRole('row');
      const firstDataRow = tableRows[1];
      const deleteBtn = within(firstDataRow).getAllByRole('button')[1];
      await userEvent.click(deleteBtn);

      expect(crmFirestore.deleteContact).not.toHaveBeenCalled();

      confirmMock.mockRestore();
    });
  });

  describe('Subscription Cleanup', () => {
    it('unsubscribes when dialog is closed', async () => {
      const { rerender } = render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(crmFirestore.subscribeToClientContacts).toHaveBeenCalled();
      });

      rerender(
        <ContactsDialog
          open={false}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      // Component should unsubscribe when closed
      expect(unsubscribeMock).toHaveBeenCalled();
    });

    it('subscribes with correct clientId', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(crmFirestore.subscribeToClientContacts).toHaveBeenCalledWith(
          'client-1',
          expect.any(Function)
        );
      });
    });
  });

  describe('Primary Contact Toggle', () => {
    it('includes isPrimary in contact creation', async () => {
      render(
        <ContactsDialog
          open={true}
          onOpenChange={vi.fn()}
          client={mockClient}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Contact')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /add contact/i }));

      await userEvent.type(screen.getByLabelText(/name/i), 'Primary Contact');

      // Toggle the switch - find by label or role
      const primaryToggle = screen.getByRole('switch');
      await userEvent.click(primaryToggle);

      const submitButton = screen.getByRole('button', { name: /add contact$/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(crmFirestore.createContact).toHaveBeenCalledWith(
          expect.objectContaining({
            isPrimary: true,
          })
        );
      });
    });
  });
});
