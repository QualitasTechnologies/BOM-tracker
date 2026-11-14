const test=require('node:test'),assert=require('node:assert/strict'),{readFile}=require('node:fs/promises'),{createHash}=require('node:crypto');
test('material rule addition is pinned to the live schedule policy and exactly reversible',async()=>{
 const {buildMaterialFenceRules,stripMaterialFenceAddition,BASELINE_SHA256}=await import('../scripts/build-material-fence-rules.mjs');
 const baseline=(await readFile(require('node:path').join(__dirname,'../firestore.schedule-fence.rules'),'utf8')).replace(/\r\n/g,'\n'),candidate=buildMaterialFenceRules(baseline);
 assert.equal(createHash('sha256').update(stripMaterialFenceAddition(candidate)).digest('hex'),BASELINE_SHA256);
 assert.equal(stripMaterialFenceAddition(candidate),baseline);
 assert.throws(()=>buildMaterialFenceRules(baseline+'\n'),/baseline_changed/);
 assert.throws(()=>stripMaterialFenceAddition(candidate+candidate),/ambiguous/);
 assert.equal((await readFile(require('node:path').join(__dirname,'../firestore.material-fence.rules'),'utf8')).replace(/\r\n/g,'\n'),candidate);
});
