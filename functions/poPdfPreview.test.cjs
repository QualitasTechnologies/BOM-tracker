const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const PDFDocument=require('pdfkit');
const indexSource=fs.readFileSync(path.join(__dirname,'index.js'),'utf8');
const formatterStart=indexSource.indexOf('function formatIndianCurrency(');
const formatterSource=indexSource.slice(formatterStart,indexSource.indexOf('\n/**',formatterStart));
const rendererSource=indexSource.slice(indexSource.indexOf('async function generatePOPDFHandler('),indexSource.indexOf('\nconst legacyPoAccess =',indexSource.indexOf('async function generatePOPDFHandler(')));
const entrySource=indexSource.slice(indexSource.indexOf('exports.generatePOPDF = onCall('),indexSource.indexOf('\nfunction buildPOEmailData',indexSource.indexOf('exports.generatePOPDF = onCall(')));
const issuedPath='purchase-orders/fixture-project/QA-ONLY-001.pdf';
const stored={bytes:Buffer.from('%PDF historical issued fixture - never rewrite'),metadata:{contentType:'application/pdf',metadata:{firebaseStorageDownloadTokens:'historical-token',retained:'keep'}}};
function fixture({failSave=false,poOverrides={}}={}){
 const objects=new Map([[issuedPath,structuredClone(stored)]]),events=[];
 const bucket={name:'fixture.invalid',file:filename=>({save:async(bytes,options)=>{events.push({kind:'save',filename,options});if(failSave)throw Error('upload failed');if(options.preconditionOpts?.ifGenerationMatch===0&&objects.has(filename))throw Object.assign(Error('exists'),{code:412});objects.set(filename,{bytes:Buffer.from(bytes),metadata:structuredClone(options.metadata)});},setMetadata:async metadata=>{events.push({kind:'setMetadata',filename});const old=objects.get(filename);old.metadata={...old.metadata,...metadata,metadata:{...old.metadata.metadata,...metadata.metadata}};}})};
 const po={id:'fixture-po',projectId:'fixture-project',poNumber:'QA-ONLY-001',poDate:new Date('2026-11-18'),projectReference:'SYNTHETIC TEST ONLY',vendorName:'Synthetic vendor',vendorAddress:'Test address',vendorGstin:'TEST-ONLY',vendorStateCode:'29',invoiceToCompany:'Synthetic fixture',invoiceToAddress:'Test address',invoiceToGstin:'TEST-ONLY',shipToAddress:'Test address',items:[{slNo:1,description:'Synthetic item',quantity:1,rate:10,amount:10,uom:'nos'}],subtotal:10,taxType:'igst',taxPercentage:18,igstAmount:1.8,totalAmount:11.8,amountInWords:'Synthetic fixture amount',paymentTerms:'Test only',deliveryTerms:'Test only',...poOverrides};
 const company={companyName:'SYNTHETIC TEST ONLY',companyAddress:'Fixture address',gstin:'TEST-ONLY',pan:'TEST-ONLY'};
 const cachedNative={path:'native-purchase-orders/cached.pdf',generation:'1',sha256:'a'.repeat(64),url:'https://fixture.invalid/cached'};
 const context=vm.createContext({Buffer,PDFDocument,__dirname,require:name=>{if(['http','https','node:http','node:https'].includes(name))throw Error('network forbidden');if(name==='fs')return{...fs,existsSync:()=>false};return require(name);},admin:{storage:()=>({bucket:()=>bucket})},logger:{info(){},warn(){},error(){}},functions:{https:{HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}}},formatDateSafe:()=> '18 Nov 2026',legacyPoAccess:{preparePreview:async()=>({po,companySettings:company})},onCall:fn=>fn,exports:{},readNativePoArtifact:async()=>cachedNative,writeNativePoArtifact:async()=>{throw Error('cached native artifact must not rewrite');},writePoPreview:options=>require('./poPdfPreview.cjs').writePoPreview(options)});
 vm.runInContext(formatterSource,context);vm.runInContext(rendererSource,context);vm.runInContext(entrySource,context);
 return{bucket,objects,events,po,company,cachedNative,preview:input=>context.exports.generatePOPDF({data:input||{}}),legacy:()=>context.generatePOPDFHandler({data:{purchaseOrder:po,companySettings:company}}),native:()=>context.generatePOPDFHandler({data:{purchaseOrder:po,companySettings:company}},{path:'native-purchase-orders/cached.pdf'})};
}
const fingerprint=value=>crypto.createHash('sha256').update(value.bytes).update(JSON.stringify(value.metadata)).digest('hex');
test('actual authorized preview callable cannot overwrite the existing issued PDF or rotate its token',async()=>{
 const f=fixture(),before=fingerprint(f.objects.get(issuedPath)),result=await f.preview({preview:false});
 assert.equal(fingerprint(f.objects.get(issuedPath)),before,'preview changed issued bytes/token');
 assert.notEqual(result.storagePath,issuedPath);assert.match(result.storagePath,/^purchase-orders\/fixture-project\/previews\/[a-f0-9-]+\.pdf$/);
 assert.equal(result.success,true);assert.equal(result.pdfUrl,result.downloadUrl);assert.equal(f.objects.get(result.storagePath).bytes.subarray(0,5).toString(),'%PDF-');
 assert.equal(f.events.length,1,'preview publishes bytes and token atomically');assert.equal(f.events[0].kind,'save');assert.equal(f.events[0].options.preconditionOpts.ifGenerationMatch,0);
 assert.equal(new URL(result.pdfUrl).searchParams.get('token'),f.objects.get(result.storagePath).metadata.metadata.firebaseStorageDownloadTokens);
});
test('actual concurrent previews have independent targets and leave the issued artifact intact',async()=>{
 const f=fixture(),before=fingerprint(f.objects.get(issuedPath));const[a,b]=await Promise.all([f.preview(),f.preview()]);
 assert.notEqual(a.storagePath,b.storagePath);assert.equal(f.objects.size,3);assert.equal(fingerprint(f.objects.get(issuedPath)),before);
});
test('actual legacy sender rendering retains its original publication contract',async()=>{
 const f=fixture(),result=await f.legacy();assert.equal(result.storagePath,issuedPath);assert.equal(result.success,true);assert.deepEqual(f.events.map(e=>e.kind),['save','setMetadata']);
});
test('actual native immutable-artifact lookup remains unchanged',async()=>{
 const f=fixture();assert.deepEqual(await f.native(),f.cachedNative);assert.equal(f.events.length,0);
});
test('failed preview publication cannot rotate or change the issued artifact',async()=>{
 const f=fixture({failSave:true}),before=fingerprint(f.objects.get(issuedPath));await assert.rejects(f.preview(),/upload failed/);assert.equal(fingerprint(f.objects.get(issuedPath)),before);assert.equal(f.events.filter(e=>e.kind==='setMetadata').length,0);
});
let writePoPreview;try{({writePoPreview}=require('./poPdfPreview.cjs'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const uuid='00000000-0000-4000-8000-000000000001';
test('preview publisher rejects malformed server-owned project or PO identity before Storage access',async()=>{
 assert.equal(typeof writePoPreview,'function');for(const bad of ['', '../other', 'a/b', 'a\\b']){const f=fixture();await assert.rejects(()=>writePoPreview({bucket:f.bucket,purchaseOrder:{...f.po,projectId:bad},pdfBuffer:Buffer.from('%PDF-1.3 fixture')}));assert.equal(f.events.length,0);}
 const f=fixture();await assert.rejects(()=>writePoPreview({bucket:f.bucket,purchaseOrder:{...f.po,id:'a/b'},pdfBuffer:Buffer.from('%PDF-1.3 fixture')}));assert.equal(f.events.length,0);
});
test('preview publication collision fails create-only and leaves every existing token intact',async()=>{
 assert.equal(typeof writePoPreview,'function');const f=fixture(),previewPath=`purchase-orders/fixture-project/previews/${uuid}.pdf`;f.objects.set(previewPath,structuredClone(stored));const before=fingerprint(f.objects.get(previewPath));
 await assert.rejects(()=>writePoPreview({bucket:f.bucket,purchaseOrder:f.po,pdfBuffer:Buffer.from('%PDF-1.3 fixture'),randomUUID:()=>uuid}),e=>e.code===412);assert.equal(fingerprint(f.objects.get(previewPath)),before);assert.equal(f.events.filter(e=>e.kind==='setMetadata').length,0);
});

async function parsedPreview(poOverrides) {
 const f=fixture({poOverrides}),result=await f.preview();
 const {PDFParse}=require('pdf-parse');
 const parser=new PDFParse({data:new Uint8Array(f.objects.get(result.storagePath).bytes)});
 try{return {fixture:f,result,text:await parser.getText()};}finally{await parser.destroy();}
}
test('authorized PDF preview includes the selected stored annexure after the original PO page',async()=>{
 const terms='QA ANNEXURE START\n1. Preserve this exact stored obligation.\n2. QA ANNEXURE END';
 const before=fingerprint(stored);
 const withTerms=await parsedPreview({includeAnnexure:true,termsAndConditions:terms});
 const withoutTerms=await parsedPreview({includeAnnexure:false,termsAndConditions:terms});
 assert.ok(withTerms.text.total>=2,'selected terms must produce an annexure page');
 assert.equal(withTerms.text.pages[0].text,withoutTerms.text.pages[0].text,'existing PO layout/content changed');
 assert.match(withTerms.text.pages[1].text,/QA-ONLY-001/,'annexure must identify its PO');
 assert.match(withTerms.text.text,/QA ANNEXURE START/);assert.match(withTerms.text.text,/QA ANNEXURE END/);
 assert.match(withTerms.text.text,/Preserve this exact stored obligation/);
 assert.equal(fingerprint(withTerms.fixture.objects.get(issuedPath)),before,'annexure preview altered issued artifact');
});
test('unselected, missing or empty annexure adds no terms or pages',async()=>{
 for(const fields of [{includeAnnexure:false,termsAndConditions:'HIDDEN ANNEXURE'},{termsAndConditions:'HIDDEN ANNEXURE'},{includeAnnexure:'true',termsAndConditions:'HIDDEN ANNEXURE'},{includeAnnexure:true,termsAndConditions:'  \n  '},{includeAnnexure:true}]){
  const p=await parsedPreview(fields);assert.equal(p.text.total,1);assert.doesNotMatch(p.text.text,/HIDDEN ANNEXURE/);
 }
});
test('selected long annexure flows completely across additional pages',async()=>{
 const clauses=Array.from({length:70},(_,i)=>`CLAUSE-${String(i+1).padStart(3,'0')}: This synthetic stored obligation must remain complete and readable, with no omitted terms.`);
 const p=await parsedPreview({includeAnnexure:true,termsAndConditions:clauses.join('\n\n')});
 assert.ok(p.text.total>=4,'long terms must flow beyond a single annexure page');
 for(const clause of clauses)assert.ok(p.text.text.replace(/\s+/g,' ').includes(clause),clause);
 assert.match(p.text.pages.at(-1).text,/CLAUSE-070/);
});
test('cached native send artifact is returned without applying new annexure rendering',async()=>{
 const f=fixture({poOverrides:{includeAnnexure:true,termsAndConditions:'DO NOT REWRITE ACCEPTED ARTIFACT'}});
 assert.deepEqual(await f.native(),f.cachedNative);assert.equal(f.events.length,0);
});

test('USD preview uses ISO currency, omits GST and preserves the selected annexure', async () => {
 const {text}=await parsedPreview({currency:'USD',taxType:'none',taxPercentage:0,igstAmount:0,totalAmount:10,includeAnnexure:true,termsAndConditions:'USD ANNEXURE FIXTURE'});
 assert.match(text.text,/USD\s+10\.00/);
 assert.doesNotMatch(text.text,/\b(?:IGST|CGST|SGST)\s*\(/);
 assert.doesNotMatch(text.text,/Rs\.\s*10\.00/);
 assert.match(text.text,/USD ANNEXURE FIXTURE/);
});
