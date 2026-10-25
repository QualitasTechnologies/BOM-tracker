import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
assert.equal(emulator.hostname, '127.0.0.1');
let env;
const claims = { email: 'alice@partner.example', email_verified: true, status: 'approved', role: 'viewer' };
const actor = (uid = 'alice', extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra });
const markerPath = 'pulseSupportCutovers/P';
const exactMarker = { fence: 'legacy_support_resolution_writes', version: 1 };
const rca = { rootCause: 'cause', correctiveAction: 'fix', preventiveAction: 'monitor', resolutionSummary: 'restored' };
const canonicalActivity = { type: 'resolution', message: 'RCA and solution record updated', createdBy: 'alice' };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bom-native-security',
    firestore: {
      host: emulator.hostname,
      port: Number(emulator.port),
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});
beforeEach(async () => env.clearFirestore());
after(async () => env.cleanup());

async function seed({ marker = 'absent', projects = ['P'] } = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const projectId of projects) {
      await setDoc(doc(db, `projects/${projectId}`), { projectId, memberIds: ['alice'] });
      if (projectId !== 'P') {
        await setDoc(doc(db, `projects/${projectId}/supportTickets/T`), { projectId, ticketNumber: 'SUP-1', title: 'Ticket', ...rca });
      }
    }
    if (marker !== 'absent') {
      const { path = markerPath, data = marker } = marker;
      await setDoc(doc(db, path), data);
    }
    await setDoc(doc(db, 'projects/P/supportTickets/T'), { projectId: 'P', ticketNumber: 'SUP-1', title: 'Ticket', ...rca });
  });
}

test('an absent, wrong-project, malformed, or mismatched marker preserves legacy resolution writes', async () => {
  const unrecognizedMarkers = [
    'absent',
    { path: 'pulseSupportCutovers/OTHER', data: exactMarker },
    { path: markerPath, data: { fence: 'different_fence', version: 1 } },
    { path: markerPath, data: { fence: exactMarker.fence, version: 2 } },
    { path: markerPath, data: { fence: exactMarker.fence } },
    { path: markerPath, data: { version: 1 } },
    { path: markerPath, data: { fence: 12, version: '1' } },
  ];
  for (const marker of unrecognizedMarkers) {
    await seed({ marker });
    const db = actor().firestore();
    await assertSucceeds(updateDoc(doc(db, 'projects/P/supportTickets/T'), { rootCause: 'changed' }));
    await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/activities/legacy'), canonicalActivity));
    await env.clearFirestore();
  }
});

test('the exact marker blocks direct RCA create and edits while preserving ordinary ticket updates', async () => {
  await seed({ marker: exactMarker });
  const db = actor().firestore();
  for (const field of Object.keys(rca)) {
    await assertFails(updateDoc(doc(db, 'projects/P/supportTickets/T'), { [field]: `changed ${field}` }));
  }
  await assertSucceeds(updateDoc(doc(db, 'projects/P/supportTickets/T'), {
    title: 'Updated title', status: 'in-progress', customerConfirmation: 'confirmed',
  }));
  await assertSucceeds(getDoc(doc(db, 'projects/P/supportTickets/T')));
  const tickets = await getDocs(collection(db, 'projects/P/supportTickets'));
  assert.equal(tickets.size, 1);
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/new-ticket'), { projectId: 'P', title: 'New ticket' }));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/new-ticket'), { projectId: 'P', rootCause: 'forged' }));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/new-ticket'), { projectId: 'P', resolutionSummary: '' }));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/T'), { rootCause: 'merged overwrite' }, { merge: true }));
  await assertFails(updateDoc(doc(actor('alice', { role: 'admin' }).firestore(), 'projects/P/supportTickets/T'), { preventiveAction: 'admin direct write' }));
  await assertFails(deleteDoc(doc(db, 'projects/P/supportTickets/T')));
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/new-empty-ticket'), { projectId: 'P', title: 'No RCA data' }));
  await assertSucceeds(deleteDoc(doc(db, 'projects/P/supportTickets/new-empty-ticket')));
});

test('the exact marker protects canonical RCA activities but preserves customer confirmation and other activity types', async () => {
  await seed({ marker: exactMarker });
  const db = actor().firestore();
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/T/activities/resolution-op'), canonicalActivity));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/T/activities/random'), canonicalActivity));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/T/activities/random-type'), {
    type: 'note', message: 'RCA and solution record updated', createdBy: 'alice',
  }));
  await assertFails(setDoc(doc(db, 'projects/P/supportTickets/T/activities/random-resolution'), {
    type: 'resolution', message: 'A forged resolution note', createdBy: 'alice',
  }));

  for (const [index, value] of ['pending', 'confirmed', 'not required'].entries()) {
    await assertSucceeds(setDoc(doc(db, `projects/P/supportTickets/T/activities/confirmation-${index}`), {
      type: 'resolution', message: `Customer confirmation set to ${value}`, createdBy: 'alice',
    }));
  }
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/activities/note'), {
    type: 'note', message: 'Technician added a note', createdBy: 'alice',
  }));
  for (const type of ['status-change', 'assignment', 'commercial', 'document', 'created', 'communication']) {
    await assertSucceeds(setDoc(doc(db, `projects/P/supportTickets/T/activities/${type}`), {
      type, message: `${type} event remains available`, createdBy: 'alice',
    }));
  }

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'projects/P/supportTickets/T/activities/old-resolution'), canonicalActivity);
    await setDoc(doc(adminDb, 'projects/P/supportTickets/T/activities/note-to-resolution'), { type: 'note', message: 'A note' });
  });
  await assertFails(updateDoc(doc(db, 'projects/P/supportTickets/T/activities/old-resolution'), { message: 'edited' }));
  await assertFails(deleteDoc(doc(db, 'projects/P/supportTickets/T/activities/old-resolution')));
  await assertFails(updateDoc(doc(db, 'projects/P/supportTickets/T/activities/note-to-resolution'), {
    type: 'resolution', message: 'A forged resolution note',
  }));
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'projects/P/supportTickets/T/activities/confirmation-to-rca'), {
      type: 'resolution', message: 'Customer confirmation set to confirmed',
    });
  });
  await assertFails(updateDoc(doc(db, 'projects/P/supportTickets/T/activities/confirmation-to-rca'), {
    message: 'RCA and solution record updated',
  }));
  await assertSucceeds(updateDoc(doc(db, 'projects/P/supportTickets/T/activities/note'), { message: 'Updated note' }));
});

test('the carve-out preserves unrelated nested writes and enforces the fence per project', async () => {
  await seed({ marker: exactMarker, projects: ['P', 'Q'] });
  const db = actor().firestore();
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/supportDocuments/D'), { name: 'report.pdf' }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/activities/A/annotations/note'), { text: 'nested legacy metadata' }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/supportTickets/T/customData/child/grandchildren/grandchild'), { value: true }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/bom/data'), { categories: [] }));
  await assertSucceeds(setDoc(doc(db, 'projects/P/purchaseOrders/PO'), { status: 'draft' }));
  await assertSucceeds(updateDoc(doc(db, 'projects/Q/supportTickets/T'), { rootCause: 'Q remains in coexistence' }));
  await assertFails(updateDoc(doc(actor('mallory').firestore(), 'projects/P/supportTickets/T'), { title: 'outsider' }));
  await assertFails(getDoc(doc(actor('mallory').firestore(), 'projects/P/supportTickets/T')));
  await assertFails(getDoc(doc(actor('mallory').firestore(), 'projects/P/supportTickets/T/activities/A')));
  await assertFails(getDoc(doc(actor('mallory').firestore(), 'projects/P/supportTickets/T/supportDocuments/D')));
  await assertFails(getDocs(collection(actor('mallory').firestore(), 'projects/P/supportTickets')));
  await assertFails(getDoc(doc(actor('alice', { status: 'pending' }).firestore(), 'projects/P/supportTickets/T')));
  await assertFails(setDoc(doc(db, markerPath), { fence: 'attacker', version: 1 }));
  await assertFails(setDoc(doc(actor('alice', { role: 'admin' }).firestore(), markerPath), exactMarker));
});

test('Admin SDK writes bypass the browser fence as expected', async () => {
  await seed({ marker: exactMarker });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, 'projects/P/supportTickets/T'), { rootCause: 'native command write' });
    await setDoc(doc(db, 'projects/P/supportTickets/T/activities/resolution-server'), canonicalActivity);
  });
});
