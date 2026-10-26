// Resend SDK v4 returns these named 4xx responses as successful HTTP responses
// with an `error` body. They prove the current request was rejected. A network
// throw, 409 conflict, 5xx response or unknown shape stays ambiguous so the PO
// remains locked against a duplicate order.
const DEFINITIVE_REJECTION_NAMES = new Set([
  'missing_required_field',
  'invalid_idempotency_key',
  'invalid_access',
  'invalid_parameter',
  'invalid_region',
  'rate_limit_exceeded',
  'missing_api_key',
  'invalid_api_Key',
  'invalid_from_address',
  'validation_error',
  'not_found',
  'method_not_allowed',
]);

function isDefinitiveResendRejection(error) {
  return !!error && typeof error === 'object' && DEFINITIVE_REJECTION_NAMES.has(error.name);
}

module.exports = { isDefinitiveResendRejection };
