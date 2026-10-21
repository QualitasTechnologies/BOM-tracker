import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDoc, updateDoc } from 'firebase/firestore';
import { deleteBOMItem, updateBOMData, updateBOMItem } from '../projectFirestore';
import { linkDocumentToBOMItems } from '../projectDocumentFirestore';

const nativeSubmit = vi.hoisted(() => vi.fn());
const nativeMode = vi.hoisted(() => ({ enabled: true }));
vi.mock('../nativeMaterialCommands', () => ({
  isNativeMaterialCommandEnabled: () => nativeMode.enabled,
  submitNativeMaterialCommand: nativeSubmit,
}));

describe('native material write boundary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'false');
    nativeMode.enabled = true;
    vi.mocked(setDoc).mockClear();
    vi.mocked(updateDoc).mockClear();
    nativeSubmit.mockReset().mockRejectedValue(Object.assign(new Error('This BOM changed while you were editing it.'), { code: 'material_version_conflict' }));
  });

  it('blocks whole-array replacement while native writes are enabled', async () => {
    await expect(updateBOMData('P', [])).rejects.toThrow(/Whole-BOM replacement is disabled/);
    expect(setDoc).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it('blocks the separate legacy document link helper while native material writes are enabled', async () => {
    await expect(linkDocumentToBOMItems('invoice', ['motor'])).rejects.toThrow(/versioned|native|BOM/i);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it('preserves the legacy document link helper when native material writes are disabled', async () => {
    nativeMode.enabled = false;
    await linkDocumentToBOMItems('invoice', ['motor']);
    expect(updateDoc).toHaveBeenCalledOnce();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it('scoped reads cannot fall back to replacement arrays when native edits are disabled', async () => {
    nativeMode.enabled = false;
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    await expect(updateBOMData('P', [])).rejects.toThrow(/versioned|native|BOM/i);
    await expect(linkDocumentToBOMItems('invoice', ['motor'])).rejects.toThrow(/versioned|native|BOM/i);
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it('does not fall back to a whole-array write after native patch or delete fails', async () => {
    const categories = [{ name: 'Mech', items: [{ id: 'motor', name: 'Motor', quantity: 1 }] }] as any;
    await expect(updateBOMItem('P', categories, 'motor', { quantity: 2 }, '7:3')).rejects.toMatchObject({ code: 'material_version_conflict' });
    await expect(deleteBOMItem('P', categories, 'motor', '7:3')).rejects.toMatchObject({ code: 'material_version_conflict' });
    expect(nativeSubmit).toHaveBeenNthCalledWith(1, 'P', { kind: 'patch_items', updates: [{ item_id: 'motor', patch: { quantity: 2 } }] }, '7:3');
    expect(nativeSubmit).toHaveBeenNthCalledWith(2, 'P', { kind: 'delete_items', item_ids: ['motor'] }, '7:3');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('clears invoice links through an explicit native patch', async () => {
    nativeSubmit.mockResolvedValue({ ok: true });
    const categories = [{ name: 'Mech', items: [{ id: 'motor', name: 'Motor', quantity: 1, linkedInvoiceDocumentId: 'invoice-1' }] }] as any;
    await updateBOMItem('P', categories, 'motor', { linkedInvoiceDocumentId: '' } as any, '7:3');
    expect(nativeSubmit).toHaveBeenCalledWith('P', { kind: 'patch_items', updates: [{ item_id: 'motor', patch: { linkedInvoiceDocumentId: null } }] }, '7:3');
    expect(setDoc).not.toHaveBeenCalled();
  });
});
