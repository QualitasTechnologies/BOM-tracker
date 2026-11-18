import React from 'react';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PurchaseRequestDialog from '../PurchaseRequestDialog';
const h = vi.hoisted(() => ({
  uid: 'U',
  recover: vi.fn(),
  read: vi.fn(),
  call: vi.fn(),
  clear: vi.fn(),
  begin: vi.fn(),
  toast: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('@/firebase', () => ({
  auth: {
    get currentUser() {
      return { uid: h.uid, email: 'u@qualitastech.com' };
    },
  },
}));
vi.mock('@/utils/purchaseRequestRecovery', () => ({
  readPurchaseRequest: h.read,
  callPurchaseRequest: h.call,
  clearPurchaseRequest: h.clear,
  beginPurchaseRequest: h.begin,
  recoverPurchaseRequest: h.recover,
}));
vi.mock('@/utils/settingsFirestore', () => ({ getPRSettings: h.settings }));
vi.mock('@/components/ui/use-toast', () => ({ toast: h.toast }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
const pending = {
  version: 1 as const,
  uid: 'U',
  projectId: 'P',
  body: {
    operation_id: 'saved-1',
    expected_actor_uid: 'U',
    projectDetails: { projectId: 'P' },
    categories: [],
    recipients: ['a@example.com'],
  },
};
const uncertain = {
  ok: true,
  success: false,
  status: 'uncertain',
  operation_id: 'saved-1',
  can_retry: true,
};
const sent = {
  ok: true,
  success: true,
  status: 'sent',
  operation_id: 'saved-1',
  emailId: 'provider-id',
  recipients: ['a@example.com'],
};
function props(projectId = 'P') {
  return {
    open: true,
    onOpenChange: vi.fn(),
    projectId,
    projectDetails: { projectId, projectName: 'QA', clientName: 'Fixture' },
    categories: [],
    vendors: [],
    documents: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.uid = 'U';
  h.recover.mockResolvedValue(null);
  h.settings.mockResolvedValue({
    recipients: ['a@example.com'],
    fromEmail: 'info@qualitastech.com',
    companyName: 'Company',
  });
  h.read.mockReturnValue(pending);
  h.call.mockResolvedValue(uncertain);
  h.clear.mockResolvedValue(undefined);
});
it('resolves saved evidence on open and retries that same request despite an empty current draft', async () => {
  const p = props();
  render(<PurchaseRequestDialog {...p} />);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith(pending, true));
  const button = await screen.findByRole('button', {
    name: /retry saved request/i,
  });
  expect(button).toBeEnabled();
  h.call.mockResolvedValue(sent);
  fireEvent.click(button);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith(pending, false));
  await waitFor(() =>
    expect(h.clear).toHaveBeenCalledWith('U', 'P', 'saved-1')
  );
  expect(h.begin).not.toHaveBeenCalled();
  expect(p.onOpenChange).toHaveBeenCalledWith(false);
  expect(h.toast).toHaveBeenCalledTimes(1);
});
it('uncertain recovery has no success toast or dialog completion', async () => {
  const p = props();
  render(<PurchaseRequestDialog {...p} />);
  await waitFor(() => expect(h.call).toHaveBeenCalled());
  expect(h.toast).not.toHaveBeenCalled();
  expect(p.onOpenChange).not.toHaveBeenCalled();
  expect(h.clear).not.toHaveBeenCalled();
});
it('expired saved request can only be checked and never creates a new request', async () => {
  h.call.mockResolvedValue({
    ...uncertain,
    status: 'needs_reconciliation',
    can_retry: false,
  });
  render(<PurchaseRequestDialog {...props()} />);
  const button = await screen.findByRole('button', {
    name: /check saved request/i,
  });
  fireEvent.click(button);
  await waitFor(() => expect(h.call).toHaveBeenCalledTimes(2));
  expect(h.call.mock.calls.every((c) => c[1] === true)).toBe(true);
  expect(h.begin).not.toHaveBeenCalled();
});
it('late response from an old project cannot acknowledge or close the new dialog', async () => {
  let done: (v: any) => void = () => {};
  h.call.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  const p = props();
  const view = render(<PurchaseRequestDialog {...p} />);
  await waitFor(() => expect(h.call).toHaveBeenCalledTimes(1));
  h.read.mockReturnValue(null);
  view.rerender(
    <PurchaseRequestDialog
      {...p}
      {...{
        projectId: 'other',
        projectDetails: {
          projectId: 'other',
          projectName: 'Other',
          clientName: 'Client',
        },
      }}
    />
  );
  await act(async () => {
    done(sent);
    await Promise.resolve();
  });
  expect(h.clear).not.toHaveBeenCalled();
  expect(h.toast).not.toHaveBeenCalled();
  expect(p.onOpenChange).not.toHaveBeenCalled();
});
it('corrupt saved evidence blocks fresh sending', async () => {
  h.read.mockImplementation(() => {
    throw Error('Saved request is corrupt');
  });
  render(<PurchaseRequestDialog {...props()} />);
  await screen.findByText(/Saved request is corrupt/);
  expect(screen.getByRole('button', { name: /send PR/i })).toBeDisabled();
  expect(h.call).not.toHaveBeenCalled();
  expect(h.begin).not.toHaveBeenCalled();
});

function readyProps() {
  return {
    ...props(),
    categories: [
      {
        name: 'Mech',
        items: [
          {
            id: 'i',
            name: 'Bolt',
            description: 'Item',
            make: 'QA',
            sku: 'B1',
            quantity: 2,
            itemType: 'component',
            finalizedVendor: { id: 'V', name: 'Vendor' },
          },
        ],
      },
    ] as any,
    vendors: [
      { id: 'V', company: 'Vendor', status: 'active', type: 'Supplier' },
    ] as any,
    documents: [
      {
        id: 'Q',
        type: 'vendor-quote',
        name: 'Quote',
        url: 'https://files.example.com/quote',
        linkedBOMItems: ['i'],
      },
    ] as any,
  };
}
it('fresh sending saves the selected items/vendors/quotes and actor copy before dispatch', async () => {
  h.read.mockReturnValue(null);
  h.begin.mockResolvedValue({ pending, created: true });
  h.call.mockResolvedValue(sent);
  const p = readyProps();
  render(<PurchaseRequestDialog {...p} />);
  const button = await screen.findByRole('button', {
    name: /Send PR \(1 items\)/,
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(h.begin).toHaveBeenCalled());
  expect(h.begin.mock.calls[0][0]).toBe('U');
  expect(h.begin.mock.calls[0][1]).toBe('P');
  expect(
    h.begin.mock.calls[0][2].categories[0].items[0].finalizedVendor.id
  ).toBe('V');
  expect(h.begin.mock.calls[0][2].categories[0].items[0].linkedQuote.id).toBe(
    'Q'
  );
  expect(h.begin.mock.calls[0][2].recipients).toContain('u@qualitastech.com');
  await waitFor(() => expect(h.call).toHaveBeenCalledWith(pending, false));
  await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
});
it('failure to save fresh recovery evidence prevents any send', async () => {
  h.read.mockReturnValue(null);
  h.begin.mockRejectedValue(Error('storage quota'));
  render(<PurchaseRequestDialog {...readyProps()} />);
  const button = await screen.findByRole('button', {
    name: /Send PR \(1 items\)/,
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText(/storage quota/);
  expect(h.call).not.toHaveBeenCalled();
  expect(h.toast).not.toHaveBeenCalled();
});
it('a request reserved by another tab is resolved instead of dispatched as a fresh request', async () => {
  h.read.mockReturnValue(null);
  h.begin.mockResolvedValue({ pending, created: false });
  render(<PurchaseRequestDialog {...readyProps()} />);
  const button = await screen.findByRole('button', {
    name: /Send PR \(1 items\)/,
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith(pending, true));
  expect(h.call).not.toHaveBeenCalledWith(pending, false);
  expect(h.toast).not.toHaveBeenCalled();
});
it('server-side recovery works when the local browser copy is missing', async () => {
  h.read.mockReturnValue(null);
  h.recover.mockResolvedValue(pending);
  render(<PurchaseRequestDialog {...props()} />);
  await waitFor(() => expect(h.recover).toHaveBeenCalledWith('U', 'P'));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith(pending, true));
  expect(
    await screen.findByRole('button', { name: /Retry saved request/i })
  ).toBeEnabled();
  expect(h.begin).not.toHaveBeenCalled();
});
it('a direct account change suppresses a late confirmed response', async () => {
  let done: (v: any) => void = () => {};
  h.call.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  const p = props();
  render(<PurchaseRequestDialog {...p} />);
  await waitFor(() => expect(h.call).toHaveBeenCalled());
  h.uid = 'OTHER';
  await act(async () => {
    done(sent);
    await Promise.resolve();
  });
  expect(h.clear).not.toHaveBeenCalled();
  expect(h.toast).not.toHaveBeenCalled();
  expect(p.onOpenChange).not.toHaveBeenCalled();
});
