const { randomUUID: defaultUUID } = require('node:crypto');

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !['.', '..'].includes(value) && !/[\/\\\x00-\x1f\x7f]/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);

// Preview publication must never share the mutable legacy send filename.
// A create-only object and atomic token metadata also keep concurrent previews independent.
async function writePoPreview({ bucket, purchaseOrder, pdfBuffer, randomUUID = defaultUUID }) {
  if (!validId(purchaseOrder?.projectId) || !validId(purchaseOrder?.id)
    || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.subarray(0, 5).toString() !== '%PDF-') {
    throw Object.assign(new Error('invalid_po_preview_target'), { code: 'invalid_po_preview_target' });
  }
  const previewId = randomUUID(), token = randomUUID();
  if (!uuid(previewId) || !uuid(token)) throw new Error('invalid_po_preview_identity');
  const storagePath = `purchase-orders/${purchaseOrder.projectId}/previews/${previewId}.pdf`;
  await bucket.file(storagePath).save(pdfBuffer, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: 'application/pdf',
      metadata: {
        firebaseStorageDownloadTokens: token,
        preview: 'true',
        projectId: purchaseOrder.projectId,
        poId: purchaseOrder.id,
        poNumber: typeof purchaseOrder.poNumber === 'string' ? purchaseOrder.poNumber : 'DRAFT',
        generatedAt: new Date().toISOString(),
      },
    },
  });
  const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  return { success: true, pdfUrl, storagePath, downloadUrl: pdfUrl, size: pdfBuffer.length };
}

module.exports = { writePoPreview };
