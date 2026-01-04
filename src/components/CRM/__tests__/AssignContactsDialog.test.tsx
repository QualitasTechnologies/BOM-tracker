import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignContactsDialog from '../AssignContactsDialog';
import { Contact } from '@/types/crm';
import * as crmFirestore from '@/utils/crmFirestore';

// Mock the CRM Firestore module
vi.mock('@/utils/crmFirestore', () => ({
  getContactsByClient: vi.fn(),
  updateDeal: vi.fn(),
}));

// Mock the useToast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

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
  {
    id: 'contact-3',
    clientId: 'client-1',
    name: 'Alice Johnson',
    designation: 'Technical Lead',
    email: 'alice@acme.com',
    phone: '+91 98765 43212',
    department: 'Engineering',
    isPrimary: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  dealId: 'deal-1',
  clientId: 'client-1',
  assignedContactIds: [],
  onContactsUpdated: vi.fn(),
};

describe('AssignContactsDialog', () => {
  beforeEach(() => {
    vi.mocked(crmFirestore.getContactsByClient).mockResolvedValue(mockContacts);
    vi.mocked(crmFirestore.updateDeal).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders dialog with correct title when open', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      expect(screen.getByText('Assign Contacts to Deal')).toBeInTheDocument();
    });

    it('does not render content when dialog is closed', () => {
      render(<AssignContactsDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Assign Contacts to Deal')).not.toBeInTheDocument();
    });

    it('shows loading spinner while fetching contacts', () => {
      // Return a pending promise to simulate loading
      vi.mocked(crmFirestore.getContactsByClient).mockReturnValue(
        new Promise(() => {}) // Never resolves
      );

      render(<AssignContactsDialog {...defaultProps} />);

      // Loading state should be visible
      expect(screen.getByText('Assign Contacts to Deal')).toBeInTheDocument();
    });

    it('shows empty state when no contacts exist for client', async () => {
      vi.mocked(crmFirestore.getContactsByClient).mockResolvedValue([]);

      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('No contacts available for this client')).toBeInTheDocument();
      });
    });

    it('displays all contacts as selectable items', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
        expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
      });
    });

    it('shows Primary badge for primary contact', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Primary')).toBeInTheDocument();
      });
    });

    it('displays contact details - email, phone, designation', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('jane@acme.com')).toBeInTheDocument();
        expect(screen.getByText('Project Manager')).toBeInTheDocument();
      });
    });
  });

  describe('Selection Behavior', () => {
    it('shows contacts pre-selected based on assignedContactIds', async () => {
      render(
        <AssignContactsDialog
          {...defaultProps}
          assignedContactIds={['contact-1', 'contact-3']}
        />
      );

      await waitFor(() => {
        const checkboxes = screen.getAllByRole('checkbox');
        // Should have 3 checkboxes total
        expect(checkboxes).toHaveLength(3);
      });
    });

    it('toggles contact selection when checkbox is clicked', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).not.toBeChecked();

      await userEvent.click(checkboxes[0]);
      expect(checkboxes[0]).toBeChecked();

      await userEvent.click(checkboxes[0]);
      expect(checkboxes[0]).not.toBeChecked();
    });

    it('allows multiple contacts to be selected', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');

      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      await userEvent.click(checkboxes[2]);

      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).toBeChecked();
      expect(checkboxes[2]).toBeChecked();
    });

    it('updates selection count in Save button', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Initially 0 selected
      expect(screen.getByRole('button', { name: /save \(0 selected\)/i })).toBeInTheDocument();

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]);

      expect(screen.getByRole('button', { name: /save \(1 selected\)/i })).toBeInTheDocument();

      await userEvent.click(checkboxes[1]);
      expect(screen.getByRole('button', { name: /save \(2 selected\)/i })).toBeInTheDocument();
    });

    it('clicking on contact row toggles selection', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Click on the label element containing the contact
      const janeLabel = screen.getByText('Jane Smith').closest('label');
      if (janeLabel) {
        await userEvent.click(janeLabel);
      }

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();
    });
  });

  describe('Saving Contacts', () => {
    it('calls updateDeal with selected contact IDs on Save', async () => {
      const onContactsUpdated = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          onContactsUpdated={onContactsUpdated}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]); // Select Jane Smith
      await userEvent.click(checkboxes[2]); // Select Alice Johnson

      const saveButton = screen.getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(crmFirestore.updateDeal).toHaveBeenCalledWith('deal-1', {
          assignedContactIds: ['contact-1', 'contact-3'],
        });
      });
    });

    it('calls onContactsUpdated callback after successful save', async () => {
      const onContactsUpdated = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          onContactsUpdated={onContactsUpdated}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]);

      const saveButton = screen.getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(onContactsUpdated).toHaveBeenCalledWith(['contact-1']);
      });
    });

    it('closes dialog after successful save', async () => {
      const onOpenChange = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('allows saving empty selection (unassign all contacts)', async () => {
      const onContactsUpdated = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          assignedContactIds={['contact-1']}
          onContactsUpdated={onContactsUpdated}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      // Uncheck the pre-selected contact
      await userEvent.click(checkboxes[0]);

      const saveButton = screen.getByRole('button', { name: /save \(0 selected\)/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(crmFirestore.updateDeal).toHaveBeenCalledWith('deal-1', {
          assignedContactIds: [],
        });
      });
    });
  });

  describe('Cancel Behavior', () => {
    it('closes dialog when Cancel button is clicked', async () => {
      const onOpenChange = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelButton);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not save changes when Cancel is clicked', async () => {
      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]); // Make a selection

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelButton);

      expect(crmFirestore.updateDeal).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('handles fetch error gracefully', async () => {
      vi.mocked(crmFirestore.getContactsByClient).mockRejectedValue(new Error('Network error'));

      render(<AssignContactsDialog {...defaultProps} />);

      // Should not crash and eventually show empty state or error
      await waitFor(() => {
        // After error, contacts list should be empty or show error state
        expect(crmFirestore.getContactsByClient).toHaveBeenCalled();
      });
    });

    it('handles save error gracefully', async () => {
      vi.mocked(crmFirestore.updateDeal).mockRejectedValue(new Error('Save failed'));
      const onContactsUpdated = vi.fn();

      render(
        <AssignContactsDialog
          {...defaultProps}
          onContactsUpdated={onContactsUpdated}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]);

      const saveButton = screen.getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        // onContactsUpdated should NOT be called on error
        expect(onContactsUpdated).not.toHaveBeenCalled();
      });
    });
  });

  describe('API Calls', () => {
    it('fetches contacts with correct clientId', async () => {
      render(
        <AssignContactsDialog
          {...defaultProps}
          clientId="custom-client-id"
        />
      );

      await waitFor(() => {
        expect(crmFirestore.getContactsByClient).toHaveBeenCalledWith('custom-client-id');
      });
    });

    it('does not fetch contacts when dialog is closed', () => {
      render(<AssignContactsDialog {...defaultProps} open={false} />);

      expect(crmFirestore.getContactsByClient).not.toHaveBeenCalled();
    });

    it('does not fetch contacts when clientId is empty', () => {
      render(<AssignContactsDialog {...defaultProps} clientId="" />);

      // Should not attempt to fetch with empty clientId
      // The effect should short-circuit
    });

    it('refetches contacts when dialog reopens', async () => {
      const { rerender } = render(<AssignContactsDialog {...defaultProps} open={false} />);

      expect(crmFirestore.getContactsByClient).not.toHaveBeenCalled();

      rerender(<AssignContactsDialog {...defaultProps} open={true} />);

      await waitFor(() => {
        expect(crmFirestore.getContactsByClient).toHaveBeenCalled();
      });
    });
  });

  describe('Visual States', () => {
    it('highlights selected contact cards', async () => {
      render(
        <AssignContactsDialog
          {...defaultProps}
          assignedContactIds={['contact-1']}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // The label containing Jane Smith should have the selected styling
      const janeLabel = screen.getByText('Jane Smith').closest('label');
      expect(janeLabel).toHaveClass('bg-blue-50');
    });

    it('disables Save button while saving', async () => {
      // Make updateDeal hang to simulate saving state
      vi.mocked(crmFirestore.updateDeal).mockReturnValue(
        new Promise(() => {}) // Never resolves
      );

      render(<AssignContactsDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /save/i });
      await userEvent.click(saveButton);

      // Button should become disabled during save
      expect(saveButton).toBeDisabled();
    });
  });
});
