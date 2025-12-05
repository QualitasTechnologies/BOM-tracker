/**
 * Temporary script to make a user an admin
 * Run: node makeAdmin.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with project ID
// Using GOOGLE_APPLICATION_CREDENTIALS environment variable for authentication
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_CONFIG || '';

admin.initializeApp({
  projectId: 'visionbomtracker'
});

async function makeAdmin() {
  const targetEmail = 'rkashyap@gmail.com';

  try {
    console.log(`Looking up user: ${targetEmail}...`);

    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(targetEmail);
    console.log(`Found user with UID: ${userRecord.uid}`);

    // Check current claims
    console.log('Current custom claims:', userRecord.customClaims || 'None');

    // Set admin claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      status: 'approved',
      approvedAt: admin.firestore.Timestamp.now().toDate().toISOString(),
      approvedBy: 'system',
      grantedVia: 'makeAdmin script'
    });

    console.log(`✅ SUCCESS: ${targetEmail} is now an admin!`);
    console.log('The user will need to sign out and sign back in for changes to take effect.');

    // Verify the change
    const updatedUser = await admin.auth().getUser(userRecord.uid);
    console.log('New custom claims:', updatedUser.customClaims);

    process.exit(0);

  } catch (error) {
    console.error('❌ ERROR:', error.message);

    if (error.code === 'auth/user-not-found') {
      console.log('\nThe user needs to sign up first before being made an admin.');
      console.log('Please have chaitanya@qualitastech.com create an account in the app first.');
    }

    process.exit(1);
  }
}

makeAdmin();
