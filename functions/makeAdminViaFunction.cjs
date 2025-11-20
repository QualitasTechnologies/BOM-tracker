/**
 * Make a user admin using the bootstrapAdmin cloud function
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function makeAdmin() {
  const email = 'chaitanya@qualitastech.com';
  const adminKey = 'QualitasTech2025Bootstrap'; // From functions/index.js line 246

  console.log(`Making ${email} an admin using bootstrapAdmin function...`);

  try {
    // Call the cloud function using firebase CLI
    const command = `firebase functions:call bootstrapAdmin --data='{"email":"${email}","adminKey":"${adminKey}"}'`;

    console.log('Calling cloud function...');
    const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() + '/..' });

    if (stderr) {
      console.error('stderr:', stderr);
    }

    console.log('stdout:', stdout);
    console.log(`\n✅ SUCCESS: ${email} should now be an admin!`);
    console.log('The user will need to sign out and sign back in for changes to take effect.');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.log('\nAlternative: The cloud function might not be deployed.');
    console.log('Let me try a direct approach...');
  }
}

makeAdmin();
