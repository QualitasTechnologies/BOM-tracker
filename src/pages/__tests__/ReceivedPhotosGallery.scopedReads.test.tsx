import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceivedPhotosGallery from '../ReceivedPhotosGallery';
import type { BOMCategory } from '@/types/bom';

type Sub = { projectId: string; emit: (categories: BOMCategory[]) => void; fail: (error: Error) => void; unsubscribe: ReturnType<typeof vi.fn> };
const h = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  authListener: null as null | ((user: { uid: string } | null) => void),
  authUnsubscribe: vi.fn(),
  params: { projectId: 'A' },
  subs: [] as any[],
  subscribe: vi.fn(),
  documents: vi.fn(),
  invoice: vi.fn(),
}));
vi.mock('@/firebase', () => ({ auth: h.auth, db: {}, storage: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => { h.authListener = listener; return h.authUnsubscribe; },
}));
vi.mock('react-router-dom', () => ({
  useParams: () => h.params,
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));
vi.mock('@/utils/projectFirestore', () => ({ subscribeToBOM: h.subscribe }));
vi.mock('@/utils/projectDocumentFirestore', () => ({ getProjectDocuments: h.documents, getReceivedPhotoInvoice: h.invoice }));

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Item ${id}`, status: 'received', receivedPhotoUrl: `https://photos.example/${id}.jpg`,
  linkedInvoiceDocumentId: `inv-${id}`, actualArrival: '2026-10-19', ...over,
});
const cats = (...items: unknown[]) => [{ id: 'c', name: 'Cat', items }] as unknown as BOMCategory[];
const invoiceDoc = (id: string, name = `${id}.pdf`) => ({ id, name, url: `https://files.example/${id}.pdf`, linkedBOMItems: [], type: 'vendor-invoice' });
const readFailure = (code: string, message: string) => Object.assign(new Error(message), { code });
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const latest = (): Sub => h.subs[h.subs.length - 1];
const emit = (categories: BOMCategory[], sub: Sub = latest()) => act(() => sub.emit(categories));

beforeEach(() => {
  vi.unstubAllEnvs();
  h.auth.currentUser = { uid: 'alice' }; h.authListener = null; h.params.projectId = 'A'; h.subs.length = 0;
  for (const mock of [h.authUnsubscribe, h.subscribe, h.documents, h.invoice]) mock.mockReset();
  h.subscribe.mockImplementation((projectId: string, callback: (categories: BOMCategory[]) => void, onError?: (error: Error) => void) => {
    const unsubscribe = vi.fn();
    h.subs.push({ projectId, emit: callback, fail: (error: Error) => onError?.(error), unsubscribe });
    return unsubscribe;
  });
  h.documents.mockResolvedValue([]);
  h.invoice.mockImplementation(async (_project: string, itemId: string) => invoiceDoc(`inv-${itemId}`));
});
afterEach(() => vi.unstubAllEnvs());

describe('scoped reads on', () => {
  beforeEach(() => vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true'));

  it('shows the reverse invoice of a visible received item whose invoice has no forward links, without reading the document list', async () => {
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('link', { name: 'inv-m1.pdf' })).toHaveAttribute('href', 'https://files.example/inv-m1.pdf');
    expect(screen.getByRole('img', { name: 'Item m1' })).toHaveAttribute('src', 'https://photos.example/m1.jpg');
    expect(h.invoice).toHaveBeenCalledWith('A', 'm1', { isCurrent: expect.any(Function) });
    expect(h.documents).not.toHaveBeenCalled();
  });

  it('looks up invoices only for visible received physical photographed items and once per shared invoice', async () => {
    h.invoice.mockImplementation(async () => invoiceDoc('shared', 'Shared invoice.pdf'));
    render(<ReceivedPhotosGallery />);
    emit(cats(
      item('m1', { linkedInvoiceDocumentId: 'shared' }), item('m2', { linkedInvoiceDocumentId: 'shared' }),
      item('ordered', { status: 'ordered' }), item('service', { itemType: 'service' }),
      item('nophoto', { receivedPhotoUrl: undefined }), item('noinvoice', { linkedInvoiceDocumentId: undefined }),
    ));
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Shared invoice.pdf' })).toHaveLength(2));
    expect(h.invoice.mock.calls.map(call => call[1])).toEqual(['m1']);
    expect(screen.getByRole('img', { name: 'Item noinvoice' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Item ordered' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Item service' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Item nophoto' })).toBeNull();
  });

  it('bounds concurrent invoice lookups', async () => {
    const waiting: Array<() => void> = []; let inFlight = 0, peak = 0;
    h.invoice.mockImplementation((_p: string, itemId: string) => new Promise(resolve => {
      inFlight++; peak = Math.max(peak, inFlight);
      waiting.push(() => { inFlight--; resolve(invoiceDoc(`inv-${itemId}`)); });
    }));
    render(<ReceivedPhotosGallery />);
    emit(cats(...Array.from({ length: 10 }, (_, index) => item(`m${index}`))));
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    for (let done = 0; done < 10; done++) { await waitFor(() => expect(waiting.length).toBeGreaterThan(0)); waiting.shift()!(); }
    expect(await screen.findByRole('link', { name: 'inv-m9.pdf' })).toBeInTheDocument();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(h.invoice).toHaveBeenCalledTimes(10);
  });

  it('treats an unavailable invoice as absent without an error', async () => {
    h.invoice.mockResolvedValue(undefined);
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    await waitFor(() => expect(h.invoice).toHaveBeenCalled());
    expect(await screen.findByRole('img', { name: 'Item m1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /\.pdf/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores stale results across an A-B-A route change, including late snapshots and invoices', async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(), third = deferred<unknown>();
    h.invoice.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const view = render(<ReceivedPhotosGallery />);
    const subA1 = latest(); emit(cats(item('a1')), subA1);
    h.params.projectId = 'B'; view.rerender(<ReceivedPhotosGallery />);
    expect(subA1.unsubscribe).toHaveBeenCalledOnce();
    emit(cats(item('b1')));
    h.params.projectId = 'A'; view.rerender(<ReceivedPhotosGallery />);
    expect(screen.queryByRole('img', { name: 'Item b1' })).toBeNull();
    emit(cats(item('a1')));
    emit(cats(item('stale')), subA1);
    expect(screen.queryByRole('img', { name: 'Item stale' })).toBeNull();
    await act(async () => { first.resolve(invoiceDoc('x', 'Stale first A.pdf')); second.resolve(invoiceDoc('y', 'Stale B.pdf')); });
    expect(screen.queryByRole('link', { name: /Stale/ })).toBeNull();
    await act(async () => { third.resolve(invoiceDoc('z', 'Fresh A.pdf')); });
    expect(await screen.findByRole('link', { name: 'Fresh A.pdf' })).toBeInTheDocument();
    expect(h.invoice.mock.calls.map(call => call[0])).toEqual(['A', 'B', 'A']);
  });

  it('does not reuse an ambiguous colon-joined project/account context', async () => {
    h.params.projectId = 'A:B'; h.auth.currentUser = { uid: 'C' };
    const committed: string[] = [];
    const Observe = () => {
      useLayoutEffect(() => { committed.push(document.body.textContent ?? ''); });
      return <ReceivedPhotosGallery />;
    };
    const view = render(<Observe />);
    emit(cats(item('private')));
    await screen.findByRole('img', { name: 'Item private' });
    h.params.projectId = 'A'; h.auth.currentUser = { uid: 'B:C' };
    view.rerender(<Observe />);
    expect(committed.at(-1)).not.toContain('Item private');
    expect(committed.at(-1)).toContain('Loading...');
  });

  it('hides prior project and account content in the committed render before passive effects run', async () => {
    const committed: string[] = [];
    const Observe = () => {
      useLayoutEffect(() => { committed.push(document.body.textContent ?? ''); });
      return <ReceivedPhotosGallery />;
    };
    const view = render(<Observe />);
    emit(cats(item('a1')));
    expect(await screen.findByRole('img', { name: 'Item a1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('img', { name: 'Item a1' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    h.params.projectId = 'B';
    view.rerender(<Observe />);
    expect(committed.at(-1)).toContain('Loading...');
    expect(committed.at(-1)).not.toContain('Item a1');
    expect(committed.at(-1)).not.toContain('a1.jpg');

    emit(cats(item('b1')));
    expect(await screen.findByRole('img', { name: 'Item b1' })).toBeInTheDocument();
    act(() => latest().fail(readFailure('access', 'You do not have access to this project.')));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    h.auth.currentUser = { uid: 'bob' };
    view.rerender(<Observe />);
    expect(committed.at(-1)).toContain('Loading...');
    expect(committed.at(-1)).not.toContain('You do not have access');
    expect(committed.at(-1)).not.toContain('Item b1');
  });

  it('keeps only the newest snapshot invoices when an older lookup finishes later', async () => {
    const older = deferred<unknown>(), newer = deferred<unknown>();
    h.invoice.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1'))); emit(cats(item('m1')));
    await act(async () => { newer.resolve(invoiceDoc('inv-m1', 'Newer.pdf')); });
    await act(async () => { older.resolve(invoiceDoc('inv-m1', 'Older.pdf')); });
    expect(await screen.findByRole('link', { name: 'Newer.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Older.pdf' })).toBeNull();
  });

  it('clears the prior invoice immediately on a new snapshot and does not revive it after newer data omits it', async () => {
    const stale = deferred<unknown>(), latestLookup = deferred<unknown>();
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('link', { name: 'inv-m1.pdf' })).toBeInTheDocument();

    h.invoice.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latestLookup.promise);
    emit(cats(item('m1')));
    expect(screen.queryByRole('link', { name: 'inv-m1.pdf' })).toBeNull();
    emit(cats(item('m1')));
    await act(async () => { latestLookup.resolve(undefined); });
    await act(async () => { stale.resolve(invoiceDoc('inv-m1', 'Stale invoice.pdf')); });

    expect(screen.queryByRole('link', { name: /invoice\.pdf/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Item m1' })).toBeInTheDocument();
  });

  it('clears photos, invoices and the open image when the account changes and ignores later results', async () => {
    const late = deferred<unknown>();
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('link', { name: 'inv-m1.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('img', { name: 'Item m1' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    h.invoice.mockReturnValue(late.promise);
    emit(cats(item('m1'), item('m2')));
    act(() => h.authListener!({ uid: 'alice' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    h.auth.currentUser = { uid: 'bob' };
    act(() => h.authListener!({ uid: 'bob' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('img', { name: 'Item m1' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'inv-m1.pdf' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/account changed/i);
    await act(async () => { late.resolve(invoiceDoc('late', 'Late.pdf')); });
    emit(cats(item('m9')));
    expect(screen.queryByRole('link', { name: 'Late.pdf' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Item m9' })).toBeNull();
  });

  it('detects an account change that arrives before the auth listener fires, when a late result returns', async () => {
    const late = deferred<unknown>(); h.invoice.mockReturnValue(late.promise);
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    h.auth.currentUser = { uid: 'bob' };
    await act(async () => { late.resolve(invoiceDoc('late', 'Late.pdf')); });
    expect(screen.queryByRole('link', { name: 'Late.pdf' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Item m1' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/account changed/i);
  });

  it('clears everything on a denied invoice lookup, shows a plain error, and Try again re-reads', async () => {
    h.invoice.mockRejectedValueOnce(readFailure('access', 'You do not have access to this project.'));
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this project.');
    expect(screen.queryByRole('img', { name: 'Item m1' })).toBeNull();
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(h.documents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.subscribe).toHaveBeenCalledTimes(2);
    expect(h.subs[0].unsubscribe).toHaveBeenCalledOnce();
    emit(cats(item('m1')));
    expect(await screen.findByRole('link', { name: 'inv-m1.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a generic message instead of internals for unexpected failures', async () => {
    h.invoice.mockRejectedValueOnce(new Error('internal stack detail xyz'));
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.queryByText(/xyz/)).toBeNull();
  });

  it('shows an error rather than an endless spinner when the BOM listener fails, and recovers on a later snapshot', async () => {
    render(<ReceivedPhotosGallery />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    act(() => latest().fail(readFailure('paused', 'Project reads are paused.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Project reads are paused.');
    expect(screen.queryByText('Loading...')).toBeNull();
    emit(cats(item('m1')));
    expect(await screen.findByRole('img', { name: 'Item m1' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('requires a signed-in account before subscribing or reading anything', async () => {
    h.auth.currentUser = null;
    render(<ReceivedPhotosGallery />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in/i);
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.invoice).not.toHaveBeenCalled();
    expect(h.documents).not.toHaveBeenCalled();
  });

  it('closes the full-size image when its item is no longer visible and releases listeners on unmount', async () => {
    const view = render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    fireEvent.click(await screen.findByRole('img', { name: 'Item m1' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    emit(cats(item('m2')));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    view.unmount();
    expect(latest().unsubscribe).toHaveBeenCalledOnce();
    expect(h.authUnsubscribe).toHaveBeenCalledOnce();
  });
});

describe('scoped reads off', () => {
  it('keeps the original single document-list read, never uses the scoped invoice lookup or watches auth', async () => {
    h.documents.mockResolvedValue([invoiceDoc('inv-m1', 'Legacy invoice.pdf')]);
    render(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    expect(await screen.findByRole('link', { name: 'Legacy invoice.pdf' })).toBeInTheDocument();
    expect(h.documents).toHaveBeenCalledTimes(1);
    expect(h.invoice).not.toHaveBeenCalled();
    expect(h.authListener).toBeNull();
  });

  it('still shows an error instead of an endless spinner when the BOM listener reports a failure', async () => {
    render(<ReceivedPhotosGallery />);
    act(() => latest().fail(readFailure('request_failed', 'Project data is temporarily unavailable. Try again.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Project data is temporarily unavailable. Try again.');
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('ignores a document list that arrives after leaving the project', async () => {
    const late = deferred<unknown[]>(); h.documents.mockReturnValue(late.promise);
    const view = render(<ReceivedPhotosGallery />);
    const stale = latest(); emit(cats(item('m1')), stale);
    h.params.projectId = 'B'; h.documents.mockResolvedValue([]); view.rerender(<ReceivedPhotosGallery />);
    emit(cats(item('m1')));
    await act(async () => { late.resolve([invoiceDoc('inv-m1', 'Old project invoice.pdf')]); });
    expect(screen.queryByRole('link', { name: 'Old project invoice.pdf' })).toBeNull();
  });
});
