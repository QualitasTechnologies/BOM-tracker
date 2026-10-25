import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { updateDoc } from 'firebase/firestore';
import { updateProject } from '../projectFirestore';

beforeEach(() => { vi.mocked(updateDoc).mockClear(); vi.stubEnv('VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED', 'false'); vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'false'); });
afterEach(() => vi.unstubAllEnvs());
it('blocks legacy whole-profile replacement under the paired Support writer', async () => {
  vi.stubEnv('VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED', 'true');
  await expect(updateProject('P', { supportProfile: { internalNotes: 'Unsafe replacement' } })).rejects.toThrow(/Reopen Support/);
  expect(updateDoc).not.toHaveBeenCalled();
});
it('read enablement alone cannot permit a projected Support profile to replace raw fields', async () => {
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
  await expect(updateProject('P', { supportProfile: { internalNotes: 'Partial' } })).rejects.toThrow(/Reopen Support/);
  expect(updateDoc).not.toHaveBeenCalled();
});
it('retains coexistence and does not route unrelated project patches into the Support writer', async () => {
  await updateProject('P', { supportProfile: { internalNotes: 'Original path' } });
  expect(updateDoc).toHaveBeenCalledOnce(); vi.mocked(updateDoc).mockClear();
  vi.stubEnv('VITE_BOM_NATIVE_SUPPORT_PROFILE_ENABLED', 'true');
  await updateProject('P', { description: 'Other metadata' }); expect(updateDoc).toHaveBeenCalledOnce();
});
