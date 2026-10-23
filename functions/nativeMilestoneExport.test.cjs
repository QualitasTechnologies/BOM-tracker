const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./index.js'),'utf8');
test('schedule export has no provider secret and requires all three explicit native write flags',()=>{
  let options,config;const context={exports:{},process:{env:{}},admin:{auth:()=>({}),firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}})},
    require:()=>({...require('./nativeMilestoneOperations.cjs'),createNativeMilestoneOperations:input=>{options=input;return'handler';}}),onCall:(settings,handler)=>{config=settings;return handler;}};
  vm.runInNewContext(source.slice(source.indexOf('// Native delivery schedule'),source.indexOf('// Native project overheads')),context);
  assert.equal(options.enabled(),false);assert.equal(config.secrets,undefined);assert.equal(config.region,'us-central1');assert.equal(context.exports.nativeMilestoneOperations,'handler');
  context.process.env.BOM_NATIVE_MILESTONE_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),false);
  context.process.env.BOM_MATERIAL_MUTATIONS_ENABLED='true';context.process.env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),true);
});

test('scoped schedule access follows its exact read flag independently from mutation flags',()=>{
  let options;const context={exports:{},process:{env:{}},admin:{auth:()=>({}),firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}})},
    require:()=>({...require('./nativeMilestoneOperations.cjs'),createNativeMilestoneOperations:input=>{options=input;return'handler';}}),onCall:(_settings,handler)=>handler};
  vm.runInNewContext(source.slice(source.indexOf('// Native delivery schedule'),source.indexOf('// Native project overheads')),context);
  assert.equal(options.scopedReadsEnabled(),false);
  for(const value of ['false','TRUE','1']){context.process.env.BOM_SCOPED_READS_ENABLED=value;assert.equal(options.scopedReadsEnabled(),false);}
  context.process.env.BOM_SCOPED_READS_ENABLED='true';assert.equal(options.scopedReadsEnabled(),true);assert.equal(options.enabled(),false);
  context.process.env.BOM_MATERIAL_MUTATIONS_ENABLED='true';context.process.env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED='true';context.process.env.BOM_NATIVE_MILESTONE_MUTATIONS_ENABLED='true';
  context.process.env.BOM_SCOPED_READS_ENABLED='false';assert.equal(options.scopedReadsEnabled(),false);assert.equal(options.enabled(),true);
});
