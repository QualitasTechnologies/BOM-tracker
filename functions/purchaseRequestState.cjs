const { createHash } = require('node:crypto');
const { createFreeze } = require('./nativePoSerialization.cjs');
const { readProjectDocumentView } = require('./projectDocumentRead.cjs');
const PUBLIC = Symbol('purchase-request-fault');
const fault = (code, status = 400) =>
  Object.assign(Error(code), { code, status, [PUBLIC]: true });
const plain = (v) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const id = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 512 &&
  !/[\/\\\x00-\x1f]/.test(v) &&
  !['.', '..'].includes(v) &&
  !/^__.*__$/.test(v);
const freeze = createFreeze(fault),
  hash = (v) =>
    createHash('sha256')
      .update(JSON.stringify(freeze(v)))
      .digest('hex');
const email = (v) =>
  typeof v === 'string' &&
  v.length <= 254 &&
  /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(v);
const validVersion = (value) =>
  value === 'missing' ||
  (typeof value === 'string' &&
    /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.test(value) &&
    Number.isSafeInteger(Number(value.split(':')[0])) &&
    Number(value.split(':')[1]) < 1e9);
function version(snapshot) {
  if (!snapshot.exists) return 'missing';
  const time = snapshot.updateTime;
  if (
    !Number.isSafeInteger(time?.seconds) ||
    time.seconds < 0 ||
    !Number.isInteger(time.nanoseconds) ||
    time.nanoseconds < 0 ||
    time.nanoseconds >= 1e9
  )
    throw fault('purchase_request_changed', 409);
  return `${time.seconds}:${time.nanoseconds}`;
}
function itemView(item) {
  const out = {};
  for (const key of ['name', 'make', 'sku', 'description']) {
    const v = item?.[key] ?? '';
    if (
      typeof v !== 'string' ||
      v.length > (key === 'description' ? 4000 : 500)
    )
      throw fault('invalid_purchase_request');
    out[key] = v;
  }
  for (const key of ['quantity', 'price']) {
    const v = item?.[key] ?? (key === 'price' ? 0 : NaN);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      throw fault('invalid_purchase_request');
    out[key] = v;
  }
  out.itemType = item.itemType || 'component';
  if (out.itemType !== 'component') throw fault('invalid_purchase_request');
  return out;
}
function normalize(data, actor) {
  if (
    !plain(data) ||
    (data.operation !== undefined && data.operation !== 'send') ||
    !/^[-\w]{1,128}$/.test(data.operation_id || '') ||
    data.expected_actor_uid !== actor.uid ||
    !id(data.projectDetails?.projectId) ||
    !validVersion(data.expected_project_version) ||
    data.expected_project_version === 'missing' ||
    !validVersion(data.expected_material_version) ||
    (data.resolve_only !== undefined && data.resolve_only !== true)
  )
    throw fault('invalid_purchase_request');
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 256 * 1024)
    throw fault('purchase_request_too_large');
  if (
    !Array.isArray(data.categories) ||
    !data.categories.length ||
    data.categories.length > 200 ||
    !Array.isArray(data.recipients) ||
    !data.recipients.length ||
    data.recipients.length > 50
  )
    throw fault('invalid_purchase_request');
  const recipients = [
    ...new Set(
      data.recipients.map((v) => {
        if (!email(v)) throw fault('invalid_purchase_request');
        return v.trim().toLowerCase();
      })
    ),
  ];
  const selections = [],
    seen = new Set();
  for (const category of data.categories) {
    if (
      !plain(category) ||
      typeof category.name !== 'string' ||
      !category.name ||
      category.name.length > 500 ||
      !Array.isArray(category.items)
    )
      throw fault('invalid_purchase_request');
    for (const item of category.items) {
      if (
        !plain(item) ||
        !id(item.id) ||
        seen.has(item.id) ||
        !id(item.finalizedVendor?.id) ||
        !id(item.linkedQuote?.id)
      )
        throw fault('invalid_purchase_request');
      seen.add(item.id);
      selections.push({
        id: item.id,
        category: category.name,
        vendor_id: item.finalizedVendor.id,
        quote_id: item.linkedQuote.id,
        item: itemView(item),
      });
    }
  }
  if (!selections.length || selections.length > 200)
    throw fault('invalid_purchase_request');
  return {
    project_id: data.projectDetails.projectId,
    expected_project_version: data.expected_project_version,
    expected_material_version: data.expected_material_version,
    operation_id: data.operation_id,
    selections,
    recipients,
  };
}
function scopeFor(project, actor, categories) {
  if (
    actor.customClaims.role !== 'admin' &&
    project.memberIds !== null &&
    (!Array.isArray(project.memberIds) ||
      !project.memberIds.includes(actor.uid))
  )
    throw fault('project_forbidden', 403);
  if (
    actor.customClaims.role === 'admin' ||
    actor.email.toLowerCase().endsWith('@qualitastech.com')
  )
    return null;
  const member = (Array.isArray(project.members) ? project.members : []).find(
      (m) => m.userId === actor.uid
    ),
    scope = Array.isArray(member?.categoryScope) ? member.categoryScope : [];
  if (categories.some((c) => !scope.includes(c)))
    throw fault('purchase_request_forbidden', 403);
  return scope;
}
function writable(snapshot) {
  if (
    snapshot.exists &&
    !['legacy', 'coexist', 'pulse_only'].includes(snapshot.data()?.mode)
  )
    throw fault('purchase_request_read_only', 503);
}
const escape = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
async function prepare({ tx, db, bucket, input, actor, project, scope }) {
  const bom = await tx.get(
    db
      .collection('projects')
      .doc(input.project_id)
      .collection('bom')
      .doc('data')
  );
  if (version(bom) !== input.expected_material_version)
    throw fault('purchase_request_changed', 409);
  const settings = await tx.get(
    db.collection('settings').doc('purchaseRequest')
  );
  const categories = bom.exists ? bom.data()?.categories : null;
  if (!Array.isArray(categories)) throw fault('purchase_request_changed', 409);
  const items = new Map(),
    visible = new Set();
  for (const c of categories) {
    if (!Array.isArray(c.items)) throw fault('purchase_request_changed', 409);
    for (const item of c.items) {
      if (items.has(item.id)) throw fault('purchase_request_changed', 409);
      items.set(item.id, { item, category: c.name });
      if (scope === null || scope.includes(c.name)) visible.add(item.id);
    }
  }
  const vendors = new Map(),
    quotes = new Map(),
    grouped = new Map();
  for (const selected of input.selections) {
    const stored = items.get(selected.id);
    if (
      !stored ||
      stored.category !== selected.category ||
      hash(itemView(stored.item)) !== hash(selected.item)
    )
      throw fault('purchase_request_changed', 409);
    if (!vendors.has(selected.vendor_id)) {
      const v = await tx.get(db.collection('vendors').doc(selected.vendor_id));
      if (!v.exists || v.data().status !== 'active')
        throw fault('purchase_request_changed', 409);
      vendors.set(selected.vendor_id, { ...v.data(), id: selected.vendor_id });
    }
    if (!quotes.has(selected.quote_id)) {
      const d = await tx.get(
          db.collection('projectDocuments').doc(selected.quote_id)
        ),
        raw = d.data();
      if (
        !d.exists ||
        raw.projectId !== input.project_id ||
        raw.type !== 'vendor-quote' ||
        (scope !== null &&
          !(
            Array.isArray(raw.linkedBOMItems) &&
            raw.linkedBOMItems.some((i) => visible.has(i))
          ))
      )
        throw fault('purchase_request_quote_forbidden', 403);
      const doc = await readProjectDocumentView({
        transaction: tx,
        db,
        bucket,
        projectId: input.project_id,
        id: selected.quote_id,
        raw,
      });
      let url;
      try {
        url = new URL(doc.url);
      } catch {
        throw fault('purchase_request_changed', 409);
      }
      if (url.protocol !== 'https:' || url.username || url.password)
        throw fault('purchase_request_changed', 409);
      quotes.set(selected.quote_id, doc);
    }
    const vendor = vendors.get(selected.vendor_id),
      quote = quotes.get(selected.quote_id),
      rows = grouped.get(selected.category) || [];
    rows.push({
      ...Object.fromEntries(
        Object.entries(selected.item).map(([k, v]) => [
          k,
          typeof v === 'string' ? escape(v) : v,
        ])
      ),
      id: selected.id,
      finalizedVendor: {
        id: vendor.id,
        name: escape(vendor.company),
        price: selected.item.price,
      },
      linkedQuote: {
        id: quote.id,
        name: escape(quote.name),
        url: escape(quote.url),
      },
    });
    grouped.set(selected.category, rows);
  }
  const config = settings.exists ? settings.data() : {};
  const fromEmail = config.fromEmail || 'info@qualitastech.com';
  if (
    typeof fromEmail !== 'string' ||
    !fromEmail.includes('@') ||
    fromEmail.length > 320 ||
    /[\r\n]/.test(fromEmail)
  )
    throw fault('purchase_request_settings_invalid', 409);
  if (
    typeof project.projectName !== 'string' ||
    project.projectName.length > 500 ||
    /[\r\n]/.test(project.projectName) ||
    typeof project.clientName !== 'string'
  )
    throw fault('purchase_request_changed', 409);
  return {
    subjectProjectName: project.projectName,
    projectDetails: {
      projectId: input.project_id,
      projectName: escape(project.projectName),
      clientName: escape(project.clientName),
    },
    categories: [...grouped].map(([name, items]) => ({
      name: escape(name),
      items,
    })),
    vendors: [...vendors.values()].map((v) =>
      Object.fromEntries(
        [
          'id',
          'company',
          'email',
          'phone',
          'contactPerson',
          'paymentTerms',
          'leadTime',
        ].map((k) => [k, escape(v[k])])
      )
    ),
    companyName: escape(config.companyName || 'Qualitas Technologies Pvt Ltd'),
    fromEmail,
    recipients: [...new Set([...input.recipients, actor.email.toLowerCase()])],
    requestedBy: escape(actor.email),
  };
}
module.exports = {
  version,
  PUBLIC,
  fault,
  plain,
  id,
  hash,
  email,
  normalize,
  scopeFor,
  writable,
  prepare,
};
