const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createNativeUploadOperations } = require('./nativeUploadOperations.cjs');
function fixture(options = {}) {
  const actor = { uid: 'alice', email: 'alice@qualitastech.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } };
  const bytes = Buffer.from([255, 216, 255, 1, 2, 255, 217]);
  const docs = new Map([['projects/P', { projectId: 'P', memberIds: ['alice'] }], ['projects/P/bom/data', { categories: [{ name: 'Mech', items: [{ id: 'bolt' }] }] }]]);
  const ref = path => ({ path, doc: id => ref(`${path}/${id}`), collection: key => ref(`${path}/${key}`) });
  const db = { collection: key => ref(key), runTransaction: async fn => {
    const writes = []; const result = await fn({ get: async r => { assert.equal(writes.length, 0); await options.onRead?.(r.path, { actor, docs }); return { exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)) }; },
      create: (r, d) => { assert.equal(docs.has(r.path), false); writes.push([r.path, d]); }, update: (r, d) => writes.push([r.path, { ...docs.get(r.path), ...d }]) });
    if (options.failAudit && writes.some(([p]) => p.includes('/audit/'))) throw Error('audit');
    if (options.failFinalizeOnce && writes.some(([p]) => p.endsWith('_finalize'))) { options.failFinalizeOnce = false; throw Error('interrupted final journal'); }
    writes.forEach(([p, d]) => docs.set(p, d)); return result;
  } };
  const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => structuredClone(actor) };
  let blob = null, finalBlob = null, finalMetadata, publications = 0, time = new Date('2026-10-14T00:00:00Z');
  const bucket = { name: 'test.appspot.com', file: (path, opts) => {
    const final = path.includes('/finalized/'); return {
      getMetadata: async () => { const value = final ? finalBlob : blob; if (!value) throw Object.assign(Error('missing'), { code: 404 }); return [{ size: String(value.length), contentType: 'image/jpeg', generation: final ? '8' : '7', metageneration: '1', ...(final ? finalMetadata : {}) }]; },
      createReadStream: () => { const value = final ? finalBlob : blob; const stream = (async function* () { if (!final) await options.onDownload?.({ actor, docs }); assert.equal(opts.generation, final ? '8' : '7'); yield value; })(); stream.destroy = () => {}; return stream; },
      save: async (value, settings) => { assert.equal(final, true); assert.equal(settings.preconditionOpts.ifGenerationMatch, 0); assert.equal(settings.resumable, false); if (finalBlob) throw Object.assign(Error('exists'), { code: 412 }); finalBlob = Buffer.from(value); finalMetadata = settings.metadata; publications++; await options.onMetadata?.({ actor, docs }); },
    };
  } };
  const native = createNativeUploadOperations({ db, auth, bucket, enabled: options.enabled ?? true, getServerTimestamp: () => 'server', now: () => time });
  const base = { project_id: 'P', item_id: 'bolt', operation_id: 'nonce', expected_actor_uid: 'alice' };
  const call = data => native({ auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer test' }, data: { ...base, ...data } });
  const reserve = extra => call({ operation: 'reserve', content_type: 'image/jpeg', byte_size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...extra });
  return { actor, docs, bytes, reserve, finalize: extra => call({ operation: 'finalize', ...extra }), upload: value => { blob = value ?? bytes; }, expire: () => { time = new Date('2026-10-14T01:00:00Z'); }, finalBytes: () => finalBlob, publications: () => publications };
}
test('reserve and finalize are nonce bound, audited and replayable with verified generation', async () => {
  const f = fixture(); const r = await f.reserve(); assert.equal(r.ok, true); assert.match(r.path, /^projects\/P\/received-photos\/native\/[a-f0-9]{64}\.jpg$/);
  assert.deepEqual(await f.reserve(), r); assert.equal((await f.reserve({ sha256: 'a'.repeat(64) })).error, 'operation_conflict');
  f.upload(); const done = await f.finalize(); assert.equal(done.ok, true); assert.equal(done.generation, '8'); assert.match(done.photo_url, /generation=8/); assert.deepEqual(await f.finalize(), done);
  assert.equal([...f.docs.keys()].filter(p => p.includes('/audit/')).length, 2);
});
test('missing, wrong-size and same-size changed bytes never finalize', async () => {
  const f = fixture(); await f.reserve(); assert.equal((await f.finalize()).error, 'upload_not_found'); f.upload(Buffer.from('bad')); assert.equal((await f.finalize()).error, 'upload_integrity_failed');
  f.upload(Buffer.from([255, 216, 255, 4, 5, 255, 217])); assert.equal((await f.finalize()).error, 'upload_integrity_failed');
});
test('expiry, actor switches, default gates and client URL input fail closed', async () => {
  const f = fixture(); await f.reserve(); f.upload(); f.expire(); assert.equal((await f.finalize()).error, 'upload_intent_expired');
  assert.equal((await fixture({ enabled: false }).reserve()).error, 'native_uploads_disabled');
  assert.equal((await fixture().reserve({ expected_actor_uid: 'other' })).error, 'actor_session_changed');
  assert.equal((await fixture().finalize({ photo_url: 'https://client' })).error, 'invalid_upload_request');
});
test('fresh membership, category and account access also apply to replays and after blob IO', async () => {
  const f = fixture(); await f.reserve(); f.upload(); await f.finalize(); f.docs.get('projects/P').memberIds = []; assert.equal((await f.finalize()).error, 'project_forbidden');
  const p = fixture(); p.actor.email = 'alice@partner.example'; p.docs.get('projects/P').members = [{ userId: 'alice', categoryScope: [] }]; assert.equal((await p.reserve()).error, 'material_forbidden');
  const revoked = fixture({ onDownload: ({ actor }) => { actor.disabled = true; } }); await revoked.reserve(); revoked.upload(); assert.equal((await revoked.finalize()).error, 'actor_forbidden');
});
test('audit failure cannot persist a grant; changed nonce target cannot reuse a grant', async () => {
  const f = fixture({ failAudit: true }); assert.equal((await f.reserve()).error, 'native_uploads_unavailable'); assert.equal([...f.docs.keys()].some(p => p.startsWith('pulseNativeUploadIntents/')), false);
  const g = fixture(); await g.reserve(); assert.equal((await g.finalize({ item_id: 'different' })).ok, false);
});
test('read_only blocks new intent and finalization but permits immutable finalized receipt replay', async () => {
  const f = fixture(); f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); assert.equal((await f.reserve()).error, 'native_uploads_read_only');
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'pulse_only' }); await f.reserve(); f.upload();
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); assert.equal((await f.finalize()).error, 'native_uploads_read_only');
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'coexist' }); const result = await f.finalize(); assert.equal(result.ok, true);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }); f.expire(); assert.deepEqual(await f.finalize(), result);
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'unknown' }); assert.equal((await f.finalize()).error, 'native_upload_control_unavailable');
});
test('revocation or read_only during blob IO blocks finalization', async () => {
  const f = fixture({ onDownload: ({ docs }) => docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' }) }); await f.reserve(); f.upload(); assert.equal((await f.finalize()).error, 'native_uploads_read_only');
  const p = fixture({ onDownload: ({ docs }) => { docs.get('projects/P').memberIds = []; } }); await p.reserve(); p.upload(); assert.equal((await p.finalize()).error, 'project_forbidden');
});
test('access revoked during URL publication cannot persist a finalized receipt', async () => {
  const f = fixture({ onMetadata: ({ actor }) => { actor.disabled = true; } }); await f.reserve(); f.upload(); assert.equal((await f.finalize()).error, 'actor_forbidden');
  assert.equal(f.docs.get('pulseNativeUploadOperations/P/receipts/nonce').finalized, undefined);
});
test('reserve replay rechecks actor after receipt and runtime-control reads', async () => {
  let revoke = false;
  const f = fixture({ onRead: (path, { actor }) => { if (revoke && path === 'pulseRuntimeControl/cutover') actor.disabled = true; } });
  await f.reserve(); revoke = true; assert.equal((await f.reserve()).error, 'actor_forbidden');
});
test('oversized files, non-JPEG bytes and non-JPEG declarations cannot become proof', async () => {
  assert.equal((await fixture().reserve({ byte_size: 10485760 })).error, 'invalid_upload_request');
  assert.equal((await fixture().reserve({ content_type: 'image/png' })).error, 'invalid_upload_request');
  const f = fixture(), bytes = Buffer.from('notjpeg'); await f.reserve({ sha256: createHash('sha256').update(bytes).digest('hex') }); f.upload(bytes); assert.equal((await f.finalize()).error, 'upload_integrity_failed');
});
test('finalized photo bytes live outside the writable staging path', async () => {
  const f = fixture(); await f.reserve(); f.upload(); const result = await f.finalize();
  assert.equal(result.ok, true);
  assert.match(decodeURIComponent(new URL(result.photo_url).pathname), /\/received-photos\/finalized\//);
});

test('finalized photo replay survives disabled writes but new reservations do not', async () => {
  let enabled = true; const f = fixture({ enabled: () => enabled }); await f.reserve(); f.upload();
  const result = await f.finalize(); assert.equal(result.ok, true); enabled = false;
  assert.deepEqual(await f.finalize(), result);
  assert.equal((await f.reserve({ operation_id: 'new-photo' })).error, 'native_uploads_disabled');
});

test('an interrupted publication recovers the verified destination after staging is replaced', async () => {
  const f = fixture({ failFinalizeOnce: true }); await f.reserve(); f.upload();
  assert.equal((await f.finalize()).error, 'native_uploads_unavailable');
  f.upload(Buffer.from([255, 216, 255, 8, 9, 255, 217]));
  const recovered = await f.finalize(); assert.equal(recovered.ok, true);
  assert.deepEqual(f.finalBytes(), f.bytes); assert.equal(f.publications(), 1);
});

test('existing unpublished canonical bytes cannot bypass a later write-disable or expiry fence', async () => {
  let enabled = true; const f = fixture({ failFinalizeOnce: true, enabled: () => enabled }); await f.reserve(); f.upload();
  assert.equal((await f.finalize()).ok, false); enabled = false;
  assert.equal((await f.finalize()).error, 'native_uploads_disabled');
  enabled = true; f.expire(); assert.equal((await f.finalize()).error, 'upload_intent_expired');
  assert.equal(f.docs.get('pulseNativeUploadOperations/P/receipts/nonce').finalized, undefined);
});

test('restored current authorization can confirm the same unpublished destination without another upload', async () => {
  const f = fixture({ onMetadata: ({ actor }) => { actor.disabled = true; } }); await f.reserve(); f.upload();
  assert.equal((await f.finalize()).error, 'actor_forbidden'); assert.equal(f.publications(), 1);
  f.actor.disabled = false; assert.equal((await f.finalize()).ok, true);
  assert.equal(f.publications(), 1); assert.deepEqual(f.finalBytes(), f.bytes);
});
