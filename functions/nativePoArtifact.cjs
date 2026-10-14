const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const fault = code => Object.assign(new Error(code), { code, status: 409 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validate = target => {
  if (!target || !/^native-purchase-orders\/[a-f0-9]{64}\.pdf$/.test(target.path) || !/^[a-f0-9]{64}$/.test(target.intentHash) || typeof target.key !== 'string' || target.key.length < 64) throw fault('invalid_native_pdf_target');
};
const signature = (target, hash) => createHmac('sha256', target.key).update(JSON.stringify([target.path, target.intentHash, hash])).digest('hex');
const descriptor = (bucket, target, metadata) => ({ path: target.path, generation: String(metadata.generation), sha256: metadata.metadata.nativeSha256,
  size: Number(metadata.size), url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(target.path)}?alt=media&token=${metadata.metadata.firebaseStorageDownloadTokens}` });

// Only the protected attempt record holds the attestation key. A client-created
// object cannot be accepted merely because it copied a path or payload hash.
async function readNativePoArtifact(bucket, target) {
  validate(target);
  const file = bucket.file(target.path);
  if (!(await file.exists())[0]) return null;
  const [metadata] = await file.getMetadata();
  const data = metadata.metadata || {};
  if (data.nativeIntentHash !== target.intentHash || !/^[a-f0-9]{64}$/.test(data.nativeSha256 || '') || !/^[a-f0-9]{64}$/.test(data.nativeSignature || '')
    || !timingSafeEqual(Buffer.from(signature(target, data.nativeSha256)), Buffer.from(data.nativeSignature)) || !metadata.generation || !data.firebaseStorageDownloadTokens) throw fault('native_pdf_artifact_conflict');
  const [bytes] = await bucket.file(target.path, { generation: metadata.generation }).download();
  if (sha(bytes) !== data.nativeSha256 || bytes.length !== Number(metadata.size)) throw fault('native_pdf_artifact_conflict');
  return descriptor(bucket, target, metadata);
}

async function writeNativePoArtifact(bucket, target, bytes) {
  validate(target);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw fault('invalid_native_pdf_artifact');
  const cached = await readNativePoArtifact(bucket, target); if (cached) return cached;
  const hash = sha(bytes);
  try {
    await bucket.file(target.path).save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/pdf',
      metadata: { nativeIntentHash: target.intentHash, nativeSha256: hash, nativeSignature: signature(target, hash), firebaseStorageDownloadTokens: randomUUID() } } });
  } catch (error) { if (Number(error.code) !== 412) throw error; }
  return readNativePoArtifact(bucket, target);
}
async function downloadNativePoArtifact(bucket, artifact) {
  if (!artifact || !/^native-purchase-orders\/[a-f0-9]{64}\.pdf$/.test(artifact.path) || !artifact.generation || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw fault('invalid_native_pdf_artifact');
  const [bytes] = await bucket.file(artifact.path, { generation: artifact.generation }).download();
  if (sha(bytes) !== artifact.sha256 || bytes.length !== artifact.size) throw fault('native_pdf_artifact_conflict');
  return bytes;
}
module.exports = { readNativePoArtifact, writeNativePoArtifact, downloadNativePoArtifact };
