/**
 * One-time migration: moves per-project stakeholders subcollection into the project document.
 * Run with: node functions/migrate-stakeholders.cjs
 * Uses application default credentials (firebase login already authenticated).
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'visionbomtracker' });

const db = admin.firestore();

async function migrate() {
  console.log('Starting stakeholder migration...\n');

  const projectsSnap = await db.collection('projects').get();
  const results = { processed: 0, skipped: 0, errors: [] };

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    const projectData = projectDoc.data();

    try {
      const stakeholdersSnap = await db
        .collection('projects').doc(projectId)
        .collection('stakeholders')
        .get();

      if (stakeholdersSnap.empty) {
        results.skipped++;
        continue;
      }

      const existingMembers = (projectData.members || []).map(m => ({ ...m }));
      const existingExternal = projectData.externalRecipients || [];
      const existingExternalEmails = new Set(existingExternal.map(r => r.email.toLowerCase()));

      const newExternalRecipients = [...existingExternal];
      let membersUpdated = false;

      for (const stDoc of stakeholdersSnap.docs) {
        const st = stDoc.data();
        const stEmail = (st.email || '').toLowerCase();
        if (!stEmail) continue;

        const matchIdx = existingMembers.findIndex(m => m.email.toLowerCase() === stEmail);

        if (matchIdx !== -1) {
          // Already a member — set notificationsEnabled if not already set
          if (existingMembers[matchIdx].notificationsEnabled === undefined) {
            existingMembers[matchIdx].notificationsEnabled = st.notificationsEnabled !== false;
            membersUpdated = true;
          }
        } else if (!existingExternalEmails.has(stEmail)) {
          // Not a member — add as email-only external recipient
          newExternalRecipients.push({
            email: st.email,
            name: st.name || st.email,
            notificationsEnabled: st.notificationsEnabled !== false,
          });
          existingExternalEmails.add(stEmail);
        }
      }

      const update = {};
      if (membersUpdated) update.members = existingMembers;
      if (newExternalRecipients.length !== (projectData.externalRecipients || []).length) {
        update.externalRecipients = newExternalRecipients;
      }

      if (Object.keys(update).length > 0) {
        await db.collection('projects').doc(projectId).update(update);
        console.log(`✅ ${projectId} (${projectData.projectName}): ${stakeholdersSnap.size} stakeholder(s) migrated`);
      } else {
        console.log(`⏭  ${projectId} (${projectData.projectName}): already up to date`);
      }

      results.processed++;
    } catch (err) {
      console.error(`❌ ${projectId}: ${err.message}`);
      results.errors.push({ projectId, error: err.message });
    }
  }

  console.log(`\nDone. Processed: ${results.processed}, Skipped (no stakeholders): ${results.skipped}, Errors: ${results.errors.length}`);
  if (results.errors.length > 0) {
    console.error('Errors:', results.errors);
    process.exit(1);
  }
  process.exit(0);
}

migrate().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
