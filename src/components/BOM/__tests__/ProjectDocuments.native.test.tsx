import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProjectDocuments from '../ProjectDocuments';

const mocks = vi.hoisted(() => ({
  currentUid: 'u1' as string | null,
  toast: vi.fn(),
  getProjectDocuments: vi.fn(),
  uploadProjectDocument: vi.fn(),
  deleteProjectDocument: vi.fn(),
  linkDocumentToBOMItems: vi.fn(),
}));

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/utils/projectDocumentFirestore', () => ({
  uploadProjectDocument: mocks.uploadProjectDocument,
  getProjectDocuments: mocks.getProjectDocuments,
  deleteProjectDocument: mocks.deleteProjectDocument,
  linkDocumentToBOMItems: mocks.linkDocumentToBOMItems,
  getPendingProjectDocumentOperations:()=>({uploads:[],deletions:[]}),
}));
vi.mock('@/firebase', () => ({ auth: { get currentUser() { return mocks.currentUid ? { uid: mocks.currentUid } : null; } } }));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div role="dialog">
        <button type="button" onClick={() => onOpenChange(false)}>Dismiss dialog</button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, disabled, onCheckedChange }: any) => (
    <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}));

const ITEMS: any[] = [
  { id: 'a', name: 'Item A', category: 'Mech', quantity: 1 },
  { id: 'b', name: 'Item B', category: 'Mech', quantity: 2 },
  { id: 'c', name: 'Item C', category: 'Elec', quantity: 3 },
];
const quoteDoc = (linked: string[] = ['a', 'b']): any => ({
  id: 'doc-1', name: 'quote.pdf', type: 'vendor-quote', url: 'http://x/quote.pdf',
  uploadedAt: new Date('2026-01-01'), linkedBOMItems: linked,
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const setup = (props: Record<string, unknown> = {}, docs: any[] = [quoteDoc()]) => {
  mocks.getProjectDocuments.mockResolvedValue(docs);
  const onSaveDocumentLinks = vi.fn().mockResolvedValue(undefined);
  const onBOMItemUpdate = vi.fn().mockResolvedValue(undefined);
  const all = {
    projectId: 'P1', bomItems: ITEMS, fullPage: true, sections: [{ type: 'vendor-quote', label: 'Vendor Quotes', description: '' }],
    awaitConfirmation: true, confirmationContext: 'ctx-1', onSaveDocumentLinks, onBOMItemUpdate, ...props,
  };
  const view = render(<ProjectDocuments {...(all as any)} />);
  return { ...view, all, onSaveDocumentLinks, onBOMItemUpdate, rerenderWith: (next: Record<string, unknown>) => view.rerender(<ProjectDocuments {...({ ...all, ...next } as any)} />) };
};

const openDialog = async () => {
  await flush();
  fireEvent.click(screen.getByTitle('Link to BOM items'));
};
const check = (name: string) => fireEvent.click(screen.getByLabelText(new RegExp(name)));
const save = () => fireEvent.click(screen.getByRole('button', { name: /Save Links|Saving/ }));

describe('ProjectDocuments link saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUid = 'u1';
    mocks.linkDocumentToBOMItems.mockResolvedValue(undefined);
  });

  describe('native (awaitConfirmation)', () => {
    it('sends exactly one awaited callback with deltas from the opening links and does no direct writes', async () => {
      const { onSaveDocumentLinks, onBOMItemUpdate } = setup();
      await openDialog();
      check('Item B'); // unlink b
      check('Item C'); // link c
      save();
      await flush();

      expect(onSaveDocumentLinks).toHaveBeenCalledTimes(1);
      expect(onSaveDocumentLinks).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), ['c'], ['b']);
      expect(mocks.linkDocumentToBOMItems).not.toHaveBeenCalled();
      expect(onBOMItemUpdate).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
    });

    it('does not report success or close until the callback resolves, and blocks duplicate/cancel/draft controls', async () => {
      const d = deferred<void>();
      const { onSaveDocumentLinks } = setup();
      onSaveDocumentLinks.mockReturnValueOnce(d.promise);
      await openDialog();
      check('Item C');
      save();
      await flush();

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.toast).not.toHaveBeenCalled();
      const saveBtn = screen.getByRole('button', { name: /Saving/ }) as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText(/Item A/) as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(saveBtn);
      fireEvent.click(screen.getByText('Dismiss dialog'));
      expect(onSaveDocumentLinks).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog')).toBeTruthy();

      await act(async () => { d.resolve(); await d.promise; });
      await flush();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
    });

    it('keeps the dialog and selection on failure and allows retry', async () => {
      const { onSaveDocumentLinks } = setup();
      onSaveDocumentLinks.mockRejectedValueOnce(new Error('backend said no'));
      await openDialog();
      check('Item C');
      save();
      await flush();

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect((screen.getByLabelText(/Item C/) as HTMLInputElement).checked).toBe(true);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'backend said no' }));
      expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));

      save();
      await flush();
      expect(onSaveDocumentLinks).toHaveBeenCalledTimes(2);
      expect(onSaveDocumentLinks).toHaveBeenLastCalledWith(expect.anything(), ['c'], []);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not pretend success when the callback is missing', async () => {
      const { onBOMItemUpdate } = setup({ onSaveDocumentLinks: undefined });
      await openDialog();
      check('Item C');
      save();
      await flush();

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
      expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
      expect(mocks.linkDocumentToBOMItems).not.toHaveBeenCalled();
      expect(onBOMItemUpdate).not.toHaveBeenCalled();
    });

    it('closes without calling the callback when nothing changed', async () => {
      const { onSaveDocumentLinks } = setup();
      await openDialog();
      save();
      await flush();
      expect(onSaveDocumentLinks).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('refuses to save when the account changed after the dialog opened', async () => {
      const { onSaveDocumentLinks } = setup();
      await openDialog();
      check('Item C');
      mocks.currentUid = 'u2';
      save();
      await flush();

      expect(onSaveDocumentLinks).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    });

    it('ignores a late result from an old context and discards the dialog', async () => {
      const d = deferred<void>();
      const { onSaveDocumentLinks, rerenderWith } = setup();
      onSaveDocumentLinks.mockReturnValueOnce(d.promise);
      await openDialog();
      check('Item C');
      save();
      await flush();

      rerenderWith({ confirmationContext: 'ctx-2' });
      await flush();
      expect(screen.queryByRole('dialog')).toBeNull();

      mocks.toast.mockClear();
      await act(async () => { d.resolve(); await d.promise; });
      await flush();
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('ignores a late failure from an old context', async () => {
      const d = deferred<void>();
      const { onSaveDocumentLinks, rerenderWith } = setup();
      onSaveDocumentLinks.mockReturnValueOnce(d.promise);
      await openDialog();
      check('Item C');
      save();
      await flush();

      rerenderWith({ confirmationContext: 'ctx-2' });
      await flush();
      await act(async () => { d.reject(new Error('late')); await d.promise.catch(() => undefined); });
      await flush();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('lets a new dialog opened after a context change save normally while an old save is still pending', async () => {
      const d = deferred<void>();
      const { onSaveDocumentLinks, rerenderWith } = setup();
      onSaveDocumentLinks.mockReturnValueOnce(d.promise);
      await openDialog();
      check('Item C');
      save();
      await flush();
      rerenderWith({ confirmationContext: 'ctx-2' });
      await flush();

      fireEvent.click(screen.getByTitle('Link to BOM items'));
      expect((screen.getByRole('button', { name: /Save Links/ }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByLabelText(/Item C/) as HTMLInputElement).checked).toBe(false);
    });
  });

  describe('legacy (default)', () => {
    it('keeps writing links directly and looping item fields', async () => {
      const { onSaveDocumentLinks, onBOMItemUpdate } = setup({ awaitConfirmation: false, confirmationContext: undefined });
      await openDialog();
      check('Item B'); // unlink
      check('Item C'); // link
      save();
      await flush();

      expect(mocks.linkDocumentToBOMItems).toHaveBeenCalledWith('doc-1', ['a', 'c']);
      expect(onBOMItemUpdate).toHaveBeenCalledWith('a', { linkedQuoteDocumentId: 'doc-1' });
      expect(onBOMItemUpdate).toHaveBeenCalledWith('c', { linkedQuoteDocumentId: 'doc-1' });
      expect(onBOMItemUpdate).toHaveBeenCalledWith('b', { linkedQuoteDocumentId: undefined });
      expect(onSaveDocumentLinks).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

it('captures the document baseline when links open before selections or save', async () => {
  const opening = vi.fn(); setup({ onDocumentLinkOpen: opening }); await openDialog();
  expect(opening).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
});
