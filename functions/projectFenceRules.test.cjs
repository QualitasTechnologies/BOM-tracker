const test=require('node:test'),assert=require('node:assert/strict'),{readFile}=require('node:fs/promises');
test('project-only release strips to the exact published material policy and rejects drift',async()=>{
 const {buildProjectFenceRules,stripProjectFenceAddition,BASELINE_SHA256}=await import('../scripts/build-project-fence-rules.mjs');
 const baseline=(await readFile(new URL('../firestore.material-fence.rules',require('node:url').pathToFileURL(__filename)),'utf8')).replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(baseline).digest('hex'),BASELINE_SHA256);
 const result=buildProjectFenceRules(baseline);assert.equal((await readFile(new URL('../firestore.project-fence.rules',require('node:url').pathToFileURL(__filename)),'utf8')).replace(/\r\n/g,'\n'),result);assert.equal(stripProjectFenceAddition(result),baseline);assert.equal((result.match(/&& !projectClientWritesFenced\(\)/g)||[]).length,3);
 assert.throws(()=>buildProjectFenceRules(baseline+'\n'),/baseline/);assert.throws(()=>stripProjectFenceAddition(result+'\n        && !projectClientWritesFenced()\n'),/ambiguous/);
});
