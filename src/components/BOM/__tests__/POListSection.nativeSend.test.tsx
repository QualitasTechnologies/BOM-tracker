import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import POListSection from '../POListSection';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  uid: 'user-1',
  sendPurchaseOrder: vi.fn(),
  sendPOEmail: vi.fn(),
  getProject: vi.fn(),
  deletePurchaseOrder: vi.fn(),
  poStatus: 'pending-approval',
  poNativeFields: {},
  session: null as any,
  createSession: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, user: { uid: mocks.uid } }) }));
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: mocks.uid, email: 'buyer@example.com' }; } } }));
vi.mock('@/utils/nativeProcurementOperations', () => ({
  createNativePOSendSession: (...args: unknown[]) => mocks.createSession(...args),
  isNativePOSendEnabled: () => import.meta.env.VITE_BOM_NATIVE_PO_SEND_ENABLED === 'true',
}));
vi.mock('@/utils/poFirestore', () => ({
  subscribeToPurchaseOrders: (_projectId: string, callback: (orders: any[]) => void) => {
    callback([{ id: 'po-1', poNumber: 'PO-1', vendorName: 'Acme', vendorEmail: 'vendor@acme.com', status: mocks.poStatus, items: [], ...mocks.poNativeFields }]);
    return () => {};
  },
  deletePurchaseOrder: (...args: unknown[]) => mocks.deletePurchaseOrder(...args),
  sendPurchaseOrder: (...args: unknown[]) => mocks.sendPurchaseOrder(...args),
  generatePOPDF: vi.fn(),
  sendPOEmail: (...args: unknown[]) => mocks.sendPOEmail(...args),
  submitPOForApproval: vi.fn(),
  requestPOChanges: vi.fn(),
  notifyPOApproval: vi.fn(),
}));
vi.mock('@/utils/settingsFirestore', () => ({ billingEntityToCompanySettings: (value: any) => value, getBillingEntity: vi.fn().mockResolvedValue({ companyName: 'Co' }) }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => mocks.getProject(...args),
  getNotificationRecipients: () => [{ name: 'Alex', email: 'alex@example.com' }],
}));
vi.mock('../EditPODialog', () => ({ default: () => null }));
vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null;
  return {
    Dialog, DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children }: any) => <div>{children}</div>,
  };
});
vi.mock('@/components/ui/alert-dialog', () => {
  const Nil = () => null;
  return { AlertDialog: Nil, AlertDialogAction: Nil, AlertDialogCancel: Nil, AlertDialogContent: Nil, AlertDialogDescription: Nil, AlertDialogFooter: Nil, AlertDialogHeader: Nil, AlertDialogTitle: Nil };
});
vi.mock('@/components/ui/dropdown-menu', () => {
  const Wrapper = ({ children }: any) => <div>{children}</div>;
  const Item = ({ children, onClick, disabled, title }: any) => <button type="button" onClick={onClick} disabled={disabled} title={title}>{children}</button>;
  return { DropdownMenu: Wrapper, DropdownMenuContent: Wrapper, DropdownMenuItem: Item, DropdownMenuSeparator: () => <hr />, DropdownMenuTrigger: Wrapper };
});
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: ({ checked, onCheckedChange }: any) => <input type="checkbox" checked={!!checked} onChange={(event) => onCheckedChange(event.target.checked)} /> }));

const session = (permissionsSend = true, phase = 'complete') => ({
  load: vi.fn().mockResolvedValue({
    purchase_order: { id: 'po-1', projectId: 'project-1', poNumber: 'PO-1', vendorEmail: 'vendor@acme.com' },
    po_version: '1:1', material_version: '1:1', material_items: [], permissions: { send: permissionsSend }, attempt: null,
  }),
  send: vi.fn().mockResolvedValue({ ok: true, attempt_id: 'attempt-1', phase, mode: 'email' }),
  recover: vi.fn().mockResolvedValue({ attempt_id: 'attempt-1', phase: 'complete' }),
  reviewMaterials: vi.fn(), reconcile: vi.fn().mockResolvedValue({ attempt_id: 'attempt-1', phase: 'complete' }),
  cancel: vi.fn().mockResolvedValue({ attempt_id: 'attempt-1', phase: 'cancelled' }), invalidate: vi.fn(),
});

const setup = (canSend = true) => {
  mocks.session = session(canSend);
  const onPOSent = vi.fn().mockResolvedValue(undefined);
  render(<POListSection projectId="project-1" onPOSent={onPOSent} />);
  return { onPOSent };
};

const openMode = async (mode: 'email' | 'mark') => {
  fireEvent.click(screen.getByText(mode === 'email' ? 'Approve & Email to Vendor' : 'Approve & Mark as Sent'));
  await screen.findByRole('dialog');
};

describe('POListSection native send migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_BOM_NATIVE_PO_SEND_ENABLED', 'true');
    mocks.uid = 'user-1';
    mocks.poStatus = 'pending-approval';
    mocks.poNativeFields = {};
    mocks.createSession.mockImplementation(() => mocks.session);
    mocks.getProject.mockResolvedValue({ projectName: 'Project 1' });
  });

  it('routes Mark as Sent through the native session', async () => {
    setup();
    await openMode('mark');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }));
    await waitFor(() => expect(mocks.session.send).toHaveBeenCalledWith({ mode: 'mark', recipient_email: 'vendor@acme.com', cc_emails: [] }));
    expect(mocks.sendPurchaseOrder).not.toHaveBeenCalled();
  });

  it('routes Email through the native session and skips the stale BOM callback', async () => {
    const { onPOSent } = setup();
    await openMode('email');
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));
    await waitFor(() => expect(mocks.session.send).toHaveBeenCalledWith({ mode: 'email', recipient_email: 'vendor@acme.com', cc_emails: ['alex@example.com', 'buyer@example.com'] }));
    expect(mocks.sendPOEmail).not.toHaveBeenCalled();
    expect(mocks.sendPurchaseOrder).not.toHaveBeenCalled();
    expect(onPOSent).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the modal actionable but disables sending when the server gate is off', async () => {
    setup(false);
    await openMode('mark');
    expect(screen.getByText(/native PO sending is disabled/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark as Sent' })).toBeDisabled();
    expect(mocks.session.send).not.toHaveBeenCalled();
    expect(mocks.sendPurchaseOrder).not.toHaveBeenCalled();
  });

  it('keeps recovery and cancellation actions for an unresolved prepared request', async () => {
    setup();
    mocks.session.load.mockResolvedValueOnce({
      purchase_order: { id: 'po-1', projectId: 'project-1', poNumber: 'PO-1', vendorEmail: 'vendor@acme.com' },
      po_version: '1:1', material_version: '1:1', material_items: [], permissions: { send: true },
      attempt: { attempt_id: 'attempt-1', phase: 'prepared', mode: 'mark', recipient_email: 'vendor@acme.com', cc_emails: [] },
    });
    await openMode('mark');
    expect(screen.getByRole('button', { name: 'Recover send' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel saved request' }));
    await waitFor(() => expect(mocks.session.cancel).toHaveBeenCalledTimes(1));
  });

  it('explains that sent POs cannot be deleted under the native audit rules', () => {
    mocks.poStatus = 'sent';
    setup();

    const deleteAction = screen.getByRole('button', { name: 'Sent POs cannot be deleted' });
    expect(deleteAction).toBeDisabled();
    expect(deleteAction).toHaveAttribute('title', 'Sent purchase orders are retained for audit history.');
    fireEvent.click(deleteAction);
    expect(mocks.deletePurchaseOrder).not.toHaveBeenCalled();
  });

  it('keeps the legacy email flow when the explicit client gate is off', async () => {
    vi.stubEnv('VITE_BOM_NATIVE_PO_SEND_ENABLED', 'false');
    const { onPOSent } = setup();
    await openMode('email');
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));
    await waitFor(() => expect(mocks.sendPOEmail).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(onPOSent).toHaveBeenCalledWith('po-1', [], 'PO-1');
  });
});
