'use strict';

function createLegacyPoAccess({ admin, functions }) {
  const HttpsError = functions.https.HttpsError;

  function fail(code, message) {
    throw new HttpsError(code, message);
  }

  function defaultCompanySettings() {
    return {
      companyName: 'Qualitas Technologies Pvt Ltd',
      companyAddress: '#53, Kempegowda Double Road, BEML Layout 5th Stage, Rajarajeshwari Nagar, Bengaluru-560098',
      gstin: '29AAACQ1872F1ZE',
      stateCode: '29',
      stateName: 'Karnataka',
      pan: 'AAACQ1872F',
      phone: '',
      email: '',
      website: '',
    };
  }

  async function loadCompanyEntity(db) {
    const companySnapshot = await db.collection('settings').doc('company').get();
    const settings = companySnapshot.exists ? companySnapshot.data() || {} : defaultCompanySettings();
    return {
      ...settings,
      id: 'company',
      legalName: settings.companyName,
      displayName: settings.companyName,
      isActive: true,
    };
  }

  async function loadDefaultBillingEntity(db) {
    const [company, billingSnapshot] = await Promise.all([
      loadCompanyEntity(db),
      db.collection('billingEntities').get(),
    ]);
    const entities = (billingSnapshot.docs || []).map(entityDoc => ({
      id: entityDoc.id,
      ...(entityDoc.data() || {}),
    }));
    const activeEntities = [company, ...entities].filter(entity => entity.isActive !== false);
    return activeEntities.find(entity => entity.isDefault) ||
      activeEntities.find(entity => /data\s*sensor/i.test(`${entity.displayName || ''} ${entity.legalName || ''}`)) ||
      activeEntities.find(entity => entity.id === 'company') ||
      activeEntities[0] || null;
  }

  async function loadBillingEntity(db, entityId) {
    if (!entityId) return loadDefaultBillingEntity(db);
    if (entityId === 'company') return loadCompanyEntity(db);

    const billingSnapshot = await db.collection('billingEntities').doc(entityId).get();
    if (!billingSnapshot.exists) fail('failed-precondition', 'Billing entity for this PO was not found');
    return { id: billingSnapshot.id || entityId, ...(billingSnapshot.data() || {}) };
  }

  async function loadRequestContext(request, { adminOnly = false, requirePending = false, nativeEnabled = false } = {}) {
    const uid = request?.auth?.uid;
    if (!uid) fail('unauthenticated', 'Authentication required');

    const user = await admin.auth().getUser(uid);
    const claims = user?.customClaims || {};
    if (claims.status !== 'approved') fail('permission-denied', 'Approved access is required');
    const isAdmin = claims.role === 'admin';
    if (adminOnly && !isAdmin) fail('permission-denied', 'Admin privileges required');

    const callerPO = request?.data?.purchaseOrder;
    const projectId = typeof callerPO?.projectId === 'string' ? callerPO.projectId.trim() : '';
    const poId = typeof callerPO?.id === 'string' ? callerPO.id.trim() : '';
    if (!projectId || !poId) fail('invalid-argument', 'A project and purchase order are required');

    const db = admin.firestore();
    const projectRef = db.collection('projects').doc(projectId);
    const projectSnapshot = await projectRef.get();
    if (!projectSnapshot.exists) fail('not-found', 'Project not found');
    const storedProject = projectSnapshot.data() || {};

    if (!isAdmin && storedProject.memberIds != null) {
      if (!Array.isArray(storedProject.memberIds) || !storedProject.memberIds.includes(uid)) {
        fail('permission-denied', 'Project access required');
      }
    }

    const poRef = projectRef.collection('purchaseOrders').doc(poId);
    const poSnapshot = await poRef.get();
    if (!poSnapshot.exists) fail('not-found', 'Purchase Order not found');
    const storedPO = poSnapshot.data() || {};
    if (storedPO.projectId && storedPO.projectId !== projectId) {
      fail('failed-precondition', 'Purchase Order does not belong to this project');
    }
    if (nativeEnabled) {
      fail('failed-precondition', 'Native procurement is enabled. Reopen this project in Pulse to send the Purchase Order.');
    }
    if (requirePending && storedPO.nativeSendAttemptId) {
      fail('failed-precondition', 'A native Purchase Order send attempt is already active');
    }
    if (requirePending && storedPO.status !== 'pending-approval') {
      fail('failed-precondition', 'Only POs pending approval can be sent');
    }

    const billingEntityId = storedPO.billingEntityId || storedProject.billingEntityId;
    const billingEntity = await loadBillingEntity(db, billingEntityId);
    if (!billingEntity) fail('failed-precondition', 'No billing entity is available for this PO');

    const po = { ...storedPO, id: poSnapshot.id || poId, projectId };
    const companySettings = {
      companyName: billingEntity.legalName || billingEntity.companyName || '',
      companyAddress: billingEntity.companyAddress || '',
      gstin: billingEntity.gstin || '',
      stateCode: billingEntity.stateCode || '',
      stateName: billingEntity.stateName || '',
      pan: billingEntity.pan || '',
      phone: billingEntity.phone || '',
      email: billingEntity.email || '',
      website: billingEntity.website || '',
    };
    if (!companySettings.companyName) {
      fail('failed-precondition', 'Billing entity is missing its legal name');
    }

    return {
      uid,
      isAdmin,
      projectId,
      project: { ...storedProject, id: projectSnapshot.id || projectId },
      po,
      billingEntity,
      companySettings,
      companyLogoPath: billingEntity.logoPath || undefined,
    };
  }

  function validateEmail(value, label) {
    const email = typeof value === 'string' ? value.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail('invalid-argument', `${label} must be a valid email address`);
    }
    return email;
  }

  return {
    async prepareSend(request, { nativeEnabled = false } = {}) {
      const context = await loadRequestContext(request, { adminOnly: true, requirePending: true, nativeEnabled });
      const recipientEmail = validateEmail(request?.data?.recipientEmail, 'Recipient');
      const ccEmails = request?.data?.ccEmails == null ? [] : request.data.ccEmails;
      if (!Array.isArray(ccEmails)) {
        fail('invalid-argument', 'CC recipients must be an array of email addresses');
      }
      return { ...context, recipientEmail, ccEmails: ccEmails.map(email => validateEmail(email, 'CC recipient')) };
    },

    async preparePreview(request) {
      return loadRequestContext(request);
    },
  };
}

module.exports = { createLegacyPoAccess };
