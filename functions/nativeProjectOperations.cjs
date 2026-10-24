const { createHash } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget, MAX_INPUT_BYTES } = require('./materialCommands.cjs');
const {milestoneDelayRecord,isMilestoneFault}=require('./milestoneCommands.cjs');
const {projectReadView,supportProfileView,isProjectReadStateError}=require('./projectReadView.cjs');
const {applySupportProfileCommand,isSupportProfileCommandError,isSupportProfileStateError}=require('./supportProfileCommands.cjs');
const PUBLIC=Symbol('project-operation');
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status,[PUBLIC]:true });
const verifiedActor=async(auth,request)=>{try{return await currentNativeActor(auth,request);}catch(error){const known={actor_authentication_required:401,actor_forbidden:403,identity_provider_unavailable:503};if(Object.hasOwn(known,error?.code)&&known[error.code]===error.status)throw fault(error.code,error.status);throw error;}};
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const mail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
const internal = actor => actor.email.trim().toLowerCase().endsWith('@qualitastech.com');
const freeze = value => value instanceof Date ? value.toISOString() : value && typeof value.toDate === 'function' ? value.toDate().toISOString()
  : Array.isArray(value) ? value.map(freeze) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, freeze(value[key])])) : value;
const revision = snapshot => `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const exact = (data, keys) => { if (!plain(data) || Object.keys(data).some(key => !keys.includes(key))) throw fault('invalid_project_command'); };
const text = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && (!nonempty || value.trim());
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const resolvableKinds = new Set(['metadata', 'budget', 'archive', 'restore', 'support_profile', 'support_billing_entity', 'member_add', 'member_remove', 'member_scope', 'member_notifications',
  'recipient_add', 'recipient_remove', 'recipient_notifications']);
const validReceipt = (receipt, projectId, operationId) => plain(receipt) && typeof receipt.actor_uid === 'string' &&
  typeof receipt.actor_email === 'string' && /^[a-f0-9]{64}$/.test(receipt.payload_hash || '') && plain(receipt.result) &&
  receipt.result.ok === true && receipt.result.project_id === projectId && receipt.result.operation_id === operationId &&
  (receipt.cancelled === undefined || typeof receipt.cancelled === 'boolean');
const projectMutationsEnabled = env => ['BOM_NATIVE_PROJECT_MUTATIONS_ENABLED', 'BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED'].every(key => env[key] === 'true');
const supportProfileMutationsEnabled = env => projectMutationsEnabled(env) && env.BOM_NATIVE_SUPPORT_PROFILE_ENABLED === 'true';
const assertAccess = (project, actor) => {
  if (actor.customClaims.role === 'admin') return;
  if (!Object.hasOwn(project, 'memberIds') || (project.memberIds !== null
    && (!Array.isArray(project.memberIds) || !project.memberIds.includes(actor.uid)))) throw fault('project_forbidden', 403);
};

function createNativeProjectOperations({ db, auth, enabled = false, supportProfileEnabled = false, getServerTimestamp, getDeleteField, now = () => new Date() }) {
  const writesOn = () => (typeof enabled === 'function' ? enabled() : enabled) === true;
  const supportWritesOn = () => writesOn() && (typeof supportProfileEnabled === 'function' ? supportProfileEnabled() : supportProfileEnabled) === true;
  return async request => {
    try {
      const actor = await verifiedActor(auth, request), data = request.data;
      exact(data, ['operation', 'project_id', 'expected_actor_uid', 'expected_version', 'operation_id', 'command','resolve_only']);
      if (!['get', 'support_get', 'command'].includes(data.operation) || !validId(data.project_id)) throw fault('invalid_project_request');
      if (data.expected_actor_uid !== actor.uid) throw fault('actor_session_changed', 403);
      const projectRef = db.collection('projects').doc(data.project_id);
      const read = async transaction => {
        const snapshot = await transaction.get(projectRef);
        if (!snapshot.exists) throw fault('project_not_found', 404);
        const project = snapshot.data();
        if (project.projectId && project.projectId !== data.project_id) throw fault('project_identity_conflict', 409);
        // Only an explicit null retains the legacy rule's migration fallback.
        assertAccess(project, actor);
        return { snapshot, project };
      };
      const canEdit = actor.customClaims.role === 'admin' || internal(actor);
      if (data.operation === 'support_get') {
        exact(data, ['operation', 'project_id', 'expected_actor_uid']);
        return await db.runTransaction(async transaction => {
          const {snapshot,project}=await read(transaction);
          const control=await transaction.get(db.collection('pulseRuntimeControl').doc('cutover'));
          const mode=control.exists?control.data()?.mode??'coexist':'coexist';
          const profile=supportProfileView(project.supportProfile)??null;
          const current=await verifiedActor(auth,request);
          if(current.uid!==actor.uid||normalizeEmail(current.email)!==normalizeEmail(actor.email))throw fault('actor_session_changed',403);
          assertAccess(project,current);
          return {ok:true,project_id:data.project_id,actor_uid:actor.uid,version:revision(snapshot),support_profile:profile,
            permissions:{edit:supportWritesOn()&&['coexist','pulse_only'].includes(mode),resolve:true}};
        });
      }
      if (data.operation === 'get') {
        exact(data, ['operation', 'project_id', 'expected_actor_uid']);
        return await db.runTransaction(async transaction => {
          const { snapshot, project } = await read(transaction);
          const control=await transaction.get(db.collection('pulseRuntimeControl').doc('cutover')),controlData=control.exists?control.data():{},mode=controlData.mode??'coexist',enabledHere=writesOn()&&['coexist','pulse_only'].includes(mode);
          const current=await verifiedActor(auth,request);
          if(current.uid!==actor.uid||normalizeEmail(current.email)!==normalizeEmail(actor.email)||current.customClaims.role!==actor.customClaims.role)throw fault('actor_session_changed',403);
          assertAccess(project,current);
          return { ok: true, project_id: data.project_id, project: projectReadView(data.project_id,project,current), version: revision(snapshot),
            permissions: { edit: enabledHere && canEdit, manage_members: enabledHere && current.customClaims.role === 'admin', notifications: enabledHere && canEdit,
              restore: enabledHere && canEdit && controlData.projectStatusClientWritesFenced === true, restore_resolve: canEdit } };
        });
      }
      if (!validVersion(data.expected_version) || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.operation_id || '') || !plain(data.command)
        || Buffer.byteLength(JSON.stringify(data)) > MAX_INPUT_BYTES) throw fault('invalid_project_command');
      const command = data.command;
      const resolving=data.resolve_only===true;
      if(Object.hasOwn(data,'resolve_only')&&(!resolving||!resolvableKinds.has(command.kind)))throw fault('invalid_project_command');
      const shapes = { metadata: ['kind', 'patch','delay'], budget: ['kind', 'amount'], support_billing_entity: ['kind', 'billing_entity_id'], archive: ['kind'], member_add: ['kind', 'user_id', 'category_scope'], member_remove: ['kind', 'user_id'], member_scope: ['kind', 'user_id', 'category_scope'],
        member_notifications: ['kind', 'user_id', 'enabled'], recipient_add: ['kind', 'email', 'name'], recipient_remove: ['kind', 'email'], recipient_notifications: ['kind', 'email', 'enabled'], restore: ['kind'], support_profile:['kind','patch','machines'] };
      if (!shapes[command.kind]) throw fault('invalid_project_command');
      exact(command, shapes[command.kind]);
      const manage = ['member_add', 'member_remove', 'member_scope', 'recipient_add', 'recipient_remove'].includes(command.kind);
      const support = ['support_profile', 'support_billing_entity'].includes(command.kind);
      if (manage && actor.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
      if (!manage && !canEdit && !support) throw fault('project_edit_forbidden', 403);
      if (command.kind === 'budget' && actor.customClaims.role !== 'admin') throw fault('project_edit_forbidden', 403);
      if (command.kind === 'member_notifications' && actor.customClaims.role !== 'admin' && command.user_id !== actor.uid) throw fault('member_notification_forbidden', 403);
      if (command.kind.startsWith('member_') && (!validId(command.user_id) || command.user_id.length > 128)) throw fault('invalid_project_command');
      if (command.kind.endsWith('_notifications') && typeof command.enabled !== 'boolean') throw fault('invalid_project_command');
      if (command.kind.startsWith('recipient_') && !mail(normalizeEmail(command.email))) throw fault('invalid_project_command');
      const receiptRef = db.collection('pulseProjectOperations').doc(data.project_id).collection('receipts').doc(data.operation_id);
      const auditRef = db.collection('pulseProjectOperations').doc(data.project_id).collection('audit').doc(data.operation_id);
      const payloadHash = createHash('sha256').update(JSON.stringify(freeze({ command, expected_version: data.expected_version }))).digest('hex');
      const authorizeCommand = (project,current) => {
        if(current.uid!==actor.uid||normalizeEmail(current.email)!==normalizeEmail(actor.email))throw fault('actor_session_changed',403);
        assertAccess(project,current);
        if(manage&&current.customClaims.role!=='admin')throw fault('project_management_forbidden',403);
        if(!manage&&!support&&current.customClaims.role!=='admin'&&!internal(current))throw fault('project_edit_forbidden',403);
        if(command.kind==='budget'&&current.customClaims.role!=='admin')throw fault('project_edit_forbidden',403);
        if(command.kind==='member_notifications'&&current.customClaims.role!=='admin'&&command.user_id!==current.uid)throw fault('member_notification_forbidden',403);
      };
      return await db.runTransaction(async transaction => {
        const { snapshot, project } = await read(transaction), receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const current = await verifiedActor(auth, request);
          authorizeCommand(project,current);
          const old = receipt.data();
          if (!validReceipt(old, data.project_id, data.operation_id) || old.actor_uid !== actor.uid || old.actor_email !== normalizeEmail(actor.email) || old.payload_hash !== payloadHash) throw fault('operation_conflict', 409);
          if(resolving)return{...old.result,resolution:old.cancelled?'cancelled':'committed'};
          if(old.cancelled)throw fault('project_request_cancelled',409);return old.result;
        }
        if(resolving){
          const current=await verifiedActor(auth,request);authorizeCommand(project,current);
          const result={ok:true,project_id:data.project_id,operation_id:data.operation_id},record={actor_uid:actor.uid,actor_email:normalizeEmail(actor.email),payload_hash:payloadHash,result,cancelled:true,created_at:getServerTimestamp()};
          const audit={actor_uid:current.uid,project_id:data.project_id,operation_id:data.operation_id,operation:`${command.kind}_cancelled`,expected_version:data.expected_version,payload_hash:payloadHash,created_at:getServerTimestamp()};
          assertDocumentBudget([{path:receiptRef.path,data:record},{path:auditRef.path,data:audit}]);transaction.create(receiptRef,record);transaction.create(auditRef,audit);return{...result,resolution:'cancelled'};
        }
        let target;
        if (command.kind === 'member_add') {
          try { target = await auth.getUser(command.user_id); } catch { throw fault('target_user_unavailable', 409); }
          if (target.uid !== command.user_id || target.disabled || !target.emailVerified || target.customClaims?.status !== 'approved'
            || !['admin', 'user', 'viewer'].includes(target.customClaims.role) || !mail(normalizeEmail(target.email))) throw fault('target_user_unavailable', 409);
          // Looking up the target is an external await: don't grant access using an
          // admin role that was revoked while that lookup was in flight.
          const current = await verifiedActor(auth, request);
          if (current.uid !== actor.uid || normalizeEmail(current.email) !== normalizeEmail(actor.email)) throw fault('actor_session_changed', 403);
          if (current.customClaims.role !== 'admin') throw fault('project_management_forbidden', 403);
        }
        const control=await transaction.get(db.collection('pulseRuntimeControl').doc('cutover')),controlData=control.exists?control.data():{},mode=controlData.mode??'coexist';
        if(support&&!supportWritesOn())throw fault('support_profile_mutations_disabled',503);
        if(!writesOn())throw fault('project_mutations_disabled',503);
        if(!['coexist','pulse_only'].includes(mode))throw fault('project_read_only',503);
        if(command.kind==='restore'){
          if(!control.exists||controlData.projectStatusClientWritesFenced!==true)throw fault('project_status_writers_not_fenced',503);
        }
        if (revision(snapshot) !== data.expected_version) throw fault('project_version_conflict', 409);
        let patch = {}, removeFields = [], delayLog;
        if (support) {
          if (command.kind === 'support_profile') {
            const merged=applySupportProfileCommand(project.supportProfile,command);
            patch={supportProfile:merged.profile};
          } else {
            if (!validId(command.billing_entity_id)) throw fault('invalid_project_command');
            const billing = command.billing_entity_id === 'company'
              ? await transaction.get(db.collection('settings').doc('company'))
              : await transaction.get(db.collection('billingEntities').doc(command.billing_entity_id));
            if (!billing.exists || command.billing_entity_id !== 'company' && billing.data().isActive === false) throw fault('billing_entity_unavailable', 409);
            patch = { billingEntityId: command.billing_entity_id };
          }
        } else if (command.kind === 'budget') {
          if (command.amount !== null && (typeof command.amount !== 'number' || !Number.isFinite(command.amount) || command.amount < 0)) throw fault('invalid_project_command');
          if (command.amount === null) removeFields.push('internalBudget');
          else patch = { internalBudget: command.amount };
        } else if (command.kind === 'metadata') {
          const value = command.patch;
          exact(value, ['projectName', 'clientName', 'clientId', 'billingEntityId', 'description', 'status', 'deadline', 'pulseProjectId']);
          if (!Object.keys(value).length) throw fault('invalid_project_command');
          const lengths = { projectName: 500, clientName: 500, clientId: 512, billingEntityId: 512, description: 4000, deadline: 32 };
          for (const [key, field] of Object.entries(value)) {
            if (lengths[key] && !text(field, lengths[key], key === 'projectName')) throw fault('invalid_project_command');
            if (['clientId', 'billingEntityId'].includes(key) && !validId(field)) throw fault('invalid_project_command');
            if (key === 'deadline' && (!/^\d{4}-\d{2}-\d{2}$/.test(field) || !Number.isFinite(Date.parse(field)) || new Date(field).toISOString().slice(0, 10) !== field)) throw fault('invalid_project_command');
            if (key === 'status' && !['Planning', 'Ongoing', 'Delayed', 'Completed', 'Archived'].includes(field)) throw fault('invalid_project_command');
            if (key === 'status' && (field === 'Archived' || project.status === 'Archived' && field !== project.status)) throw fault('project_status_transition_invalid', 409);
            if (key === 'pulseProjectId' && field !== null && (!Number.isSafeInteger(field) || field <= 0)) throw fault('invalid_project_command');
          }
          patch = { ...value };
          if(project.isBaselined&&Object.hasOwn(value,'deadline')&&value.deadline!==project.deadline){
            if(!command.delay)throw fault('delay_required');
            exact(command.delay,['reason','attribution']);
            const delay=milestoneDelayRecord({project:{...project,projectId:data.project_id},entityType:'project',entityId:data.project_id,entityName:project.projectName||data.project_id,
              previousDate:project.deadline,newDate:value.deadline,reason:command.delay.reason,attribution:command.delay.attribution,
              actor:{uid:actor.uid,email:actor.email,displayName:actor.displayName},now:now(),operationId:data.operation_id});
            const ref=projectRef.collection('delayLogs').doc(delay.id);if((await transaction.get(ref)).exists)throw fault('project_delay_history_conflict',409);
            delayLog={ref,data:delay.data};
          }else if(command.delay!==undefined)throw fault('invalid_project_command');
          if (value.pulseProjectId === null) { delete patch.pulseProjectId; removeFields.push('pulseProjectId'); }
          const clientId = value.clientId ?? project.clientId;
          if (clientId && (Object.hasOwn(value, 'clientId') && value.clientId !== project.clientId || Object.hasOwn(value, 'clientName') && value.clientName !== project.clientName)) {
            const client = await transaction.get(db.collection('clients').doc(clientId));
            if (!client.exists) throw fault('client_unavailable', 409);
            if (client.data().company !== (value.clientName ?? project.clientName)) throw fault('client_identity_conflict', 409);
          }
          if (value.billingEntityId && value.billingEntityId !== project.billingEntityId && value.billingEntityId !== 'company') {
            const billing = await transaction.get(db.collection('billingEntities').doc(value.billingEntityId));
            if (!billing.exists || billing.data().isActive === false) throw fault('billing_entity_unavailable', 409);
          }
          if (project.status === 'Planning' && value.status === 'Ongoing') {
            const documents = await transaction.get(db.collection('projectDocuments').where('projectId', '==', data.project_id).where('type', '==', 'customer-po').limit(1));
            if (!documents.docs.length) throw fault('customer_po_required', 409);
            const bom = await transaction.get(projectRef.collection('bom').doc('data'));
            const categories = bom.exists ? bom.data().categories : [];
            if (!Array.isArray(categories) || categories.some(row => !plain(row) || !Array.isArray(row.items))) throw fault('invalid_material_snapshot', 409);
            patch.bomSnapshot = categories.flatMap(category => category.items);
            patch.bomSnapshotDate = now().toISOString();
          }
        } else if (command.kind === 'archive') {
          if(project.status==='Archived')throw fault('project_already_archived',409);
          patch = { status: 'Archived', archivedAt: now().toISOString() };
        } else if (command.kind === 'restore') {
          if(project.status!=='Archived')throw fault('project_not_archived',409);
          patch = { status: 'Planning', archivedAt: null };
        } else if (command.kind.startsWith('member_')) {
          const members = project.members ?? [], ids = project.memberIds ?? [];
          if (['member_add', 'member_remove'].includes(command.kind) && project.memberIds == null) throw fault('legacy_membership_migration_required', 409);
          if (!Array.isArray(members) || members.length > 200 || members.some(row => !plain(row) || !validId(row.userId)) || new Set(members.map(row => row.userId)).size !== members.length
            || !Array.isArray(ids) || ids.some(value => !validId(value)) || new Set(ids).size !== ids.length) throw fault('invalid_project_members', 409);
          const existing = members.find(row => row.userId === command.user_id);
          const accessIds = [...new Set([...ids, ...members.map(row => row.userId)])];
          if (command.kind === 'member_add') {
            if (existing || ids.includes(command.user_id)) throw fault('project_member_exists', 409);
            if (members.length >= 200) throw fault('project_member_limit', 409);
            // Recheck after the transaction's business reads. Auth and Firestore
            // cannot share a transaction; future access also verifies the profile.
            try { target = await auth.getUser(command.user_id); } catch { throw fault('target_user_unavailable', 409); }
            if (target.uid !== command.user_id || target.disabled || !target.emailVerified || target.customClaims?.status !== 'approved'
              || !['admin', 'user', 'viewer'].includes(target.customClaims.role) || !mail(normalizeEmail(target.email))) throw fault('target_user_unavailable', 409);
          } else if (!existing) throw fault('project_member_not_found', 409);
          let scope;
          if (command.kind === 'member_scope' || command.kind === 'member_add' && !internal(target)) {
            scope = command.category_scope ?? [];
            const bom = await transaction.get(projectRef.collection('bom').doc('data'));
            const names = (bom.data()?.categories || []).map(row => row.name);
            if (!Array.isArray(scope) || scope.length > 200 || scope.some(name => !text(name, 500, true) || !names.includes(name)) || new Set(scope).size !== scope.length) throw fault('invalid_category_scope', 409);
          }
          if (command.kind === 'member_add') {
            const member = { userId: target.uid, email: normalizeEmail(target.email), displayName: target.displayName || target.email, addedBy: actor.uid,
              addedAt: now().toISOString().slice(0, 10), notificationsEnabled: true, ...(scope ? { categoryScope: scope } : {}) };
            patch = { members: [...members, member], memberIds: [...accessIds, target.uid] };
          } else if (command.kind === 'member_remove') {
            if (members.length <= 1) throw fault('last_project_member', 409);
            patch = { members: members.filter(row => row.userId !== command.user_id), memberIds: accessIds.filter(id => id !== command.user_id) };
          } else patch.members = members.map(row => row.userId !== command.user_id ? row : { ...row, ...(command.kind === 'member_scope' ? { categoryScope: scope } : { notificationsEnabled: command.enabled }) });
        } else if (command.kind.startsWith('recipient_')) {
          const recipients = project.externalRecipients ?? [], email = normalizeEmail(command.email);
          if (!Array.isArray(recipients) || recipients.length > 200 || recipients.some(row => !plain(row) || !mail(normalizeEmail(row.email)))) throw fault('invalid_project_recipients', 409);
          const existing = recipients.find(row => normalizeEmail(row.email) === email);
          if (command.kind === 'recipient_add') {
            if (!text(command.name, 500, true)) throw fault('invalid_project_command');
            if (existing) throw fault('project_recipient_exists', 409);
            if (recipients.length >= 200) throw fault('project_recipient_limit', 409);
            patch.externalRecipients = [...recipients, { email, name: command.name.trim(), notificationsEnabled: true }];
          } else {
            if (!existing) throw fault('project_recipient_not_found', 409);
            patch.externalRecipients = command.kind === 'recipient_remove' ? recipients.filter(row => normalizeEmail(row.email) !== email)
              : recipients.map(row => normalizeEmail(row.email) !== email ? row : { ...row, notificationsEnabled: command.enabled });
          }
        }
        const after = { ...project, ...patch }; removeFields.forEach(key => { delete after[key]; });
        const fields = [...Object.keys(patch), ...removeFields];
        const changes = Object.fromEntries(fields.map(key => [key, { before: Object.hasOwn(project, key) ? { present: true, value: project[key] } : { present: false },
          after: Object.hasOwn(after, key) ? { present: true, value: after[key] } : { present: false } }]));
        const result = { ok: true, project_id: data.project_id, operation_id: data.operation_id };
        const audit = { actor_uid: actor.uid, actor_email: normalizeEmail(actor.email), project_id: data.project_id, operation_id: data.operation_id, operation: command.kind, expected_version:data.expected_version, changes,...(delayLog?{delay_log_id:delayLog.ref.path.split('/').at(-1)}:{}),created_at: getServerTimestamp() };
        const recorded = { actor_uid: actor.uid, actor_email: normalizeEmail(actor.email), payload_hash: payloadHash, result, created_at: getServerTimestamp() };
        assertDocumentBudget([{ path: projectRef.path, data: after }, { path: auditRef.path, data: audit }, { path: receiptRef.path, data: recorded },...(delayLog?[{path:delayLog.ref.path,data:delayLog.data}]:[])]);
        const current = await verifiedActor(auth, request);
        authorizeCommand(project,current);
        transaction.update(projectRef, { ...patch, ...Object.fromEntries(removeFields.map(key => [key, getDeleteField()])) });
        if(delayLog)transaction.create(delayLog.ref,delayLog.data);
        transaction.create(auditRef, audit); transaction.create(receiptRef, recorded);
        return result;
      });
    } catch (error) { return { ok: false, error: error?.[PUBLIC]||isMilestoneFault(error)||isProjectReadStateError(error)||isSupportProfileCommandError(error)||isSupportProfileStateError(error) ? error.code : 'project_operations_unavailable' }; }
  };
}
module.exports = { createNativeProjectOperations, projectMutationsEnabled, supportProfileMutationsEnabled };
