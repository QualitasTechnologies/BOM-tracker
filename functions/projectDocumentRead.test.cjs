const test=require('node:test'),assert=require('node:assert/strict');
const {readProjectDocumentView}=require('./projectDocumentRead.cjs');

const path='projects/P/documents/native/finalized/file.bin',token='private-token',generation='7';
const url=`https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(path)}?alt=media&token=${token}&generation=${generation}`;
function setup({projectId='P',markerProject='P',proofProject='P',proofExists=true,documentId='doc',proofDocument='doc',markerPath=path,proofPath=path,markerGeneration=generation,proofGeneration=generation,proofDocumentId='doc',proofUrl=url,proofToken=token,marker={operation_id:'op',path:markerPath,generation:markerGeneration}}={}){
 const calls=[];const records=new Map([
  ['projectDocuments/doc',{projectId:markerProject,name:'Spec',url:'https://public.example/doc?alt=media',type:'spec-sheet',uploadedAt:new Date('2025-01-01'),uploadedBy:'alice',linkedBOMItems:['item'],fileSize:12,pulseNativeDocument:marker,secret:'never expose'}],
  ['receipt',{project_id:proofProject,document_id:proofDocument,final_path:proofPath,download_token:proofToken,finalized:{generation:proofGeneration,document:{id:proofDocumentId,url:proofUrl},rawSdk:{private_key:'secret'}}}]
 ]);
 const tx={get:async ref=>{calls.push(ref);const data=ref.name.includes('/receipts')?(proofExists?records.get('receipt'):undefined):records.get('projectDocuments/doc');return{exists:!!data,data:()=>data};}};
 const db={collection:name=>({doc:id=>({name,id,collection:sub=>({doc:child=>({name:`${name}/${id}/${sub}`,id:child})})})})};
 return{calls,transaction:tx,db,projectId,id:documentId,raw:records.get('projectDocuments/doc')};
}
const read=input=>readProjectDocumentView({...input,bucket:{name:'bucket'}});

test('projects a legacy document through the safe public view',async()=>{
 const x=setup({marker:null});const result=await read(x);
 assert.equal(result.id,'doc');assert.equal(result.url,x.raw.url);assert.deepEqual(result.linkedBOMItems,['item']);
 assert.equal('secret' in result,false);assert.equal('rawSdk' in result,false);assert.equal(x.calls.length,0);
});
test('hydrates a native document from the matching private receipt using the supplied transaction',async()=>{
 const x=setup(),result=await read(x);
 assert.equal(result.url,url);assert.equal(x.calls.length,1);assert.equal(x.calls[0].name,'pulseProjectDocumentUploads/P/receipts');
 assert.equal(x.calls[0].id,'op');assert.equal(JSON.stringify(result).includes(token),true);
 assert.equal(JSON.stringify(result).includes('private_key'),false);
});
test('rejects document identity mismatch, malformed markers, and inconsistent private proof',async()=>{
 const wrongProject=setup({projectId:'Q'});
 await assert.rejects(read(wrongProject),e=>e.code==='project_document_forbidden'&&e.status===403);
 const variants=[
  setup({marker:{operation_id:'bad/id',path,generation}}),setup({proofExists:false}),setup({proofProject:'Q'}),
  setup({proofDocument:'other'}),setup({proofPath:'other'}),setup({proofGeneration:'8'}),
  setup({proofDocumentId:'other'}),setup({proofToken:''}),setup({proofUrl:'https://other.test/file'})
 ];
 for(const x of variants)await assert.rejects(read(x),e=>e.code==='invalid_project_document_state');
});
