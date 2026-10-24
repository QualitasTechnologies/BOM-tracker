const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeProjectDocumentFixture.cjs');
const {Firestore,Timestamp,GeoPoint,FieldValue}=require('@google-cloud/firestore');
const {encode}=require('./node_modules/firebase-functions/lib/common/providers/https.js');
test('actual SDK references never escape through the document callable projection and raw archives retain SDK types',async()=>{
 const f=fixture(),db=new Firestore({projectId:'demo-offline',credentials:{client_email:'dummy@example.com',private_key:'SYNTHETIC-DOCUMENT-SECRET'}});
 const ref=db.doc('legacy/reference'),at=new Timestamp(10,20),point=new GeoPoint(12,34),vector=FieldValue.vector([1,2]);
 f.docs.set('projectDocuments/legacy',{projectId:'P',name:'legacy.pdf',url:'https://example.test/legacy.pdf',type:'spec-sheet',uploadedAt:at,uploadedBy:'alice',linkedBOMItems:[],sourceUrl:ref,unknown:{ref,at,point,vector}});
 const result=await f.get();assert.equal(result.ok,true);const encoded=encode(result);assert.doesNotMatch(JSON.stringify(encoded),/SYNTHETIC-DOCUMENT-SECRET|private_key|_firestore|_serializer|client_email/);
 assert.equal(encoded.documents[0].uploadedAt,at.toDate().toISOString());assert.equal(encoded.documents[0].sourceUrl,undefined);
 const o=result.documents[0].nativeOpening;
 const deleted=await f.call({operation:'delete',document_id:'legacy',operation_id:'delete-legacy',expected_project_version:o.project_version,expected_bom_version:o.bom_version,expected_document_version:o.document_version});assert.equal(deleted.ok,true);
 const archived=f.docs.get('pulseDeletedProjectDocuments/P/documents/legacy').document;
 assert.equal(archived.sourceUrl,ref);assert.equal(archived.unknown.ref,ref);assert.ok(archived.uploadedAt instanceof Timestamp);assert.equal(archived.unknown.point,point);assert.equal(archived.unknown.vector,vector);
 await db.terminate();
});
