const isNativeSpecSearchEnabled = value => value === 'true';
function nativeSpecSearchEnabled(env = {}) {
  return ['BOM_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', 'BOM_NATIVE_SPEC_SEARCH_ENABLED'].every(key => isNativeSpecSearchEnabled(env[key]));
}
module.exports = {isNativeSpecSearchEnabled, nativeSpecSearchEnabled};
