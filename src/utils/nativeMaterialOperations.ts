// Native Firebase client for the `nativeMaterialOperations` callable.
// Transport only: callers carry the displayed expected_version and a stable operation_id,
// and a failure is never retried or replayed through a direct Firestore write.

export const NATIVE_MATERIAL_PATCH_FIELDS = ['name', 'description', 'make', 'sku', 'unit', 'quantity', 'price', 'itemType', 'category', 'finalizedVendor'] as const;
export type NativeMaterialPatchField = (typeof NATIVE_MATERIAL_PATCH_FIELDS)[number];
export const NATIVE_MATERIAL_COMMAND_MAX_ITEMS = 200;

const TEXT_FIELDS: readonly string[] = ['name', 'description', 'make', 'sku', 'unit', 'category'];
const NUMBER_FIELDS: readonly string[] = ['quantity', 'price'];

export type NativeMaterialPatch = Partial<Record<'name' | 'description' | 'make' | 'sku' | 'unit' | 'category', string>> & {
  quantity?: number;
  price?: number | null;
  itemType?: 'component' | 'service';
  finalizedVendor?: { name: string; price?: number; leadTime?: string; availability?: string } | null;
};

export interface NativeMaterialPatchInput {
  item_id: string;
  expected_version: string;
  operation_id: string;
  patch: NativeMaterialPatch;
}

export interface NativeMaterialFulfillmentInput {
  item_id: string;
  expected_version: string;
  operation_id: string;
  fulfillment: { kind: 'receipt' | 'fulfillment'; quantity: number; invoiceDocId?: string; photoUrl?: string; loggedAt?: string };
}

export type NativeMaterialVendor = { name: string; price: number; leadTime: string; availability: string };
export type NativeMaterialCommandPatch = Omit<NativeMaterialPatch, 'make' | 'sku' | 'unit'> & {
  make?: string | null; sku?: string | null; unit?: string | null;
  vendors?: NativeMaterialVendor[];
  status?: 'not-ordered' | 'ordered' | 'received'; order?: number | null;
  orderDate?: string | null; expectedArrival?: string | null; expectedDelivery?: string | null;
  poNumber?: string | null; thumbnailUrl?: string | null; specificationUrl?: string | null;
  linkedSpecDocumentId?: string | null; linkedQuoteDocumentId?: string | null; linkedPODocumentId?: string | null;
};
export type NativeMaterialNewItem = {
  id: string; itemType: 'component' | 'service'; name: string; description: string; category: string; quantity: number;
  make?: string; sku?: string; unit?: string; price?: number; vendors?: NativeMaterialVendor[];
  status?: 'not-ordered'; order?: number; poNumber?: string; thumbnailUrl?: string; specificationUrl?: string;
};
export type NativeMaterialCommand =
  | { kind: 'add_items'; items: NativeMaterialNewItem[]; initialize?: boolean }
  | { kind: 'delete_items'; item_ids: string[] }
  | { kind: 'patch_items'; updates: { item_id: string; patch: NativeMaterialCommandPatch }[] }
  | { kind: 'category_state'; category: string; isExpanded: boolean }
  | { kind: 'move_category'; category: string; destination: string; remove_source?: boolean }
  | { kind: 'delete_category'; category: string }
  | { kind: 'link_document'; document_id: string; item_ids: string[]; action: 'add' | 'remove' }
  | { kind: 'link_document_delta'; document_id: string; add_item_ids: string[]; remove_item_ids: string[] };
export interface NativeMaterialCommandInput { expected_version: string; operation_id: string; command: NativeMaterialCommand }
export interface NativeMaterialCommandResult { ok: true; project_id: string; operation_id: string; command_kind: NativeMaterialCommand['kind'] }

export interface NativeMaterialGetResult {
  ok: true;
  project_id: string;
  categories: unknown[];
  version: string;
  permissions: { review: true; edit: boolean; command?: boolean };
}

export interface NativeMaterialPatchResult {
  ok: true;
  project_id: string;
  item_id: string;
  operation_id: string;
  item: Record<string, unknown>;
}

export interface NativeMaterialUser {
  uid: string;
  isAnonymous?: boolean;
}

export interface NativeMaterialOperationsDeps {
  getCurrentUser: () => NativeMaterialUser | null | Promise<NativeMaterialUser | null>;
  callable: (payload: Record<string, unknown>) => Promise<{ data: unknown }>;
}

export interface NativeProjectMetadata {
  projectName: string; clientName: string; description: string;
  status: 'Planning' | 'Procurement' | 'Ongoing' | 'Delayed' | 'Completed' | 'Archived';
  deadline: string; poValue: number; clientId?: string; billingEntityId?: string;
}

export interface NativeMaterialOperationsClient {
  createProject: (projectId: string, input: { operation_id: string; project: NativeProjectMetadata }, expectedUid: string) => Promise<{ ok: true; project_id: string; operation_id: string }>;
  get: (projectId: string) => Promise<NativeMaterialGetResult>;
  patch: (projectId: string, input: NativeMaterialPatchInput, expectedUid?: string) => Promise<NativeMaterialPatchResult>;
  currentUid?: () => Promise<string>;
  fulfill: (projectId: string, input: NativeMaterialFulfillmentInput, expectedUid?: string) => Promise<NativeMaterialPatchResult>;
  command: (projectId: string, input: NativeMaterialCommandInput, expectedUid: string) => Promise<NativeMaterialCommandResult>;
}

export class NativeMaterialError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeMaterialError';
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_ID_MAX = 512;
const SAFE_PROVIDER_CODE = /^[a-z0-9]+(?:[/_-][a-z0-9]+)*$/;
const ERROR_MESSAGE_MAX = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isVersion = (value: unknown): value is string => value === 'missing' || typeof value === 'string'
  && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;

const invalidInput = (what: string) => new NativeMaterialError('native-material/invalid-input', `Invalid ${what}`);
const invalidResponse = () => new NativeMaterialError('native-material/invalid-response', 'Unexpected response from the material service');

const requireProjectId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > PROJECT_ID_MAX || value.includes('/')) throw invalidInput('project id');
  return value;
};

const requireId = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || (what === 'item id'
    ? !value || value.length > 512 || value.includes('/') : !ID_PATTERN.test(value))) throw invalidInput(what);
  return value;
};

const requirePatch = (value: unknown): NativeMaterialPatch => {
  if (!isRecord(value)) throw invalidInput('patch');
  const keys = Object.keys(value);
  if (!keys.length) throw invalidInput('patch');
  const clean: Record<string, unknown> = {};
  for (const key of keys) {
    const field = value[key];
    const textLimits: Record<string, number> = { name: 500, description: 4000, make: 500, sku: 500, unit: 100, category: 500 };
    if (key === 'price' && field === null || key === 'finalizedVendor' && field === null) clean[key] = null;
    else if (key === 'itemType' && (field === 'component' || field === 'service')) clean[key] = field;
    else if (key === 'finalizedVendor' && isRecord(field)) {
      const vendor = Object.fromEntries(Object.entries(field).filter(([, value]) => value !== undefined));
      if (Object.keys(vendor).some(key => !['name', 'price', 'leadTime', 'availability'].includes(key))
        || typeof vendor.name !== 'string' || !vendor.name.trim() || vendor.name.length > 500
        || 'price' in vendor && (typeof vendor.price !== 'number' || !Number.isFinite(vendor.price) || vendor.price < 0)
        || ['leadTime', 'availability'].some(key => key in vendor && (typeof vendor[key] !== 'string' || (vendor[key] as string).length > 500))) throw invalidInput('vendor');
      clean[key] = vendor;
    }
    else if (TEXT_FIELDS.includes(key) && typeof field === 'string' && field.length <= textLimits[key] && (!['name', 'category'].includes(key) || field.trim())) clean[key] = field;
    else if (NUMBER_FIELDS.includes(key) && typeof field === 'number' && Number.isFinite(field) && (key === 'quantity' ? field > 0 : field >= 0)) clean[key] = field;
    else throw invalidInput('patch field');
  }
  return clean as NativeMaterialPatch;
};

const requireUid = async (deps: NativeMaterialOperationsDeps): Promise<string> => {
  const user = await deps.getCurrentUser();
  if (!user || typeof user.uid !== 'string' || !user.uid || user.isAnonymous) {
    throw new NativeMaterialError('native-material/unauthenticated', 'Sign in to use material operations');
  }
  return user.uid;
};

const commandFault = () => invalidInput('material command');
const commandId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\/\x00-\x1f]/.test(value) || value === '.' || value === '..' || /^__.*__$/.test(value)) throw commandFault();
  return value;
};
const commandText = (value: unknown, max = 500, required = false) => {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw commandFault();
};
const commandList = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || !value.length || value.length > NATIVE_MATERIAL_COMMAND_MAX_ITEMS) throw commandFault();
  return value;
};
const commandIds = (value: unknown) => {
  const ids = commandList(value).map(commandId);
  if (new Set(ids).size !== ids.length) throw commandFault();
};
const commandUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 4096) throw commandFault();
  let url: URL;
  try { url = new URL(value); } catch { throw commandFault(); }
  if (url.protocol !== 'https:' || url.username || url.password) throw commandFault();
};
const commandVendors = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 200) throw commandFault();
  for (const vendor of value) {
    if (!isRecord(vendor) || Object.keys(vendor).some(key => !['name', 'price', 'leadTime', 'availability'].includes(key))) throw commandFault();
    commandText(vendor.name, 500, true); commandText(vendor.leadTime); commandText(vendor.availability);
    if (typeof vendor.price !== 'number' || !Number.isFinite(vendor.price) || vendor.price < 0) throw commandFault();
  }
};
const commandPatch = (value: unknown) => {
  if (!isRecord(value) || !Object.keys(value).length) throw commandFault();
  const nullable = ['make', 'sku', 'unit', 'price', 'finalizedVendor', 'order', 'orderDate', 'expectedArrival', 'expectedDelivery', 'poNumber', 'thumbnailUrl', 'specificationUrl', 'linkedSpecDocumentId', 'linkedQuoteDocumentId', 'linkedPODocumentId'];
  for (const [key, field] of Object.entries(value)) {
    if (field === null && nullable.includes(key)) continue;
    if (NATIVE_MATERIAL_PATCH_FIELDS.includes(key as NativeMaterialPatchField)) { requirePatch({ [key]: field }); continue; }
    if (key === 'vendors') commandVendors(field);
    else if (key === 'status') { if (!['not-ordered', 'ordered', 'received'].includes(String(field)) || typeof field !== 'string') throw commandFault(); }
    else if (key === 'order') { if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) throw commandFault(); }
    else if (['orderDate', 'expectedArrival', 'expectedDelivery'].includes(key)) {
      if (typeof field !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(field) || !Number.isFinite(Date.parse(field)) || new Date(field).toISOString().slice(0, 10) !== field) throw commandFault();
    } else if (key === 'poNumber') commandText(field);
    else if (['thumbnailUrl', 'specificationUrl'].includes(key)) commandUrl(field);
    else if (['linkedSpecDocumentId', 'linkedQuoteDocumentId', 'linkedPODocumentId'].includes(key)) commandId(field);
    else throw commandFault();
  }
};
const requireCommand = (value: unknown): NativeMaterialCommand => {
  if (!isRecord(value) || typeof value.kind !== 'string') throw commandFault();
  const allowed: Record<string, string[]> = {
    add_items: ['kind', 'items', 'initialize'], delete_items: ['kind', 'item_ids'], patch_items: ['kind', 'updates'],
    category_state: ['kind', 'category', 'isExpanded'], move_category: ['kind', 'category', 'destination', 'remove_source'],
    delete_category: ['kind', 'category'], link_document: ['kind', 'document_id', 'item_ids', 'action'],
    link_document_delta: ['kind', 'document_id', 'add_item_ids', 'remove_item_ids'],
  };
  if (!Object.prototype.hasOwnProperty.call(allowed, value.kind)) throw commandFault();
  const allowedFields = allowed[value.kind as keyof typeof allowed];
  if (Object.keys(value).some(key => !allowedFields.includes(key))) throw commandFault();
  if (value.kind === 'add_items') {
    const items = commandList(value.items);
    if (value.initialize !== undefined && typeof value.initialize !== 'boolean') throw commandFault();
    const ids = items.map(item => {
      if (!isRecord(item) || Object.keys(item).some(key => !['id', 'itemType', 'name', 'description', 'category', 'quantity', 'make', 'sku', 'unit', 'price', 'vendors', 'status', 'order', 'poNumber', 'thumbnailUrl', 'specificationUrl'].includes(key))) throw commandFault();
      const id = commandId(item.id);
      if (!['component', 'service'].includes(String(item.itemType)) || typeof item.itemType !== 'string') throw commandFault();
      commandText(item.name, 500, true); commandText(item.description, 4000); commandText(item.category, 500, true);
      if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.itemType === 'service' && item.quantity < 0.5) throw commandFault();
      for (const [key, field] of Object.entries(item)) {
        if (['id', 'itemType', 'name', 'description', 'category', 'quantity'].includes(key)) continue;
        if (key === 'status') { if (field !== 'not-ordered') throw commandFault(); }
        else { if (field === null) throw commandFault(); commandPatch({ [key]: field }); }
      }
      return id;
    });
    if (new Set(ids).size !== ids.length) throw commandFault();
  } else if (value.kind === 'delete_items' || value.kind === 'link_document') {
    commandIds(value.item_ids);
    if (value.kind === 'link_document') { commandId(value.document_id); if (value.action !== 'add' && value.action !== 'remove') throw commandFault(); }
  } else if (value.kind === 'link_document_delta') {
    commandId(value.document_id);
    if (!Array.isArray(value.add_item_ids) || !Array.isArray(value.remove_item_ids)) throw commandFault();
    // The combined list validates both uniqueness and overlap, with the same cap.
    commandIds([...value.add_item_ids, ...value.remove_item_ids]);
  } else if (value.kind === 'patch_items') {
    const ids = commandList(value.updates).map(update => {
      if (!isRecord(update) || Object.keys(update).some(key => !['item_id', 'patch'].includes(key))) throw commandFault();
      const id = commandId(update.item_id); commandPatch(update.patch); return id;
    });
    if (new Set(ids).size !== ids.length) throw commandFault();
  } else {
    commandText(value.category, 500, true);
    if (value.kind === 'category_state' && typeof value.isExpanded !== 'boolean') throw commandFault();
    if (value.kind === 'move_category') {
      commandText(value.destination, 500, true);
      if (value.destination === value.category || value.remove_source !== undefined && typeof value.remove_source !== 'boolean') throw commandFault();
    }
  }
  return value as NativeMaterialCommand;
};

const requireFulfillment = (value: unknown): NativeMaterialFulfillmentInput['fulfillment'] => {
  if (!isRecord(value) || Object.keys(value).some(key => !['kind', 'quantity', 'invoiceDocId', 'photoUrl', 'loggedAt'].includes(key))
    || !['receipt', 'fulfillment'].includes(String(value.kind)) || typeof value.quantity !== 'number'
    || !Number.isFinite(value.quantity) || value.quantity <= 0) throw invalidInput('fulfillment');
  if (value.kind === 'receipt' && (!Number.isSafeInteger(value.quantity) || value.quantity < 1 || !value.invoiceDocId || !value.photoUrl || !value.loggedAt)) throw invalidInput('receipt');
  if (value.invoiceDocId !== undefined && (typeof value.invoiceDocId !== 'string' || !value.invoiceDocId.trim() || value.invoiceDocId.length > 512 || value.invoiceDocId.includes('/'))) throw invalidInput('invoice');
  if (value.loggedAt !== undefined && (typeof value.loggedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.loggedAt)
    || !Number.isFinite(Date.parse(value.loggedAt)) || new Date(value.loggedAt).toISOString().slice(0, 10) !== value.loggedAt)) throw invalidInput('receipt date');
  if (value.photoUrl !== undefined) {
    if (typeof value.photoUrl !== 'string' || value.photoUrl.length > 8192) throw invalidInput('receipt photo');
    let url: URL;
    try { url = new URL(value.photoUrl); } catch { throw invalidInput('receipt photo'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw invalidInput('receipt photo');
  }
  return { ...value } as NativeMaterialFulfillmentInput['fulfillment'];
};

const providerCode = (error: unknown): string => {
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === 'string' && code.length <= 64 && SAFE_PROVIDER_CODE.test(code) ? code : 'native-material/request-failed';
};

const run = async (deps: NativeMaterialOperationsDeps, payload: Record<string, unknown>, expectedUid?: string): Promise<unknown> => {
  const uid = await requireUid(deps);
  if (expectedUid !== undefined && uid !== expectedUid) throw new NativeMaterialError('native-material/identity-changed', 'The signed-in account changed; reopen before continuing');
  let data: unknown;
  let failure: unknown;
  let failed = false;
  try {
    data = (await deps.callable(payload)).data;
  } catch (error) {
    failed = true;
    failure = error;
  }
  // The account may have switched or been revoked while the call was in flight.
  const current = await deps.getCurrentUser();
  if (!current || current.uid !== uid) {
    throw new NativeMaterialError('native-material/identity-changed', 'The signed-in account changed; reload before continuing');
  }
  if (failed) {
    const message = failure instanceof Error && failure.message ? failure.message.slice(0, ERROR_MESSAGE_MAX) : 'Material request failed';
    throw new NativeMaterialError(providerCode(failure), message);
  }
  if (isRecord(data) && data.ok === false && typeof data.error === 'string' && data.error.trim()) {
    if (data.error.length > 64 || !SAFE_PROVIDER_CODE.test(data.error)) throw invalidResponse();
    throw new NativeMaterialError(data.error, data.error);
  }
  return data;
};

export const createNativeMaterialOperationsClient = (deps: NativeMaterialOperationsDeps): NativeMaterialOperationsClient => ({
  async createProject(projectId, input, expectedUid) {
    const project_id = requireProjectId(projectId);
    if (!isRecord(input) || Object.keys(input).some(key => !['operation_id', 'project'].includes(key))) throw invalidInput('creation request');
    const operation_id = requireId(input.operation_id, 'operation id');
    const project = input.project;
    if (!isRecord(project) || Object.keys(project).some(key => !['projectName', 'clientName', 'description', 'status', 'deadline', 'poValue', 'clientId', 'billingEntityId'].includes(key))
      || typeof project.projectName !== 'string' || !project.projectName.trim() || project.projectName.length > 500
      || typeof project.clientName !== 'string' || !project.clientName.trim() || project.clientName.length > 500
      || typeof project.description !== 'string' || project.description.length > 4000
      || !['Planning', 'Procurement', 'Ongoing', 'Delayed', 'Completed', 'Archived'].some(status => status === project.status)
      || typeof project.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(project.deadline) || !Number.isFinite(Date.parse(project.deadline)) || new Date(project.deadline).toISOString().slice(0, 10) !== project.deadline
      || typeof project.poValue !== 'number' || !Number.isFinite(project.poValue) || project.poValue < 0
      || ['clientId', 'billingEntityId'].some(key => Object.prototype.hasOwnProperty.call(project, key) && (typeof project[key] !== 'string' || !project[key].trim() || project[key].length > 512 || /[\/\x00-\x1f]/.test(project[key])))
      || typeof expectedUid !== 'string' || !expectedUid || expectedUid.length > 128) throw invalidInput('project metadata');
    const data = await run(deps, { operation: 'create_project', project_id, operation_id, project: { ...project }, expected_actor_uid: expectedUid }, expectedUid);
    if (!isRecord(data) || data.ok !== true || data.project_id !== project_id || data.operation_id !== operation_id) throw invalidResponse();
    return { ok: true, project_id, operation_id };
  },
  currentUid: () => requireUid(deps),
  async get(projectId) {
    const project_id = requireProjectId(projectId);
    const data = await run(deps, { operation: 'get', project_id });
    if (!isRecord(data) || !isRecord(data.permissions)) throw invalidResponse();
    const permissions = data.permissions;
    const commandPermission = typeof permissions.command === 'boolean' ? permissions.command : undefined;
    if (data.ok !== true || data.project_id !== project_id || !Array.isArray(data.categories) || !isVersion(data.version) ||
      permissions.review !== true || typeof permissions.edit !== 'boolean' || permissions.command !== undefined && typeof permissions.command !== 'boolean'
    ) throw invalidResponse();
    return {
      ok: true,
      project_id,
      categories: data.categories,
      version: data.version,
      permissions: { review: true, edit: permissions.edit, ...(commandPermission !== undefined ? { command: commandPermission } : {}) },
    };
  },

  async patch(projectId, input, expectedUid) {
    const project_id = requireProjectId(projectId);
    if (!isRecord(input)) throw invalidInput('patch request');
    const item_id = requireId(input.item_id, 'item id');
    const operation_id = requireId(input.operation_id, 'operation id');
    if (!isVersion(input.expected_version)) throw invalidInput('expected version');
    const patch = requirePatch(input.patch);
    const expected_version = input.expected_version;
    if (expectedUid !== undefined && (typeof expectedUid !== 'string' || !expectedUid || expectedUid.length > 128)) throw invalidInput('opening account');
    const data = await run(deps, { operation: 'patch', project_id, item_id, expected_version, operation_id, patch,
      ...(expectedUid !== undefined ? { expected_actor_uid: expectedUid } : {}) }, expectedUid);
    if (
      !isRecord(data) || data.ok !== true || data.project_id !== project_id || data.item_id !== item_id || data.operation_id !== operation_id ||
      !isRecord(data.item) || data.item.id !== item_id
    ) throw invalidResponse();
    return { ok: true, project_id, item_id, operation_id, item: data.item };
  },

  async fulfill(projectId, input, expectedUid) {
    const project_id = requireProjectId(projectId);
    if (!isRecord(input) || Object.keys(input).some(key => !['item_id', 'expected_version', 'operation_id', 'fulfillment'].includes(key))) throw invalidInput('fulfillment request');
    const item_id = requireId(input.item_id, 'item id');
    const operation_id = requireId(input.operation_id, 'operation id');
    if (!isVersion(input.expected_version)) throw invalidInput('expected version');
    const fulfillment = requireFulfillment(input.fulfillment);
    if (expectedUid !== undefined && (typeof expectedUid !== 'string' || !expectedUid || expectedUid.length > 128)) throw invalidInput('opening account');
    const data = await run(deps, { operation: 'fulfill', project_id, item_id, operation_id, expected_version: input.expected_version, fulfillment,
      ...(expectedUid !== undefined ? { expected_actor_uid: expectedUid } : {}) }, expectedUid);
    if (!isRecord(data) || data.ok !== true || data.project_id !== project_id || data.item_id !== item_id || data.operation_id !== operation_id
      || !isRecord(data.item) || data.item.id !== item_id) throw invalidResponse();
    return { ok: true, project_id, item_id, operation_id, item: data.item };
  },

  async command(projectId, input, expectedUid) {
    const project_id = requireProjectId(projectId);
    if (!isRecord(input) || Object.keys(input).some(key => !['expected_version', 'operation_id', 'command'].includes(key))) throw commandFault();
    if (!isVersion(input.expected_version)) throw invalidInput('expected version');
    const operation_id = requireId(input.operation_id, 'operation id');
    if (typeof expectedUid !== 'string' || !expectedUid || expectedUid.length > 128) throw invalidInput('opening account');
    const command = requireCommand(input.command);
    const payload = { operation: 'command', project_id, expected_version: input.expected_version, operation_id, command, expected_actor_uid: expectedUid };
    let json: string;
    try { json = JSON.stringify(payload); } catch { throw commandFault(); }
    if (new TextEncoder().encode(json).length > 256 * 1024) throw commandFault();
    const data = await run(deps, payload, expectedUid);
    if (!isRecord(data) || data.ok !== true || data.project_id !== project_id || data.operation_id !== operation_id || data.command_kind !== command.kind) throw invalidResponse();
    return { ok: true, project_id, operation_id, command_kind: command.kind };
  },
});

// Firebase is loaded lazily so importing this module never initializes the app (or analytics) on its own.
export const nativeMaterialOperations: NativeMaterialOperationsClient = createNativeMaterialOperationsClient({
  getCurrentUser: async () => (await import('@/firebase')).auth.currentUser,
  callable: async (payload) => {
    const [{ functions }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    return httpsCallable(functions, 'nativeMaterialOperations')(payload);
  },
});
