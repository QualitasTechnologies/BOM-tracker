function isNativeSpecSearchEnabled(value) {
  return value === "true";
}

function rejectLegacySpecSearch(response, enabled = () => false) {
  if (!enabled()) return false;
  response.status(410).json({success: false, error: "native_spec_search_enabled"});
  return true;
}

module.exports = {isNativeSpecSearchEnabled, rejectLegacySpecSearch};
