const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('staged overhead Rules exist and have a reversible addition on the exact published baseline',async()=>{
 const root=path.resolve(__dirname,'..'),artifact=path.join(root,'firestore.overhead-fence.rules');
 assert.equal(fs.existsSync(artifact),true,'staged overhead fence Rules must exist');
 const{buildOverheadFenceRules,stripOverheadFenceAddition,BASELINE_SHA256,OVERHEAD_HELPER}=await import('../scripts/build-overhead-fence-rules.mjs');
 const baseline=fs.readFileSync(path.join(root,'firestore.read-signals.rules'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(baseline).digest('hex'),BASELINE_SHA256);
 const staged=fs.readFileSync(artifact,'utf8').replace(/\r\n/g,'\n');assert.equal(staged,buildOverheadFenceRules(baseline));assert.equal(stripOverheadFenceAddition(staged),baseline);
 assert.ok(fs.readFileSync(path.join(root,'firestore.rules'),'utf8').replace(/\r\n/g,'\n').includes(OVERHEAD_HELPER),'candidate and staged Rules use the same helper');
 assert.throws(()=>buildOverheadFenceRules(baseline+'\n'),/baseline_changed/);assert.throws(()=>stripOverheadFenceAddition(staged+staged),/ambiguous/);
});
