const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('project document callable is provider-free and strictly default-off behind all three switches',()=>{
 const source=fs.readFileSync(require.resolve('./index.js'),'utf8'),start=source.indexOf('// Native project documents:');assert.ok(start>=0);
 let options,config,bucket={name:'bucket'};const context={exports:{},process:{env:{}},admin:{auth:()=>({}),storage:()=>({bucket:()=>bucket}),firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}})},
  require:()=>({...require('./nativeProjectDocumentOperations.cjs'),createNativeProjectDocumentOperations:input=>{options=input;return'handler';}}),onCall:(settings,handler)=>{config=settings;return handler;}};
 const end=source.indexOf('// Authorized original-screen reads.',start);assert.ok(end>start);
 vm.runInNewContext(source.slice(start,end),context);assert.equal(config.secrets,undefined);assert.equal(config.region,'us-central1');assert.equal(options.bucket,bucket);assert.equal(options.enabled(),false);assert.equal(context.exports.nativeProjectDocumentOperations,'handler');
 assert.equal(typeof options.getServerTimestamp,'function');
 const env=context.process.env;env.BOM_NATIVE_PROJECT_DOCUMENTS_ENABLED='true';assert.equal(options.enabled(),false);
 env.BOM_MATERIAL_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),false);
 env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),true);
 env.BOM_NATIVE_PROJECT_DOCUMENTS_ENABLED='false';assert.equal(options.enabled(),false);
});
test('document export coverage is bounded between receipt and scoped-read exports',()=>{
 const source=fs.readFileSync(require.resolve('./index.js'),'utf8');assert.equal(source.split('// Native project documents:').length,2);
 assert.ok(source.indexOf('// Native project documents:')>source.indexOf('// Native travel receipts:'));
 assert.ok(source.indexOf('// Authorized original-screen reads.')>source.indexOf('// Native project documents:'));
});
