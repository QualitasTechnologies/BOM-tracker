const MATERIAL_FENCE = Object.freeze({fence: 'legacy_bom_data_writes', version: 1});
function isCanonicalMaterialFence(snapshot) {
  return snapshot.exists && snapshot.data()?.fence === MATERIAL_FENCE.fence && snapshot.data()?.version === MATERIAL_FENCE.version;
}
function materialWritesAllowed(snapshot, channel) {
  return channel === 'native' ? isCanonicalMaterialFence(snapshot) : channel === 'legacy' && !snapshot.exists;
}
module.exports = {MATERIAL_FENCE, isCanonicalMaterialFence, materialWritesAllowed};
