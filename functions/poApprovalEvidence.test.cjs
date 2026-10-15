const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {verifyPOApprovalEvidence, approvalMailHash} = require('./poApprovalEvidence.cjs');

const ERR = 'notification_provider_evidence_mismatch';
const DELIVERY = 'a'.repeat(64);
const PROVIDER = '123e4567-e89b-42d3-a456-426614174000';
const FIRST = Date.parse('2026-10-15T10:00:00.000Z');
const NOW = FIRST + 60_000;
const TAG = {name: 'pulse_po_delivery', value: DELIVERY};

const clone = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function makeMail(overrides = {}) {
  return {from: 'PO <po@example.com>', to: ['a@example.com', 'b@example.com'], subject: 'PO 1 approved', html: '<p>Approved &amp; ready</p>', tags: [{...TAG}], ...overrides};
}
function makeJob(mailOverrides = {}, jobOverrides = {}) {
  const mail = makeMail(mailOverrides);
  return {schema: 1, parent_id: 'b'.repeat(64), project_id: 'proj1', po_id: 'po1', kind: 'submit', mail, mail_hash: approvalMailHash(mail),
    idempotency_key: `po-approval/${DELIVERY}`, first_dispatched_ms: FIRST, ...jobOverrides};
}
function makeEvidence(overrides = {}) {
  const mail = makeMail();
  return {object: 'email', id: PROVIDER, from: mail.from, to: [...mail.to], subject: mail.subject, html: mail.html, text: null,
    bcc: [], cc: [], reply_to: [], created_at: new Date(FIRST + 1000).toISOString(), scheduled_at: null, tags: [{...TAG}], last_event: 'delivered', ...overrides};
}
const verify = (parts = {}) => verifyPOApprovalEvidence({deliveryId: DELIVERY, providerId: PROVIDER, job: makeJob(), evidence: makeEvidence(), nowMs: NOW, ...parts});
const rejects = (parts, label) => assert.throws(() => verify(parts), error => error instanceof Error && error.message === ERR && Object.keys(error).length === 0, label);
test('the documented provider UTC timestamp form is accepted without relaxing message matching',()=>{
  const proof=verify({evidence:makeEvidence({created_at:'2026-10-15 10:00:01.000000+00'})});
  assert.equal(proof.provider_created_ms,FIRST+1000);
});
test('proof rejects unsupported delivery identity and workflow snapshots',()=>{
  rejects({deliveryId:'not-a-hash',job:makeJob({}, {idempotency_key:'po-approval/not-a-hash'})});
  rejects({job:makeJob({}, {kind:'approve'})});
  rejects({job:makeJob({}, {parent_id:'not-a-hash'})});
});

test('approvalMailHash is canonical, key-order independent and matches the dispatcher digest', () => {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  const expected = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
  const mail = makeMail();
  assert.equal(approvalMailHash(mail), expected(mail));
  assert.equal(approvalMailHash({b: 1, a: {d: 1, c: [{z: 1, y: 2}]}}), approvalMailHash({a: {c: [{y: 2, z: 1}], d: 1}, b: 1}));
});

test('matching unchanged payload returns only the selected proof fields', () => {
  const result = verify();
  assert.deepEqual(Object.keys(result).sort(), ['evidence_hash', 'provider_created_ms', 'provider_event', 'provider_id']);
  assert.equal(result.provider_id, PROVIDER);
  assert.equal(result.provider_event, 'delivered');
  assert.equal(result.provider_created_ms, FIRST + 1000);
  assert.match(result.evidence_hash, /^[0-9a-f]{64}$/);
  const text = JSON.stringify(result);
  assert.ok(!text.includes('example.com') && !text.includes('Approved'));
  assert.deepEqual(verify(), result);
});

test('provider UUID is matched case-insensitively and returned normalized', () => {
  const result = verify({providerId: PROVIDER.toUpperCase(), evidence: makeEvidence({id: PROVIDER})});
  assert.equal(result.provider_id, PROVIDER);
  assert.deepEqual(verify({evidence: makeEvidence({id: PROVIDER.toUpperCase()})}), verify());
  rejects({providerId: 'not-a-uuid', evidence: makeEvidence({id: 'not-a-uuid'})});
  rejects({providerId: '123e4567-e89b-42d3-a456-42661417400'});
  rejects({evidence: makeEvidence({id: '123e4567-e89b-42d3-a456-426614174001'})});
  rejects({evidence: makeEvidence({id: undefined})});
});

test('evidence hash changes with the provider event and time but not key order', () => {
  const base = verify();
  assert.notEqual(verify({evidence: makeEvidence({last_event: 'opened'})}).evidence_hash, base.evidence_hash);
  assert.notEqual(verify({evidence: makeEvidence({created_at: new Date(FIRST + 2000).toISOString()})}).evidence_hash, base.evidence_hash);
  const reordered = Object.fromEntries(Object.entries(makeEvidence()).reverse());
  assert.equal(verify({evidence: reordered}).evidence_hash, base.evidence_hash);
});

test('every payload field mismatch is rejected', () => {
  rejects({evidence: makeEvidence({object: 'batch'})});
  rejects({evidence: makeEvidence({from: 'Other <o@example.com>'})});
  rejects({evidence: makeEvidence({subject: 'PO 2 approved'})});
  rejects({evidence: makeEvidence({html: '<p>Approved</p>'})});
  rejects({evidence: makeEvidence({text: 'plain'})});
  rejects({evidence: makeEvidence({to: ['a@example.com']})});
  rejects({evidence: makeEvidence({to: ['b@example.com', 'a@example.com']})});
  rejects({evidence: makeEvidence({to: ['a@example.com', 'b@example.com', 'c@example.com']})});
  rejects({evidence: makeEvidence({to: 'a@example.com'})});
  rejects({evidence: makeEvidence({cc: ['c@example.com']})});
  rejects({evidence: makeEvidence({bcc: ['c@example.com']})});
  rejects({evidence: makeEvidence({reply_to: ['c@example.com']})});
  rejects({evidence: makeEvidence({scheduled_at: '2026-10-16T00:00:00.000Z'})});
  rejects({evidence: makeEvidence({cc: null})});
});

test('missing evidence fields are never skipped', () => {
  for (const key of ['object', 'id', 'from', 'to', 'subject', 'html', 'text', 'bcc', 'cc', 'reply_to', 'created_at', 'scheduled_at', 'tags', 'last_event']) {
    const evidence = makeEvidence();
    delete evidence[key];
    rejects({evidence}, key);
  }
  rejects({evidence: null});
  rejects({evidence: []});
  rejects({evidence: 'email'});
  rejects({evidence: undefined});
});

test('tags must be the single exact frozen delivery tag', () => {
  rejects({evidence: makeEvidence({tags: []})});
  rejects({evidence: makeEvidence({tags: [{name: 'pulse_po_delivery', value: 'b'.repeat(64)}]})});
  rejects({evidence: makeEvidence({tags: [{name: 'other', value: DELIVERY}]})});
  rejects({evidence: makeEvidence({tags: [{...TAG}, {...TAG}]})});
  rejects({evidence: makeEvidence({tags: [{...TAG}, {name: 'extra', value: 'x'}]})});
  rejects({evidence: makeEvidence({tags: [{...TAG, extra: 1}]})});
  rejects({evidence: makeEvidence({tags: {...TAG}})});
  rejects({evidence: makeEvidence({tags: undefined})});
  rejects({deliveryId: 'b'.repeat(64)});
});

test('tag collision: an old pre-tag job with the tag absent is not accepted', () => {
  const mail = makeMail();
  delete mail.tags;
  rejects({job: makeJob({tags: undefined}, {mail, mail_hash: approvalMailHash(mail)}), evidence: makeEvidence({tags: []})});
  rejects({job: makeJob({tags: []}), evidence: makeEvidence({tags: []})});
  const other = [{name: 'pulse_po_delivery', value: 'c'.repeat(64)}];
  rejects({job: makeJob({tags: other}), evidence: makeEvidence({tags: other})});
  // same delivery tag on evidence, different local tag
  rejects({job: makeJob({tags: other}), evidence: makeEvidence()});
});

test('invalid local job snapshot is rejected', () => {
  rejects({job: null});
  rejects({job: 'job'});
  rejects({job: makeJob({}, {schema: 2})});
  rejects({job: makeJob({}, {schema: undefined})});
  for (const key of ['parent_id', 'project_id', 'po_id', 'kind']) {
    rejects({job: makeJob({}, {[key]: ''})}, key);
    rejects({job: makeJob({}, {[key]: undefined})}, key);
  }
  rejects({job: makeJob({}, {mail_hash: 'f'.repeat(64)})});
  rejects({job: makeJob({}, {mail_hash: undefined})});
  rejects({job: makeJob({}, {idempotency_key: `po-approval/${'b'.repeat(64)}`})});
  rejects({job: makeJob({}, {idempotency_key: undefined})});
  rejects({job: makeJob({}, {first_dispatched_ms: undefined})});
  rejects({job: makeJob({}, {first_dispatched_ms: 0})});
  rejects({job: makeJob({}, {first_dispatched_ms: -5})});
  rejects({job: makeJob({}, {first_dispatched_ms: NaN})});
  rejects({job: makeJob({}, {first_dispatched_ms: Infinity})});
  rejects({job: makeJob({}, {first_dispatched_ms: String(FIRST)})});
  rejects({job: makeJob({}, {mail: undefined})});
});

test('local mail with channels the native send cannot express is rejected even with a valid hash', () => {
  for (const extra of [{attachments: [{filename: 'a.pdf'}]}, {headers: {'X-A': '1'}}, {template: {id: 't'}}, {cc: ['c@example.com']}, {bcc: ['c@example.com']}, {reply_to: ['r@example.com']}, {text: 'plain'}, {scheduled_at: 'tomorrow'}]) {
    const mail = makeMail(extra);
    rejects({job: makeJob({}, {mail, mail_hash: approvalMailHash(mail)})}, Object.keys(extra)[0]);
  }
  for (const key of ['from', 'to', 'subject', 'html']) {
    const mail = makeMail();
    delete mail[key];
    rejects({job: makeJob({}, {mail, mail_hash: approvalMailHash(mail)})}, key);
  }
  const bad = makeMail({to: [42]});
  rejects({job: makeJob({}, {mail: bad, mail_hash: approvalMailHash(bad)}), evidence: makeEvidence({to: [42]})});
});

test('only sent-proof terminal events are accepted, including bounced and failed', () => {
  for (const event of ['sent', 'delivered', 'opened', 'clicked', 'delivery_delayed', 'bounced', 'complained', 'failed']) {
    assert.equal(verify({evidence: makeEvidence({last_event: event})}).provider_event, event);
  }
  for (const event of ['queued', 'scheduled', 'canceled', 'unknown', 'inbox', 'DELIVERED', '', null, undefined, 7]) {
    rejects({evidence: makeEvidence({last_event: event})}, String(event));
  }
});

test('provider created time must be strict ISO within [first dispatch - 5s, now + 5s]', () => {
  const at = ms => ({evidence: makeEvidence({created_at: new Date(ms).toISOString()})});
  assert.equal(verify(at(FIRST - 5000)).provider_created_ms, FIRST - 5000);
  assert.equal(verify(at(NOW + 5000)).provider_created_ms, NOW + 5000);
  rejects(at(FIRST - 5001));
  rejects(at(NOW + 5001));
  assert.equal(verify({evidence: makeEvidence({created_at: '2026-10-15T10:00:01+00:00'})}).provider_created_ms, FIRST + 1000);
  for (const value of ['2026-10-15 10:00:01.000000+01', '2026-10-15T10:00:01', '2026-10-15', 'Oct 15 2026 10:00:01 GMT', String(FIRST + 1000), 'garbage', '', null, undefined, FIRST + 1000, {}, '2026-13-45T10:00:01Z']) {
    rejects({evidence: makeEvidence({created_at: value})}, String(value));
  }
  rejects({nowMs: NaN});
  rejects({nowMs: undefined});
  rejects({nowMs: Infinity});
  rejects({nowMs: String(NOW)});
  const epoch = makeJob({}, {first_dispatched_ms: 1});
  rejects({job: epoch, evidence: makeEvidence({created_at: new Date(0).toISOString()})});
});

test('inputs are not mutated and may be frozen', () => {
  const parts = {deliveryId: DELIVERY, providerId: PROVIDER, job: makeJob(), evidence: makeEvidence(), nowMs: NOW};
  const before = clone(parts);
  deepFreeze(parts);
  assert.deepEqual(verifyPOApprovalEvidence(parts), verify());
  assert.deepEqual(clone(parts), before);
});

test('hostile inputs produce only the generic error', () => {
  const trap = {get id() { throw new Error('secret@example.com leaked'); }};
  const hostile = [{evidence: trap}, {job: trap}, {evidence: new Proxy({}, {get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }})}];
  for (const parts of hostile) rejects(parts);
  assert.throws(() => verifyPOApprovalEvidence(undefined), error => error.message === ERR);
  assert.throws(() => verifyPOApprovalEvidence(null), error => error.message === ERR);
  assert.throws(() => verify({evidence: makeEvidence({html: '<p>different secret@example.com</p>'})}), error => error.message === ERR && !String(error.stack).includes('secret'));
});
