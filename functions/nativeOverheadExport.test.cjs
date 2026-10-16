const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./index.js'),'utf8');
test('overhead export is provider-free and requires all three explicit mutation flags',()=>{
  let options,config;const context={exports:{},process:{env:{}},admin:{auth:()=>({}),firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}})},require:()=>({...require('./nativeOverheadOperations.cjs'),createNativeOverheadOperations:input=>{options=input;return'handler';}}),onCall:(settings,handler)=>{config=settings;return handler;}};
  const start=source.indexOf('// Native project overheads:');assert.notEqual(start,-1,'native overhead export marker');vm.runInNewContext(source.slice(start,source.indexOf('// Durable expense approval notifications',start)),context);
  assert.equal(options.enabled(),false);assert.equal(config.secrets,undefined);assert.equal(config.region,'us-central1');assert.equal(context.exports.nativeOverheadOperations,'handler');context.process.env.BOM_NATIVE_OVERHEAD_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),false);context.process.env.BOM_MATERIAL_MUTATIONS_ENABLED='true';context.process.env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),true);
});
