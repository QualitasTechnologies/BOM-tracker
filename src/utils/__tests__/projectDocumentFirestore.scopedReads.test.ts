import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  getDocs: vi.fn(), getDoc: vi.fn(), addDoc: vi.fn(), deleteDoc: vi.fn(), updateDoc: vi.fn(),
  uploadBytes: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn(),
  documents: vi.fn(), galleryInvoice: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, storage: {}, auth: h.auth }));
vi.mock('firebase/firestore', () => ({
  collection: () => 'col', addDoc: h.addDoc, query: (...a: unknown[]) => ({ q: a }), where: (...a: unknown[]) => a,
  getDocs: h.getDocs, getDoc: h.getDoc, deleteDoc: h.deleteDoc, doc: () => 'docref', updateDoc: h.updateDoc,
  Timestamp: { now: () => ({ toDate: () => new Date(0) }) },
}));
vi.mock('firebase/storage', () => ({ ref: () => 'sref', uploadBytes: h.uploadBytes, getDownloadURL: h.getDownloadURL, deleteObject: h.deleteObject }));
vi.mock('../nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => false }));
vi.mock('../nativeProjectReads', () => ({
  nativeProjectReads: { documents: h.documents, galleryInvoice: h.galleryInvoice, get: vi.fn(), list: vi.fn() },
}));
import * as svc from '../projectDocumentFirestore';

const opening = { project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', document_version: '3:3' };
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, projectId: 'P', name: `${id}.pdf`, url: `https://files.example/${id}?token=secret`, type: 'vendor-invoice',
  uploadedAt: '2026-10-19T10:20:30.000Z', uploadedBy: 'bob', linkedBOMItems: ['m1'], fileSize: 12, nativeOpening: opening, ...over,
});
const page = (documents: unknown[], next_cursor: string | null = null, over: Record<string, unknown> = {}) => ({
  project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', documents, next_cursor, ...over,
});
const failure = (code: string) => Object.assign(new Error(`read failed: ${code}`), { code });
const file = () => new File(['abc'], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.unstubAllEnvs();
  Object.values(h).forEach(value => { if (typeof value === 'function') (value as ReturnType<typeof vi.fn>).mockReset(); });
  h.auth.currentUser = { uid: 'alice' };
  h.getDocs.mockResolvedValue({ docs: [] });
  h.documents.mockResolvedValue(page([]));
});
const scoped = () => vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');

describe('scoped document reads with the edit switch off', () => {
  it('reads strictly through the native client with the captured account and converts the ISO date explicitly', async () => {
    scoped(); vi.stubEnv('VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'false');
    const pulse = { operation_id: 'o', path: 'p', generation: '1' };
    h.documents.mockResolvedValue(page([row('A', { sourceUrl: 'https://src.example/a', pulseNativeDocument: pulse }), row('B', { uploadedAt: null }), row('C', { uploadedAt: undefined })]));
    const documents = await svc.getProjectDocuments('P');
    expect(h.getDocs).not.toHaveBeenCalled();
    expect(h.documents).toHaveBeenCalledTimes(1);
    const [projectId, options, uid, assertContext] = h.documents.mock.calls[0];
    expect([projectId, uid]).toEqual(['P', 'alice']);
    expect(options).toEqual({ limit: 100 });
    expect(typeof assertContext).toBe('function');
    expect(documents[0]).toEqual({ ...row('A', { sourceUrl: 'https://src.example/a', pulseNativeDocument: pulse }), uploadedAt: new Date('2026-10-19T10:20:30.000Z') });
    expect(documents[0].uploadedAt).toBeInstanceOf(Date);
    expect((documents[0] as any).nativeOpening).toEqual(opening);
    expect(documents[0].url).toBe('https://files.example/A?token=secret');
    expect(documents[1].uploadedAt).toEqual(new Date(0));
    expect(documents[2].uploadedAt).toEqual(new Date(0));
  });

  it('rejects an unparseable upload date instead of inventing one', async () => {
    scoped(); h.documents.mockResolvedValue(page([row('A', { uploadedAt: 'not a date' })]));
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/integrity|invalid|date/i);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('exhausts opaque pagination including an empty filtered page that still has a cursor', async () => {
    scoped();
    h.documents
      .mockResolvedValueOnce(page([row('A')], 'cursor-1'))
      .mockResolvedValueOnce(page([], 'cursor-2'))
      .mockResolvedValueOnce(page([row('B')], null));
    expect((await svc.getProjectDocuments('P')).map(d => d.id)).toEqual(['A', 'B']);
    expect(h.documents.mock.calls.map(call => call[1])).toEqual([{ limit: 100 }, { limit: 100, cursor: 'cursor-1' }, { limit: 100, cursor: 'cursor-2' }]);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('rejects a repeated cursor, duplicate ids across pages, and never falls back to the SDK', async () => {
    scoped();
    h.documents.mockResolvedValueOnce(page([row('A')], 'c1')).mockResolvedValueOnce(page([row('B')], 'c1')).mockResolvedValueOnce(page([row('C')], 'c1'));
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/cursor|repeat|integrity/i);
    h.documents.mockReset();
    h.documents.mockResolvedValueOnce(page([row('A')], 'c1')).mockResolvedValueOnce(page([row('A')], null));
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/duplicate|integrity/i);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('restarts a bounded number of times when the project or BOM revision changes between pages, then fails closed', async () => {
    scoped();
    h.documents
      .mockResolvedValueOnce(page([row('A')], 'c1'))
      .mockResolvedValueOnce(page([row('B')], null, { bom_version: '9:9' }))
      .mockResolvedValueOnce(page([row('A')], 'c1', { bom_version: '9:9' }))
      .mockResolvedValueOnce(page([row('B')], null, { bom_version: '9:9' }));
    expect((await svc.getProjectDocuments('P')).map(d => d.id)).toEqual(['A', 'B']);
    h.documents.mockReset();
    let n = 0;
    h.documents.mockImplementation(async () => page([row(`D${n}`)], 'next-' + n, { bom_version: `${n++}:0` }));
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/changed|refresh|try again/i);
    expect(h.documents.mock.calls.length).toBeLessThan(20);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('getProjectDocumentsByType filters the same strict read and never uses the typed SDK query', async () => {
    scoped();
    h.documents.mockResolvedValue(page([row('A', { type: 'vendor-quote' }), row('B', { type: 'spec-sheet' })]));
    expect((await svc.getProjectDocumentsByType('P', 'spec-sheet')).map(d => d.id)).toEqual(['B']);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it.each(['access', 'paused', 'integrity', 'request_failed', 'sign_in_required', 'identity_changed'])('a %s failure is surfaced with no raw SDK fallback', async code => {
    scoped(); h.documents.mockRejectedValue(failure(code));
    await expect(svc.getProjectDocuments('P')).rejects.toMatchObject({ code });
    await expect(svc.getProjectDocumentsByType('P', 'spec-sheet')).rejects.toMatchObject({ code });
    await expect(svc.getDocumentsForBOMItem('P', 'm1')).rejects.toMatchObject({ code });
    expect(h.getDocs).not.toHaveBeenCalled();
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('passes a context guard derived from the request options and the captured account', async () => {
    scoped(); let current = true;
    await svc.getProjectDocuments('P', { isCurrent: () => current });
    const assertContext = h.documents.mock.calls[0][3] as () => void;
    expect(() => assertContext()).not.toThrow();
    current = false;
    expect(() => assertContext()).toThrow(/account|project|changed/i);
    current = true;
    expect(() => assertContext()).not.toThrow();
    h.auth.currentUser = { uid: 'bob' };
    expect(() => assertContext()).toThrow(/account|project|changed/i);
  });

  it('discards a result when the account or request context changes during a page request', async () => {
    scoped();
    h.documents.mockImplementation(async () => { h.auth.currentUser = { uid: 'bob' }; return page([row('A')]); });
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/account|project|changed/i);
    h.auth.currentUser = { uid: 'alice' }; let current = true;
    h.documents.mockImplementation(async () => { current = false; return page([row('A')]); });
    await expect(svc.getProjectDocumentsByType('P', 'vendor-invoice', { isCurrent: () => current })).rejects.toThrow(/account|project|changed/i);
    h.documents.mockReset();
    h.documents.mockImplementationOnce(async () => page([row('A')], 'c1')).mockImplementationOnce(async () => { h.auth.currentUser = { uid: 'bob' }; return page([row('B')]); });
    h.auth.currentUser = { uid: 'alice' };
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/account|project|changed/i);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('requires a signed-in account before any request', async () => {
    scoped(); h.auth.currentUser = null;
    await expect(svc.getProjectDocuments('P')).rejects.toThrow(/sign in/i);
    expect(h.documents).not.toHaveBeenCalled();
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('keeps the raw legacy read untouched when the scoped gate is off', async () => {
    const when = { toDate: () => new Date(5) };
    h.getDocs.mockResolvedValue({ docs: [{ id: 'L', data: () => ({ projectId: 'P', name: 'x', url: 'u', type: 'spec-sheet', uploadedAt: when, uploadedBy: 'u', linkedBOMItems: ['i'] }) }] });
    expect((await svc.getProjectDocuments('P'))[0]).toMatchObject({ id: 'L', uploadedAt: new Date(5), linkedBOMItems: ['i'] });
    expect((await svc.getProjectDocumentsByType('P', 'spec-sheet'))[0].id).toBe('L');
    expect(h.documents).not.toHaveBeenCalled();
  });
});

describe('getReceivedPhotoInvoice', () => {
  const invoice = (over: Record<string, unknown> = {}) => row('inv', { linkedBOMItems: [], ...over });
  const reply = (document: unknown) => ({ project_id: 'P', actor_uid: 'alice', project_version: '1:1', bom_version: '2:2', document });

  it('uses the strict gallery lookup, keeps an invoice whose own link array is empty and converts the date', async () => {
    scoped(); h.galleryInvoice.mockResolvedValue(reply(invoice()));
    const result = await svc.getReceivedPhotoInvoice('P', 'motor');
    expect(result).toMatchObject({ id: 'inv', linkedBOMItems: [], url: 'https://files.example/inv?token=secret', uploadedAt: new Date('2026-10-19T10:20:30.000Z') });
    expect((result as any).nativeOpening).toEqual(opening);
    const [projectId, itemId, uid, assertContext] = h.galleryInvoice.mock.calls[0];
    expect([projectId, itemId, uid]).toEqual(['P', 'motor', 'alice']);
    expect(typeof assertContext).toBe('function');
    expect(h.getDocs).not.toHaveBeenCalled();
    expect(h.getDoc).not.toHaveBeenCalled();
    expect(h.documents).not.toHaveBeenCalled();
  });

  it('treats an unavailable invoice as absent but surfaces every other failure without a raw fallback', async () => {
    scoped(); h.galleryInvoice.mockRejectedValueOnce(failure('not_found'));
    expect(await svc.getReceivedPhotoInvoice('P', 'motor')).toBeUndefined();
    for (const code of ['access', 'paused', 'integrity', 'request_failed', 'sign_in_required', 'identity_changed']) {
      h.galleryInvoice.mockRejectedValueOnce(failure(code));
      await expect(svc.getReceivedPhotoInvoice('P', 'motor')).rejects.toMatchObject({ code });
    }
    expect(h.getDocs).not.toHaveBeenCalled();
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('captures the account before awaiting and rejects a late result after an account or context change', async () => {
    scoped();
    h.galleryInvoice.mockImplementation(async () => { h.auth.currentUser = { uid: 'bob' }; return reply(invoice()); });
    await expect(svc.getReceivedPhotoInvoice('P', 'motor')).rejects.toThrow(/account|project|changed/i);
    h.auth.currentUser = { uid: 'alice' }; let current = true;
    h.galleryInvoice.mockImplementation(async () => { current = false; return reply(invoice()); });
    await expect(svc.getReceivedPhotoInvoice('P', 'motor', { isCurrent: () => current })).rejects.toThrow(/account|project|changed/i);
    h.auth.currentUser = null;
    await expect(svc.getReceivedPhotoInvoice('P', 'motor')).rejects.toThrow(/sign in/i);
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('refuses to start when the request context is already stale', async () => {
    scoped(); h.galleryInvoice.mockResolvedValue(reply(invoice()));
    await expect(svc.getReceivedPhotoInvoice('P', 'motor', { isCurrent: () => false })).rejects.toThrow(/account|project|changed/i);
  });

  it('with scoped reads off keeps the original document-list behaviour and finds the item invoice by id', async () => {
    h.getDocs.mockResolvedValue({ docs: [{ id: 'inv', data: () => ({ projectId: 'P', name: 'inv.pdf', url: 'u', type: 'vendor-invoice', uploadedBy: 'u' }) }] });
    expect((await svc.getReceivedPhotoInvoice('P', 'motor', { invoiceDocumentId: 'inv' }))?.id).toBe('inv');
    expect(await svc.getReceivedPhotoInvoice('P', 'motor', { invoiceDocumentId: 'missing' })).toBeUndefined();
    expect(await svc.getReceivedPhotoInvoice('P', 'motor')).toBeUndefined();
    expect(h.galleryInvoice).not.toHaveBeenCalled();
  });
});

describe('legacy document writes lacking a paired versioned writer', () => {
  it.each([
    ['upload', () => svc.uploadProjectDocument(file(), 'P', 'vendor-quote', 'alice')],
    ['delete', () => svc.deleteProjectDocument('D', 'https://firebasestorage.googleapis.com/v0/b/b/o/projects%2FP%2Fdocuments%2Fx.pdf?alt=media&token=t')],
    ['link', () => svc.linkDocumentToBOMItems('D', ['i'])],
  ])('%s is refused before any Storage or Firestore side effect when scoped reads are on, even with edits off', async (_name, run) => {
    scoped(); vi.stubEnv('VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'false');
    await expect(run()).rejects.toThrow(/unavailable|versioned|native|BOM|reopen/i);
    for (const mock of [h.uploadBytes, h.getDownloadURL, h.addDoc, h.deleteObject, h.deleteDoc, h.updateDoc]) expect(mock).not.toHaveBeenCalled();
  });

  it('keeps upload and delete unchanged when scoped reads are off', async () => {
    h.getDownloadURL.mockResolvedValue('https://legacy/url'); h.addDoc.mockResolvedValue({ id: 'L1' });
    expect((await svc.uploadProjectDocument(file(), 'P', 'vendor-quote', 'alice')).id).toBe('L1');
    await svc.deleteProjectDocument('D', 'https://firebasestorage.googleapis.com/v0/b/b/o/projects%2FP%2Fdocuments%2Fx.pdf?alt=media&token=t');
    expect(h.uploadBytes).toHaveBeenCalledTimes(1); expect(h.addDoc).toHaveBeenCalledTimes(1);
    expect(h.deleteObject).toHaveBeenCalledTimes(1); expect(h.deleteDoc).toHaveBeenCalledTimes(1);
  });
});
