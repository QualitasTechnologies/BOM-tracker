#!/usr/bin/env node

import { runAllAIImportTests } from './aiImportTest';

// Simple test runner
const main = async () => {
  console.log('Starting BOM AI Import Tests...\n');
  
  try {
    await runAllAIImportTests();
  } catch (error: any) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
};

// Run if called directly
if (require.main === module) {
  main();
}

export default main;