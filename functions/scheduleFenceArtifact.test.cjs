const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
test('schedule artifact is pinned, reversible and uses the same helpers as the full candidate',async()=>{
 const root=path.resolve(__dirname,'..'),{BASELINE_SHA256,SCHEDULE_HELPER,buildScheduleFenceRules,stripScheduleFenceAddition}=await import(pathToFileURL(path.join(root,'scripts/build-schedule-fence-rules.mjs')));
 const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n'),baseline=read('firestore.overhead-fence.rules'),artifact=read('firestore.schedule-fence.rules');
 assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'),BASELINE_SHA256);assert.equal(buildScheduleFenceRules(baseline),artifact);assert.equal(stripScheduleFenceAddition(artifact),baseline);assert.ok(read('firestore.rules').includes(SCHEDULE_HELPER));assert.throws(()=>buildScheduleFenceRules(baseline+'\n'),/baseline_changed/);assert.throws(()=>stripScheduleFenceAddition(artifact+SCHEDULE_HELPER),/ambiguous/);
});
