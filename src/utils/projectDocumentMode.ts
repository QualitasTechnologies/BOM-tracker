export const nativeProjectDocumentsEnabled = () =>
  import.meta.env.VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED === 'true'
  && import.meta.env.VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED === 'true';
