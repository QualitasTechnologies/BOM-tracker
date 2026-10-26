const { createHash, randomUUID } = require('node:crypto');

const validProjectId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const validAttemptId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function legacyPOEmailRetryPdfPath(projectId, attemptId) {
  if (!validProjectId(projectId) || !validAttemptId(attemptId)) throw new Error('invalid PO retry PDF identity');
  return `purchase-orders/${projectId}/legacy-send-attempts/${attemptId}.pdf`;
}

async function freezeLegacyPOEmailPdf({ bucket, projectId, attemptId, pdfBuffer, downloadToken = randomUUID() }) {
  if (!bucket || typeof bucket.name !== 'string' || !bucket.name
    || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0
    || typeof downloadToken !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(downloadToken)) {
    throw new Error('invalid PO retry PDF');
  }
  const path = legacyPOEmailRetryPdfPath(projectId, attemptId);
  const file = bucket.file(path);
  await file.save(pdfBuffer, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: 'application/pdf', metadata: { firebaseStorageDownloadTokens: downloadToken } },
  });
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
  return { path, file, downloadToken, downloadUrl, size: pdfBuffer.length, sha256 };
}

module.exports = { freezeLegacyPOEmailPdf, legacyPOEmailRetryPdfPath };
