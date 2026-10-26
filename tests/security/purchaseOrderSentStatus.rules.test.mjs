import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

assert.equal(new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`).hostname, '127.0.0.1');

let env;
const memberClaims = { status: 'approved', role: 'viewer' };
const member = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...memberClaims, ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bom-native-security',
    firestore: {
      host: '127.0.0.1',
      port: 18080,
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/P'), { memberIds: ['alice'] });
    await setDoc(doc(db, 'projects/Q'), { memberIds: ['quinn'] });
    await setDoc(doc(db, 'projects/P/purchaseOrders/draft'), {
      status: 'draft',
      paymentTerms: 'Net 30',
      items: [{ bomItemId: 'item-1', quantity: 2 }],
    });
    await setDoc(doc(db, 'projects/P/purchaseOrders/sent'), {
      status: 'sent',
      sentAt: Timestamp.fromMillis(1_760_000_000_000),
      sentBy: 'admin',
      sentToEmail: 'vendor@example.com',
      nativeSendAttemptId: 'attempt-existing',
      nativeSendPhase: 'complete',
      pdfUrl: 'https://example.test/po.pdf',
      paymentTerms: 'Net 30',
    });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('project access on neighboring and deep non-PO subcollections keeps the current membership rules', async () => {
  const db = member().firestore();
  const email = doc(db, 'projects/P/emails/mail-1');
  const deepItem = doc(db, 'projects/P/bomCategories/cat-1/items/item-1/changes/change-1');

  await assertSucceeds(setDoc(email, { subject: 'Quote' }));
  await assertSucceeds(getDoc(email));
  await assertSucceeds(setDoc(deepItem, { quantity: 2 }));
  await assertSucceeds(updateDoc(deepItem, { quantity: 3 }));
  await assertSucceeds(deleteDoc(deepItem));

  await assertFails(getDoc(doc(member('bob').firestore(), 'projects/P/emails/mail-1')));
  await assertFails(getDoc(doc(member('alice', { status: 'pending' }).firestore(), 'projects/P/emails/mail-1')));
  await assertFails(setDoc(doc(member('bob').firestore(), 'projects/P/bomCategories/cat-1/items/item-1'), { quantity: 1 }));
  await assertFails(getDoc(doc(member('bob').firestore(), 'projects/P/purchaseOrders/draft')));
  await assertFails(setDoc(doc(member('bob').firestore(), 'projects/P/purchaseOrders/draft/receipts/forbidden'), { quantity: 1 }));
  await assertFails(setDoc(doc(member('bob').firestore(), 'projects/P/purchaseOrders/draft/receipts/forbidden/events/event-1'), { kind: 'created' }));
  await assertFails(getDoc(doc(member('alice', { status: 'pending' }).firestore(), 'projects/P/purchaseOrders/draft')));
  await assertFails(setDoc(doc(member('alice', { status: 'pending' }).firestore(), 'projects/P/purchaseOrders/draft/receipts/unapproved'), { quantity: 1 }));
  await assertSucceeds(getDoc(doc(member('admin', { role: 'admin' }).firestore(), 'projects/Q')));

  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'projects/legacy'), { memberIds: null });
  });
  await assertSucceeds(getDoc(doc(member('bob').firestore(), 'projects/legacy')));
});

test('PO create, ordinary edits, approval transitions, receipt statuses, deletion and nested records remain available', async () => {
  const db = member().firestore();
  const draft = doc(db, 'projects/P/purchaseOrders/new-draft');

  await assertSucceeds(setDoc(draft, { status: 'draft', paymentTerms: 'Net 15' }));
  await assertSucceeds(updateDoc(draft, {
    status: 'pending-approval',
    submittedBy: 'alice',
    submittedForApprovalAt: Timestamp.fromMillis(1_760_000_000_000),
  }));
  await assertSucceeds(updateDoc(draft, { status: 'draft', changesRequestedBy: 'admin' }));
  await assertSucceeds(updateDoc(draft, { paymentTerms: 'Net 45', items: [{ bomItemId: 'item-1', quantity: 4 }] }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/draft/receipts/receipt-1'), { quantity: 1 }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/draft/receipts/receipt-1/events/event-1'), { kind: 'created' }));
  await assertSucceeds(getDoc(doc(db, 'projects/P/purchaseOrders/draft/receipts/receipt-1/events/event-1')));
  await assertSucceeds(setDoc(doc(member('alice', { role: 'admin' }).firestore(), 'projects/P/purchaseOrders/draft/receipts/admin-receipt'), { quantity: 2 }));
  await assertSucceeds(updateDoc(doc(member('admin', { role: 'admin' }).firestore(), 'projects/P/purchaseOrders/sent'), {
    status: 'acknowledged',
    updatedAt: Timestamp.fromMillis(1_760_000_000_001),
  }));
  await assertSucceeds(deleteDoc(draft));
});

test('sent PO cannot be reopened or have its status removed, but all typed post-send statuses remain available', async () => {
  for (const [actor, role] of [[member(), 'member'], [member('alice', { role: 'admin' }), 'admin']]) {
    const db = actor.firestore();
    const sent = doc(db, 'projects/P/purchaseOrders/sent');
    await assertFails(updateDoc(sent, { status: 'draft' }));
    await assertFails(updateDoc(sent, { status: 'pending-approval' }));
    await assertFails(updateDoc(sent, { status: deleteField() }));

    for (const status of ['acknowledged', 'partially-received', 'completed', 'cancelled']) {
      const transition = doc(db, `projects/P/purchaseOrders/forward-${role}-${status}`);
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), transition.path), {
          status: 'sent',
          sentAt: Timestamp.fromMillis(1_760_000_000_000),
          sentBy: 'admin',
          sentToEmail: 'vendor@example.com',
        });
      });
      await assertSucceeds(updateDoc(transition, { status }));
    }

    for (const postSendStatus of ['acknowledged', 'partially-received', 'completed', 'cancelled']) {
      const postSend = doc(db, `projects/P/purchaseOrders/sticky-${role}-${postSendStatus}`);
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), postSend.path), {
          status: postSendStatus,
          sentAt: Timestamp.fromMillis(1_760_000_000_000),
          sentBy: 'admin',
          sentToEmail: 'vendor@example.com',
        });
      });
      await assertFails(updateDoc(postSend, { status: 'draft' }));
      await assertFails(updateDoc(postSend, { status: 'pending-approval' }));
      await assertFails(updateDoc(postSend, { status: deleteField() }));
    }

    const sequence = doc(db, `projects/P/purchaseOrders/sequence-${role}`);
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), sequence.path), {
        status: 'sent',
        sentAt: Timestamp.fromMillis(1_760_000_000_000),
        sentBy: 'admin',
        sentToEmail: 'vendor@example.com',
      });
    });
    await assertSucceeds(updateDoc(sequence, { status: 'acknowledged' }));
    await assertFails(updateDoc(sequence, { status: 'draft' }));
    await assertFails(updateDoc(sequence, { status: 'pending-approval' }));
    await assertFails(updateDoc(sequence, { status: deleteField() }));
    await assertSucceeds(updateDoc(sequence, { status: 'partially-received' }));
    await assertFails(updateDoc(sequence, { status: 'draft' }));
  }
});

test('clients cannot delete or recreate a sent PO under the same id', async () => {
  for (const actor of [member(), member('alice', { role: 'admin' })]) {
    const db = actor.firestore();
    for (const status of ['sent', 'acknowledged', 'partially-received', 'completed', 'cancelled']) {
      const po = doc(db, `projects/P/purchaseOrders/delete-${status}`);
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), po.path), {
          status,
          sentAt: Timestamp.fromMillis(1_760_000_000_000),
          sentBy: 'admin',
          sentToEmail: 'vendor@example.com',
        });
      });
      await assertFails(deleteDoc(po));
      await assertFails(setDoc(po, { status: 'draft' }));
    }
  }
});

test('clients cannot delete an in-flight attempt, overwrite a sent PO, or edit sent business fields', async () => {
  const db = member().firestore();
  const inFlight = doc(db, 'projects/P/purchaseOrders/in-flight');
  const materialPending = doc(db, 'projects/P/purchaseOrders/material-pending');
  const cancelled = doc(db, 'projects/P/purchaseOrders/cancelled-attempt');
  const acknowledged = doc(db, 'projects/P/purchaseOrders/acknowledged');

  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), inFlight.path), {
      status: 'pending-approval',
      nativeSendAttemptId: 'attempt-active',
      nativeSendPhase: 'prepared',
    });
    await setDoc(doc(context.firestore(), cancelled.path), {
      status: 'draft',
      nativeSendAttemptId: null,
      nativeSendPhase: 'cancelled',
    });
    await setDoc(doc(context.firestore(), materialPending.path), {
      status: 'sent',
      sentAt: Timestamp.fromMillis(1_760_000_000_000),
      sentBy: 'admin',
      sentToEmail: 'vendor@example.com',
      nativeSendAttemptId: 'attempt-material-pending',
      nativeSendPhase: 'material_pending',
    });
    await setDoc(doc(context.firestore(), acknowledged.path), {
      status: 'acknowledged',
      sentAt: Timestamp.fromMillis(1_760_000_000_000),
      sentBy: 'admin',
      sentToEmail: 'vendor@example.com',
    });
  });

  await assertFails(deleteDoc(inFlight));
  await assertFails(updateDoc(inFlight, { status: 'cancelled' }));
  await assertFails(updateDoc(inFlight, { status: 'draft' }));
  await assertFails(updateDoc(inFlight, { paymentTerms: 'Net 45' }));
  await assertFails(deleteDoc(materialPending));
  await assertFails(updateDoc(materialPending, { status: 'acknowledged' }));
  await assertFails(updateDoc(materialPending, { paymentTerms: 'Net 45' }));
  await assertSucceeds(deleteDoc(cancelled));
  await assertFails(setDoc(doc(db, 'projects/P/purchaseOrders/sent'), { status: 'draft' }));
  await assertFails(setDoc(doc(db, 'projects/P/purchaseOrders/sent'), { status: 'draft' }, { merge: true }));
  await assertFails(setDoc(doc(db, 'projects/P/purchaseOrders/sent'), { paymentTerms: 'Net 45' }, { merge: true }));
  await assertFails(updateDoc(acknowledged, { status: 'sent' }));
});

test('clients cannot create or move an unsent PO directly into a post-send status', async () => {
  for (const actor of [member(), member('alice', { role: 'admin' })]) {
    const db = actor.firestore();
    const draft = doc(db, 'projects/P/purchaseOrders/draft');
    for (const status of ['sent', 'acknowledged', 'partially-received', 'completed', 'cancelled']) {
      await assertFails(setDoc(doc(db, `projects/P/purchaseOrders/forged-create-${status}`), { status }));
      await assertFails(updateDoc(draft, { status }));
    }
  }
});

test('clients cannot create a PO as sent or create its sent metadata', async () => {
  const sentAt = Timestamp.fromMillis(1_760_000_000_000);

  for (const [actor, role] of [[member(), 'member'], [member('alice', { role: 'admin' }), 'admin']]) {
    const db = actor.firestore();
    await assertFails(setDoc(doc(db, `projects/P/purchaseOrders/${role}-forged-sent`), { status: 'sent' }));
    const forged = [
      ['sent-at', 'sentAt', sentAt],
      ['sent-by', 'sentBy', 'alice'],
      ['sent-to', 'sentToEmail', 'vendor@example.com'],
      ['attempt-id', 'nativeSendAttemptId', 'forged-attempt'],
      ['attempt-phase', 'nativeSendPhase', 'prepared'],
      ['pdf-url', 'pdfUrl', 'https://example.test/forged.pdf'],
    ];
    for (const [suffix, field, value] of forged) {
      await assertFails(setDoc(doc(db, `projects/P/purchaseOrders/${role}-forged-${suffix}`), { status: 'draft', [field]: value }));
    }
  }
});

test('clients cannot transition a PO to sent or change sent metadata, while unrelated edits still work', async () => {
  const sentAt = Timestamp.fromMillis(1_760_000_000_000);

  for (const actor of [member(), member('alice', { role: 'admin' })]) {
    const db = actor.firestore();
    const draft = doc(db, 'projects/P/purchaseOrders/draft');
    const sent = doc(db, 'projects/P/purchaseOrders/sent');

    await assertFails(updateDoc(draft, { status: 'sent' }));
    await assertFails(updateDoc(draft, {
      status: 'sent',
      sentAt,
      sentBy: 'alice',
      sentToEmail: 'vendor@example.com',
    }));
    await assertFails(updateDoc(draft, { sentAt }));
    await assertFails(updateDoc(draft, { sentBy: 'alice' }));
    await assertFails(updateDoc(draft, { sentToEmail: 'vendor@example.com' }));
    await assertFails(updateDoc(draft, { nativeSendAttemptId: 'forged-attempt' }));
    await assertFails(updateDoc(draft, { nativeSendPhase: 'prepared' }));
    await assertFails(updateDoc(draft, { pdfUrl: 'https://example.test/forged.pdf' }));
    await assertFails(updateDoc(sent, { sentAt: Timestamp.fromMillis(1_760_000_000_001) }));
    await assertFails(updateDoc(sent, { sentAt: deleteField() }));
    await assertFails(updateDoc(sent, { sentBy: 'alice' }));
    await assertFails(updateDoc(sent, { sentToEmail: 'attacker@example.com' }));
    await assertFails(updateDoc(sent, { nativeSendAttemptId: 'forged-attempt' }));
    await assertFails(updateDoc(sent, { nativeSendPhase: 'prepared' }));
    await assertFails(updateDoc(sent, { pdfUrl: 'https://example.test/forged.pdf' }));
    for (const field of ['sentAt', 'sentBy', 'sentToEmail', 'nativeSendAttemptId', 'nativeSendPhase', 'pdfUrl']) {
      await assertFails(updateDoc(sent, { [field]: deleteField() }));
    }
    await assertSucceeds(updateDoc(draft, { paymentTerms: 'Net 60' }));
    await assertSucceeds(updateDoc(sent, { status: 'partially-received', updatedAt: Timestamp.fromMillis(1_760_000_000_001) }));
    await assertFails(updateDoc(sent, { vendorEmail: 'attacker@example.com' }));
    await assertFails(updateDoc(sent, { items: [{ bomItemId: 'other', quantity: 99, rate: 0 }] }));
    await assertFails(updateDoc(sent, { totalAmount: 0 }));
  }
});

test('completed and cancelled purchase orders cannot be reopened', async () => {
  const db = member().firestore();
  const sent = doc(db, 'projects/P/purchaseOrders/sent');
  await assertSucceeds(updateDoc(sent, { status: 'cancelled', closedAt: Timestamp.fromMillis(1_760_000_000_001) }));
  await assertFails(updateDoc(sent, { status: 'acknowledged' }));
});

const legacySendFields = {
  acceptedAt: '2026-10-18T18:30:00.000Z',
  actualSentDate: '2026-10-19',
  legacySendAttemptId: 'forged-attempt',
  legacySendPhase: 'preparing',
  legacySendAcceptedAt: '2026-10-18T18:30:00.000Z',
  legacySendPreparingAt: Timestamp.fromMillis(1_760_000_000_000),
  legacySendDispatchStartedAt: Timestamp.fromMillis(1_760_000_000_000),
  legacySendProviderId: 'forged-provider',
  legacySendActorUid: 'alice',
  legacySendRecipientEmail: 'attacker@example.com',
  legacySendPdfUrl: 'https://example.test/forged.pdf',
  legacySendFileSize: 1,
  legacySendDocumentId: 'forged-document',
  legacySendRetryPayloadReady: true,
};

test('legacy email send metadata and receipts cannot be forged, cleared or edited around by project members or admins', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects/P/purchaseOrders/legacy-active'), {
      status: 'pending-approval', paymentTerms: 'Net 30', items: [{ bomItemId: 'item-1', quantity: 2 }],
      legacySendAttemptId: 'attempt-1', legacySendPhase: 'uncertain', legacySendRetryPayloadReady: true,
      legacySendDispatchStartedAt: Timestamp.fromMillis(1_760_000_000_000), legacySendRecipientEmail: 'vendor@example.com',
    });
    await setDoc(doc(db, 'projects/P/purchaseOrders/legacy-sent'), {
      status: 'sent', paymentTerms: 'Net 30', items: [{ bomItemId: 'item-1', quantity: 2 }],
      // Keep these different from legacySendFields: unchanged writes do not forge metadata.
      sentAt: Timestamp.fromMillis(1_760_000_000_000), acceptedAt: '2026-10-17T18:30:00.000Z',
      actualSentDate: '2026-10-18', sentBy: 'admin', sentToEmail: 'vendor@example.com',
    });
    await setDoc(doc(db, 'projects/P/purchaseOrders/accepted-only'), {
      status: 'pending-approval', paymentTerms: 'Net 30', actualSentDate: '2026-10-19',
    });
  });
  for (const actor of [member(), member('alice', { role: 'admin' })]) {
    const db = actor.firestore();
    const draft = doc(db, 'projects/P/purchaseOrders/draft');
    const active = doc(db, 'projects/P/purchaseOrders/legacy-active');
    const legacySent = doc(db, 'projects/P/purchaseOrders/legacy-sent');
    for (const [field, value] of Object.entries(legacySendFields)) {
      await assertFails(setDoc(doc(db, `projects/P/purchaseOrders/forged-${field}`), { status: 'draft', [field]: value }), `create ${field}`);
      await assertFails(updateDoc(draft, { [field]: value }), `draft ${field}`);
      await assertFails(updateDoc(active, { [field]: value }), `active ${field}`);
      await assertFails(updateDoc(legacySent, { [field]: value }), `sent ${field}`);
    }
    for (const field of ['legacySendAttemptId', 'legacySendPhase', 'legacySendRetryPayloadReady', 'legacySendDispatchStartedAt', 'legacySendRecipientEmail']) {
      await assertFails(updateDoc(active, { [field]: deleteField() }), `clear ${field}`);
    }
    for (const field of ['acceptedAt', 'actualSentDate']) {
      await assertFails(updateDoc(legacySent, { [field]: deleteField() }), `clear ${field}`);
    }
    // A reserved or uncertain legacy send freezes ordinary edits, status changes and deletion.
    await assertFails(updateDoc(active, { paymentTerms: 'Net 90' }));
    await assertFails(updateDoc(active, { status: 'draft' }));
    await assertFails(updateDoc(active, { status: 'sent' }));
    await assertFails(deleteDoc(active));
    // Server-written acceptance evidence marks the PO as sent for post-send field limits and deletion.
    await assertFails(updateDoc(doc(db, 'projects/P/purchaseOrders/accepted-only'), { paymentTerms: 'Net 90' }));
    await assertFails(deleteDoc(doc(db, 'projects/P/purchaseOrders/accepted-only')));
    await assertFails(updateDoc(legacySent, { items: [{ bomItemId: 'other', quantity: 99, rate: 0 }] }));
    await assertFails(deleteDoc(legacySent));
    await assertSucceeds(updateDoc(legacySent, { status: 'acknowledged', updatedAt: Timestamp.fromMillis(1_760_000_000_001) }));
    await assertSucceeds(updateDoc(draft, { paymentTerms: 'Net 60' }));

    for (const path of [
      'pulseLegacyPOSendAttempts/P/attempts/attempt-1',
      'pulseLegacyPOSendRecoveries/P/operations/forged',
      'pulseProcurementOperations/P/audit/attempt-1-legacy-email',
      'pulseProcurementOperations/P/legacyMarks/operation-1',
    ]) {
      await assertFails(getDoc(doc(db, path)), `read ${path}`);
      await assertFails(setDoc(doc(db, path), { project_id: 'P', po_id: 'draft' }), `write ${path}`);
    }
  }
});
