import { describe, expect, it } from 'vitest';
import { canUseNativeProjectLifecycle, isNativeProjectLifecycleEnabled } from '../projectLifecycleAccess';

describe('native project lifecycle access', () => {
  it('requires scoped reads and both existing native edit flags', () => {
    expect(isNativeProjectLifecycleEnabled({ VITE_BOM_SCOPED_READS_ENABLED: 'true' })).toBe(false);
    expect(isNativeProjectLifecycleEnabled({ VITE_BOM_SCOPED_READS_ENABLED: 'true', VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED: 'true' })).toBe(false);
    expect(isNativeProjectLifecycleEnabled({ VITE_BOM_SCOPED_READS_ENABLED: 'true', VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED: 'true', VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' })).toBe(true);
  });

  it('keeps partner lifecycle writes off and limits create to internal users', () => {
    const base = { scopedReads: true, nativeEdits: true };
    expect(canUseNativeProjectLifecycle({ ...base, partner: false, internalOrAdmin: false })).toEqual({ edit: true, archive: true, restore: true, create: false });
    expect(canUseNativeProjectLifecycle({ ...base, partner: true, internalOrAdmin: false })).toEqual({ edit: false, archive: false, restore: false, create: false });
  });

  it('never lets scoped reads alone turn writes on', () => {
    expect(canUseNativeProjectLifecycle({ scopedReads: true, nativeEdits: false, partner: false, internalOrAdmin: true })).toEqual({ edit: false, archive: false, restore: false, create: false });
  });
});
