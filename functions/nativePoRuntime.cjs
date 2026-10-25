const { createHash } = require('node:crypto');
const { downloadNativePoArtifact } = require('./nativePoArtifact.cjs');
const procurementEnabled = env => ['BOM_NATIVE_PROCUREMENT_ENABLED', 'BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED'].every(key => env[key] === 'true');
const defaultCompany = {
  id: 'company', companyName: 'Qualitas Technologies Pvt Ltd',
  companyAddress: '#53, Kempegowda Double Road, BEML Layout 5th Stage, Rajarajeshwari Nagar, Bengaluru-560098',
  gstin: '29AAACQ1872F1ZE', stateCode: '29', stateName: 'Karnataka', pan: 'AAACQ1872F', phone: '', email: '', website: '',
  poNumberPrefix: 'PO-QT', poNumberFormat: 'simple', nextPoNumber: 1, defaultPaymentTerms: '', defaultDeliveryTerms: '', defaultTermsAndConditions: '',
};

// Dependencies are local server functions, never callable-request properties.
function createNativePoRuntime({ db, bucket, renderPdf, createResend, buildEmail, downloadArtifact = downloadNativePoArtifact }) {
  const company = async transaction => {
    const stored = await transaction.get(db.collection('settings').doc('company'));
    return stored.exists ? { ...stored.data(), id: 'company' } : { ...defaultCompany };
  };
  const resolveBilling = async (po, project, transaction) => {
    const entityId = po.billingEntityId || project.billingEntityId;
    if (entityId === 'company') return company(transaction);
    if (entityId) {
      if (typeof entityId !== 'string' || entityId.length > 512 || /[\/\x00-\x1f]/.test(entityId) || ['.', '..'].includes(entityId)) throw new Error('invalid_billing_entity');
      const stored = await transaction.get(db.collection('billingEntities').doc(entityId));
      return stored.exists ? { ...stored.data(), id: entityId, companyName: stored.data().legalName } : null;
    }
    const settings = await company(transaction);
    const snapshot = await transaction.get(db.collection('billingEntities').limit(201));
    if (snapshot.docs.length > 200) throw new Error('billing_entity_limit');
    const entities = [{ ...settings, legalName: settings.companyName, displayName: settings.companyName, isActive: true },
      ...snapshot.docs.map(row => ({ ...row.data(), id: row.id }))].filter(row => row.isActive !== false);
    const chosen = entities.find(row => row.isDefault) || entities.find(row => /data\s*sensor/i.test(`${row.displayName} ${row.legalName}`)) || entities.find(row => row.id === 'company') || entities[0];
    return chosen ? { ...chosen, companyName: chosen.legalName } : null;
  };
  const prepareArtifact = (purchaseOrder, companySettings, intent) => {
    const filename = createHash('sha256').update(JSON.stringify([intent.project_id, intent.po_id, intent.attempt_id])).digest('hex');
    return renderPdf({ data: { purchaseOrder, companySettings, ...(companySettings.logoPath ? { companyLogoPath: companySettings.logoPath } : {}) } },
      { path: `native-purchase-orders/${filename}.pdf`, intentHash: intent.payload_hash, key: intent.artifact_key });
  };
  const sendEmail = async (frozen, idempotencyKey) => {
    const bytes = await downloadArtifact(bucket, frozen.artifact);
    const payload = buildEmail(frozen.purchaseOrder, frozen.companySettings, frozen.recipientEmail, frozen.ccEmails, bytes);
    const result = await createResend().emails.send(payload, { idempotencyKey });
    if (result.error || !result.data?.id) throw new Error('provider_outcome_unconfirmed');
    return { id: result.data.id };
  };
  return { resolveBilling, prepareArtifact, sendEmail };
}
module.exports = { createNativePoRuntime, procurementEnabled };
