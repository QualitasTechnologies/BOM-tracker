const test = require('node:test'); const assert = require('node:assert/strict');
const { readNativePoArtifact, writeNativePoArtifact, downloadNativePoArtifact } = require('./nativePoArtifact.cjs');
function fixture() {
  const files = new Map(); let generation = 0, saves = 0;
  const bucket = { name: 'fixture', file: (path, options = {}) => ({
    exists: async () => [files.has(path)], getMetadata: async () => [files.get(path).metadata],
    download: async () => { const value = files.get(path); if (!value || options.generation && String(options.generation) !== value.metadata.generation) throw new Error('generation missing'); return [value.bytes]; },
    save: async (bytes, options) => { assert.equal(options.preconditionOpts.ifGenerationMatch, 0); if (files.has(path)) throw { code: 412 }; saves++; files.set(path, { bytes, metadata: { ...options.metadata, generation: String(++generation), size: String(bytes.length) } }); },
  }) };
  return { bucket, files, saves: () => saves, target: { path: `native-purchase-orders/${'a'.repeat(64)}.pdf`, intentHash: 'b'.repeat(64), key: 'c'.repeat(72) } };
}
test('native artifacts have immutable generation, attested bytes and a cached recovery path', async () => {
  const f = fixture(), bytes = Buffer.from('original PDF'); const first = await writeNativePoArtifact(f.bucket, f.target, bytes);
  assert.deepEqual(await writeNativePoArtifact(f.bucket, f.target, Buffer.from('new render')), first); assert.equal(f.saves(), 1);
  assert.deepEqual(await downloadNativePoArtifact(f.bucket, first), bytes);
});
test('forged metadata or replaced bytes cannot become a native email attachment', async () => {
  const f = fixture(); await writeNativePoArtifact(f.bucket, f.target, Buffer.from('PDF'));
  f.files.get(f.target.path).bytes = Buffer.from('BAD');
  await assert.rejects(readNativePoArtifact(f.bucket, f.target), { code: 'native_pdf_artifact_conflict' });
  const g = fixture(); const artifact = await writeNativePoArtifact(g.bucket, g.target, Buffer.from('PDF'));
  g.files.get(g.target.path).metadata.metadata.nativeSignature = 'd'.repeat(64);
  await assert.rejects(readNativePoArtifact(g.bucket, g.target), { code: 'native_pdf_artifact_conflict' });
  await assert.rejects(readNativePoArtifact(g.bucket, { ...g.target, key: 'e'.repeat(72) }), { code: 'native_pdf_artifact_conflict' });
  assert.ok(artifact.url.startsWith('https://firebasestorage.googleapis.com/'));
});
