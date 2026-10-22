import type { BOMTemplate } from '@/types/bom';
import { NativeMaterialError, type NativeMaterialCommandInput, type NativeMaterialOperationsClient, type NativeProjectMetadata } from './nativeMaterialOperations';

interface InitializationDeps {
  projectId: string;
  templateId?: string;
  client: NativeMaterialOperationsClient;
  project: NativeProjectMetadata;
  cachedUid?: string;
  getTemplate: (id: string) => Promise<Pick<BOMTemplate, 'id' | 'items'> | null>;
}

// This session survives dialog close and retains the exact request after an uncertain outcome.
// A captured baseline is never refreshed to attach a newer revision to the old template.
export const createProjectTemplateInitialization = (deps: InitializationDeps) => {
  let projectCreated = false;
  let creationAttempted = false;
  let openingUid: string | undefined;
  let baseline: string | undefined;
  let commandAllowed = false;
  let input: NativeMaterialCommandInput | undefined;
  let busy = false;
  let complete = false;
  const operationId = crypto.randomUUID();
  const creationInput = { operation_id: crypto.randomUUID(), project: Object.freeze(structuredClone(deps.project)) };
  const currentUid = async () => {
    if (!deps.client.currentUid) throw new Error('Cannot verify the signed-in account');
    return deps.client.currentUid();
  };
  const assertAccount = async () => {
    if (await currentUid() !== openingUid) throw new NativeMaterialError('native-material/identity-changed', 'The signed-in account changed; return to the account that created this project before retrying');
  };
  const apply = async () => {
    await assertAccount();
    if (baseline === undefined) {
      const snapshot = await deps.client.get(deps.projectId);
      await assertAccount();
      baseline = snapshot.version;
      commandAllowed = snapshot.permissions.command === true;
    }
    if (!commandAllowed) throw new Error('You do not have permission to apply this template. Review the created project');
    if (!input) {
      const template = await deps.getTemplate(deps.templateId);
      await assertAccount();
      if (!template || template.id !== deps.templateId || !Array.isArray(template.items) || !template.items.length) throw new Error('The selected template is missing or empty. Review the created project before retrying');
      const identities = new Set<string>();
      const items = await Promise.all(template.items.map(async item => {
        if (typeof item.id !== 'string' || !item.id || identities.has(item.id)) throw new Error('The selected template has invalid or duplicate item identities');
        identities.add(item.id);
        const identity = JSON.stringify([deps.projectId, deps.templateId, item.id]);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
        const id = 'template_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return {
          id, itemType: item.itemType, name: item.name, description: item.description,
          category: item.category, quantity: item.quantity,
          ...(item.price !== undefined ? { price: item.price } : {}),
          ...(item.make !== undefined ? { make: item.make } : {}),
          ...(item.sku !== undefined ? { sku: item.sku } : {}),
          status: 'not-ordered' as const, vendors: [],
        };
      }));
      await assertAccount();
      input = { expected_version: baseline, operation_id: operationId, command: { kind: 'add_items', initialize: true, items } };
    }
    await assertAccount();
    await deps.client.command(deps.projectId, input, openingUid!);
    await assertAccount();
    complete = true;
  };
  const run = async (creating: boolean) => {
    if (busy) throw new Error('Template initialization is already in progress');
    if (complete) return;
    busy = true;
    try {
      if (!projectCreated && (creating || creationAttempted)) {
        openingUid ??= await currentUid();
        if (deps.cachedUid !== undefined && deps.cachedUid !== openingUid) throw new Error('The signed-in account changed; reopen project creation before continuing');
        await assertAccount();
        creationAttempted = true;
        await deps.client.createProject(deps.projectId, creationInput, openingUid);
        projectCreated = true;
      }
      if (!projectCreated) throw new Error('Create the project before applying its template');
      if (!deps.templateId) { await assertAccount(); complete = true; return; }
      await apply();
    } finally { busy = false; }
  };
  return { get projectCreated() { return projectCreated; }, get creationAttempted() { return creationAttempted; }, start: () => run(true), retry: () => run(false) };
};
