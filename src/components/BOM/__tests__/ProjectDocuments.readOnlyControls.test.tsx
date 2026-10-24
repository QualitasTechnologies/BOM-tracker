import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDocuments from '../ProjectDocuments';

const h = vi.hoisted(() => ({
  uid: 'alice', scopedReads: true, documentWrites: false,
  uploads: [] as string[], deletions: [] as string[],
  upload: vi.fn(), remove: vi.fn(), legacyLink: vi.fn(), saveLinks: vi.fn(), recover: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, storage: {}, auth: { get currentUser() { return { uid: h.uid }; } } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => h.scopedReads }));
vi.mock('@/utils/projectDocumentMode', () => ({ nativeProjectDocumentsEnabled: () => h.documentWrites }));
vi.mock('@/utils/nativeProjectDocumentUpload', () => ({ getPendingNativeProjectDocumentTypes: () => [] }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => false, submitNativeMaterialCommand: vi.fn() }));
vi.mock('@/utils/projectDocumentFirestore', () => ({
  getProjectDocuments: async () => [documentRow], uploadProjectDocument: (...args: unknown[]) => h.upload(...args),
  deleteProjectDocument: (...args: unknown[]) => h.remove(...args), linkDocumentToBOMItems: (...args: unknown[]) => h.legacyLink(...args),
  acknowledgeProjectDocumentUpload: vi.fn(), acknowledgeProjectDocumentDeletion: vi.fn(),
  getPendingProjectDocumentOperations: () => ({ uploads: h.uploads, deletions: h.deletions }),
  cancelProjectDocumentUpload: (...args: unknown[]) => h.recover(...args),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, disabled, onCheckedChange }: any) => <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onCheckedChange(e.target.checked)} />,
}));

const documentRow = {
  id: 'D', projectId: 'P', name: 'quote.pdf', url: 'https://files.example/quote', type: 'vendor-quote',
  uploadedAt: new Date('2026-10-19'), uploadedBy: 'bob', linkedBOMItems: ['a'],
  nativeOpening: { project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', document_version: '3:3' },
};
const props = {
  projectId: 'P', bomItems: [{ id: 'a', name: 'Item A', category: 'Mech' }], fullPage: true,
  sections: [{ type: 'vendor-quote', label: 'Vendor Quotes', description: '' }],
} as any;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  h.uid = 'alice'; h.scopedReads = true; h.documentWrites = false; h.uploads = []; h.deletions = [];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('scoped document controls', () => {
  it('disables new upload, delete and link controls before any write call when paired routes are off', async () => {
    const view = render(<ProjectDocuments {...props} />);
    await screen.findByText('quote.pdf');
    const upload = screen.getByLabelText('Upload Vendor Quotes') as HTMLInputElement;
    const remove = screen.getByTitle('Delete document') as HTMLButtonElement;
    const link = screen.getByTitle('Link to BOM items') as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(link.disabled).toBe(true);

    fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'new.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(remove);
    fireEvent.click(link);
    await flush();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.legacyLink).not.toHaveBeenCalled();
  });

  it('keeps saved request recovery controls enabled while new writes are off', async () => {
    h.uploads = ['vendor-quote']; h.deletions = ['D'];
    render(<ProjectDocuments {...props} />);
    await screen.findByText('quote.pdf');
    expect((await screen.findByRole('button', { name: /Check saved Vendor Quote Upload/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Cancel Vendor Quote Upload/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Retry Deletion of quote\.pdf/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('locks an open link form if its paired route closes, including forced submit events', async () => {
    const openContext = 'P:alice';
    const view = render(<ProjectDocuments {...props} awaitConfirmation confirmationContext={openContext} onSaveDocumentLinks={h.saveLinks} />);
    await screen.findByText('quote.pdf');
    fireEvent.click(screen.getByTitle('Link to BOM items'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    view.rerender(<ProjectDocuments {...props} awaitConfirmation={false} confirmationContext={openContext} onSaveDocumentLinks={h.saveLinks} />);
    await flush();
    expect(screen.getByRole('dialog')).toBeTruthy();
    const checkbox = screen.getByLabelText(/Item A/) as HTMLInputElement;
    const save = screen.getByRole('button', { name: /Save Links/i }) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    fireEvent.click(save);
    fireEvent.click(checkbox);
    await flush();
    expect(h.saveLinks).not.toHaveBeenCalled();
    expect(h.legacyLink).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});
