import React, { createContext, useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import OrderItemDialog from '../OrderItemDialog';
import ReceiveItemDialog from '../ReceiveItemDialog';
import LogFulfillmentDialog from '../LogFulfillmentDialog';

const mocks = vi.hoisted(() => ({
  currentUid: 'u1' as string | null,
  toast: vi.fn(),
  uploadProjectDocument: vi.fn(),
  getProjectDocuments: vi.fn(),
  linkDocumentToBOMItems: vi.fn(),
  confirm: vi.fn(),
  pendingDocuments: vi.fn(),
  recoverUpload: vi.fn(),
  acknowledgeDocument: vi.fn(),
  reconcileDocuments: vi.fn(),
  pendingType: null as string | null,
  latestUploaded: null as any,
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/utils/projectDocumentFirestore', () => ({
  uploadProjectDocument: mocks.uploadProjectDocument,
  getProjectDocuments: mocks.getProjectDocuments,
  linkDocumentToBOMItems: mocks.linkDocumentToBOMItems,
  getPendingProjectDocumentOperations: mocks.pendingDocuments,
  recoverProjectDocumentUpload: mocks.recoverUpload,
  cancelProjectDocumentUpload: vi.fn(),
  acknowledgeProjectDocumentUpload: mocks.acknowledgeDocument,
  recoverProjectDocumentDeletion: vi.fn(),
  acknowledgeProjectDocumentDeletion: vi.fn(),
}));
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return mocks.currentUid ? { uid: mocks.currentUid } : null; } }, storage: {} }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(() => ({})), uploadBytes: mocks.uploadBytes, getDownloadURL: mocks.getDownloadURL }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/select', async () => {
  const Ctx = createContext<any>(null);
  return {
    Select: ({ children, onValueChange, disabled }: any) => <Ctx.Provider value={{ onValueChange, disabled }}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, disabled }: any) => { const ctx = useContext(Ctx); return <button type="button" role="combobox" disabled={disabled || ctx.disabled}>{children}</button>; },
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value, disabled }: any) => { const ctx = useContext(Ctx); return <button type="button" disabled={disabled || ctx.disabled} onClick={() => ctx.onValueChange(value)}>{children}</button>; },
  };
});

const ORDER_ITEM: any = {
  id: 'valve', itemType: 'component', name: 'Valve', category: 'Mech', quantity: 3, vendors: [], status: 'not-ordered',
  finalizedVendor: { name: 'Acme', price: 10, leadTime: '', availability: 'In Stock' }, poNumber: 'PO-1', linkedPODocumentId: 'po-1',
};
const ORDER_VENDORS: any[] = [{ id: 'v1', company: 'Acme', type: 'OEM', status: 'active', leadTime: '' }];
const ORDER_DOCS: any[] = [{ id: 'po-1', name: 'po.pdf', type: 'vendor-po', linkedBOMItems: [] }];
const RECEIVE_ITEM: any = { id: 'motor', itemType: 'component', name: 'Motor', category: 'Mech', quantity: 3, vendors: [], status: 'ordered', linkedInvoiceDocumentId: 'invoice-1' };
const pdf = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });
const documentInput = () => document.querySelector('input[type="file"]:not([accept="image/*"])') as HTMLInputElement;
const unavailable = () => screen.queryByRole('status');
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

type Opts = { open?: boolean; projectId?: string; alt?: boolean };
const cases = [
  {
    name: 'OrderItemDialog', type: 'vendor-po', element: (o: Opts = {}) => <OrderItemDialog open={o.open ?? true} onOpenChange={vi.fn()} item={o.alt ? { ...ORDER_ITEM, id: 'other' } : ORDER_ITEM} projectId={o.projectId ?? 'P1'} availablePODocuments={ORDER_DOCS} vendors={ORDER_VENDORS} onConfirm={mocks.confirm} onDocumentUploaded={mocks.reconcileDocuments} />,
  },
  {
    name: 'ReceiveItemDialog', type: 'vendor-invoice', element: (o: Opts = {}) => <ReceiveItemDialog open={o.open ?? true} onOpenChange={vi.fn()} item={o.alt ? { ...RECEIVE_ITEM, id: 'other' } : RECEIVE_ITEM} projectId={o.projectId ?? 'P1'} availableVendorQuotes={[{ id: 'invoice-1', name: 'invoice.pdf', type: 'vendor-invoice', linkedBOMItems: [] } as any]} onConfirm={vi.fn()} onDocumentUploaded={mocks.reconcileDocuments} />,
  },
  {
    name: 'LogFulfillmentDialog', type: 'vendor-invoice', element: (o: Opts = {}) => <LogFulfillmentDialog open={o.open ?? true} onOpenChange={vi.fn()} itemType="service" itemName={o.alt ? 'Other' : 'Commissioning'} budgetedQty={10} remainingQty={8} projectId={o.projectId ?? 'P1'} projectDocuments={[]} onConfirm={vi.fn()} />,
  },
];

beforeEach(() => {
  mocks.currentUid = 'u1';
  mocks.toast.mockReset();
  mocks.uploadProjectDocument.mockReset().mockResolvedValue({ id: 'new', name: 'doc.pdf', type: 'vendor-invoice' });
  mocks.getProjectDocuments.mockReset().mockImplementation(async () => mocks.latestUploaded ? [mocks.latestUploaded] : []);
  mocks.linkDocumentToBOMItems.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset();
  mocks.pendingDocuments.mockReset().mockReturnValue({ uploads: [], deletions: [] });
  mocks.recoverUpload.mockReset().mockResolvedValue({ id: 'recovered', name: 'recovered.pdf', type: 'vendor-invoice' });
  mocks.acknowledgeDocument.mockReset().mockResolvedValue(undefined);
  mocks.reconcileDocuments.mockReset().mockResolvedValue(undefined);
  mocks.pendingType = null;
  mocks.latestUploaded = null;
  vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED', 'true');
  vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'false');
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'false');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe.each(cases)('$name document upload boundary', (c) => {
  it('retains the legacy upload route with scoped reads off', async () => {
    render(c.element());
    const input = documentInput();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { files: [pdf()] } });
    await flush();
    expect(mocks.uploadProjectDocument).toHaveBeenCalledTimes(1);
    expect(unavailable()).toBeNull();
  });

  it('disables new file uploads and blocks forced changes before side effects with reads on and document edits off', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    render(c.element());
    const input = documentInput();
    expect(input).toBeDisabled();
    expect(unavailable()).toHaveTextContent(/new document uploads are unavailable/i);
    fireEvent.change(input, { target: { files: [pdf()] } });
    await flush();
    expect(mocks.uploadProjectDocument).not.toHaveBeenCalled();
    expect(mocks.linkDocumentToBOMItems).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('keeps the native document upload route when both native edit flags are on', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    render(c.element());
    const input = documentInput();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { files: [pdf()] } });
    await flush();
    expect(mocks.uploadProjectDocument).toHaveBeenCalledTimes(1);
    expect(unavailable()).toBeNull();
  });

  it('retains a document selected by an upload when the native edit gate closes', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    const element = c.element();
    const view = render(element);
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'false');
    view.rerender(c.element());
    expect(documentInput()).toBeDisabled();
    if (c.name === 'OrderItemDialog') {
      fireEvent.change(screen.getByLabelText(/Expected Arrival/), { target: { value: '2026-11-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark as Ordered' }));
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ linkedPODocumentId: 'new' }));
    } else {
      expect(screen.getAllByText(/doc\.pdf/).length).toBeGreaterThan(0);
    }
  });

  it('keeps the in-flight native upload and its selected document when the UI rerenders after the gate closes', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    const pending = deferred<any>();
    mocks.uploadProjectDocument.mockReturnValue(pending.promise);
    const view = render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(mocks.uploadProjectDocument).toHaveBeenCalledOnce();
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'false');
    view.rerender(c.element());
    expect(documentInput()).toBeDisabled();
    await act(async () => pending.resolve({ id: 'new', name: 'doc.pdf', type: c.type }));
    await flush();
    if (c.name === 'OrderItemDialog') {
      fireEvent.change(screen.getByLabelText(/Expected Arrival/), { target: { value: '2026-11-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark as Ordered' }));
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ linkedPODocumentId: 'new' }));
    } else {
      expect(screen.getAllByText(/doc\.pdf/).length).toBeGreaterThan(0);
    }
  });

  it('keeps saved request recovery available while new uploads are disabled', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    mocks.pendingDocuments.mockReturnValue({ uploads: [c.type], deletions: [] });
    render(c.element());
    expect(documentInput()).toBeDisabled();
    const typeLabel = c.type === 'vendor-po' ? 'Vendor PO' : 'Vendor Invoice';
    const recover = await screen.findByRole('button', { name: `Check saved ${typeLabel} Upload` });
    expect(recover).toBeEnabled();
    fireEvent.click(recover);
    await flush();
    expect(mocks.recoverUpload).toHaveBeenCalledWith('P1', c.type, 'u1', undefined, expect.any(Object));
    expect(mocks.acknowledgeDocument).toHaveBeenCalledWith('P1', c.type, 'u1', expect.any(Object));
  });

  it('acknowledges each successful native upload before allowing a different file', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    const results = [
      { id: 'native-1', name: 'one.pdf', type: c.type, pulseNativeDocument: { operation_id: 'op-1', path: 'p1', generation: '1' } },
      { id: 'native-2', name: 'two.pdf', type: c.type, pulseNativeDocument: { operation_id: 'op-2', path: 'p2', generation: '2' } },
    ];
    mocks.pendingDocuments.mockImplementation(() => ({ uploads: mocks.pendingType ? [mocks.pendingType] : [], deletions: [] }));
    mocks.uploadProjectDocument.mockImplementation(async (_file: File, _projectId: string, type: string) => { mocks.pendingType = type; mocks.latestUploaded = results.shift(); return mocks.latestUploaded; });
    mocks.acknowledgeDocument.mockImplementation(async () => { mocks.pendingType = null; });
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(mocks.acknowledgeDocument).toHaveBeenCalledTimes(1);
    fireEvent.change(documentInput(), { target: { files: [new File(['y'], 'second.pdf', { type: 'application/pdf' })] } });
    await flush();
    expect(mocks.uploadProjectDocument).toHaveBeenCalledTimes(2);
    expect(mocks.acknowledgeDocument).toHaveBeenCalledTimes(2);
    expect(mocks.acknowledgeDocument.mock.invocationCallOrder[0]).toBeLessThan(mocks.uploadProjectDocument.mock.invocationCallOrder[1]);
  });

  it('keeps an ambiguous saved native request pending without acknowledging it', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    mocks.pendingDocuments.mockImplementation(() => ({ uploads: mocks.pendingType ? [mocks.pendingType] : [], deletions: [] }));
    mocks.uploadProjectDocument.mockImplementation(async (_file: File, _projectId: string, type: string) => { mocks.pendingType = type; throw new Error('Acknowledgement was lost'); });
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: `Check saved ${c.type === 'vendor-po' ? 'Vendor PO' : 'Vendor Invoice'} Upload` })).toBeEnabled();
  });

  it('keeps the saved request pending when document refresh fails', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    mocks.pendingDocuments.mockImplementation(() => ({ uploads: mocks.pendingType ? [mocks.pendingType] : [], deletions: [] }));
    mocks.uploadProjectDocument.mockImplementation(async (_file: File, _projectId: string, type: string) => { mocks.pendingType = type; mocks.latestUploaded = { id: 'native', name: 'doc.pdf', type: c.type, pulseNativeDocument: { operation_id: 'op', path: 'p', generation: '1' } }; return mocks.latestUploaded; });
    mocks.getProjectDocuments.mockRejectedValue(new Error('refresh failed'));
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: `Check saved ${c.type === 'vendor-po' ? 'Vendor PO' : 'Vendor Invoice'} Upload` })).toBeEnabled();
  });
});

describe('unrelated procurement controls remain usable', () => {
  it('keeps photo controls independent from the document upload gate', () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    const view = render(cases[1].element());
    expect(documentInput()).toBeDisabled();
    expect(document.querySelector('input[accept="image/*"]')).toBeEnabled();
    expect(screen.getByRole('button', { name: /Take Photo/ })).toBeEnabled();
    view.unmount();
    render(cases[2].element());
    expect(document.querySelector('input[accept="image/*"]')).toBeEnabled();
    expect(screen.getByRole('button', { name: /Take Photo/ })).toBeEnabled();
  });

  it('still lets a service fulfilment proceed with only its quantity', () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    const onConfirm = vi.fn();
    render(<LogFulfillmentDialog open onOpenChange={vi.fn()} itemType="service" itemName="Commissioning" budgetedQty={10} remainingQty={8} projectId="P1" projectDocuments={[]} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Days consumed/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Log 2 days/ }));
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 2, invoiceDocId: undefined, photoUrl: undefined });
  });
});

const nativeDoc = (type: string) => ({ id: 'native', name: 'native.pdf', type, pulseNativeDocument: { operation_id: 'op', path: 'p', generation: '1' } });
const typeLabel = (type: string) => (type === 'vendor-po' ? 'Vendor PO' : 'Vendor Invoice');
const reconciles = (name: string) => name !== 'LogFulfillmentDialog';

describe.each(cases)('$name request-context guards for native uploads', (c) => {
  const arm = (opts: { uploadGate?: ReturnType<typeof deferred<any>>; refreshGate?: ReturnType<typeof deferred<any>> } = {}) => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'true');
    mocks.pendingDocuments.mockImplementation(() => ({ uploads: mocks.pendingType ? [mocks.pendingType] : [], deletions: [] }));
    mocks.uploadProjectDocument.mockImplementation(async (_f: File, _p: string, type: string) => {
      mocks.pendingType = type;
      mocks.latestUploaded = nativeDoc(c.type);
      return opts.uploadGate ? opts.uploadGate.promise : mocks.latestUploaded;
    });
    if (opts.refreshGate) mocks.getProjectDocuments.mockImplementation(() => opts.refreshGate!.promise);
  };
  const expectNothingPublished = () => {
    expect(screen.queryAllByText('native.pdf')).toHaveLength(0);
    expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
    expect(mocks.reconcileDocuments).not.toHaveBeenCalled();
  };
  const changes: [string, (view: ReturnType<typeof render>) => void][] = [
    ['close and reopen', (v) => { v.rerender(c.element({ open: false })); v.rerender(c.element()); }],
    ['project switch', (v) => v.rerender(c.element({ projectId: 'P2' }))],
    ['item switch', (v) => v.rerender(c.element({ alt: true }))],
    ['account switch', (v) => { mocks.currentUid = 'u2'; v.rerender(c.element()); }],
    ['A-B-A item switch', (v) => { v.rerender(c.element({ alt: true })); v.rerender(c.element()); }],
    ['A-B-A account switch', (v) => { mocks.currentUid = 'u2'; v.rerender(c.element()); mocks.currentUid = 'u1'; v.rerender(c.element()); }],
  ];

  describe.each(changes)('%s while work is deferred', (_name, change) => {
    it('publishes nothing when the upload resolves afterwards', async () => {
      const gate = deferred<any>();
      arm({ uploadGate: gate });
      const view = render(c.element());
      fireEvent.change(documentInput(), { target: { files: [pdf()] } });
      await flush();
      change(view);
      await act(async () => gate.resolve(nativeDoc(c.type)));
      await flush();
      expectNothingPublished();
      expect(mocks.pendingType).toBe(c.type);
    });

    it('publishes nothing when the refresh resolves afterwards', async () => {
      const gate = deferred<any>();
      arm({ refreshGate: gate });
      const view = render(c.element());
      fireEvent.change(documentInput(), { target: { files: [pdf()] } });
      await flush();
      expect(mocks.getProjectDocuments).toHaveBeenCalledOnce();
      change(view);
      await act(async () => gate.resolve([nativeDoc(c.type)]));
      await flush();
      expectNothingPublished();
      expect(mocks.pendingType).toBe(c.type);
    });

    it('publishes and acknowledges nothing when the parent reconciliation resolves afterwards', async () => {
      if (!reconciles(c.name)) return;
      const gate = deferred<void>();
      arm();
      mocks.reconcileDocuments.mockReturnValue(gate.promise);
      const view = render(c.element());
      fireEvent.change(documentInput(), { target: { files: [pdf()] } });
      await flush();
      expect(mocks.reconcileDocuments).toHaveBeenCalledOnce();
      change(view);
      await act(async () => gate.resolve());
      await flush();
      expect(screen.queryAllByText('native.pdf')).toHaveLength(0);
      expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
      expect(mocks.pendingType).toBe(c.type);
    });
  });

  it.each([
    ['an empty refresh', () => mocks.getProjectDocuments.mockResolvedValue([])],
    ['a failed refresh', () => mocks.getProjectDocuments.mockRejectedValue(new Error('refresh failed'))],
  ])('keeps the earlier draft and no new confirmable id after %s', async (_n, setup) => {
    arm();
    setup();
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expectNothingPublished();
    expect(mocks.pendingType).toBe(c.type);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(await screen.findByRole('button', { name: `Check saved ${typeLabel(c.type)} Upload` })).toBeEnabled();
    if (c.name === 'OrderItemDialog') {
      fireEvent.change(screen.getByLabelText(/Expected Arrival/), { target: { value: '2026-11-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark as Ordered' }));
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ linkedPODocumentId: 'po-1' }));
    }
  });

  it('refreshes, reconciles, publishes and only then acknowledges a normal success', async () => {
    arm();
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(screen.getAllByText('native.pdf').length).toBeGreaterThan(0);
    expect(mocks.acknowledgeDocument).toHaveBeenCalledOnce();
    const ack = mocks.acknowledgeDocument.mock.invocationCallOrder[0];
    expect(mocks.getProjectDocuments.mock.invocationCallOrder[0]).toBeLessThan(ack);
    if (reconciles(c.name)) {
      expect(mocks.reconcileDocuments).toHaveBeenCalledWith(expect.objectContaining({ id: 'native' }));
      expect(mocks.getProjectDocuments.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcileDocuments.mock.invocationCallOrder[0]);
      expect(mocks.reconcileDocuments.mock.invocationCallOrder[0]).toBeLessThan(ack);
    }
  });

  it('completes the refresh and acknowledgement when only the document gate closes during the refresh', async () => {
    const gate = deferred<any>();
    arm({ refreshGate: gate });
    const view = render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    vi.stubEnv('VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED', 'false');
    view.rerender(c.element());
    expect(documentInput()).toBeDisabled();
    await act(async () => gate.resolve([nativeDoc(c.type)]));
    await flush();
    expect(screen.getAllByText('native.pdf').length).toBeGreaterThan(0);
    expect(mocks.acknowledgeDocument).toHaveBeenCalledOnce();
  });

  it('does not publish or acknowledge when the parent reconciliation fails', async () => {
    if (!reconciles(c.name)) return;
    arm();
    mocks.reconcileDocuments.mockRejectedValue(new Error('parent refresh failed'));
    render(c.element());
    fireEvent.change(documentInput(), { target: { files: [pdf()] } });
    await flush();
    expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
    expect(screen.queryAllByText('native.pdf')).toHaveLength(0);
    expect(mocks.pendingType).toBe(c.type);
  });

  it('publishes a recovered saved upload only after the parent reconciles, then acknowledges it', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    mocks.pendingDocuments.mockReturnValue({ uploads: [c.type], deletions: [] });
    render(c.element());
    expect(documentInput()).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: `Check saved ${typeLabel(c.type)} Upload` }));
    await flush();
    expect(screen.getAllByText('recovered.pdf').length).toBeGreaterThan(0);
    expect(mocks.acknowledgeDocument).toHaveBeenCalledOnce();
    if (reconciles(c.name)) {
      expect(mocks.reconcileDocuments.mock.invocationCallOrder[0]).toBeLessThan(mocks.acknowledgeDocument.mock.invocationCallOrder[0]);
    }
  });

  it('does not publish or acknowledge a recovered upload when the dialog closes during parent reconciliation', async () => {
    if (!reconciles(c.name)) return;
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    const gate = deferred<void>();
    mocks.reconcileDocuments.mockReturnValue(gate.promise);
    mocks.pendingDocuments.mockReturnValue({ uploads: [c.type], deletions: [] });
    const view = render(c.element());
    fireEvent.click(await screen.findByRole('button', { name: `Check saved ${typeLabel(c.type)} Upload` }));
    await flush();
    view.rerender(c.element({ open: false }));
    view.rerender(c.element());
    await act(async () => gate.resolve());
    await flush();
    expect(screen.queryAllByText('recovered.pdf')).toHaveLength(0);
    expect(mocks.acknowledgeDocument).not.toHaveBeenCalled();
  });
});
