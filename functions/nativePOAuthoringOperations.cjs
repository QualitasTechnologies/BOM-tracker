const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');
const { calculatePOTotals, generatePONumber, determineTaxType, getStateName } = require('./poDomain.generated.cjs');
const PO_FAULT = Symbol('po-authoring-fault');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status, [PO_FAULT]:true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.','..'].includes(value) && !/^__.*__$/.test(value);
const nonce = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const version = snapshot => snapshot.exists ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : 'missing';
const validVersion = value => value === 'missing' || typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const freeze = value => value instanceof Date ? value.toISOString() : value && typeof value.toDate === 'function' ? value.toDate().toISOString()
  : Array.isArray(value) ? value.map(freeze) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, freeze(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(freeze(value))).digest('hex');
const text = (value, max = 4000) => typeof value === 'string' && value.length <= max;
function date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0,10) !== value.slice(0,10)) throw fault('invalid_po_date');
  return new Date(value);
}
const editable = ['paymentTerms','deliveryTerms','vendorQuoteReference','expectedDeliveryDate','shipToAddress'];
function commandOf(value) {
  if (!plain(value) || !['edit','submit','request_changes'].includes(value.kind)) throw fault('invalid_po_command');
  const fields = value.kind === 'edit' ? ['kind','patch'] : value.kind === 'request_changes' ? ['kind','note'] : ['kind'];
  if (Object.keys(value).some(key => !fields.includes(key))) throw fault('invalid_po_command');
  if (value.kind === 'edit') {
    if (!plain(value.patch) || !Object.keys(value.patch).length || Object.keys(value.patch).some(key => !editable.includes(key))) throw fault('invalid_po_command');
    for (const [key, field] of Object.entries(value.patch)) {
      if (key === 'expectedDeliveryDate') date(field);
      else if (!text(field) || ['paymentTerms','deliveryTerms'].includes(key) && !field.trim()) throw fault('invalid_po_command');
    }
  } else if (value.note !== undefined && !text(value.note)) throw fault('invalid_po_command');
  return value;
}
const createText = ['projectReference','billingEntityId','vendorId','vendorName','vendorAddress','vendorGstin','vendorStateCode','vendorStateName','vendorEmail','vendorPhone','shipToAddress','shipToGstin','shipToStateCode','shipToStateName','paymentTerms','deliveryTerms','dispatchedThrough','destination','termsAndConditions','vendorQuoteReference'];
const requiredText = ['projectReference','billingEntityId','vendorId','vendorName','vendorAddress','vendorGstin','vendorStateCode','vendorStateName','paymentTerms','deliveryTerms'];
const legalFields = ['companyName','companyAddress','gstin','stateCode','stateName'];
function validateCreate(input, billing) {
  if (!plain(input) || Object.keys(input).some(key => ![...createText,'items','includeAnnexure','expectedDeliveryDate'].includes(key))
    || requiredText.some(key => !text(input[key])) || createText.some(key => input[key] !== undefined && !text(input[key]))
    || !input.paymentTerms.trim() || !input.deliveryTerms.trim() || !id(input.billingEntityId) || !id(input.vendorId)
    || typeof input.includeAnnexure !== 'boolean' || !Array.isArray(input.items) || !input.items.length || input.items.length > 200
    || !plain(billing) || Object.keys(billing).length !== legalFields.length || legalFields.some(key => !text(billing[key]))) throw fault('invalid_po_create');
  if (input.expectedDeliveryDate !== undefined) date(input.expectedDeliveryDate);
  const ids = new Set();
  for (const item of input.items) {
    if (!plain(item) || Object.keys(item).some(key => !['bomItemId','description','itemCode','make','uom','quantity','rate','discountPercent','amount','dueDate','hsn'].includes(key))
      || !id(item.bomItemId) || ids.has(item.bomItemId) || !text(item.description) || !text(item.uom,100)
      || ['itemCode','make','hsn'].some(key => item[key] !== undefined && !text(item[key],500))
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.rate) || item.rate <= 0
      || item.discountPercent !== undefined && (!Number.isFinite(item.discountPercent) || item.discountPercent < 0 || item.discountPercent > 100)
      || item.amount !== undefined && !Number.isFinite(item.amount)) throw fault('invalid_po_create');
    if (item.dueDate !== undefined) date(item.dueDate);
    ids.add(item.bomItemId);
  }
}
function access(project, actor) {
  if (actor.customClaims.role !== 'admin' && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid))) throw fault('project_forbidden',403);
  return { create: actor.customClaims.role === 'admin' || actor.email.trim().toLowerCase().endsWith('@qualitastech.com'), admin: actor.customClaims.role === 'admin' };
}
function writableControl(snapshot, replay = false) {
  if (!snapshot.exists) return;
  const mode = snapshot.data()?.mode;
  if (mode === 'read_only' && replay) return;
  if (mode === 'read_only') throw fault('po_authoring_read_only',503);
  if (!['coexist','pulse_only'].includes(mode)) throw fault('po_authoring_control_unavailable',503);
}
const authoringEnabled = env => ['BOM_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED','BOM_NATIVE_PO_AUTHORING_ENABLED'].every(key => env[key] === 'true');
function createNativePOAuthoringOperations({ db, auth, enabled = false, getServerTimestamp, now = () => new Date() }) {
  const on = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  const verifiedActor = async request => {
    try { return await currentNativeActor(auth,request); }
    catch (error) {
      const publicAuthErrors = { actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503 };
      if (Object.hasOwn(publicAuthErrors,error?.code) && publicAuthErrors[error.code] === error.status) throw fault(error.code,error.status);
      throw error;
    }
  };
  return async request => {
    try {
      const actor = await verifiedActor(request), data = request.data;
      if (!plain(data) || !['open','command','create'].includes(data.operation) || !id(data.project_id) || data.po_id !== undefined && !id(data.po_id)) throw fault('invalid_po_request');
      const allowed = ['operation','project_id','po_id','expected_actor_uid', ...(data.operation === 'command' ? ['expected_po_version','operation_id','command','resolve_only'] : data.operation === 'create' ? ['operation_id','expected_material_version','input','billing_snapshot','resolve_only'] : [])];
      if (Object.keys(data).some(key => !allowed.includes(key))) throw fault('invalid_po_request');
      if (Object.hasOwn(data,'resolve_only') && data.resolve_only !== true) throw fault('invalid_po_request');
      if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed',403);
      if (data.operation !== 'open' && (!id(data.po_id) || !nonce(data.operation_id))) throw fault('invalid_po_request');
      if (Buffer.byteLength(JSON.stringify(data),'utf8') > MAX_INPUT_BYTES) throw fault('po_request_too_large');
      let command;
      if (data.operation === 'command') { if (!validVersion(data.expected_po_version)) throw fault('invalid_po_request'); command = commandOf(data.command); }
      if (data.operation === 'create') { if (!validVersion(data.expected_material_version)) throw fault('invalid_po_request'); validateCreate(data.input, data.billing_snapshot); }
      const projectRef = db.collection('projects').doc(data.project_id), bomRef = projectRef.collection('bom').doc('data');
      const poRef = data.po_id ? projectRef.collection('purchaseOrders').doc(data.po_id) : null;
      const ledger = db.collection('pulsePOAuthoringOperations').doc(data.project_id), controlRef = db.collection('pulseRuntimeControl').doc('cutover');
      const receiptRef = data.operation_id ? ledger.collection('receipts').doc(data.operation_id) : null;
      const auditRef = data.operation_id ? ledger.collection('audit').doc(data.operation_id) : null;
      const { resolve_only: resolving, ...originalRequest } = data;
      const payloadHash = digest(originalRequest);
      const latest = async transaction => {
        const project = await transaction.get(projectRef);
        if (!project.exists) throw fault('project_not_found',404);
        if (project.data().projectId && project.data().projectId !== data.project_id) throw fault('project_identity_conflict',409);
        const current = await verifiedActor(request);
        if (current.uid !== actor.uid || current.email !== actor.email) throw fault('actor_session_changed',403);
        return { current, permissions: access(project.data(),current) };
      };
      return await db.runTransaction(async transaction => {
        const first = await latest(transaction), po = poRef ? await transaction.get(poRef) : null, control = await transaction.get(controlRef);
        if (po?.exists && po.data().projectId && po.data().projectId !== data.project_id) throw fault('procurement_forbidden',403);
        if (data.operation === 'open') {
          if (poRef && !po.exists) throw fault('purchase_order_not_found',404);
          const bom = await transaction.get(bomRef), final = await latest(transaction);
          let enabledHere = on(); try { writableControl(control); } catch { enabledHere = false; }
          const draft = po?.data()?.status === 'draft' && !po.data().nativeSendAttemptId;
          return { ok:true, project_id:data.project_id, po_id:data.po_id || null, po_version:po ? version(po) : 'missing', material_version:version(bom), purchase_order:po?.exists ? freeze({ ...po.data(),id:data.po_id,projectId:data.project_id }) : null,
            ...(!poRef ? {categories:final.permissions.create ? freeze(bom.data()?.categories || []) : []} : {}),
            permissions:{ create:enabledHere && final.permissions.create, edit:enabledHere && !!draft, submit:enabledHere && !!draft, request_changes:enabledHere && final.permissions.admin && po?.data()?.status === 'pending-approval' && !po.data().nativeSendAttemptId } };
        }
        if (data.operation === 'create' && !first.permissions.create || command?.kind === 'request_changes' && !first.permissions.admin) throw fault('procurement_forbidden',403);
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const final = await latest(transaction), old = receipt.data();
          if (data.operation === 'create' && !final.permissions.create || command?.kind === 'request_changes' && !final.permissions.admin) throw fault('procurement_forbidden',403);
          if (old.actor_uid !== actor.uid || old.actor_email !== actor.email || old.payload_hash !== payloadHash) throw fault('operation_conflict',409);
          writableControl(control,true);
          return resolving ? { ok:true,project_id:data.project_id,po_id:data.po_id,operation_id:data.operation_id,kind:data.operation === 'create' ? 'create' : command.kind,resolution:old.cancelled === true ? 'cancelled' : 'committed' } : old.result;
        }
        if (resolving) {
          writableControl(control,true);
          const final = await latest(transaction);
          if (data.operation === 'create' && !final.permissions.create || command?.kind === 'request_changes' && !final.permissions.admin) throw fault('procurement_forbidden',403);
          const at = getServerTimestamp(), kind = data.operation === 'create' ? 'create' : command.kind;
          const cancelled = { actor_uid:actor.uid,actor_email:actor.email,payload_hash:payloadHash,cancelled:true,result:{ok:false,error:'po_request_cancelled'},at };
          const audit = { operation:'cancel',requested_kind:kind,actor_uid:actor.uid,actor_email:actor.email,project_id:data.project_id,po_id:data.po_id,operation_id:data.operation_id,payload_hash:payloadHash,at };
          assertDocumentBudget([{path:receiptRef.path,data:cancelled},{path:auditRef.path,data:audit}]);
          // This create competes with the original transaction on exactly the same receipt.
          // A delayed original save retries its read and observes the cancellation before business writes.
          transaction.create(receiptRef,cancelled); transaction.create(auditRef,audit);
          return {ok:true,project_id:data.project_id,po_id:data.po_id,operation_id:data.operation_id,kind,resolution:'cancelled'};
        }
        if (!on()) throw fault('po_authoring_disabled',503);
        writableControl(control);
        const kind = data.operation === 'create' ? 'create' : command.kind;
        const result = { ok:true, project_id:data.project_id, po_id:data.po_id, operation_id:data.operation_id, kind };
        let after, before = po?.exists ? po.data() : null, counter;
        const at = getServerTimestamp();
        if (data.operation === 'create') {
          if (po.exists) throw fault('purchase_order_exists',409);
          const bom = await transaction.get(bomRef);
          if (version(bom) !== data.expected_material_version) throw fault('material_version_conflict',409);
          const input = data.input, vendor = await transaction.get(db.collection('vendors').doc(input.vendorId));
          const vendorMap = { vendorName:'company',vendorAddress:'address',vendorGstin:'gstNo',vendorStateCode:'stateCode',vendorStateName:'stateName',vendorEmail:'email',vendorPhone:'phone' };
          if (!vendor.exists || vendor.data().status !== 'active' || Object.entries(vendorMap).some(([key,field]) => (input[key] || '') !== (vendor.data()[field] || (field === 'stateName' ? getStateName(vendor.data().stateCode || '') : '')))) throw fault('vendor_version_conflict',409);
          const billingRef = input.billingEntityId === 'company' ? db.collection('settings').doc('company') : db.collection('billingEntities').doc(input.billingEntityId);
          const stored = await transaction.get(billingRef), entity = stored.data();
          if (!stored.exists || entity.isActive === false) throw fault('billing_entity_unavailable',409);
          const billing = Object.fromEntries(legalFields.map(key => [key,key === 'companyName' ? entity.legalName ?? entity.companyName ?? '' : entity[key] ?? '']));
          if (digest(billing) !== digest(data.billing_snapshot) || !billing.gstin || !billing.stateCode) throw fault('billing_version_conflict',409);
          const number = entity.nextPoNumber || 1;
          if (!Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER || !['simple','financial-year'].includes(entity.poNumberFormat || 'simple') || !text(entity.poNumberPrefix || 'PO',100)) throw fault('invalid_po_counter',409);
          const categories = Array.isArray(bom.data()?.categories) ? bom.data().categories : [];
          const items = input.items.map((item,index) => {
            const matches = categories.flatMap(category => Array.isArray(category.items) ? category.items : []).filter(row => row.id === item.bomItemId);
            if (matches.length !== 1) throw fault('material_not_found',409);
            if (typeof matches[0].finalizedVendor?.name !== 'string' || matches[0].finalizedVendor.name.toLowerCase() !== input.vendorName.toLowerCase()) throw fault('vendor_item_conflict',409);
            const amount = item.quantity * item.rate * (1 - (item.discountPercent || 0) / 100);
            if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) throw fault('invalid_po_create');
            return { ...item,slNo:index+1,amount,...(item.dueDate !== undefined ? {dueDate:date(item.dueDate)} : {}) };
          });
          const taxType = determineTaxType(billing.stateCode,input.vendorStateCode), totals = calculatePOTotals(items,taxType,18);
          if (!Number.isFinite(totals.totalAmount) || totals.totalAmount > Number.MAX_SAFE_INTEGER / 100) throw fault('invalid_po_create');
          const created = now();
          const calendar = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(created);
          const billingClock = { getFullYear:() => Number(calendar.find(part => part.type === 'year').value), getMonth:() => Number(calendar.find(part => part.type === 'month').value)-1 };
          after = { ...input,projectId:data.project_id,poNumber:generatePONumber(entity.poNumberPrefix || 'PO',entity.poNumberFormat || 'simple',number,billingClock),items,...totals,taxType,taxPercentage:18,currency:'INR',
            invoiceToCompany:billing.companyName,invoiceToAddress:billing.companyAddress,invoiceToGstin:billing.gstin,invoiceToStateCode:billing.stateCode,invoiceToStateName:billing.stateName,
            shipToAddress:input.shipToAddress || billing.companyAddress,shipToGstin:input.shipToGstin || billing.gstin,shipToStateCode:input.shipToStateCode || billing.stateCode,shipToStateName:input.shipToStateName || billing.stateName,
            poDate:created,expectedDeliveryDate:input.expectedDeliveryDate === undefined ? null : date(input.expectedDeliveryDate),status:'draft',warnings:[],createdBy:actor.uid,createdAt:at,updatedAt:at };
          for (const key of Object.keys(after)) if (after[key] === undefined) delete after[key];
          counter = { ref:billingRef,before:entity,patch:{ nextPoNumber:number+1,updatedAt:at } };
        } else {
          if (!po.exists) throw fault('purchase_order_not_found',404);
          if (version(po) !== data.expected_po_version) throw fault('po_version_conflict',409);
          if (before.nativeSendAttemptId) throw fault('purchase_order_attempt_active',409);
          if (before.status !== (kind === 'request_changes' ? 'pending-approval' : 'draft')) throw fault('purchase_order_state_conflict',409);
          if (kind === 'edit') after = { ...before,...command.patch,...(Object.hasOwn(command.patch,'expectedDeliveryDate') ? {expectedDeliveryDate:date(command.patch.expectedDeliveryDate)} : {}),updatedAt:at };
          else if (kind === 'submit') after = { ...before,status:'pending-approval',submittedBy:actor.uid,submittedForApprovalAt:at,changesRequestedAt:null,changesRequestedBy:null,changesRequestedNote:null,updatedAt:at };
          else after = { ...before,status:'draft',changesRequestedBy:actor.uid,changesRequestedAt:at,changesRequestedNote:command.note || null,updatedAt:at };
        }
        const final = await latest(transaction);
        if (!on()) throw fault('po_authoring_disabled',503);
        if (kind === 'create' && !final.permissions.create || kind === 'request_changes' && !final.permissions.admin) throw fault('procurement_forbidden',403);
        const audit = { operation:kind,actor_uid:actor.uid,actor_email:actor.email,project_id:data.project_id,po_id:data.po_id,operation_id:data.operation_id,before,after,at };
        const recorded = { actor_uid:actor.uid,actor_email:actor.email,payload_hash:payloadHash,result,at };
        assertDocumentBudget([{path:poRef.path,data:after},{path:auditRef.path,data:audit},{path:receiptRef.path,data:recorded},...(counter ? [{path:counter.ref.path,data:{...counter.before,...counter.patch}}] : [])]);
        if (kind === 'create') transaction.create(poRef,after); else transaction.update(poRef,after);
        if (counter) transaction.update(counter.ref,counter.patch);
        transaction.create(auditRef,audit); transaction.create(receiptRef,recorded);
        return result;
      });
    } catch (error) { return { ok:false,error:error?.[PO_FAULT] === true ? error.code : 'po_authoring_unavailable' }; }
  };
}
module.exports = { createNativePOAuthoringOperations,authoringEnabled };
