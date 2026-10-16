const test=require('node:test'),assert=require('node:assert/strict');
const {createExpenseApprovalJob,expenseFingerprint,NEVER}=require('./expenseApprovalOutbox.cjs');
const visit={id:'v',date:'2024-01-02',attendees:['alice'],location:'Delhi',purpose:'Install',expenses:[],totalCost:123,createdBy:'alice'};
const make=(extra={})=>createExpenseApprovalJob({projectId:'P',visitId:'v',operationId:'op',mode:'submitted',project:{projectName:'Project'},visit,actor:{uid:'admin',displayName:'Admin'},at:new Date(0),createdMs:0,...extra});
test('expense fingerprint handles actual Firestore timestamp/ref/geopoint/bytes values by semantics and fails unsupported values before queue creation',()=>{
 const {Timestamp,GeoPoint,getFirestore}=require('firebase-admin/firestore');const {initializeApp}=require('firebase-admin/app');
 const db=getFirestore(initializeApp({projectId:'expense-fingerprint-test'},'expense-fingerprint-test'));
 const first={...visit,expenses:[{id:'one',legacy:{at:new Timestamp(10,20),ref:db.doc('archive/one'),point:new GeoPoint(10,20),bytes:Buffer.from([1,2])}}]};
 const second={...visit,expenses:[{legacy:{bytes:new Uint8Array([1,2]),point:new GeoPoint(10,20),ref:db.doc('archive/one'),at:new Timestamp(10,20)},id:'one'}]};
 assert.equal(expenseFingerprint(first),expenseFingerprint(second));
 assert.notEqual(expenseFingerprint(first),expenseFingerprint({...visit,expenses:[{...first.expenses[0],legacy:{...first.expenses[0].legacy,at:new Timestamp(10,21)}}]}));
 class Unsupported {}
 assert.throws(()=>make({visit:{...visit,expenses:[{legacy:new Unsupported()}]}}),/expense_fingerprint_unavailable/);
});

test('actual Firestore vectors retain semantic values without depending on SDK serialization order',()=>{
 const {FieldValue}=require('firebase-admin/firestore');
 assert.equal(expenseFingerprint({...visit,expenses:[{vector:FieldValue.vector([1,2]),id:'one'}]}),expenseFingerprint({...visit,expenses:[{id:'one',vector:FieldValue.vector([1,2])}]}));
 assert.notEqual(expenseFingerprint({...visit,expenses:[{vector:FieldValue.vector([1,2])}]}),expenseFingerprint({...visit,expenses:[{vector:FieldValue.vector([2,1])}]}));
});
