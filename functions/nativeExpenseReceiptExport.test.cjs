const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('travel receipt callable is provider-free and strictly default-off behind all three switches',()=>{
 const source=fs.readFileSync(require.resolve('./index.js'),'utf8'),start=source.indexOf('// Native travel receipts:');assert.ok(start>=0);
 let options,config;const context={exports:{},process:{env:{}},admin:{auth:()=>({}),storage:()=>({bucket:()=>({})}),firestore:Object.assign(()=>({}),{FieldValue:{serverTimestamp:()=>0}})},
  require:()=>({...require('./nativeExpenseReceiptOperations.cjs'),createNativeExpenseReceiptOperations:input=>{options=input;return'handler';}}),onCall:(settings,handler)=>{config=settings;return handler;}};
 const end=source.indexOf('// Native project documents:',start);vm.runInNewContext(source.slice(start,end<0?undefined:end),context);assert.equal(config.secrets,undefined);assert.equal(options.enabled(),false);assert.equal(context.exports.nativeExpenseReceiptOperations,'handler');
 context.process.env.BOM_NATIVE_EXPENSE_RECEIPTS_ENABLED='true';assert.equal(options.enabled(),false);context.process.env.BOM_MATERIAL_MUTATIONS_ENABLED='true';context.process.env.BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED='true';assert.equal(options.enabled(),true);
});
