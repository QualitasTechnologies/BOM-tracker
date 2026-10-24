'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExpenseApprovalEmail } = require('./expenseApprovalEmail.cjs');

const NATIVE_URL = 'https://eagle-eye.qualitastech.com/pulse/bom';

const base = (over = {}) => ({
  mode: 'submitted',
  projectId: 'proj-1',
  projectName: 'Line Upgrade',
  visitDates: '12 Oct 2026 – 14 Oct 2026',
  visitTotal: 123456.4,
  actorName: 'Asha Rao',
  to: ['a@example.com', 'b@example.com'],
  ...over,
});

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test('submitted: original copy, sender, subject, legacy link', () => {
  const r = buildExpenseApprovalEmail(base({ visitLocation: 'Pune', visitPurpose: 'Site survey' }));
  assert.equal(r.from, 'BOM Tracker <info@qualitastech.com>');
  assert.deepEqual(r.to, ['a@example.com', 'b@example.com']);
  assert.equal(r.subject, 'Expense Approval Required — Line Upgrade (₹1,23,456)');
  assert.match(r.html, /<h1 style="margin:0;color:#fff;font-size:22px;">Expense Approval Required<\/h1>/);
  assert.match(r.html, /Asha Rao has submitted a travel expense for review/);
  assert.match(r.html, /linear-gradient\(135deg,#f59e0b,#d97706\)/);
  assert.match(r.html, />Project<\/td>.*Line Upgrade/);
  assert.match(r.html, />Dates<\/td>.*12 Oct 2026 – 14 Oct 2026/);
  assert.match(r.html, />Location<\/td>.*Pune/);
  assert.match(r.html, />Purpose<\/td>.*Site survey/);
  assert.match(r.html, /font-size:17px;color:#0066cc;">₹1,23,456</);
  assert.match(r.html, /Log in to BOM Tracker to approve or reject this claim\./);
  assert.match(r.html, /Review Claim →/);
  assert.match(r.html, /BOM Tracker — Qualitas Technologies Pvt Ltd/);
  assert.deepEqual(hrefs(r.html), ['https://visionbomtracker.web.app/project/proj-1/bom']);
});

test('approved: original copy and subject', () => {
  const r = buildExpenseApprovalEmail(base({ mode: 'approved', to: 'owner@example.com' }));
  assert.equal(r.to, 'owner@example.com');
  assert.equal(r.subject, 'Your expense claim was Approved — Line Upgrade');
  assert.match(r.html, /<h1 style="margin:0;color:#fff;font-size:22px;">Expense Approved<\/h1>/);
  assert.match(r.html, /Asha Rao has approved your travel expense claim/);
  assert.match(r.html, /background:#059669/);
  assert.match(r.html, /background:#ecfdf5;border:1px solid #05966944/);
  assert.match(r.html, /Status: Approved/);
  assert.match(r.html, /Your expense claim has been approved\. Please proceed with reimbursement as per company policy\./);
  assert.match(r.html, /Open BOM Tracker →/);
  assert.doesNotMatch(r.html, /Location<\/td>/);
  assert.doesNotMatch(r.html, /Purpose<\/td>/);
});

test('rejected: original copy and subject', () => {
  const r = buildExpenseApprovalEmail(base({ mode: 'rejected', to: 'owner@example.com' }));
  assert.equal(r.subject, 'Your expense claim was Rejected — Line Upgrade');
  assert.match(r.html, /Expense Rejected/);
  assert.match(r.html, /Asha Rao has rejected your travel expense claim/);
  assert.match(r.html, /background:#dc2626/);
  assert.match(r.html, /background:#fef2f2;border:1px solid #dc262644/);
  assert.match(r.html, /Status: Rejected/);
  assert.match(
    r.html,
    /Your expense claim was not approved\. Please contact your manager for details or resubmit with updated information\./,
  );
});

test('result is frozen', () => {
  const r = buildExpenseApprovalEmail(base());
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.to));
});

test('native override: Pulse branding and costs link with visit', () => {
  const r = buildExpenseApprovalEmail(
    base({ workspaceName: 'Pulse', workspaceUrl: NATIVE_URL, visitId: 'visit-7' }),
  );
  assert.match(r.html, /Log in to Pulse to approve or reject this claim\./);
  assert.match(r.html, /Pulse — Qualitas Technologies Pvt Ltd/);
  assert.match(r.html, /Open|Review Claim/);
  assert.equal(r.from, 'BOM Tracker <info@qualitastech.com>');
  assert.deepEqual(hrefs(r.html), [
    'https://eagle-eye.qualitastech.com/pulse/bom/project/proj-1/bom?tab=costs&amp;visit=visit-7',
  ]);
  const r2 = buildExpenseApprovalEmail(base({ workspaceUrl: NATIVE_URL + '/' }));
  assert.deepEqual(hrefs(r2.html), [
    'https://eagle-eye.qualitastech.com/pulse/bom/project/proj-1/bom?tab=costs',
  ]);
});

test('legacy link with visitId appends only visit query', () => {
  const r = buildExpenseApprovalEmail(base({ visitId: 'v 1&x' }));
  assert.deepEqual(hrefs(r.html), [
    'https://visionbomtracker.web.app/project/proj-1/bom?visit=v%201%26x',
  ]);
});

test('unicode ids are percent-encoded in href', () => {
  const r = buildExpenseApprovalEmail(base({ projectId: 'प्रोजेक्ट/1', visitId: 'दौरा' }));
  const [h] = hrefs(r.html);
  assert.ok(h.includes(encodeURIComponent('प्रोजेक्ट/1')));
  assert.ok(h.includes('visit=' + encodeURIComponent('दौरा')));
  assert.doesNotMatch(h, /[^\x20-\x7e]/);
});

test('every field is HTML escaped', () => {
  const evil = '<script>alert("x")</script>&\'';
  const r = buildExpenseApprovalEmail(
    base({
      projectName: evil,
      visitDates: evil,
      visitLocation: evil,
      visitPurpose: evil,
      actorName: evil,
      visitId: '"><img src=x>',
    }),
  );
  assert.doesNotMatch(r.html, /<script>/);
  assert.doesNotMatch(r.html, /<img/);
  assert.match(r.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;&#39;/);
  for (const h of hrefs(r.html)) assert.doesNotMatch(h, /["'<>]/);
});

test('no raw JSON or secrets leak', () => {
  const r = buildExpenseApprovalEmail(base({ extra: { apiKey: 'SECRET' } }));
  assert.doesNotMatch(r.html, /SECRET|\[object|undefined|\{"/);
});

test('amount rounds like original and is not repriced', () => {
  assert.match(buildExpenseApprovalEmail(base({ visitTotal: 0 })).subject, /\(₹0\)/);
  assert.match(buildExpenseApprovalEmail(base({ visitTotal: 1234.5 })).subject, /\(₹1,235\)/);
  assert.match(buildExpenseApprovalEmail(base({ visitTotal: 10000000 })).subject, /\(₹1,00,00,000\)/);
});

test('bad inputs rejected', () => {
  const bad = [
    null,
    [],
    'x',
    base({ mode: 'nope' }),
    base({ mode: undefined }),
    base({ projectId: '' }),
    base({ projectId: 5 }),
    base({ projectId: 'a'.repeat(513) }),
    base({ projectId: 'a\nb' }),
    base({ projectName: ' ' }),
    base({ projectName: 'a'.repeat(501) }),
    base({ projectName: 'a\r\nBcc: x' }),
    base({ visitDates: '' }),
    base({ visitDates: 'a'.repeat(501) }),
    base({ visitLocation: 'a'.repeat(501) }),
    base({ visitLocation: 7 }),
    base({ visitPurpose: 'a\u0000b' }),
    base({ visitId: 'a'.repeat(513) }),
    base({ visitId: 3 }),
    base({ visitId: 'a\nb' }),
    base({ actorName: '' }),
    base({ visitTotal: -1 }),
    base({ visitTotal: NaN }),
    base({ visitTotal: Infinity }),
    base({ visitTotal: '5' }),
    base({ visitTotal: undefined }),
    base({ workspaceName: 'Evil' }),
  ];
  for (const b of bad) assert.throws(() => buildExpenseApprovalEmail(b), undefined, JSON.stringify(b));
});

test('id and label boundaries accepted', () => {
  const r = buildExpenseApprovalEmail(
    base({
      projectId: 'a'.repeat(512),
      visitId: 'b'.repeat(512),
      projectName: 'n'.repeat(500),
      visitDates: 'd'.repeat(500),
      visitLocation: 'l'.repeat(500),
      visitPurpose: 'p'.repeat(500),
      actorName: 'z'.repeat(500),
    }),
  );
  assert.ok(r.html.length > 0);
});

test('recipient bounds', () => {
  const addrs = (n) => Array.from({ length: n }, (_, i) => `u${i}@example.com`);
  assert.equal(buildExpenseApprovalEmail(base({ to: addrs(50) })).to.length, 50);
  assert.throws(() => buildExpenseApprovalEmail(base({ to: addrs(51) })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: [] })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: undefined })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: ['bad'] })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: ['a@b.com, c@d.com'] })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: ['Name <a@b.com>'] })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: [5] })));
  assert.throws(() => buildExpenseApprovalEmail(base({ to: ['a'.repeat(250) + '@b.com'] })));
});

test('legacyCompatibility permits 1000 admins and empty labels', () => {
  const addrs = Array.from({ length: 1000 }, (_, i) => `u${i}@example.com`);
  const r = buildExpenseApprovalEmail(
    base({ legacyCompatibility: true, to: addrs, projectName: '', visitDates: '', actorName: '' }),
  );
  assert.equal(r.to.length, 1000);
  assert.throws(() =>
    buildExpenseApprovalEmail(base({ legacyCompatibility: true, to: [...addrs, 'x@example.com'] })),
  );
  assert.throws(() => buildExpenseApprovalEmail(base({ legacyCompatibility: true, to: ['bad'] })));
  // not enabled by truthy non-true values
  assert.throws(() => buildExpenseApprovalEmail(base({ legacyCompatibility: 'true', to: addrs })));
  assert.throws(() => buildExpenseApprovalEmail(base({ projectName: '' })));
});

test('legacyCompatibility tolerates missing visitTotal like original', () => {
  const r = buildExpenseApprovalEmail(base({ legacyCompatibility: true, visitTotal: undefined }));
  assert.match(r.subject, /\(₹0\)/);
});

test('workspaceUrl validation', () => {
  const badUrls = [
    '',
    5,
    'http://eagle-eye.qualitastech.com/pulse/bom',
    'https://user:pw@eagle-eye.qualitastech.com/pulse/bom',
    NATIVE_URL + '?a=1',
    NATIVE_URL + '#x',
    'https://eagle-eye.qualitastech.com/other',
    'https://visionbomtracker.web.app/evil',
    'https://eagle-eye.qualitastech.com\\pulse\\bom',
    'not a url',
    'https://x.example.com/' + 'a'.repeat(200),
  ];
  for (const u of badUrls) {
    assert.throws(() => buildExpenseApprovalEmail(base({ workspaceUrl: u })), undefined, String(u));
  }
  const r = buildExpenseApprovalEmail(base({ workspaceUrl: 'https://visionbomtracker.web.app' }));
  assert.deepEqual(hrefs(r.html), ['https://visionbomtracker.web.app/project/proj-1/bom']);
});

test('parity: legacy output matches original template for plain input', () => {
  const r = buildExpenseApprovalEmail(
    base({ mode: 'approved', to: 'o@example.com', visitLocation: 'Pune', visitPurpose: 'Survey' }),
  );
  const rows = [
    `<tr><td style="padding:6px 0;color:#666;width:130px;vertical-align:top;">Project</td><td style="padding:6px 0;font-weight:600;">Line Upgrade</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Dates</td><td style="padding:6px 0;">12 Oct 2026 – 14 Oct 2026</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Location</td><td style="padding:6px 0;">Pune</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Purpose</td><td style="padding:6px 0;">Survey</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:17px;color:#0066cc;">₹1,23,456</td></tr>`,
  ].join('');
  assert.ok(
    r.html.includes(`<table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0;">${rows}</table>`),
  );
  assert.ok(
    r.html.includes(
      `<a href="https://visionbomtracker.web.app/project/proj-1/bom" style="display:inline-block;margin-top:16px;padding:10px 22px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open BOM Tracker →</a>`,
    ),
  );
});
