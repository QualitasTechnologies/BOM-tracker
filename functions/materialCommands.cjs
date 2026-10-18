// Bounded material commands. Pure validation/application; the caller owns all Firestore reads.
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const MAX_ITEMS = 200;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_DOCUMENT_BYTES = 900 * 1024;
const MAX_TRANSACTION_BYTES = 8 * 1024 * 1024;
const textLimits = { name: 500, description: 4000, make: 500, sku: 500, unit: 100, category: 500, poNumber: 500 };
const linkTypes = { linkedQuoteDocumentId: 'vendor-quote', linkedPODocumentId: 'vendor-po', linkedSpecDocumentId: 'spec-sheet', linkedInvoiceDocumentId: 'vendor-invoice' };
const typeFields = Object.fromEntries(Object.entries(linkTypes).map(([field, type]) => [type, field]));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const categoryName = value => typeof value === 'string' && !!value.trim() && value.length <= 500;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const exact = (value, keys) => { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault('invalid_material_command'); };
const ids = (values, allowEmpty = false) => {
  if (!Array.isArray(values) || !allowEmpty && !values.length || values.some(value => !validId(value)) || new Set(values).size !== values.length) throw fault('invalid_material_command');
  if (values.length > MAX_ITEMS) throw fault('material_command_too_large');
};
function vendor(value, finalized = false) {
  exact(value, ['name', 'price', 'leadTime', 'availability']);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 500) throw fault('invalid_material_command');
  if ((!finalized || Object.hasOwn(value, 'price')) && (!finite(value.price) || value.price < 0)) throw fault('invalid_material_command');
  for (const key of ['leadTime', 'availability']) if ((!finalized || Object.hasOwn(value, key)) && (typeof value[key] !== 'string' || value[key].length > 500)) throw fault('invalid_material_command');
}
function patchFields(patch, adding = false) {
  if (!plain(patch) || !Object.keys(patch).length) throw fault('invalid_material_command');
  for (const [key, value] of Object.entries(patch)) {
    if (adding && key === 'id') { if (!validId(value)) throw fault('invalid_material_command'); continue; }
    if (value === null && !adding && ['make', 'sku', 'unit', 'price', 'finalizedVendor', 'poNumber', 'order', 'orderDate', 'expectedArrival', 'expectedDelivery', 'thumbnailUrl', 'specificationUrl', 'linkedQuoteDocumentId', 'linkedPODocumentId', 'linkedSpecDocumentId', 'linkedInvoiceDocumentId'].includes(key)) continue;
    if (Object.hasOwn(textLimits, key)) {
      if (typeof value !== 'string' || value.length > textLimits[key] || ['name', 'category'].includes(key) && !value.trim()) throw fault('invalid_material_command');
    } else if (key === 'itemType') { if (!['component', 'service'].includes(value)) throw fault('invalid_material_command'); }
    else if (key === 'quantity' || key === 'price') { if (!finite(value) || (key === 'quantity' ? value <= 0 : value < 0)) throw fault('invalid_material_command'); }
    else if (key === 'status') { if (!(adding ? ['not-ordered'] : ['not-ordered', 'ordered', 'received']).includes(value)) throw fault('invalid_material_command'); }
    else if (key === 'order') { if (!Number.isSafeInteger(value) || value < 0) throw fault('invalid_material_command'); }
    else if (key === 'finalizedVendor') { if (adding) throw fault('invalid_material_command'); vendor(value, true); }
    else if (key === 'vendors') { if (!Array.isArray(value) || value.length > 200) throw fault('invalid_material_command'); value.forEach(row => vendor(row)); }
    else if (['orderDate', 'expectedArrival', 'expectedDelivery'].includes(key)) { if (adding || !date(value)) throw fault('invalid_material_command'); }
    else if (['thumbnailUrl', 'specificationUrl'].includes(key)) {
      let url; try { url = new URL(value); } catch { throw fault('invalid_material_command'); }
      if (typeof value !== 'string' || value.length > 4096 || url.protocol !== 'https:' || url.username || url.password) throw fault('invalid_material_command');
    } else if (Object.hasOwn(linkTypes, key) && key !== 'linkedInvoiceDocumentId') { if (adding || !validId(value)) throw fault('invalid_material_command'); }
    else throw fault('invalid_material_command');
  }
}
function validateCommand(command) {
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(command), 'utf8'); } catch { throw fault('invalid_material_command'); }
  if (bytes > MAX_INPUT_BYTES) throw fault('material_command_too_large');
  if (!plain(command)) throw fault('invalid_material_command');
  switch (command.kind) {
    case 'add_items':
      exact(command, ['kind', 'items', 'initialize']);
      if (command.initialize !== undefined && typeof command.initialize !== 'boolean' || !Array.isArray(command.items)) throw fault('invalid_material_command');
      ids(command.items.map(item => item?.id));
      for (const item of command.items) {
        patchFields(item, true);
        if (['id', 'itemType', 'name', 'description', 'category', 'quantity'].some(key => !Object.hasOwn(item, key)) || item.itemType === 'service' && item.quantity < 0.5) throw fault('invalid_material_command');
      }
      break;
    case 'delete_items': exact(command, ['kind', 'item_ids']); ids(command.item_ids); break;
    case 'patch_items':
      exact(command, ['kind', 'updates']);
      if (!Array.isArray(command.updates)) throw fault('invalid_material_command');
      ids(command.updates.map(row => row?.item_id));
      command.updates.forEach(row => { exact(row, ['item_id', 'patch']); patchFields(row.patch); });
      break;
    case 'category_state': exact(command, ['kind', 'category', 'isExpanded']); if (!categoryName(command.category) || typeof command.isExpanded !== 'boolean') throw fault('invalid_material_command'); break;
    case 'move_category': exact(command, ['kind', 'category', 'destination', 'remove_source']); if (!categoryName(command.category) || !categoryName(command.destination) || command.category === command.destination || command.remove_source !== undefined && typeof command.remove_source !== 'boolean') throw fault('invalid_material_command'); break;
    case 'delete_category': exact(command, ['kind', 'category']); if (!categoryName(command.category)) throw fault('invalid_material_command'); break;
    case 'link_document': exact(command, ['kind', 'document_id', 'item_ids', 'action']); ids(command.item_ids); if (!validId(command.document_id) || !['add', 'remove'].includes(command.action)) throw fault('invalid_material_command'); break;
    case 'link_document_delta':
      exact(command, ['kind', 'document_id', 'add_item_ids', 'remove_item_ids']);
      if (!validId(command.document_id)) throw fault('invalid_material_command');
      ids(command.add_item_ids, true); ids(command.remove_item_ids, true);
      // Combined validation also forbids overlap and applies the shared item cap.
      ids([...command.add_item_ids, ...command.remove_item_ids]);
      break;
    default: throw fault('invalid_material_command');
  }
  return command;
}
function canonicalCategories(settings) {
  if (settings === undefined) return [];
  if (!plain(settings)) throw fault('invalid_material_state', 409);
  if (settings.categories !== undefined) {
    const rows = settings.categories;
    if (!Array.isArray(rows) || rows.some(row => !plain(row) || !categoryName(row.name)
      || row.isActive !== undefined && typeof row.isActive !== 'boolean'
      || row.parentId !== undefined && row.parentId !== null && typeof row.parentId !== 'string')) throw fault('invalid_material_state', 409);
    const names = rows.filter(row => !row.parentId && row.isActive !== false).map(row => row.name);
    if (new Set(names).size !== names.length) throw fault('invalid_material_state', 409);
    return names;
  }
  if (settings.defaultCategories === undefined) return [];
  const names = settings.defaultCategories;
  if (!Array.isArray(names) || names.some(name => !categoryName(name)) || new Set(names).size !== names.length) throw fault('invalid_material_state', 409);
  return names;
}
function indexOf(categories) {
  if (!Array.isArray(categories) || categories.some(category => !plain(category) || !categoryName(category.name) || !Array.isArray(category.items) || category.items.some(item => !plain(item) || !validId(item.id)))) throw fault('invalid_material_state', 409);
  if (new Set(categories.map(category => category.name)).size !== categories.length) throw fault('duplicate_material_category', 409);
  const index = new Map();
  for (const category of categories) for (const item of category.items) { if (index.has(item.id)) throw fault('duplicate_material_id', 409); index.set(item.id, { item, category: category.name }); }
  return index;
}
function referencedDocuments(command, categories, documents = new Map()) {
  const index = indexOf(categories), result = new Set();
  if (command.kind === 'delete_items') for (const itemId of command.item_ids) {
    const item = index.get(itemId)?.item;
    if (!item) continue;
    for (const field of Object.keys(linkTypes)) if (item[field]) {
      if (!validId(item[field])) throw fault('invalid_material_state', 409);
      result.add(item[field]);
    }
    if (item.fulfillmentTranches !== undefined && !Array.isArray(item.fulfillmentTranches)) throw fault('invalid_material_state', 409);
    for (const tranche of item.fulfillmentTranches || []) if (tranche?.invoiceDocId) {
      if (!validId(tranche.invoiceDocId)) throw fault('invalid_material_state', 409);
      result.add(tranche.invoiceDocId);
    }
  }
  if (command.kind === 'patch_items') for (const { item_id, patch } of command.updates) for (const field of Object.keys(linkTypes)) if (Object.hasOwn(patch, field)) {
    if (patch[field]) result.add(patch[field]); const old = index.get(item_id)?.item[field]; if (old) { if (!validId(old)) throw fault('invalid_material_state', 409); result.add(old); }
  }
  if (['link_document', 'link_document_delta'].includes(command.kind)) {
    result.add(command.document_id);
    const field = typeFields[documents.get(command.document_id)?.type];
    const itemIds = command.kind === 'link_document' ? command.item_ids : [...command.add_item_ids, ...command.remove_item_ids];
    if (field) for (const id of itemIds) {
      const old = index.get(id)?.item[field]; if (old) { if (!validId(old)) throw fault('invalid_material_state', 409); result.add(old); }
    }
  }
  if (result.size > 400) throw fault('material_command_too_large', 413);
  return [...result];
}
function receivedTotal(item) {
  if (!finite(item.quantity) || item.quantity <= 0 || item.fulfillmentTranches !== undefined && !Array.isArray(item.fulfillmentTranches)) throw fault('invalid_material_state', 409);
  const rows = item.fulfillmentTranches || [];
  if (rows.some(row => !plain(row) || !finite(row.quantity) || row.quantity <= 0)) throw fault('invalid_material_state', 409);
  const total = rows.length ? rows.reduce((sum, row) => sum + row.quantity, 0) : item.status === 'received' ? item.quantity : 0;
  const tolerance = Number.EPSILON * Math.max(1, total, item.quantity) * 4;
  if (!finite(total) || total > item.quantity + tolerance || item.status === 'received' && total + tolerance < item.quantity) throw fault('invalid_material_state', 409);
  return total;
}
function applyCommand({ categories, command, scope, canonical = [], documents = new Map() }) {
  const beforeIndex = indexOf(categories);
  let next = categories.map(category => ({ ...category, items: [...category.items] }));
  const affectedCategories = new Set(), affectedIds = new Set(), affectedCategoryMetadata = new Set();
  const docUpdates = new Map();
  const allow = name => { if (scope !== null && !scope.includes(name)) throw fault('material_forbidden', 403); affectedCategories.add(name); };
  const canonicalDestination = name => { allow(name); if (!canonical.includes(name)) throw fault('invalid_material_category', 400); };
  const find = id => { const entry = beforeIndex.get(id); if (!entry) throw fault('material_not_found', 404); allow(entry.category); affectedIds.add(id); return entry; };
  const category = name => { allow(name); const found = next.find(category => category.name === name); if (!found) throw fault('material_category_not_found', 404); return found; };
  const replace = (id, item, source) => { const row = next.find(row => row.name === source); row.items = row.items.map(value => value.id === id ? item : value); };
  const document = (id, expectedType) => {
    const value = documents.get(id);
    if (!value || expectedType && value.type !== expectedType || ![...Object.keys(typeFields), 'customer-po'].includes(value.type)) throw fault('document_forbidden', 403);
    if (value.linkedBOMItems !== undefined && (!Array.isArray(value.linkedBOMItems) || value.linkedBOMItems.some(id => typeof id !== 'string'))) throw fault('invalid_material_state', 409);
    return value;
  };
  const delta = (id, itemId, adding, expectedType) => {
    const value = document(id, expectedType), linked = docUpdates.get(id)?.linkedBOMItems ?? value.linkedBOMItems ?? [];
    docUpdates.set(id, { linkedBOMItems: adding ? linked.includes(itemId) ? [...linked] : [...linked, itemId] : linked.filter(id => id !== itemId) });
  };
  const changeLink = (item, field, newId, itemId) => {
    const oldId = item[field];
    if (oldId && oldId !== newId) delta(oldId, itemId, false, linkTypes[field]);
    if (newId) { delta(newId, itemId, true, linkTypes[field]); item[field] = newId; }
    else delete item[field];
  };
  if (command.kind === 'add_items') {
    if (command.initialize && beforeIndex.size) throw fault('material_initialization_conflict', 409);
    for (const item of command.items) {
      if (beforeIndex.has(item.id)) throw fault('duplicate_material_id', 409);
      canonicalDestination(item.category); affectedIds.add(item.id);
      let row = next.find(category => category.name === item.category);
      if (!row) { row = { name: item.category, isExpanded: true, items: [] }; next.push(row); affectedCategoryMetadata.add(item.category); }
      row.items.push({ ...item, vendors: item.vendors ?? [], status: 'not-ordered' });
    }
  } else if (command.kind === 'delete_items') {
    command.item_ids.forEach(find); const selected = new Set(command.item_ids);
    for (const [documentId, value] of documents) for (const itemId of selected) {
      if (Array.isArray(value.linkedBOMItems) && value.linkedBOMItems.includes(itemId)) delta(documentId, itemId, false, value.type);
    }
    next = next.map(category => ({ ...category, items: category.items.filter(item => !selected.has(item.id)) }));
  } else if (command.kind === 'patch_items') {
    for (const { item_id, patch } of command.updates) {
      const entry = find(item_id), updated = { ...entry.item };
      const total = receivedTotal(entry.item);
      for (const [key, value] of Object.entries(patch)) if (Object.hasOwn(linkTypes, key)) changeLink(updated, key, value, item_id); else if (value === null) delete updated[key]; else updated[key] = value;
      if (!finite(updated.quantity) || updated.quantity <= 0 || updated.itemType === 'service' && updated.quantity < 0.5) throw fault('invalid_material_command');
      const tolerance = Number.EPSILON * Math.max(1, total, updated.quantity) * 4;
      if (updated.quantity + tolerance < total || !entry.item.fulfillmentTranches?.length && entry.item.status === 'received' && (updated.status !== 'received' || updated.quantity !== entry.item.quantity)
        || updated.status === 'received' && total + tolerance < updated.quantity) throw fault('received_quantity_conflict', 409);
      const destination = patch.category ?? entry.category;
      if (destination === entry.category) replace(item_id, updated, entry.category);
      else {
        canonicalDestination(destination); next.find(row => row.name === entry.category).items = next.find(row => row.name === entry.category).items.filter(item => item.id !== item_id);
        let target = next.find(row => row.name === destination);
        if (!target) { target = { name: destination, isExpanded: true, items: [] }; next.push(target); affectedCategoryMetadata.add(destination); }
        target.items.push(updated);
      }
    }
  } else if (command.kind === 'category_state') {
    category(command.category).isExpanded = command.isExpanded; affectedCategoryMetadata.add(command.category);
  } else if (command.kind === 'delete_category') {
    const source = category(command.category); if (source.items.length) throw fault('nonempty_material_category', 409);
    next = next.filter(row => row.name !== command.category); affectedCategoryMetadata.add(command.category);
  } else if (command.kind === 'move_category') {
    const source = category(command.category); canonicalDestination(command.destination);
    source.items.forEach(item => affectedIds.add(item.id));
    let dest = next.find(row => row.name === command.destination);
    if (!dest) { dest = { ...source, name: command.destination, items: [] }; next.push(dest); }
    dest.isExpanded = !!(source.isExpanded || dest.isExpanded);
    dest.items = [...dest.items, ...source.items.map(item => ({ ...item, category: command.destination }))];
    if (command.remove_source !== false) next = next.filter(row => row.name !== command.category); else source.items = [];
    affectedCategoryMetadata.add(command.category); affectedCategoryMetadata.add(command.destination);
  } else if (['link_document', 'link_document_delta'].includes(command.kind)) {
    const value = document(command.document_id), field = typeFields[value.type];
    const changes = command.kind === 'link_document' ? command.item_ids.map(id => [id, command.action === 'add'])
      : [...command.add_item_ids.map(id => [id, true]), ...command.remove_item_ids.map(id => [id, false])];
    for (const [id, adding] of changes) {
      const entry = find(id), updated = { ...entry.item };
      if (!field) delta(command.document_id, id, adding, value.type);
      else if (adding) changeLink(updated, field, command.document_id, id);
      else { delta(command.document_id, id, false, value.type); if (updated[field] === command.document_id) delete updated[field]; }
      replace(id, updated, entry.category);
    }
  }
  if (affectedIds.size > MAX_ITEMS) throw fault('material_command_too_large');
  const afterIndex = indexOf(next);
  const metadata = (rows, name) => { const row = rows.find(row => row.name === name); if (!row) return { name, value: null }; const { items, ...value } = row; return { name, value }; };
  const auditSide = (index, rows, after) => ({
    items: [...affectedIds].map(id => ({ item_id: id, category: index.get(id)?.category ?? null, item: index.get(id)?.item ?? null })),
    categories: [...affectedCategoryMetadata].map(name => metadata(rows, name)),
    documents: [...docUpdates].map(([id, update]) => ({ document_id: id, linkedBOMItems: after ? update.linkedBOMItems : documents.get(id).linkedBOMItems ?? [] }))
  });
  return { categories: next, affectedCategories: [...affectedCategories], documentUpdates: docUpdates, before: auditSide(beforeIndex, categories, false), after: auditSide(afterIndex, next, true) };
}
// Official size accounting: UTF-8 string + 1, field names, value sizes, document
// path components + 16 and document + 32. Nested maps have no extra 32.
// https://firebase.google.com/docs/firestore/storage-size
// https://firebase.google.com/docs/firestore/quotas (1 MiB/doc; 10 MiB/request).
function estimateDocumentBytes(data, path) {
  const stringSize = value => Buffer.byteLength(value, 'utf8') + 1;
  const valueSize = (value, depth = 0) => {
    if (depth > 20) throw fault('material_document_too_large');
    if (value === null || typeof value === 'boolean') return 1;
    if (typeof value === 'string') return stringSize(value);
    if (typeof value === 'number') return 8;
    if (value instanceof Date || value && typeof value.toDate === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) return 8;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
    if (Array.isArray(value)) return value.reduce((sum, row) => sum + valueSize(row, depth + 1), 0);
    if (plain(value)) return Object.entries(value).reduce((sum, [key, row]) => sum + stringSize(key) + valueSize(row, depth + 1), 0);
    // The only new sentinel is a server timestamp; reserve more than its final 8 bytes.
    if (value?.constructor?.name === 'ServerTimestampTransform') return 32;
    throw fault('material_size_unavailable', 409);
  };
  return path.split('/').reduce((sum, part) => sum + stringSize(part), 16) + 32 + valueSize(data);
}
function assertDocumentBudget(documents) {
  let total = 0;
  for (const { data, path } of documents) { const bytes = estimateDocumentBytes(data, path); if (bytes > MAX_DOCUMENT_BYTES) throw fault('material_document_too_large'); total += bytes; }
  if (total > MAX_TRANSACTION_BYTES) throw fault('material_command_too_large');
}
module.exports = { validateCommand, canonicalCategories, referencedDocuments, applyCommand, estimateDocumentBytes, assertDocumentBudget, MAX_ITEMS, MAX_INPUT_BYTES, linkTypes };
