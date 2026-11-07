// The server SDK is loaded lazily, only for non-plain objects: pure JSON/Date engine paths never need it.
let sdkTypes;
const types = () => sdkTypes ??= (({ DocumentReference, GeoPoint, VectorValue }) => ({ DocumentReference, GeoPoint, VectorValue }))(require('@google-cloud/firestore'));
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const MAX_DEPTH = 64;

// Canonical logical form of stored Firestore values for hashing, durable snapshots and callable responses.
// Plain JSON, Date and Timestamp keep their historical form (ISO, sorted keys), so existing digests are unchanged.
// SDK classes are recognised by real instance, never by a constructor name a plain object could claim.
// Any other non-plain object fails closed with a code only: SDK connection objects must not be serialised.
function createFreeze(fault) {
  const invalid = () => fault('invalid_po_state', 409);
  const walk = (value, depth) => {
    if (depth > MAX_DEPTH) throw invalid();
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) { if (!Number.isFinite(value.getTime())) throw invalid(); return value.toISOString(); }
    if (Array.isArray(value)) return value.map(row => walk(row, depth + 1));
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, walk(value[key], depth + 1)]));
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __type: 'bytes', base64: Buffer.from(value).toString('base64') };
    const { DocumentReference, GeoPoint, VectorValue } = types();
    if (value instanceof DocumentReference) return { __type: 'reference', path: value.path };
    if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
    if (value instanceof VectorValue) return value.toArray();
    if (typeof value.toDate === 'function') return walk(value.toDate(), depth + 1);
    throw invalid();
  };
  return value => walk(value, 0);
}
module.exports = { createFreeze };
