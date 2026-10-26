const test = require('node:test');
const assert = require('node:assert/strict');
const { freezeLegacyPOEmailPdf } = require('./legacyPOEmailRetryPdf.cjs');

test('freezes the already-downloaded PDF bytes at an attempt-specific create-only path', async () => {
  const calls = [];
  const bucket = { name: 'test-bucket', file: path => ({ path, save: async (bytes, options) => calls.push({ path, bytes, options }) }) };
  const pdfBuffer = Buffer.from('the exact attachment bytes');
  const frozen = await freezeLegacyPOEmailPdf({ bucket, projectId: 'P-1', attemptId: 'attempt_1', pdfBuffer, downloadToken: 'token-1' });

  assert.equal(frozen.path, 'purchase-orders/P-1/legacy-send-attempts/attempt_1.pdf');
  assert.equal(frozen.file.path, frozen.path);
  assert.equal(frozen.size, pdfBuffer.length);
  assert.equal(frozen.sha256, require('node:crypto').createHash('sha256').update(pdfBuffer).digest('hex'));
  assert.equal(frozen.downloadUrl, `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(frozen.path)}?alt=media&token=token-1`);
  assert.deepEqual(calls, [{
    path: frozen.path,
    bytes: pdfBuffer,
    options: { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
      contentType: 'application/pdf', metadata: { firebaseStorageDownloadTokens: 'token-1' },
    } },
  }]);
});

test('rejects an empty PDF or unsafe identity before writing a storage object', async () => {
  const calls = [];
  const bucket = { name: 'test-bucket', file: path => ({ path, save: async () => calls.push(path) }) };
  await assert.rejects(freezeLegacyPOEmailPdf({ bucket, projectId: '../P', attemptId: 'attempt_1', pdfBuffer: Buffer.from('pdf') }), /invalid/i);
  await assert.rejects(freezeLegacyPOEmailPdf({ bucket, projectId: 'P', attemptId: 'attempt_1', pdfBuffer: Buffer.alloc(0) }), /invalid/i);
  assert.deepEqual(calls, []);
});
