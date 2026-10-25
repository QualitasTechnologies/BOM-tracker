const test=require('node:test'),assert=require('node:assert/strict');
const {createExpenseApprovalJob,expenseFingerprint,NEVER}=require('./expenseApprovalOutbox.cjs');
const visit={id:'v',date:'2024-01-02',attendees:['alice'],location:'Delhi',purpose:'Install',expenses:[],totalCost:123,createdBy:'alice'};
const make=(extra={})=>createExpenseApprovalJob({projectId:'P',visitId:'v',operationId:'op',mode:'submitted',project:{projectName:'Project'},visit,actor:{uid:'admin',displayName:'Admin'},at:new Date(0),createdMs:0,...extra});
test('expense outbox identity, original owner and legacy dates are stable and pointer/status do not affect fingerprint',()=>{
 const job=make();assert.match(job.id,/^[a-f0-9]{64}$/);assert.equal(job.record.kind,'expense_submitted');assert.equal(job.record.visit_id,'v');assert.equal(job.record.payload.submitterUid,'alice');assert.equal(job.record.payload.visitDates,'2 Jan 2024');assert.equal(job.record.payload.visitTotal,123);
 assert.equal(expenseFingerprint(visit),expenseFingerprint({...visit,reimbursementStatus:'approved',nativeExpenseNotificationId:'new'}));
 assert.notEqual(expenseFingerprint(visit),expenseFingerprint({...visit,totalCost:124}));assert.notEqual(make({mode:'approved'}).id,job.id);
});
test('missing original owner explicitly skips review notifications, while submission still targets admins',()=>{
 for(const mode of ['approved','rejected']){const job=make({mode,visit:{...visit,createdBy:undefined}});assert.equal(job.record.state,'skipped');assert.equal(job.record.problem,'no_owner');assert.equal(job.record.next_attempt_ms,NEVER);}
 assert.equal(make({visit:{...visit,createdBy:undefined}}).record.state,'pending');assert.equal(make({mode:'bad'}),null);
});

test('expense snapshots mirror original displayed single, same-month and cross-month dates and sanitize only mail labels',()=>{
 const cases=[{visit:{...visit,date:'2024-01-02'},date:'2 Jan 2024'},{visit:{...visit,startDate:'2026-07-01',endDate:'2026-07-03'},date:'1–3 Jul 2026'},{visit:{...visit,startDate:'2026-07-31',endDate:'2026-08-02'},date:'31 Jul 2026 – 2 Aug 2026'}];
 for(const row of cases)assert.equal(make({visit:row.visit}).record.payload.visitDates,row.date);
 const raw={...visit,purpose:'Install\nwith\ttraining\u0000'+ 'x'.repeat(600),location:'A\r\nB'};const job=make({visit:raw,project:{projectName:'Project\nName'},actor:{uid:'admin',displayName:'Admin\r\nName'}});
 assert.equal(job.record.payload.visitLocation,'A B');assert.equal(job.record.payload.projectName,'Project Name');assert.equal(job.record.payload.actorName,'Admin Name');assert.ok(job.record.payload.visitPurpose.length<=500);assert.doesNotMatch(job.record.payload.visitPurpose,/[\x00-\x1f\x7f]/);assert.match(raw.purpose,/\n/);assert.equal(job.record.event_fingerprint,expenseFingerprint(raw));
});

test('expense fingerprint canonicalizes nested map keys while retaining expense and attendee array order',()=>{
 const first={...visit,expenses:[{id:'one',category:'Transport',amount:50,legacy:{z:2,a:{y:1,x:0}}},{id:'two',category:'Food & Per Diem',amount:73}]};
 const reordered={...visit,expenses:[{legacy:{a:{x:0,y:1},z:2},amount:50,category:'Transport',id:'one'},{amount:73,id:'two',category:'Food & Per Diem'}]};
 assert.equal(expenseFingerprint(first),expenseFingerprint(reordered));assert.notEqual(expenseFingerprint(first),expenseFingerprint({...reordered,expenses:[...reordered.expenses].reverse()}));
 assert.notEqual(expenseFingerprint({...first,attendees:['alice','admin']}),expenseFingerprint({...first,attendees:['admin','alice']}));
});


test('expense outbox loads and fingerprints pure values without any Firebase SDK dependency',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),context={module:{exports:{}},require:name=>{assert.equal(name,'node:crypto');return require(name);},Buffer};
 vm.runInNewContext(fs.readFileSync(require.resolve('./expenseApprovalOutbox.cjs'),'utf8'),context);
 assert.match(vm.runInNewContext('module.exports.expenseFingerprint({expenses:[{amount:2,id:"e"}]})',context),/^[a-f0-9]{64}$/);
});

test('plain legacy maps with constructor labels remain maps rather than typed SDK spoofs',()=>{
 const typedLookalike={constructor:{name:'Timestamp'},seconds:10,nanoseconds:20};
 const changed={constructor:{name:'Timestamp'},seconds:10,nanoseconds:21};
 assert.notEqual(expenseFingerprint({...visit,expenses:[typedLookalike]}),expenseFingerprint({...visit,expenses:[changed]}));
 const withExtra={...typedLookalike,legacy:'extra'};assert.notEqual(expenseFingerprint({...visit,expenses:[typedLookalike]}),expenseFingerprint({...visit,expenses:[withExtra]}));
});
