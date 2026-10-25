// Read enablement never grants writes. Scoped arrays must not reach legacy
// replacement helpers even when the separate native edit switch is off.
export const isScopedProjectReadEnabled = (): boolean =>
  import.meta.env.VITE_BOM_SCOPED_READS_ENABLED === 'true';
