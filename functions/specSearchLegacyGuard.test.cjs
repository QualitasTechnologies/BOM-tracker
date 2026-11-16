const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {isNativeSpecSearchEnabled,nativeSpecSearchEnabled}=require('./specSearchLegacyGuard.cjs');
test('native spec enablement requires all three literal true gates',()=>{
 for(const value of [undefined,null,false,'TRUE','True','1','yes',' true','true '])assert.equal(isNativeSpecSearchEnabled(value),false);
 assert.equal(isNativeSpecSearchEnabled('true'),true);
 const all={BOM_MATERIAL_MUTATIONS_ENABLED:'true',BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED:'true',BOM_NATIVE_SPEC_SEARCH_ENABLED:'true'};
 assert.equal(nativeSpecSearchEnabled(all),true);
 for(const key of Object.keys(all))for(const value of [undefined,'false','TRUE',true])assert.equal(nativeSpecSearchEnabled({...all,[key]:value}),false);
});
test('actual callable export uses current Firebase identity, bounded runtime and default-off write gates',()=>{
 const source=fs.readFileSync(require.resolve('./index.js'),'utf8'),start=source.indexOf('// Native specification search callable'),end=source.indexOf('// end nativeSpecSearchOperation',start);
 assert.ok(start>=0&&end>start,'existing client callable must actually be exported');
 let deps,options;const auth={synthetic:true},db={synthetic:true},context={exports:{},process:{env:{}},admin:{firestore:()=>db,auth:()=>auth},onCall:(opts,handler)=>{options=opts;return handler;},require:name=>name==='./nativeSpecSearchOperations.cjs'?{createNativeSpecSearchOperation:d=>{deps=d;return ()=>{};}}:name==='./specSearchActor.cjs'?{resolveSpecSearchActor:async input=>input}:require(name),fetch:async()=>{throw Error('no live provider');}};
 vm.runInNewContext(source.slice(start,end),context);assert.equal(typeof context.exports.nativeSpecSearchOperation,'function');assert.equal(deps.db,db);assert.equal(deps.enabled(),false);assert.equal(options.timeoutSeconds,120);assert.equal(options.concurrency,1);assert.equal(options.cpu,'gcf_gen1');
 Object.assign(context.process.env,{BOM_MATERIAL_MUTATIONS_ENABLED:'true',BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED:'true',BOM_NATIVE_SPEC_SEARCH_ENABLED:'true'});assert.equal(deps.enabled(),true);
 return deps.resolveActor({auth:{uid:'synthetic'}}).then(input=>assert.equal(input.auth,auth));
});
test('actual legacy export preserves unfenced coexist searches even when the native switch is enabled',async()=>{
 const {fixture}=require('./nativeMilestoneFixture.cjs'),f=fixture();f.docs.delete('pulseRuntimeControl/cutover');f.docs.set('projects/P/bom/data',{categories:[{name:'Parts',items:[{id:'motor',name:'Motor'}]}]});
 let calls=0;const source=fs.readFileSync(require.resolve('./index.js'),'utf8'),start=source.indexOf('exports.triggerSpecSearch = onRequest('),end=source.indexOf('// Native specification search callable',start);
 const context={exports:{},process:{env:{BOM_NATIVE_SPEC_SEARCH_ENABLED:'true'}},onRequest:fn=>fn,require:name=>require(name),admin:{firestore:Object.assign(()=>f.db,{FieldValue:{serverTimestamp:()=> 'time'}})},logger:{error(){}},fetch:async()=>{calls++;return{ok:true,json:async()=>({success:true,specificationUrl:'https://docs.example.test/spec.pdf'})};}};
 vm.runInNewContext(source.slice(start,end),context);const invoke=async()=>{let status;await context.exports.triggerSpecSearch({method:'POST',body:{projectId:'P',bomItemId:'motor',itemName:'Motor'}},{set(){},status(n){status=n;return this;},json(){}});return status;};
 assert.equal(await invoke(),200);assert.equal(calls,1);f.docs.set('pulseMaterialCutovers/P',{fence:'legacy_bom_data_writes',version:1});assert.equal(await invoke(),503);assert.equal(calls,1);
});
