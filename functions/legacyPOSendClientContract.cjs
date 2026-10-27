// Compatibility marker, not authorization: auth/role checks stay authoritative in legacyPoAccess.
// Clients that predate server-side material finalization wrote the whole BOM after a send and send no marker.
const LEGACY_PO_SEND_CLIENT_VERSION = 1;

function assertLegacyPOSendClientContract(data) {
  if (data?.serverMaterialFinalizationVersion === LEGACY_PO_SEND_CLIENT_VERSION) return;
  throw Object.assign(new Error('This page is out of date. Reload the app and try again. The Purchase Order was not sent.'),
    { code: 'failed-precondition' });
}

module.exports = { assertLegacyPOSendClientContract, LEGACY_PO_SEND_CLIENT_VERSION };
