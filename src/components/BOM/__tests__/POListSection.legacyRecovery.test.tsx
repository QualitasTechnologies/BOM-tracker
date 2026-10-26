import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PurchaseOrder } from '@/utils/poFirestore';
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
  session: null as unknown as ReturnType<typeof session>,
  createSession: vi.fn(),
  isAdmin: true,
  recoverStale: vi.fn(),
  recoverAccepted: vi.fn(),
  retryUncertain: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin, user: { uid: mocks.uid } }) }));
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return { uid: mocks.uid, email: 'buyer@example.com' }; } } }));
vi.mock('@/utils/nativeProcurementOperations', () => ({
  createNativePOSendSession: (...args: unknown[]) => mocks.createSession(...args),
  isNativePOSendEnabled: () => import.meta.env.VITE_BOM_NATIVE_PO_SEND_ENABLED === 'true',
}));
vi.mock('@/utils/poFirestore', () => ({
  subscribeToPurchaseOrders: (_projectId: string, callback: (orders: PurchaseOrder[]) => void) => {
    callback([{ id: 'po-1', poNumber: 'PO-1', vendorName: 'Acme', vendorEmail: 'vendor@acme.com', status: mocks.poStatus, items: [], ...mocks.poNativeFields } as PurchaseOrder]);
    return () => {};
  },
  deletePurchaseOrder: (...args: unknown[]) => mocks.deletePurchaseOrder(...args),
  sendPurchaseOrder: (...args: unknown[]) => mocks.sendPurchaseOrder(...args),
  recoverStaleLegacyPOSend: (...args: unknown[]) => mocks.recoverStale(...args),
  recoverAcceptedLegacyPOSend: (...args: unknown[]) => mocks.recoverAccepted(...args),
  retryUncertainLegacyPOSend: (...args: unknown[]) => mocks.retryUncertain(...args),
  generatePOPDF: vi.fn(),
  sendPOEmail: (...args: unknown[]) => mocks.sendPOEmail(...args),
  submitPOForApproval: vi.fn(),
  requestPOChanges: vi.fn(),
  notifyPOApproval: vi.fn(),
}));
vi.mock('@/utils/settingsFirestore', () => ({ billingEntityToCompanySettings: (value: unknown) => value, getBillingEntity: vi.fn().mockResolvedValue({ companyName: 'Co' }) }));
vi.mock('@/utils/projectFirestore', () => ({
  getProject: (...args: unknown[]) => mocks.getProject(...args),
  getNotificationRecipients: () => [{ name: 'Alex', email: 'alex@example.com' }],
}));
vi.mock('../EditPODialog', () => ({ default: () => null }));
vi.mock('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null;
  return {
    Dialog, DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>, DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock('@/components/ui/alert-dialog', () => {
  const Nil = () => null;
  return { AlertDialog: Nil, AlertDialogAction: Nil, AlertDialogCancel: Nil, AlertDialogContent: Nil, AlertDialogDescription: Nil, AlertDialogFooter: Nil, AlertDialogHeader: Nil, AlertDialogTitle: Nil };
});
vi.mock('@/components/ui/dropdown-menu', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Item = ({ children, onClick, disabled, title }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" onClick={onClick} disabled={disabled} title={title}>{children}</button>;
  return { DropdownMenu: Wrapper, DropdownMenuContent: Wrapper, DropdownMenuItem: Item, DropdownMenuSeparator: () => <hr />, DropdownMenuTrigger: Wrapper };
});
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => <input type="checkbox" checked={!!checked} onChange={(event) => onCheckedChange?.(event.target.checked)} /> }));


const session = () => ({
  load: vi.fn().mockResolvedValue({
    purchase_order: { id: 'po-1', projectId: 'project-1', poNumber: 'PO-1', vendorEmail: 'vendor@acme.com' },
    po_version: '1:1', material_version: '1:1', material_items: [], permissions: { send: false }, attempt: null,
  }),
  send: vi.fn(), recover: vi.fn(), reviewMaterials: vi.fn(), reconcile: vi.fn(), cancel: vi.fn(), invalidate: vi.fn(),
});

const minutes = (value: number) => new Date(Date.now() - value * 60 * 1000);
const accepted = {
  legacySendAttemptId: 'attempt-acc', legacySendPhase: 'needs_reconciliation',
  legacySendAcceptedAt: '2026-10-17T19:00:00.000Z', legacySendProviderId: 'resend-1', legacySendActorUid: 'user-1',
  legacySendRecipientEmail: 'vendor@acme.com', legacySendPdfUrl: 'https://example.test/po.pdf',
  legacySendFileSize: 1200, legacySendDocumentId: 'doc-1',
};
const setup = (props: Record<string, unknown> = {}) => {
  const onPOSent = vi.fn().mockResolvedValue(undefined);
  const onNativeSaved = vi.fn();
  render(<POListSection projectId="project-1" onPOSent={onPOSent} onNativeSaved={onNativeSaved} {...props} />);
  return { onPOSent, onNativeSaved };
};
const openMark = async () => {
  fireEvent.click(screen.getByText('Approve & Mark as Sent'));
  await screen.findByRole('dialog');
};

describe('POListSection legacy server-backed send and recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubEnv('VITE_BOM_NATIVE_PO_SEND_ENABLED', 'false');
    mocks.uid = 'user-1';
    mocks.isAdmin = true;
    mocks.poStatus = 'pending-approval';
    mocks.poNativeFields = {};
    mocks.sendPurchaseOrder.mockResolvedValue(undefined);
    mocks.recoverStale.mockResolvedValue(undefined);
    mocks.recoverAccepted.mockResolvedValue(undefined);
    mocks.retryUncertain.mockResolvedValue(undefined);
    mocks.getProject.mockResolvedValue({ projectName: 'Project 1' });
    mocks.session = session();
    mocks.createSession.mockImplementation(() => mocks.session);
  });

  it('requires an unprefilled actual sent date and marks through the server path with it', async () => {
    const { onPOSent, onNativeSaved } = setup();
    await openMark();
    const date = screen.getByLabelText('Actual sent date') as HTMLInputElement;
    expect(date.value).toBe('');
    expect(screen.getByRole('button', { name: 'Mark as Sent' })).toBeDisabled();
    fireEvent.change(date, { target: { value: '2026-10-18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }));
    await waitFor(() => expect(mocks.sendPurchaseOrder).toHaveBeenCalledTimes(1));
    const [projectId, poId, input, operationId] = mocks.sendPurchaseOrder.mock.calls[0];
    expect([projectId, poId]).toEqual(['project-1', 'po-1']);
    expect(input).toEqual({ sentBy: 'user-1', sentToEmail: 'vendor@acme.com', actualSentDate: '2026-10-18' });
    expect(operationId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(onPOSent).not.toHaveBeenCalled();
    expect(onNativeSaved).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('replays the same operation id after an uncertain failure', async () => {
    mocks.sendPurchaseOrder.mockRejectedValueOnce(new Error('network lost'));
    setup();
    await openMark();
    fireEvent.change(screen.getByLabelText('Actual sent date'), { target: { value: '2026-10-18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }));
    await waitFor(() => expect(mocks.sendPurchaseOrder).toHaveBeenCalledTimes(2));
    expect(mocks.sendPurchaseOrder.mock.calls[1][3]).toBe(mocks.sendPurchaseOrder.mock.calls[0][3]);
  });

  it('does not fall back to raw writes or the email callable when the legacy mark is denied', async () => {
    mocks.sendPurchaseOrder.mockRejectedValue(new Error('procurement_forbidden'));
    const { onPOSent, onNativeSaved } = setup();
    await openMark();
    fireEvent.change(screen.getByLabelText('Actual sent date'), { target: { value: '2026-10-18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Sent' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'procurement_forbidden' })));
    expect(mocks.sendPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(mocks.sendPOEmail).not.toHaveBeenCalled();
    expect(onPOSent).not.toHaveBeenCalled();
    expect(onNativeSaved).not.toHaveBeenCalled();
  });

  it('keeps the native route from calling any legacy callable when the server denies sending', async () => {
    vi.stubEnv('VITE_BOM_NATIVE_PO_SEND_ENABLED', 'true');
    setup();
    await openMark();
    fireEvent.change(screen.getByLabelText('Actual sent date'), { target: { value: '2026-10-18' } });
    expect(screen.getByRole('button', { name: 'Mark as Sent' })).toBeDisabled();
    expect(mocks.sendPurchaseOrder).not.toHaveBeenCalled();
    expect(mocks.sendPOEmail).not.toHaveBeenCalled();
  });

  it('lets an admin release a reservation only once it has been stale for fifteen minutes', async () => {
    mocks.poNativeFields = { legacySendAttemptId: 'attempt-1', legacySendPhase: 'preparing', legacySendPreparingAt: minutes(14) };
    const { unmount } = render(<POListSection projectId="project-1" />);
    expect(screen.queryByRole('button', { name: 'Release stale PO send reservation' })).toBeNull();
    unmount();
    mocks.poNativeFields = { legacySendAttemptId: 'attempt-1', legacySendPhase: 'preparing', legacySendPreparingAt: minutes(16) };
    const { onNativeSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Release stale PO send reservation' }));
    await waitFor(() => expect(mocks.recoverStale).toHaveBeenCalledWith('project-1', 'po-1', 'attempt-1'));
    await waitFor(() => expect(onNativeSaved).toHaveBeenCalledTimes(1));
  });

  it('offers accepted-send completion only with complete durable provider evidence', async () => {
    mocks.poNativeFields = { ...accepted, legacySendDocumentId: null };
    const { unmount } = render(<POListSection projectId="project-1" />);
    expect(screen.queryByRole('button', { name: 'Complete accepted PO send' })).toBeNull();
    unmount();
    mocks.poNativeFields = accepted;
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Complete accepted PO send' }));
    await waitFor(() => expect(mocks.recoverAccepted).toHaveBeenCalledWith('project-1', 'po-1', 'attempt-acc'));
  });

  it('retries an uncertain email with the saved attempt id inside the idempotency window only', async () => {
    const uncertain = { legacySendAttemptId: 'attempt-unc', legacySendPhase: 'uncertain', legacySendRetryPayloadReady: true };
    mocks.poNativeFields = { ...uncertain, legacySendDispatchStartedAt: minutes(24 * 60) };
    const { unmount } = render(<POListSection projectId="project-1" />);
    expect(screen.queryByRole('button', { name: 'Recover uncertain PO email' })).toBeNull();
    unmount();
    mocks.poNativeFields = { ...uncertain, legacySendDispatchStartedAt: minutes(5) };
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Recover uncertain PO email' }));
    await waitFor(() => expect(mocks.retryUncertain).toHaveBeenCalledWith('project-1', 'po-1', 'attempt-unc'));
    expect(mocks.sendPOEmail).not.toHaveBeenCalled();
  });

  it('shows no recovery controls to non-admin members', () => {
    mocks.isAdmin = false;
    mocks.poNativeFields = { ...accepted, legacySendPreparingAt: minutes(60) };
    setup();
    expect(screen.queryByRole('button', { name: /Complete accepted PO send|Release stale|Recover uncertain/ })).toBeNull();
  });

  it('shows the server-recorded actual sent day on sent POs and leaves it blank when absent', () => {
    mocks.poStatus = 'sent';
    mocks.poNativeFields = { actualSentDate: '2026-10-18' };
    const { unmount } = render(<POListSection projectId="project-1" />);
    expect(screen.getByText(/Actual sent: 18 Oct 2026/)).toBeTruthy();
    unmount();
    mocks.poNativeFields = {};
    render(<POListSection projectId="project-1" />);
    expect(screen.queryByText(/Actual sent:/)).toBeNull();
  });
});
