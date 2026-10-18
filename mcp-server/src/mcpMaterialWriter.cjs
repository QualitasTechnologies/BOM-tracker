// Guarded MCP add-item writer: one Firestore transaction, exact revision, replayable receipt, protected audit.
const { createHash } = require('node:crypto');
let commands;
try { commands = require('./materialCommands.cjs'); } catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  commands = require('../../functions/materialCommands.cjs');
}
const { validateCommand, applyCommand, assertDocumentBudget } = commands;

const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const NONCE = /^[a-zA-Z0-9_-]{1,128}$/;
const VERSION = /^\d{1,15}:\d{1,9}$/;
const ALLOWED = ['project_id', 'category', 'name', 'description', 'quantity', 'price', 'make', 'sku', 'item_type', 'expected_version', 'operation_id'];
const REQUIRED = ['project_id', 'category', 'name', 'description', 'quantity', 'expected_version', 'operation_id'];
const LIMITS = { category: 500, name: 500, description: 4000, make: 500, sku: 500 };
const MODES = ['coexist', 'pulse_only', 'read_only'];

function validateInput(input) {
  if (!plain(input)) throw fault('invalid_mcp_input');
  if (Object.keys(input).some(key => !ALLOWED.includes(key)) || REQUIRED.some(key => !Object.hasOwn(input, key))) throw fault('invalid_mcp_input');
  const { project_id, operation_id, expected_version, quantity, price, item_type = 'component' } = input;
  if (typeof project_id !== 'string' || !project_id.trim() || project_id.length > 512 || /[\/\x00-\x1f]/.test(project_id) || ['.', '..'].includes(project_id) || /^__.*__$/.test(project_id)) throw fault('invalid_mcp_input');
  if (typeof operation_id !== 'string' || !NONCE.test(operation_id)) throw fault('invalid_mcp_input');
  if (typeof expected_version !== 'string' || !VERSION.test(expected_version)) throw fault('invalid_mcp_input');
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = input[key];
    if (value === undefined && !['category', 'name', 'description'].includes(key)) continue;
    if (typeof value !== 'string' || value.length > max || ['category', 'name', 'description'].includes(key) && !value.trim()) throw fault('invalid_mcp_input');
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) throw fault('invalid_mcp_input');
  if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) throw fault('invalid_mcp_input');
  if (price !== undefined && !Number.isFinite(price * quantity)) throw fault('invalid_mcp_input');
  if (!['component', 'service'].includes(item_type)) throw fault('invalid_mcp_input');
}

// Key-sorted JSON so retries hash identically regardless of property order.
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const hashInput = input => createHash('sha256').update(stable(input)).digest('hex');

function versionOf(snapshot) {
  const time = snapshot.updateTime;
  if (!time || !Number.isSafeInteger(time.seconds) || !Number.isSafeInteger(time.nanoseconds)) throw fault('bom_version_unavailable', 409);
  return `${time.seconds}:${time.nanoseconds}`;
}

function assertMode(snapshot) {
  if (!snapshot.exists) return 'coexist';
  const data = snapshot.data();
  if (!plain(data) || typeof data.mode !== 'string' || !MODES.includes(data.mode)) throw fault('runtime_control_invalid', 503);
  return data.mode;
}

function validateBomUser(user) {
  if (!plain(user) || typeof user.uid !== 'string' || !user.uid.trim() || user.uid.length > 128
    || typeof user.status !== 'string' || typeof user.role !== 'string'
    || user.email !== undefined && (typeof user.email !== 'string' || user.email.length > 320)
    || typeof user.disabled !== 'boolean') throw fault('mcp_principal_unavailable', 403);
  if (user.disabled) throw fault('mcp_user_disabled', 403);
  if (user.status !== 'approved') throw fault('mcp_user_unapproved', 403);
  return { uid: user.uid, status: user.status, role: user.role, disabled: user.disabled, ...(user.email ? { email: user.email } : {}) };
}

function projectScope(project, user) {
  if (user.role === 'admin') return null;
  if (!Array.isArray(project.memberIds) || !project.memberIds.includes(user.uid)) throw fault('project_forbidden', 403);
  if (user.email?.trim().toLowerCase().endsWith('@qualitastech.com')) return null;
  const member = (Array.isArray(project.members) ? project.members : []).find(row => row?.userId === user.uid);
  return Array.isArray(member?.categoryScope) ? member.categoryScope : [];
}

function createMcpMaterialWriter({ db, resolveBomUser, getServerTimestamp }) {
  async function addItem(input, authInfo) {
    validateInput(input);
    const inputHash = hashInput(input);
    let user;
    try {
      if (typeof resolveBomUser !== 'function') throw fault('mcp_principal_unavailable', 403);
      user = validateBomUser(await resolveBomUser(authInfo));
    } catch (error) {
      if (['mcp_principal_unavailable', 'mcp_user_disabled', 'mcp_user_unapproved'].includes(error?.code)) throw error;
      throw fault('mcp_principal_unavailable', 403);
    }

    const { project_id: projectId, operation_id: nonce, expected_version: expected } = input;
    const projectRef = db.collection('projects').doc(projectId);
    const bomRef = projectRef.collection('bom').doc('data');
    const receiptRef = db.collection('pulseMcpOperations').doc(projectId).collection('receipts').doc(nonce);
    const auditRef = db.collection('pulseMcpOperations').doc(projectId).collection('audit').doc(nonce);
    const controlRef = db.collection('pulseRuntimeControl').doc('cutover');

    return db.runTransaction(async tx => {
      const [project, bom, receipt, control] = await Promise.all([tx.get(projectRef), tx.get(bomRef), tx.get(receiptRef), tx.get(controlRef)]);
      const mode = assertMode(control);
      if (!project.exists) throw fault('project_not_found', 404);
      const projectData = project.data();
      if (!plain(projectData)) throw fault('project_forbidden', 403);
      const scope = projectScope(projectData, user);
      if (receipt.exists) {
        const stored = receipt.data();
        if (!plain(stored) || stored.principalId !== user.uid || stored.inputHash !== inputHash || !plain(stored.result)) throw fault('operation_id_conflict', 409);
        if (scope !== null && !scope.includes(stored.result.category)) throw fault('material_forbidden', 403);
        return { ...stored.result, replayed: true };
      }
      if (mode === 'read_only') throw fault('mcp_writes_disabled', 403);
      if (!bom.exists) throw fault('bom_not_found', 404);
      if (versionOf(bom) !== expected) throw fault('stale_bom_version', 409);
      const bomData = bom.data();
      if (!plain(bomData) || !Array.isArray(bomData.categories)) throw fault('invalid_material_state', 409);

      const names = bomData.categories.map(category => category?.name);
      const wanted = input.category.toLowerCase();
      const matches = names.filter(name => typeof name === 'string' && name.toLowerCase() === wanted);
      // The original tool takes the first case-insensitive match, even when a
      // later category happens to be an exact-case match.
      const resolved = matches[0];
      if (!resolved) throw fault('material_category_not_found', 404);

      const itemId = `mcp-${createHash('sha256').update(JSON.stringify([projectId, nonce])).digest('hex')}`;
      const item = { id: itemId, name: input.name, description: input.description, itemType: input.item_type ?? 'component', category: resolved, quantity: input.quantity };
      if (input.price !== undefined) item.price = input.price;
      if (input.make) item.make = input.make;
      if (input.sku) item.sku = input.sku;
      const command = validateCommand({ kind: 'add_items', items: [item] });
      const applied = applyCommand({ categories: bomData.categories, command, scope, canonical: names });

      const result = { item_id: item.id, category: resolved, project_id: projectId, operation_id: nonce, name: item.name, quantity: item.quantity, ...(item.price !== undefined ? { price: item.price } : {}) };
      const actor = { type: 'firebase-user', subject: user.uid, uid: user.uid, ...(user.email ? { email: user.email } : {}) };
      const loggedAt = getServerTimestamp();
      const receiptData = { operationId: nonce, projectId, principalId: user.uid, inputHash, result, createdAt: loggedAt };
      const auditData = { action: 'mcp_add_item', channel: 'mcp-server', projectId, operationId: nonce, actor, expectedVersion: expected, inputHash, before: applied.before, after: applied.after, loggedAt };
      const bomUpdate = { categories: applied.categories };
      assertDocumentBudget([
        { data: { ...bomData, ...bomUpdate }, path: bomRef.path },
        { data: receiptData, path: receiptRef.path },
        { data: auditData, path: auditRef.path }
      ]);
      tx.update(bomRef, bomUpdate);
      tx.create(auditRef, auditData);
      tx.create(receiptRef, receiptData);
      return { ...result, replayed: false };
    });
  }
  return { addItem };
}

module.exports = { createMcpMaterialWriter };
