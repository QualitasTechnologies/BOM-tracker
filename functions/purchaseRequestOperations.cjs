const { randomUUID } = require('node:crypto');
const { currentNativeActor } = require('./nativeMaterialOperations.cjs');
const { assertDocumentBudget } = require('./materialCommands.cjs');
const {
  version,
  PUBLIC,
  fault,
  plain,
  id,
  hash,
  normalize,
  scopeFor,
  writable,
  prepare,
} = require('./purchaseRequestState.cjs');
const WINDOW = 23 * 60 * 60 * 1000,
  LEASE = 120000,
  hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function createPurchaseRequestOperations({
  db,
  auth,
  bucket,
  buildMail,
  sendEmail,
  lookup,
  providerFingerprint,
  now = Date.now,
  getServerTimestamp,
}) {
  const fingerprint = () => {
    const value = providerFingerprint?.();
    if (typeof value !== 'string' || !value || value.length > 512)
      throw fault('purchase_request_provider_unavailable', 503);
    return value;
  };
  const transact = async (fn) => {
    for (let n = 0; ; n++) {
      try {
        return await db.runTransaction(fn);
      } catch (e) {
        if (
          n >= 2 ||
          e.code !== 3 ||
          !/^(?:3 INVALID_ARGUMENT: )?Transaction is invalid or closed\.$/.test(
            String(e.message || '').trim()
          )
        )
          throw e;
      }
    }
  };
  const actorOf = (request) => currentNativeActor(auth, request);
  const activeRef = (uid, p) =>
    db.collection('pulsePurchaseRequestActors').doc(hash([uid, p]));
  const projectRef = (p) => db.collection('projects').doc(p),
    controlRef = db.collection('pulseRuntimeControl').doc('cutover');
  const response = (r) => ({
    ok: true,
    success: r.status === 'sent',
    status: r.status,
    operation_id: r.operation_id,
    ...(r.status === 'sent'
      ? { emailId: r.provider_id, recipients: r.mail.to }
      : {
          can_retry:
            ['uncertain', 'sending'].includes(r.status) &&
            Number.isSafeInteger(r.first_dispatch_ms) &&
            now() >= r.first_dispatch_ms &&
            now() - r.first_dispatch_ms < WINDOW &&
            !(r.status === 'sending' && r.lease_until > now()),
        }),
  });
  async function currentAccess(tx, request, actor, p, categories) {
    const project = await tx.get(projectRef(p));
    if (!project.exists) throw fault('project_not_found', 404);
    const current = await actorOf(request);
    if (
      current.uid !== actor.uid ||
      current.email !== actor.email ||
      current.customClaims.role !== actor.customClaims.role
    )
      throw fault('actor_session_changed', 403);
    const scope = scopeFor(project.data(), current, categories);
    return { project: project.data(), scope, projectVersion: version(project) };
  }
  async function finish(
    ref,
    expected,
    providerId,
    reconciled = false,
    proof = null
  ) {
    return transact(async (tx) => {
      const snap = await tx.get(ref),
        r = snap.data(),
        audit = ref.collection('audit').doc(reconciled ? 'reconciled' : 'sent');
      const prior = await tx.get(audit),
        active = activeRef(r?.actor_uid, r?.project_id),
        pointer = await tx.get(active);
      if (
        !snap.exists ||
        r.request_hash !== expected.request_hash ||
        r.mail_hash !== expected.mail_hash ||
        hash(r.mail) !== r.mail_hash ||
        r.status === 'cancelled'
      )
        throw fault('purchase_request_changed', 409);
      if (r.status === 'sent') {
        if (r.provider_id !== providerId)
          throw fault('purchase_request_provider_conflict', 409);
        return r;
      }
      const updated = {
        ...r,
        status: 'sent',
        provider_id: providerId,
        accepted_at: getServerTimestamp(),
        lease_id: null,
        lease_until: 0,
      };
      const evidence = {
        operation: reconciled
          ? 'purchase_request_reconciled'
          : 'purchase_request_sent',
        actor_uid: r.actor_uid,
        project_id: r.project_id,
        operation_id: r.operation_id,
        provider_id: providerId,
        mail_hash: r.mail_hash,
        created_at: getServerTimestamp(),
        ...(proof ? { proof } : {}),
      };
      assertDocumentBudget([
        { path: ref.path, data: updated },
        { path: audit.path, data: evidence },
      ]);
      tx.update(ref, updated);
      if (
        pointer.exists &&
        pointer.data().request_id === ref.path.split('/').at(-1)
      )
        tx.update(active, { status: 'sent' });
      if (!prior.exists) tx.create(audit, evidence);
      return updated;
    });
  }
  async function reconcile(request, actor) {
    const data = request.data;
    if (actor.customClaims.role !== 'admin')
      throw fault('purchase_request_forbidden', 403);
    if (
      data.expected_actor_uid !== actor.uid ||
      !id(data.project_id) ||
      !hex(data.request_id) ||
      typeof data.provider_id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        data.provider_id
      )
    )
      throw fault('invalid_purchase_request');
    const ref = db
      .collection('pulsePurchaseRequestOperations')
      .doc(data.request_id);
    const record = await transact(async (tx) => {
      const snap = await tx.get(ref),
        r = snap.data();
      if (
        !snap.exists ||
        r.project_id !== data.project_id ||
        r.status === 'cancelled' ||
        !r.mail ||
        hash(r.mail) !== r.mail_hash
      )
        throw fault('purchase_request_changed', 409);
      await currentAccess(tx, request, actor, r.project_id, r.categories);
      return r;
    });
    if (record.status === 'sent') {
      if (record.provider_id !== data.provider_id)
        throw fault('purchase_request_provider_conflict', 409);
      return response(record);
    }
    const proof = await lookup(data.provider_id),
      created = Date.parse(proof?.created_at);
    if (
      !proof ||
      proof.id !== data.provider_id ||
      !Number.isFinite(created) ||
      created < record.first_dispatch_ms - 120000 ||
      created >= record.first_dispatch_ms + 24 * 3600000 ||
      !Array.isArray(proof.tags) ||
      hash(proof.tags) !== hash(record.mail.tags) ||
      ['from', 'to', 'subject', 'html', 'text'].some(
        (k) => hash(proof[k]) !== hash(record.mail[k])
      ) ||
      proof.cc?.length ||
      proof.bcc?.length
    )
      throw fault('purchase_request_evidence_mismatch', 409);
    const current = await actorOf(request);
    if (current.uid !== actor.uid || current.customClaims.role !== 'admin')
      throw fault('purchase_request_forbidden', 403);
    return response(
      await finish(ref, record, data.provider_id, true, {
        lookup_hash: hash(proof),
        verified_by: actor.uid,
        verified_at: getServerTimestamp(),
      })
    );
  }
  return async (request) => {
    try {
      const actor = await actorOf(request);
      if (request.data?.operation === 'recover') {
        const d = request.data;
        if (d.expected_actor_uid !== actor.uid || !id(d.project_id))
          throw fault('invalid_purchase_request');
        return await transact(async (tx) => {
          const pointer = await tx.get(activeRef(actor.uid, d.project_id));
          if (!pointer.exists || pointer.data().status === 'sent') {
            const access = await currentAccess(
              tx,
              request,
              actor,
              d.project_id,
              []
            );
            const bom = await tx.get(
              projectRef(d.project_id).collection('bom').doc('data')
            );
            return {
              ok: true,
              pending: null,
              project_version: access.projectVersion,
              material_version: version(bom),
            };
          }
          const snap = await tx.get(
              db
                .collection('pulsePurchaseRequestOperations')
                .doc(pointer.data().request_id)
            ),
            r = snap.data();
          if (
            !snap.exists ||
            r.actor_uid !== actor.uid ||
            r.actor_email !== actor.email ||
            r.project_id !== d.project_id ||
            !r.input ||
            hash(r.input) !== r.request_hash
          )
            throw fault('purchase_request_changed', 409);
          await currentAccess(tx, request, actor, d.project_id, r.categories);
          if (r.status === 'sent' || r.status === 'cancelled')
            return { ok: true, pending: null };
          return {
            ok: true,
            pending: {
              operation_id: r.operation_id,
              expected_project_version: r.input.expected_project_version,
              expected_material_version: r.input.expected_material_version,
              expected_actor_uid: actor.uid,
              projectDetails: { projectId: r.project_id },
              recipients: r.input.recipients,
              categories: r.input.selections.map((x) => ({
                name: x.category,
                items: [
                  {
                    ...x.item,
                    id: x.id,
                    finalizedVendor: { id: x.vendor_id },
                    linkedQuote: { id: x.quote_id },
                  },
                ],
              })),
            },
          };
        });
      }
      if (request.data?.operation === 'reconcile')
        return await reconcile(request, actor);
      const input = normalize(request.data, actor),
        requestHash = hash(input),
        key = hash([actor.uid, input.project_id, input.operation_id]),
        ref = db.collection('pulsePurchaseRequestOperations').doc(key),
        leaseId = randomUUID();
      const reservation = await transact(async (tx) => {
        const snapshot = await tx.get(ref),
          r = snapshot.data(),
          active = activeRef(actor.uid, input.project_id),
          pointer = await tx.get(active);
        const access = await currentAccess(
          tx,
          request,
          actor,
          input.project_id,
          input.selections.map((s) => s.category)
        );
        if (snapshot.exists) {
          if (
            r.actor_uid !== actor.uid ||
            r.actor_email !== actor.email ||
            r.request_hash !== requestHash
          )
            throw fault('purchase_request_reused', 409);
          if (r.status === 'sent' || r.status === 'cancelled')
            return { done: r };
          if (!r.mail || hash(r.mail) !== r.mail_hash)
            throw fault('purchase_request_changed', 409);
          if (
            r.provider_fingerprint !== fingerprint() ||
            !Number.isSafeInteger(r.first_dispatch_ms) ||
            now() < r.first_dispatch_ms ||
            now() - r.first_dispatch_ms >= WINDOW
          )
            return { done: { ...r, status: 'needs_reconciliation' } };
          if (
            request.data.resolve_only ||
            (r.status === 'sending' && r.lease_until > now())
          )
            return { done: r };
          writable(await tx.get(controlRef));
          const update = {
            ...r,
            status: 'sending',
            lease_id: leaseId,
            lease_until: now() + LEASE,
          };
          tx.update(ref, update);
          return { record: update };
        }
        if (request.data.resolve_only) {
          const cancelled = {
            actor_uid: actor.uid,
            actor_email: actor.email,
            project_id: input.project_id,
            operation_id: input.operation_id,
            request_hash: requestHash,
            status: 'cancelled',
            created_at: getServerTimestamp(),
          };
          const audit = ref.collection('audit').doc('cancelled');
          tx.create(ref, cancelled);
          tx.create(audit, {
            operation: 'purchase_request_cancelled',
            actor_uid: actor.uid,
            project_id: input.project_id,
            operation_id: input.operation_id,
            created_at: getServerTimestamp(),
          });
          return { done: cancelled };
        }
        if (
          pointer.exists &&
          pointer.data().status !== 'sent' &&
          pointer.data().request_id !== key
        )
          throw fault('purchase_request_pending', 409);
        writable(await tx.get(controlRef));
        if (access.projectVersion !== input.expected_project_version)
          throw fault('purchase_request_changed', 409);
        const prepared = await prepare({
          tx,
          db,
          bucket,
          input,
          actor,
          ...access,
        });
        const mail = {
          ...buildMail(prepared),
          tags: [{ name: 'bom_purchase_request', value: key }],
        };
        if (
          !plain(mail) ||
          mail.to.length > 50 ||
          Buffer.byteLength(JSON.stringify(mail), 'utf8') > 500 * 1024
        )
          throw fault('purchase_request_too_large');
        const record = {
          actor_uid: actor.uid,
          actor_email: actor.email,
          project_id: input.project_id,
          operation_id: input.operation_id,
          request_hash: requestHash,
          input,
          categories: input.selections.map((s) => s.category),
          mail,
          mail_hash: hash(mail),
          status: 'sending',
          provider_fingerprint: fingerprint(),
          first_dispatch_ms: now(),
          lease_id: leaseId,
          lease_until: now() + LEASE,
          created_at: getServerTimestamp(),
        };
        const audit = ref.collection('audit').doc('reserved');
        assertDocumentBudget([
          { path: ref.path, data: record },
          { path: audit.path, data: { ...record, mail: null } },
        ]);
        tx.create(ref, record);
        if (pointer.exists)
          tx.update(active, { request_id: key, status: 'sending' });
        else tx.create(active, { request_id: key, status: 'sending' });
        tx.create(audit, {
          operation: 'purchase_request_reserved',
          actor_uid: actor.uid,
          project_id: input.project_id,
          operation_id: input.operation_id,
          mail_hash: record.mail_hash,
          created_at: getServerTimestamp(),
        });
        return { record };
      });
      if (reservation.done) return response(reservation.done);
      const record = reservation.record;
      // Recheck the current grant and lease immediately before any provider call.
      await transact(async (tx) => {
        const snap = await tx.get(ref),
          r = snap.data();
        await currentAccess(
          tx,
          request,
          actor,
          input.project_id,
          record.categories
        );
        writable(await tx.get(controlRef));
        if (
          !snap.exists ||
          r.status !== 'sending' ||
          r.lease_id !== leaseId ||
          r.provider_fingerprint !== fingerprint() ||
          r.lease_until <= now() ||
          now() < r.first_dispatch_ms ||
          now() - r.first_dispatch_ms >= WINDOW
        )
          throw fault('purchase_request_changed', 409);
      });
      let accepted;
      try {
        accepted = await sendEmail(record.mail, {
          idempotencyKey: 'purchase-request/' + key,
        });
        if (
          typeof accepted?.id !== 'string' ||
          !accepted.id ||
          accepted.id.length > 512
        )
          throw Error('unconfirmed');
      } catch {
        const uncertain = await transact(async (tx) => {
          const snap = await tx.get(ref),
            r = snap.data();
          if (!snap.exists || r.request_hash !== requestHash)
            throw fault('purchase_request_changed', 409);
          if (r.status === 'sent') return r;
          if (r.lease_id !== leaseId) return r;
          const update = {
            ...r,
            status: 'uncertain',
            lease_id: null,
            lease_until: 0,
            uncertain_at: getServerTimestamp(),
          };
          tx.update(ref, update);
          return update;
        });
        await transact((tx) =>
          currentAccess(tx, request, actor, input.project_id, record.categories)
        );
        return response(uncertain);
      }
      const saved = await finish(ref, record, accepted.id);
      await transact((tx) =>
        currentAccess(tx, request, actor, input.project_id, record.categories)
      );
      return response(saved);
    } catch (e) {
      const identity = [
        'actor_authentication_required',
        'actor_forbidden',
        'identity_provider_unavailable',
      ];
      return {
        ok: false,
        error:
          e?.[PUBLIC] || identity.includes(e?.code)
            ? e.code
            : 'purchase_request_unavailable',
        status: e?.[PUBLIC] || identity.includes(e?.code) ? e.status : 503,
      };
    }
  };
}
module.exports = { createPurchaseRequestOperations };
