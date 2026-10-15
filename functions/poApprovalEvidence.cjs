const {createHash} = require('node:crypto');

const MISMATCH = 'notification_provider_evidence_mismatch';
const TAG_NAME = 'pulse_po_delivery';
const SKEW_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const SENT_EVENTS = new Set(['sent', 'delivered', 'opened', 'clicked', 'delivery_delayed', 'bounced', 'complained', 'failed']);
// The native send can only express these keys; anything else would let proof cover a different payload.
const MAIL_KEYS = ['from', 'html', 'subject', 'tags', 'to'];

function sort(value) {
  return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
const approvalMailHash = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string';
const hasKeys = (value, keys) => isObject(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const sameList = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index]);
const emptyList = value => Array.isArray(value) && value.length === 0;
const positiveMs = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function check(condition) {
  if (!condition) throw new Error(MISMATCH);
}

function verify({deliveryId, providerId, job, evidence, nowMs}) {
  check(isText(deliveryId) && /^[a-f0-9]{64}$/.test(deliveryId) && isText(providerId) && UUID.test(providerId));
  check(isObject(job) && job.schema === 1 && positiveMs(job.first_dispatched_ms));
  for (const key of ['parent_id', 'project_id', 'po_id', 'kind']) check(isText(job[key]) && job[key]);
  check(/^[a-f0-9]{64}$/.test(job.parent_id) && ['submit','request_changes'].includes(job.kind));
  check(job.idempotency_key === `po-approval/${deliveryId}`);

  const mail = job.mail;
  check(hasKeys(mail, MAIL_KEYS) && job.mail_hash === approvalMailHash(mail));
  check(isText(mail.from) && isText(mail.subject) && isText(mail.html) && Array.isArray(mail.to) && mail.to.length>0 && mail.to.length<=50 && mail.to.every(isText));
  const tags = mail.tags;
  check(Array.isArray(tags) && tags.length === 1 && hasKeys(tags[0], ['name', 'value']) && tags[0].name === TAG_NAME && tags[0].value === deliveryId);

  check(isObject(evidence) && evidence.object === 'email' && isText(evidence.id) && UUID.test(evidence.id));
  const id = providerId.toLowerCase();
  check(evidence.id.toLowerCase() === id);
  check(evidence.from === mail.from && evidence.subject === mail.subject && evidence.html === mail.html && sameList(evidence.to, mail.to));
  check(evidence.text === null && evidence.scheduled_at === null);
  check(emptyList(evidence.bcc) && emptyList(evidence.cc) && emptyList(evidence.reply_to));
  check(Array.isArray(evidence.tags) && evidence.tags.length === 1 && hasKeys(evidence.tags[0], ['name', 'value']) && evidence.tags[0].name === TAG_NAME && evidence.tags[0].value === deliveryId);
  check(SENT_EVENTS.has(evidence.last_event));

  check(isText(evidence.created_at) && typeof nowMs === 'number' && Number.isFinite(nowMs));
  // The documented REST response uses a SQL-style UTC timestamp, including microseconds.
  const providerUTC=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,9})?\+00$/;
  const timestamp=providerUTC.test(evidence.created_at)?evidence.created_at.replace(' ','T').replace(/\+00$/,'Z'):evidence.created_at;
  check(ISO.test(timestamp));
  const created = Date.parse(timestamp);
  check(positiveMs(created) && created >= job.first_dispatched_ms - SKEW_MS && created <= nowMs + SKEW_MS);

  return {
    provider_id: id,
    provider_event: evidence.last_event,
    provider_created_ms: created,
    evidence_hash: approvalMailHash({
      provider_id: id, provider_event: evidence.last_event, provider_created_ms: created, delivery_id: deliveryId,
      from: evidence.from, to: evidence.to, subject: evidence.subject, html: evidence.html, text: evidence.text,
      cc: evidence.cc, bcc: evidence.bcc, reply_to: evidence.reply_to, scheduled_at: evidence.scheduled_at, tags: evidence.tags
    })
  };
}

// Any failure, including hostile getters or proxies, collapses to one fixed error so no payload detail escapes.
function verifyPOApprovalEvidence(input) {
  try {
    return verify(input);
  } catch {
    throw new Error(MISMATCH);
  }
}

module.exports = {verifyPOApprovalEvidence, approvalMailHash};
