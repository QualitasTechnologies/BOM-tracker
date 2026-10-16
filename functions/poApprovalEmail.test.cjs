'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPOApprovalEmail } = require('./poApprovalEmail.cjs');

const NATIVE_URL = 'https://eagle-eye.qualitastech.com/pulse/bom';

const base = (over = {}) => ({
  mode: 'submitted',
  projectId: 'proj-1',
  projectName: 'Line Upgrade',
  poId: 'po-9',
  poNumber: 'PO-2026-001',
  vendorName: 'Acme Components',
  totalAmount: 123456.4,
  actorName: 'Asha Rao',
  to: ['a@example.com', 'b@example.com'],
  ...over,
});

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test('submitted: original content, sender, subject, standalone link', () => {
  const r = buildPOApprovalEmail(base());
  assert.equal(r.from, 'BOM Tracker <info@qualitastech.com>');
  assert.deepEqual(r.to, ['a@example.com', 'b@example.com']);
  assert.equal(r.subject, 'PO Approval Required — PO-2026-001 (₹1,23,456)');
  assert.match(r.html, /PO Approval Required/);
  assert.match(r.html, /Asha Rao has submitted a purchase order for review/);
  assert.match(r.html, /Line Upgrade/);
  assert.match(r.html, /Acme Components/);
  assert.match(r.html, /₹1,23,456/);
  assert.match(r.html, /linear-gradient\(135deg,#f59e0b,#d97706\)/);
  assert.match(r.html, /Log in to BOM Tracker to review and send this PO, or request changes\./);
  assert.match(r.html, /Review PO →/);
  assert.match(r.html, /BOM Tracker — Qualitas Technologies Pvt Ltd/);
  assert.deepEqual(hrefs(r.html), [
    'https://visionbomtracker.web.app/project/proj-1/bom?tab=documents&amp;po=po-9',
  ]);
});

test('changes-requested: original content, string recipient preserved', () => {
  const r = buildPOApprovalEmail(
    base({ mode: 'changes-requested', to: 'eng@example.com', note: 'Fix the rate' }),
  );
  assert.equal(r.to, 'eng@example.com');
  assert.equal(r.subject, 'Changes Requested — PO PO-2026-001');
  assert.match(r.html, /Changes Requested/);
  assert.match(r.html, /Asha Rao has requested changes to your purchase order/);
  assert.match(r.html, /Note:/);
  assert.match(r.html, /Fix the rate/);
  assert.match(r.html, /background:#dc2626/);
  assert.match(r.html, /The PO has been reverted to draft\. Please make the requested changes and resubmit for approval\./);
  assert.match(r.html, /Open PO →/);
});

test('changes-requested without note omits note box', () => {
  const r = buildPOApprovalEmail(base({ mode: 'changes-requested', to: 'e@example.com' }));
  assert.doesNotMatch(r.html, /Note:/);
});

test('native Pulse deep links and branding for both modes', () => {
  for (const mode of ['submitted', 'changes-requested']) {
    const r = buildPOApprovalEmail(
      base({ mode, workspaceUrl: NATIVE_URL, workspaceName: 'Pulse', to: 'x@example.com' }),
    );
    assert.deepEqual(hrefs(r.html), [
      `${NATIVE_URL}/project/proj-1/bom?tab=documents&amp;po=po-9`,
    ]);
    assert.match(r.html, /Pulse — Qualitas Technologies Pvt Ltd/);
    assert.doesNotMatch(r.html, /BOM Tracker/);
    assert.equal(r.from, 'BOM Tracker <info@qualitastech.com>');
  }
  const s = buildPOApprovalEmail(base({ workspaceUrl: NATIVE_URL + '/', workspaceName: 'Pulse' }));
  assert.match(s.html, /Log in to Pulse to review and send this PO/);
  assert.equal(s.subject, 'PO Approval Required — PO-2026-001 (₹1,23,456)');
});

test('ids are URL-encoded then HTML-escaped', () => {
  const r = buildPOApprovalEmail(base({ projectId: 'a/b c', poId: 'x&y"z' }));
  const [h] = hrefs(r.html);
  assert.equal(
    h,
    'https://visionbomtracker.web.app/project/a%2Fb%20c/bom?tab=documents&amp;po=x%26y%22z',
  );
});

test('hostile strings are escaped in html', () => {
  const evil = '<script>alert(1)</script>"\'&';
  const r = buildPOApprovalEmail(
    base({
      mode: 'changes-requested',
      to: 'e@example.com',
      projectName: evil,
      vendorName: evil,
      actorName: evil,
      note: evil,
      poNumber: evil,
    }),
  );
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/);
});

test('rejects invalid input', () => {
  const bad = [
    { mode: 'approved' },
    { mode: undefined },
    { projectId: '' },
    { projectId: 5 },
    { projectName: 'x'.repeat(501) },
    { poNumber: 'PO\nBcc: evil@example.com' },
    { vendorName: '' },
    { actorName: '' },
    { totalAmount: NaN },
    { totalAmount: Infinity },
    { totalAmount: '100' },
    { totalAmount: undefined },
    { note: 'n'.repeat(5001) },
    { note: 7 },
    { to: [] },
    { to: '' },
    { to: 'not-an-email' },
    { to: ['ok@example.com', 'bad address@example.com'] },
    { to: 'a@example.com\nbcc:b@example.com' },
    { to: Array.from({ length: 101 }, (_, i) => `u${i}@example.com`) },
    { to: [5] },
    { workspaceName: 'Evil' },
    { workspaceUrl: 'http://visionbomtracker.web.app' },
    { workspaceUrl: 'https://user:pw@visionbomtracker.web.app' },
    { workspaceUrl: 'https://visionbomtracker.web.app/?a=1' },
    { workspaceUrl: 'https://visionbomtracker.web.app/#x' },
    { workspaceUrl: 'https://evil.example.com' },
    { workspaceUrl: 'https://eagle-eye.qualitastech.com/other' },
    { workspaceUrl: 'https://eagle-eye.qualitastech.com/pulse/bom/../x' },
    { workspaceUrl: 'javascript:alert(1)' },
    { workspaceUrl: 42 },
  ];
  for (const over of bad) {
    assert.throws(() => buildPOApprovalEmail(base(over)), Error, JSON.stringify(over));
  }
  for (const input of [null, undefined, 'x', 5]) {
    assert.throws(() => buildPOApprovalEmail(input));
  }
});

test('zero amount is valid; invalid amount is never coerced to zero', () => {
  const r = buildPOApprovalEmail(base({ totalAmount: 0 }));
  assert.match(r.subject, /\(₹0\)/);
});

test('deterministic, does not mutate input, output is frozen', () => {
  const input = base();
  const snapshot = JSON.parse(JSON.stringify(input));
  Object.freeze(input);
  Object.freeze(input.to);
  const a = buildPOApprovalEmail(input);
  const b = buildPOApprovalEmail(input);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.to));
  assert.notEqual(a.to, input.to);
});
test('native configuration supports a staging Pulse route, API-length IDs and the provider recipient bound',()=>{
  const result=buildPOApprovalEmail(base({workspaceUrl:'https://staging.qualitastech.com/pulse/bom',workspaceName:'Pulse',projectId:'p'.repeat(512)}));
  assert.match(result.html,/staging\.qualitastech\.com\/pulse\/bom\/project/);
  assert.throws(()=>buildPOApprovalEmail(base({to:Array.from({length:51},(_,i)=>`a${i}@example.com`)})));
});
test('legacy rendering keeps the old long/empty fields and missing-amount behavior while native finite amounts retain their sign',()=>{
  const legacy=buildPOApprovalEmail(base({legacyCompatibility:true,projectName:'x'.repeat(600),vendorName:'',poNumber:'',totalAmount:undefined}));
  assert.equal(legacy.subject,'PO Approval Required —  (₹0)');assert.match(legacy.html,new RegExp('x'.repeat(600)));
  assert.match(buildPOApprovalEmail(base({totalAmount:-100})).subject,/₹-100/);
});
