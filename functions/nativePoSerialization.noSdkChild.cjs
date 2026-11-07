// Child process for nativePoSerialization.noSdk.test.cjs: the pure engine path must never load the server SDK.
const Module = require('node:module'), load = Module._load, loaded = [];
Module._load = function (request, ...rest) {
  if (request === '@google-cloud/firestore' || request.startsWith('@google-cloud/firestore/')) { loaded.push(request); throw new Error('server SDK load denied'); }
  return load.call(this, request, ...rest);
};
(async () => {
  const { fixture } = require('./nativeProcurementFixture.cjs');
  const f = fixture();
  const opened = await f.call({ operation: 'open' });
  const marked = await f.call({ operation: 'send', attempt_id: 'attempt-1', expected_po_version: opened.po_version, expected_material_version: opened.material_version,
    mode: 'mark', actual_sent_date: '2026-10-14', recipient_email: 'vendor@example.com', cc_emails: [] });
  const dated = require('./nativePoSerialization.cjs').createFreeze(code => Object.assign(new Error(code), { code }))({ due: new Date('2026-10-01T00:00:00Z'), n: [1, null, 'x'] });
  process.stdout.write(JSON.stringify({ openOk: opened.ok, sendPhase: marked.phase, sendOk: marked.ok, dated, loaded }));
})().catch(error => { process.stdout.write(JSON.stringify({ failed: String(error.message), loaded })); process.exit(1); });
