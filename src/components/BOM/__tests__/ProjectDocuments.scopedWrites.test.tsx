import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectDocuments from '../ProjectDocuments';

// Real document module and recovery strip; only the SDKs, the read client and the material command client are faked.
const h = vi.hoisted(() => ({
  uid: 'alice', toast: vi.fn(), materialOn: false, submit: vi.fn(),
  getDocs: vi.fn(), addDoc: vi.fn(), deleteDoc: vi.fn(), updateDoc: vi.fn(),
  uploadBytes: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn(), documents: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, storage: {}, auth: { get currentUser() { return h.uid ? { uid: h.uid } : null; } } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('firebase/firestore', () => ({
  collection: () => 'col', addDoc: h.addDoc, query: (...a: unknown[]) => ({ q: a }), where: (...a: unknown[]) => a,
  getDocs: h.getDocs, deleteDoc: h.deleteDoc, doc: () => 'docref', updateDoc: h.updateDoc,
  Timestamp: { now: () => ({ toDate: () => new Date(0) }) },
}));
vi.mock('firebase/storage', () => ({ ref: () => 'sref', uploadBytes: h.uploadBytes, getDownloadURL: h.getDownloadURL, deleteObject: h.deleteObject }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => h.materialOn, submitNativeMaterialCommand: h.submit }));
vi.mock('@/utils/nativeProjectReads', () => ({ nativeProjectReads: { documents: h.documents, galleryInvoice: vi.fn(), get: vi.fn(), list: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, disabled, onCheckedChange }: any) => <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onCheckedChange(e.target.checked)} />,
}));

const opening = { project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', document_version: '3:3' };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'D', projectId: 'P', name: 'quote.pdf', url: 'https://files.example/quote?token=t', type: 'vendor-quote',
  uploadedAt: '2026-10-19T10:20:30.000Z', uploadedBy: 'bob', linkedBOMItems: ['a', 'hidden'], fileSize: 12, nativeOpening: opening, ...over,
});
const scopedPage = (documents: unknown[]) => ({ project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', documents, next_cursor: null });
const ITEMS: any[] = [
  { id: 'a', name: 'Item A', category: 'Mech', quantity: 1 },
  { id: 'b', name: 'Item B', category: 'Mech', quantity: 2 },
];
const props = { projectId: 'P', bomItems: ITEMS, fullPage: true, sections: [{ type: 'vendor-quote', label: 'Vendor Quotes', description: '' }] } as any;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const sdkEffects = () => [h.uploadBytes, h.addDoc, h.deleteDoc, h.deleteObject, h.updateDoc];

beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks(); sessionStorage.clear();
  h.uid = 'alice'; h.materialOn = false;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  h.documents.mockResolvedValue(scopedPage([row()]));
  h.getDocs.mockResolvedValue({ docs: [] });
});

describe('scoped reads on, document edits off', () => {
  beforeEach(() => vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true'));

  it('shows the authorized rows and disables upload before any SDK effect', async () => {
    const view = render(<ProjectDocuments {...props} />);
    await screen.findByText('quote.pdf');
    const input = view.container.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { files: [new File(['x'], 'n.pdf', { type: 'application/pdf' })] } });
    expect(h.toast).not.toHaveBeenCalled();
    sdkEffects().forEach(effect => expect(effect).not.toHaveBeenCalled());
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('disables delete before any SDK effect and keeps the row', async () => {
    render(<ProjectDocuments {...props} />);
    const deleteButton = await screen.findByTitle('Delete document') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(h.toast).not.toHaveBeenCalled();
    sdkEffects().forEach(effect => expect(effect).not.toHaveBeenCalled());
    expect(screen.getByText('quote.pdf')).toBeTruthy();
  });

  it('keeps a saved native upload recoverable and the strip enabled while the edit switch is closed', async () => {
    sessionStorage.setItem('bom-project-document:v1:alice:P:vendor-quote', '{}');
    render(<ProjectDocuments {...props} />);
    await screen.findByText('quote.pdf');
    const check = await screen.findByRole('button', { name: /Check saved Vendor Quote Upload/i });
    expect((check as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Cancel Vendor Quote Upload/i })).toBeTruthy();
  });

  it('keeps a saved deletion recoverable and does not give the SDK a delete', async () => {
    sessionStorage.setItem('bom-project-document-delete:v1:alice:P:D', '{}');
    render(<ProjectDocuments {...props} />);
    await screen.findByText('quote.pdf');
    expect(await screen.findByRole('button', { name: /Retry Deletion of quote\.pdf/i })).toBeTruthy();
    sdkEffects().forEach(effect => expect(effect).not.toHaveBeenCalled());
  });

  it('disables link entry when native material commands are also off', async () => {
    render(<ProjectDocuments {...props} />);
    const linkButton = await screen.findByTitle('Link to BOM items') as HTMLButtonElement;
    expect(linkButton.disabled).toBe(true);
    fireEvent.click(linkButton);
    expect(h.updateDoc).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('versioned material link command with hidden linked items', () => {
  beforeEach(() => { vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true'); h.materialOn = true; h.submit.mockResolvedValue({}); });

  it('sends only visible deltas against the displayed revision and leaves the hidden link untouched', async () => {
    render(<ProjectDocuments {...props} materialVersion="7:9" />);
    fireEvent.click(await screen.findByTitle('Link to BOM items'));
    fireEvent.click(screen.getByLabelText(/Item B/));
    fireEvent.click(screen.getByRole('button', { name: /Save Links/ }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.submit).toHaveBeenCalledWith('P', { kind: 'link_document_delta', document_id: 'D', add_item_ids: ['b'], remove_item_ids: [] }, '7:9');
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('can unlink a visible item without touching the hidden one', async () => {
    render(<ProjectDocuments {...props} materialVersion="7:9" />);
    fireEvent.click(await screen.findByTitle('Link to BOM items'));
    fireEvent.click(screen.getByLabelText(/Item A/));
    fireEvent.click(screen.getByRole('button', { name: /Save Links/ }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.submit.mock.calls[0][1]).toEqual({ kind: 'link_document_delta', document_id: 'D', add_item_ids: [], remove_item_ids: ['a'] });
  });

  it('refuses without a loaded revision instead of sending an unversioned command', async () => {
    render(<ProjectDocuments {...props} materialVersion={null} />);
    fireEvent.click(await screen.findByTitle('Link to BOM items'));
    fireEvent.click(screen.getByLabelText(/Item B/));
    fireEvent.click(screen.getByRole('button', { name: /Save Links/ }));
    await flush();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/revision is still loading/), variant: 'destructive' }));
  });
});

describe('legacy coexistence with every switch off', () => {
  it('still uploads through the SDK path and refreshes the list', async () => {
    h.getDownloadURL.mockResolvedValue('https://legacy/url'); h.addDoc.mockResolvedValue({ id: 'L1' });
    h.getDocs.mockResolvedValue({ docs: [] });
    const view = render(<ProjectDocuments {...props} />);
    await flush();
    fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'n.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(h.addDoc).toHaveBeenCalledTimes(1));
    expect(h.uploadBytes).toHaveBeenCalledTimes(1);
    expect(h.documents).not.toHaveBeenCalled();
  });
});
