/** Read access never enables writes. Native lifecycle actions require the scoped read
 * rollout and both existing native edit gates to be enabled independently. */
export const isNativeProjectLifecycleEnabled = (env: Record<string, string | undefined> = import.meta.env): boolean =>
  env.VITE_BOM_SCOPED_READS_ENABLED === 'true'
  && env.VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED === 'true'
  && env.VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED === 'true';

export const canUseNativeProjectLifecycle = (input: {
  scopedReads: boolean;
  nativeEdits: boolean;
  partner: boolean;
  internalOrAdmin: boolean;
}): { edit: boolean; archive: boolean; restore: boolean; create: boolean } => {
  const enabled = input.scopedReads && input.nativeEdits;
  return {
    edit: enabled && !input.partner,
    archive: enabled && !input.partner,
    restore: enabled && !input.partner,
    create: enabled && input.internalOrAdmin,
  };
};
