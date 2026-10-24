import { nativeProjectDocumentsEnabled } from '@/utils/projectDocumentMode';

export const procurementDocumentUploadUnavailable = () =>
  import.meta.env.VITE_BOM_SCOPED_READS_ENABLED === 'true' && !nativeProjectDocumentsEnabled();

export const procurementDocumentUploadUnavailableMessage =
  'New document uploads are unavailable while scoped reads are active and native document edits are not enabled. Finish any saved upload request below.';
