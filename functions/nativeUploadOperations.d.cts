export type NativeReceiptPhotoRequest = {
  project_id: string;
  item_id: string;
  operation_id: string;
  expected_actor_uid: string;
} & ({ operation: 'reserve'; content_type: 'image/jpeg'; byte_size: number; sha256: string } | { operation: 'finalize' });
export type NativeReceiptPhotoResult =
  | { ok: false; error: string }
  | { ok: true; path: string; operation_id: string; expires_at: string }
  | { ok: true; path: string; photo_url: string; generation: string };
export function createNativeUploadOperations(dependencies: {
  db: any;
  auth: any;
  bucket: any;
  enabled?: boolean | (() => boolean);
  getServerTimestamp: () => unknown;
  now?: () => Date;
}): (request: { data: NativeReceiptPhotoRequest; auth?: { uid: string }; rawRequest?: unknown }) => Promise<NativeReceiptPhotoResult>;
export const MAX_PHOTO_BYTES: number;
export const UPLOAD_TTL_MS: number;
