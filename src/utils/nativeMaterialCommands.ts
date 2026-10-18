import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/firebase';

export type NativeMaterialCommand =
  | { kind: 'add_items'; items: Array<Record<string, unknown>>; initialize?: boolean }
  | { kind: 'delete_items'; item_ids: string[] }
  | { kind: 'patch_items'; updates: Array<{ item_id: string; patch: Record<string, unknown> }> }
  | { kind: 'category_state'; category: string; isExpanded: boolean }
  | { kind: 'move_category'; category: string; destination: string; remove_source?: boolean }
  | { kind: 'delete_category'; category: string }
  | { kind: 'link_document_delta'; document_id: string; add_item_ids: string[]; remove_item_ids: string[] };

type NativeResponse = Record<string, unknown>;
type Callable = (input: Record<string, unknown>) => Promise<{ data: NativeResponse }>;

const record = (value: unknown): value is NativeResponse => !!value && typeof value === 'object' && !Array.isArray(value);
const cleanUndefined = (value: unknown): unknown => Array.isArray(value)
  ? value.map(cleanUndefined)
  : record(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, cleanUndefined(item)]))
    : value;
const nativeMessages: Record<string, string> = {
  material_version_conflict: 'This BOM changed while you were editing it. Refresh the page and apply your change again. No changes were saved.',
  material_forbidden: 'You do not have access to change these BOM items.',
  project_forbidden: 'You no longer have access to this project. Refresh the page.',
  material_mutations_disabled: 'Native BOM editing is not enabled for this project yet.',
  material_category_not_found: 'This BOM category no longer exists. Refresh the page and try again.',
  material_not_found: 'This BOM item no longer exists. Refresh the page and try again.',
  nonempty_material_category: 'Move or delete the items in this category before deleting it.',
  received_quantity_conflict: 'The requested quantity conflicts with quantities already received. Refresh and review the BOM.',
};
const failure = (error: string) => Object.assign(new Error(nativeMessages[error] || error), { code: error });
const isVersion = (value: unknown): value is string => value === 'missing' || typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value);

export function createNativeMaterialCommandClient({
  uid,
  call,
  operationId = () => crypto.randomUUID(),
}: {
  uid: () => string | null | undefined;
  call: (input: Record<string, unknown>) => Promise<NativeResponse>;
  operationId?: () => string;
}) {
  return {
    async read(projectId: string) {
      const actorUid = uid();
      if (!actorUid) throw failure('Sign in again before opening this BOM.');
      const snapshot = await call({ operation: 'get', project_id: projectId });
      if (!record(snapshot) || snapshot.ok !== true || snapshot.project_id !== projectId || !isVersion(snapshot.version)
        || !Array.isArray(snapshot.categories) || !record(snapshot.permissions) || typeof snapshot.permissions.command !== 'boolean') {
        throw failure(record(snapshot) && typeof snapshot.error === 'string' ? snapshot.error : 'Native BOM editing is unavailable for this project.');
      }
      if (uid() !== actorUid) throw failure('The signed-in account changed. Reopen this BOM before continuing.');
      return { actorUid, version: snapshot.version, categories: snapshot.categories, canCommand: snapshot.permissions.command };
    },
    async snapshot(projectId: string) {
      const snapshot = await this.read(projectId);
      if (!snapshot.canCommand) throw failure('You do not have permission to edit this BOM.');
      return { actorUid: snapshot.actorUid, version: snapshot.version };
    },
    async submit(projectId: string, command: NativeMaterialCommand, displayedVersion?: string) {
      const { actorUid, version: currentVersion } = await this.snapshot(projectId);
      const version = displayedVersion ?? currentVersion;
      if (!isVersion(version)) throw failure('The displayed BOM version is unavailable. Refresh the page and try again.');
      const id = operationId();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw failure('Unable to create a safe BOM operation ID.');
      const result = await call({
        operation: 'command', project_id: projectId, expected_version: version,
        expected_actor_uid: actorUid, operation_id: id, command: cleanUndefined(command),
      });
      if (!record(result) || result.ok !== true || result.project_id !== projectId || result.operation_id !== id) {
        throw failure(record(result) && typeof result.error === 'string' ? result.error : 'The BOM command returned an unexpected result.');
      }
      return result;
    },
    async fulfill(projectId: string, itemId: string, fulfillment: Record<string, unknown>, displayedVersion?: string) {
      const { actorUid, version: currentVersion } = await this.snapshot(projectId);
      const version = displayedVersion ?? currentVersion;
      if (!isVersion(version)) throw failure('The displayed BOM version is unavailable. Refresh the page and try again.');
      const id = operationId();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw failure('Unable to create a safe BOM operation ID.');
      const result = await call({ operation: 'fulfill', project_id: projectId, item_id: itemId, expected_version: version, expected_actor_uid: actorUid, operation_id: id, fulfillment });
      if (!record(result) || result.ok !== true || result.project_id !== projectId || result.operation_id !== id) {
        throw failure(record(result) && typeof result.error === 'string' ? result.error : 'The BOM fulfillment returned an unexpected result.');
      }
      return result;
    },
  };
}

const callable: Callable = async input => {
  const response = await httpsCallable<Record<string, unknown>, NativeResponse>(functions, 'nativeMaterialOperations')(input);
  return { data: response.data };
};
const nativeClient = createNativeMaterialCommandClient({
  uid: () => auth.currentUser?.uid,
  call: async input => (await callable(input)).data,
});
export const loadNativeMaterialSnapshot = (projectId: string) => nativeClient.read(projectId);

// Both app and server gates remain default-off. Once enabled, failures are surfaced to the user;
// this function never retries or falls back to a whole-array Firestore write.
export const isNativeMaterialCommandEnabled = () => import.meta.env.VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED === 'true';
export const submitNativeMaterialCommand = (projectId: string, command: NativeMaterialCommand, displayedVersion?: string) => {
  if (!isNativeMaterialCommandEnabled()) throw failure('Native BOM editing is not enabled.');
  return nativeClient.submit(projectId, command, displayedVersion);
};
export const submitNativeMaterialFulfillment = (projectId: string, itemId: string, fulfillment: Record<string, unknown>, displayedVersion?: string) => {
  if (!isNativeMaterialCommandEnabled()) throw failure('Native BOM editing is not enabled.');
  return nativeClient.fulfill(projectId, itemId, fulfillment, displayedVersion);
};
