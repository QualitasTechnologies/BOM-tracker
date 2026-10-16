const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./nativeOverheadFixture.cjs');
const entry={kind:'add_entry',record_id:'new',input:{date:'2026-10-15',category:'Other',description:'Permit',amount:12}};
test('actual Firestore types survive cost edits and deleted row archives',async()=>{
  const {Timestamp,GeoPoint,Firestore,FieldValue}=require('@google-cloud/firestore');
  const f=fixture(),timestamp=new Timestamp(12,34),reference=new Firestore({projectId:'demo-offline'}).doc('legacy/ref'),point=new GeoPoint(12,34),vector=FieldValue.vector([1,2]);
  const raw=f.docs.get('projects/P/overheads/data');raw.legacy={timestamp,reference,point,vector};raw.otherEntries[0].unknown={timestamp,reference,point,vector};
  assert.equal((await f.issue({...entry,kind:'edit_entry',record_id:'entry'})).ok,true);const next=f.docs.get('projects/P/overheads/data');assert.ok(next.legacy.timestamp instanceof Timestamp);assert.equal(next.legacy.reference,reference);assert.equal(next.otherEntries[0].unknown.point,point);assert.equal(next.legacy.vector,vector);
  assert.equal((await f.issue({kind:'delete_entry',record_id:'entry'},{operation_id:'delete-typed'})).ok,true);const archive=f.docs.get('pulseDeletedOverheads/P/records/entry-entry');assert.equal(archive.record.unknown.reference,reference);assert.equal(archive.record.unknown.point,point);assert.ok(archive.record.unknown.timestamp instanceof Timestamp);
});
test('callable encoding of legacy SDK values never includes Firestore connection internals',async()=>{
  const {Timestamp,GeoPoint,Firestore,FieldValue}=require('@google-cloud/firestore');
  const {encode}=require('./node_modules/firebase-functions/lib/common/providers/https.js');
  const f=fixture(),db=new Firestore({projectId:'demo-offline',credentials:{client_email:'dummy@example.com',private_key:'SYNTHETIC-PRIVATE-KEY-SENTINEL'}});
  f.docs.get('projects/P/overheads/data').travelVisits[0].legacy={reference:db.doc('legacy/ref'),timestamp:new Timestamp(12,34),point:new GeoPoint(12,34),vector:FieldValue.vector([1,2])};
  f.docs.get('projects/P').projectName=db.doc('legacy/bad-project-name');
  const result=await f.call();assert.equal(result.ok,true);const encoded=encode(result),json=JSON.stringify(encoded);
  assert.doesNotMatch(json,/_firestore|private_key|SYNTHETIC-PRIVATE-KEY-SENTINEL|client_email|_serializer/);
  assert.deepEqual(encoded.overheads.travelVisits[0].legacy.reference,{__type:'reference',path:'legacy/ref'});
  assert.equal(encoded.project.projectName,'P');
});
