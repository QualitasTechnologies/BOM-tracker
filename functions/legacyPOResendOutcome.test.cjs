const test = require('node:test');
const assert = require('node:assert/strict');
const { isDefinitiveResendRejection } = require('./legacyPOResendOutcome.cjs');

test('known Resend 4xx rejections prove the email request was rejected', () => {
  for (const name of ['missing_required_field', 'invalid_parameter', 'rate_limit_exceeded', 'missing_api_key', 'invalid_api_Key', 'invalid_from_address', 'validation_error', 'not_found', 'method_not_allowed']) {
    assert.equal(isDefinitiveResendRejection({ name, message: 'rejected' }), true, name);
  }
});

test('ambiguous, server, conflict and unrecognized provider errors remain uncertain', () => {
  for (const error of [
    null,
    undefined,
    { name: 'application_error' },
    { name: 'internal_server_error' },
    { name: 'concurrent_idempotent_requests' },
    { name: 'invalid_idempotent_request' },
    { name: 'unknown_error' },
    { message: 'request failed' },
  ]) assert.equal(isDefinitiveResendRejection(error), false);
});
