const test = require('node:test'),
  assert = require('node:assert/strict');
let createPurchaseRequestOperations;
try {
  ({
    createPurchaseRequestOperations,
  } = require('./purchaseRequestOperations.cjs'));
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}
const PID = '11111111-1111-4111-8111-111111111111';
function fixture(options = {}) {
  assert.equal(typeof createPurchaseRequestOperations, 'function');
  let actorReads = 0;
  let time = Date.parse('2026-11-18T10:00:00Z'),
    clock = 1,
    failSend = false,
    loseAck = false;
  const sends = [],
    accepted = new Map();
  const actor = {
    uid: 'U',
    email: 'u@qualitastech.com',
    emailVerified: true,
    customClaims: { role: 'user', status: 'approved' },
  };
  const item = {
    id: 'bolt',
    name: 'Bolt',
    description: 'Exact item',
    make: 'QA',
    sku: 'B1',
    quantity: 2,
    price: 10,
    itemType: 'component',
  };
  const docs = new Map([
    [
      'projects/P',
      {
        projectName: 'Stored Project',
        clientName: 'Stored Client',
        memberIds: ['U'],
        members: [],
      },
    ],
    [
      'projects/P/bom/data',
      {
        categories: [
          { name: 'Mech', items: [item] },
          { name: 'Secret', items: [{ ...item, id: 'hidden' }] },
        ],
      },
    ],
    [
      'vendors/V',
      { company: 'Stored Vendor', status: 'active', email: 'v@example.com' },
    ],
    [
      'projectDocuments/Q',
      {
        projectId: 'P',
        type: 'vendor-quote',
        name: 'Stored Quote',
        url: 'https://files.example.com/quote.pdf',
        linkedBOMItems: ['bolt'],
      },
    ],
    [
      'settings/purchaseRequest',
      { companyName: 'Stored Company', fromEmail: 'info@qualitastech.com' },
    ],
  ]);
  const versions = new Map([...docs.keys()].map((p) => [p, 1]));
  const ref = (path) => ({
    path,
    collection: (n) => ref(path + '/' + n),
    doc: (id) => ref(path + '/' + id),
  });
  const db = {
    collection: (n) => ref(n),
    runTransaction: async (fn) => {
      if (options.closedBefore) {
        options.closedBefore = false;
        throw Object.assign(
          Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'),
          { code: 3 }
        );
      }
      for (let attempt = 0; attempt < 10; attempt++) {
        const reads = [],
          writes = [];
        const out = await fn({
          get: async (r) => {
            assert.equal(writes.length, 0, 'read after write');
            reads.push([r.path, versions.get(r.path) || 0]);
            return {
              exists: docs.has(r.path),
              data: () => structuredClone(docs.get(r.path)),
              updateTime: {
                seconds: 10,
                nanoseconds: versions.get(r.path) || 0,
              },
            };
          },
          create: (r, d) => writes.push(['create', r.path, d]),
          update: (r, d) => writes.push(['update', r.path, d]),
        });
        if (reads.some(([p, v]) => (versions.get(p) || 0) !== v)) continue;
        if (
          options.closedFinal &&
          writes.some(
            ([, p, d]) => !p.includes('/audit/') && d.status === 'sent'
          )
        ) {
          options.closedFinal = false;
          throw Object.assign(
            Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'),
            { code: 3 }
          );
        }
        if (options.failCommit?.(writes)) throw Error('commit failed');
        for (const [k, p] of writes)
          if (k === 'create') assert.equal(docs.has(p), false);
        for (const [k, p, d] of writes) {
          docs.set(
            p,
            structuredClone(k === 'update' ? { ...docs.get(p), ...d } : d)
          );
          versions.set(p, ++clock);
        }
        if (
          loseAck &&
          writes.some(
            ([, p, d]) => !p.includes('/audit/') && d.status === 'sent'
          )
        ) {
          loseAck = false;
          throw Error('lost commit ack');
        }
        return out;
      }
      throw Error('contention');
    },
  };
  const auth = {
    getUser: async () => {
      await options.beforeActor?.({
        count: ++actorReads,
        actor,
        docs,
        versions,
      });
      return structuredClone(actor);
    },
    verifyIdToken: async () => {
      if (options.revoked) throw Error('revoked');
      return { uid: 'U', email: actor.email };
    },
  };
  const callFactory = createPurchaseRequestOperations({
    db,
    auth,
    bucket: { name: 'fixture.invalid' },
    getServerTimestamp: () => 'server-time',
    providerFingerprint: () =>
      options.providerFingerprint || 'fixture-provider',
    now: () => time,
    buildMail: (d) => ({
      from: d.fromEmail,
      to: d.recipients,
      subject: d.projectDetails.projectName,
      html: JSON.stringify({ ...d, subjectProjectName: undefined }),
      text: JSON.stringify(d),
    }),
    sendEmail: async (mail, { idempotencyKey }) => {
      sends.push({ mail: structuredClone(mail), key: idempotencyKey });
      await options.provider?.({ actor, docs, versions });
      if (!accepted.has(idempotencyKey))
        accepted.set(idempotencyKey, { id: PID });
      if (failSend) throw Error('uncertain');
      return accepted.get(idempotencyKey);
    },
    lookup: async (id) => {
      if (options.lookupFailure) throw Error('offline');
      const mail = sends[0].mail;
      return {
        id,
        ...mail,
        created_at: new Date(time - 1000).toISOString(),
        ...options.lookupOverride,
      };
    },
  });
  const data = {
    operation_id: 'attempt-1',
    expected_actor_uid: 'U',
    projectDetails: {
      projectId: 'P',
      projectName: 'FORGED NAME',
      clientName: 'FORGED CLIENT',
    },
    categories: [
      {
        name: 'Mech',
        items: [
          {
            ...item,
            finalizedVendor: { id: 'V', name: 'FORGED VENDOR' },
            linkedQuote: {
              id: 'Q',
              name: 'FORGED QUOTE',
              url: 'https://evil.invalid',
            },
          },
        ],
      },
    ],
    vendors: [],
    recipients: ['custom@example.com'],
    companyName: 'FORGED COMPANY',
    fromEmail: 'evil@example.com',
  };
  const call = (extra) =>
    callFactory({
      auth: { uid: 'U' },
      rawRequest: { get: () => 'Bearer fixture' },
      data: { ...structuredClone(data), ...extra },
    });
  return {
    call,
    data,
    actor,
    docs,
    versions,
    sends,
    accepted,
    advance: (n) => {
      time += n;
    },
    uncertain: (v) => {
      failSend = v;
    },
    loseAck: () => {
      loseAck = true;
    },
    options,
    receipt: () =>
      [...docs.entries()].find(
        ([p]) =>
          p.startsWith('pulsePurchaseRequestOperations/') &&
          p.split('/').length === 2
      ),
  };
}
test('current project membership, approved identity and revocation gate all provider access', async () => {
  for (const kind of ['nonmember', 'pending', 'disabled', 'revoked', 'scope']) {
    const f = fixture();
    if (kind === 'nonmember') f.docs.get('projects/P').memberIds = [];
    if (kind === 'pending') f.actor.customClaims.status = 'pending';
    if (kind === 'disabled') f.actor.disabled = true;
    if (kind === 'revoked') f.options.revoked = true;
    if (kind === 'scope') {
      f.actor.email = 'external@example.com';
      f.docs.get('projects/P').members = [
        { userId: 'U', categoryScope: ['Secret'] },
      ];
    }
    assert.equal((await f.call()).ok, false, kind);
    assert.equal(f.sends.length, 0);
  }
});
test('stored project, vendor, quote and configured sender replace caller snapshots; custom recipients and actor copy preserved', async () => {
  const f = fixture(),
    r = await f.call();
  assert.equal(r.status, 'sent');
  assert.equal(r.emailId, PID);
  const m = f.sends[0].mail;
  assert.equal(m.from, 'info@qualitastech.com');
  assert.deepEqual(m.to, ['custom@example.com', 'u@qualitastech.com']);
  assert.match(m.html, /Stored Project/);
  assert.match(m.html, /Stored Vendor/);
  assert.match(m.html, /Stored Quote/);
  assert.doesNotMatch(m.html, /FORGED|evil.invalid/);
  assert.equal(m.tags[0].value, f.receipt()[0].split('/')[1]);
});
test('external scoped member may request visible items but not unrelated quote content', async () => {
  const f = fixture();
  f.actor.email = 'partner@example.com';
  f.docs.get('projects/P').members = [{ userId: 'U', categoryScope: ['Mech'] }];
  assert.equal((await f.call()).status, 'sent');
  const g = fixture();
  g.actor.email = 'partner@example.com';
  g.docs.get('projects/P').members = [{ userId: 'U', categoryScope: ['Mech'] }];
  g.docs.get('projectDocuments/Q').linkedBOMItems = ['hidden'];
  assert.equal((await g.call()).ok, false);
  assert.equal(g.sends.length, 0);
});
test('missing/malformed memberships deny; explicit-null legacy fallback and admin access preserved', async () => {
  for (const value of [undefined, {}, 'U']) {
    const f = fixture();
    f.docs.get('projects/P').memberIds = value;
    assert.equal((await f.call()).ok, false);
  }
  const f = fixture();
  f.docs.get('projects/P').memberIds = null;
  assert.equal((await f.call()).status, 'sent');
  const a = fixture();
  a.actor.customClaims.role = 'admin';
  a.docs.get('projects/P').memberIds = [];
  assert.equal((await a.call()).status, 'sent');
});
test('stale item, moved category, duplicate selection and wrong-project quote fail before reservation/provider', async () => {
  for (const kind of ['stale', 'category', 'duplicate', 'quote']) {
    const f = fixture();
    if (kind === 'stale')
      f.docs.get('projects/P/bom/data').categories[0].items[0].quantity = 9;
    if (kind === 'category') f.data.categories[0].name = 'Secret';
    if (kind === 'duplicate')
      f.data.categories[0].items.push(
        structuredClone(f.data.categories[0].items[0])
      );
    if (kind === 'quote') f.docs.get('projectDocuments/Q').projectId = 'other';
    assert.equal((await f.call()).ok, false, kind);
    assert.equal(f.sends.length, 0);
    assert.equal(f.receipt(), undefined);
  }
});
test('same operation replays confirmed result without sending or writing another audit', async () => {
  const f = fixture(),
    a = await f.call(),
    n = f.docs.size,
    b = await f.call();
  assert.equal(a.status, 'sent');
  assert.deepEqual(a, b);
  assert.equal(f.sends.length, 1);
  assert.equal(f.docs.size, n);
});
test('concurrent identical requests reserve only one active provider call', async () => {
  const f = fixture();
  const out = await Promise.all([f.call(), f.call()]);
  assert.ok(out.some((r) => r.status === 'sent'));
  assert.equal(f.sends.length, 1);
  assert.equal(f.accepted.size, 1);
});
test('changed request under the same identity is refused', async () => {
  const f = fixture();
  await f.call();
  assert.equal(
    (await f.call({ recipients: ['other@example.com'] })).error,
    'purchase_request_reused'
  );
  assert.equal(f.sends.length, 1);
});
test('uncertain send retries identical frozen payload/key even when settings change', async () => {
  const f = fixture();
  f.uncertain(true);
  assert.equal((await f.call()).status, 'uncertain');
  f.advance(121000);
  f.uncertain(false);
  f.docs.get('settings/purchaseRequest').companyName = 'Changed';
  assert.equal((await f.call()).status, 'sent');
  assert.equal(f.accepted.size, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
});
test('expired or backwards-clock uncertainty cannot dispatch again', async () => {
  for (const elapsed of [24 * 3600000, -1000]) {
    const f = fixture();
    f.uncertain(true);
    await f.call();
    f.advance(elapsed);
    assert.equal((await f.call()).status, 'needs_reconciliation');
    assert.equal(f.sends.length, 1);
  }
});
test('read-only stops new/retry dispatch but saved sent result and resolve remain available', async () => {
  const f = fixture();
  await f.call();
  f.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await f.call()).status, 'sent');
  const n = fixture();
  n.docs.set('pulseRuntimeControl/cutover', { mode: 'read_only' });
  assert.equal((await n.call()).ok, false);
  assert.equal(n.sends.length, 0);
  assert.equal((await n.call({ resolve_only: true })).status, 'cancelled');
});
test('resolve-only missing identity creates a cancellation fence; a delayed send cannot execute', async () => {
  const f = fixture();
  assert.equal((await f.call({ resolve_only: true })).status, 'cancelled');
  assert.equal((await f.call()).status, 'cancelled');
  assert.equal(f.sends.length, 0);
});
test('known uncertain identity resolves without any provider call', async () => {
  const f = fixture();
  f.uncertain(true);
  await f.call();
  assert.equal((await f.call({ resolve_only: true })).status, 'uncertain');
  assert.equal(f.sends.length, 1);
});
test('a lost final acknowledgement resolves from the saved accepted result', async () => {
  const f = fixture();
  f.loseAck();
  await f.call();
  assert.equal((await f.call({ resolve_only: true })).status, 'sent');
  assert.equal(f.sends.length, 1);
});
test('failure to commit reservation prevents any provider call', async () => {
  const f = fixture({ failCommit: () => true });
  assert.equal((await f.call()).ok, false);
  assert.equal(f.sends.length, 0);
});
test('current permission is rechecked before provider; accepted result persists through later revocation', async () => {
  const f = fixture({
    provider: async ({ actor }) => {
      actor.disabled = true;
    },
  });
  await f.call();
  assert.equal(f.receipt()[1].status, 'sent');
  assert.equal(f.sends.length, 1);
  assert.equal((await f.call({ resolve_only: true })).ok, false);
});
test('admin reconciles expired uncertainty only from matching provider body/tag/time, without resending', async () => {
  const f = fixture();
  f.uncertain(true);
  await f.call();
  f.advance(24 * 3600000);
  f.actor.customClaims.role = 'admin';
  const [path] = f.receipt();
  f.options.lookupOverride = { created_at: '2026-11-18T10:00:00Z' };
  const r = await f.call({
    operation: 'reconcile',
    project_id: 'P',
    request_id: path.split('/')[1],
    provider_id: PID,
  });
  assert.equal(r.status, 'sent');
  assert.equal(f.sends.length, 1);
  assert.ok([...f.docs.keys()].some((p) => p.endsWith('/audit/reconciled')));
});
test('provider reconciliation rejects non-admin, wrong tag/body/time and lookup outage', async () => {
  for (const kind of ['member', 'tag', 'body', 'time', 'offline']) {
    const f = fixture();
    f.uncertain(true);
    await f.call();
    if (kind !== 'member') f.actor.customClaims.role = 'admin';
    f.options.lookupOverride =
      kind === 'tag'
        ? { tags: [] }
        : kind === 'body'
          ? { html: 'changed' }
          : kind === 'time'
            ? { created_at: '2025-01-01T00:00:00Z' }
            : {};
    if (kind === 'offline') f.options.lookupFailure = true;
    const r = await f.call({
      operation: 'reconcile',
      project_id: 'P',
      request_id: f.receipt()[0].split('/')[1],
      provider_id: PID,
    });
    assert.equal(r.ok, false, kind);
    assert.equal(f.receipt()[1].status, 'uncertain');
    assert.equal(f.sends.length, 1);
  }
});
module.exports = { fixture, PID };

test('another browser nonce cannot send while the same actor/project has an uncertain request', async () => {
  const f = fixture();
  f.uncertain(true);
  await f.call();
  const r = await f.call({ operation_id: 'other-browser' });
  assert.equal(r.error, 'purchase_request_pending');
  assert.equal(f.sends.length, 1);
});
test('server recovery restores the original request identity after browser evidence is lost', async () => {
  const f = fixture();
  f.uncertain(true);
  await f.call();
  const r = await f.call({ operation: 'recover', project_id: 'P' });
  assert.equal(r.ok, true);
  assert.equal(r.pending.operation_id, 'attempt-1');
  f.uncertain(false);
  f.advance(121000);
  const sent = await f.call({ ...r.pending, operation: 'send' });
  assert.equal(sent.status, 'sent');
  assert.equal(f.accepted.size, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
});

test('revocation discovered in the immediate pre-provider recheck prevents dispatch', async () => {
  const f = fixture({
    beforeActor: async ({ count, actor }) => {
      if (count === 3) actor.disabled = true;
    },
  });
  assert.equal((await f.call()).ok, false);
  assert.equal(f.sends.length, 0);
  assert.equal(f.receipt()[1].status, 'sending');
});
test('closed transaction callbacks recover with fresh transactions without another provider dispatch', async () => {
  const f = fixture({ closedBefore: true, closedFinal: true });
  assert.equal((await f.call()).status, 'sent');
  assert.equal(f.sends.length, 1);
});
test('dynamic HTML data is escaped while the selected stored quote URL remains the source', async () => {
  const f = fixture();
  f.docs.get('projects/P').projectName = 'A & B <script>';
  f.docs.get('vendors/V').company = '<img src=x>';
  assert.equal((await f.call()).status, 'sent');
  const html = f.sends[0].mail.html;
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('evil.invalid'));
});

test('zero-quantity component rows remain selectable as in the original request dialog', async () => {
  const f = fixture();
  f.data.categories[0].items[0].quantity = 0;
  f.docs.get('projects/P/bom/data').categories[0].items[0].quantity = 0;
  assert.equal((await f.call()).status, 'sent');
  assert.equal(f.sends.length, 1);
});

test('provider credential rotation stops uncertain automatic retry and retains the original request', async () => {
  const f = fixture();
  f.uncertain(true);
  await f.call();
  f.options.providerFingerprint = 'different-provider';
  assert.equal((await f.call()).status, 'needs_reconciliation');
  assert.equal(f.sends.length, 1);
  assert.equal(
    (await f.call({ resolve_only: true })).status,
    'needs_reconciliation'
  );
  assert.equal(f.sends.length, 1);
});
