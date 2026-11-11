const test=require('node:test');
const assert=require('node:assert/strict');
test('real Firestore transactions: concurrent numbering, rollback, and lost-reply replay',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST,/^(127\.0\.0\.1|localhost):\d+$/);
  const admin=require('firebase-admin');
  const {fixture}=require('./nativePOAuthoringFixture.cjs');
  const {createNativePOAuthoringOperations}=require('./nativePOAuthoringOperations.cjs');
  const app=admin.initializeApp({projectId:'demo-po-create-repair'},'po-create-test');
  const db=app.firestore(),f=fixture(),P='PO_TEST_'+Date.now();
  for(const [path,data]of f.docs){
    if(path==='pulseRuntimeControl/cutover')continue;
    await db.doc(path.replace(/^projects\/P/,`projects/${P}`)).set(data.projectId ? {...data,projectId:P}:data);
  }
  const snapshot=await db.doc(`projects/${P}/bom/data`).get();
  const version=`${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
  const options={db,auth:f.auth,enabled:true,legacyCreateOnly:true,getServerTimestamp:()=>admin.firestore.FieldValue.serverTimestamp()};
  const engine=createNativePOAuthoringOperations(options);
  const request=id=>({auth:{uid:'alice'},rawRequest:{get:()=> 'Bearer fixture'},data:{operation:'create',project_id:P,expected_actor_uid:'alice',po_id:id,operation_id:id,expected_material_version:version,input:f.input,billing_snapshot:f.billingSnapshot}});
  const results=await Promise.all(['one','two','three'].map(id=>engine(request(id))));
  assert.ok(results.every(result=>result.ok),JSON.stringify(results));
  const created=await Promise.all(['one','two','three'].map(id=>db.doc(`projects/${P}/purchaseOrders/${id}`).get()));
  assert.equal(new Set(created.map(row=>row.data().poNumber)).size,3);
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber,10);
  const failing=createNativePOAuthoringOperations({...options,db:{collection:path=>db.collection(path),runTransaction:fn=>db.runTransaction(tx=>fn({
    get:ref=>tx.get(ref),update:(ref,data)=>tx.update(ref,data),create:(ref,data)=>{if(ref.path.includes('/audit/'))throw Error('forced failure');return tx.create(ref,data);}
  }))}});
  assert.equal((await failing(request('failed'))).ok,false);
  assert.equal((await db.doc(`projects/${P}/purchaseOrders/failed`).get()).exists,false);
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber,10);
  let lose=true;
  const lossy=createNativePOAuthoringOperations({...options,db:{collection:path=>db.collection(path),runTransaction:async fn=>{
    const result=await db.runTransaction(fn);if(lose){lose=false;throw Error('lost reply');}return result;
  }}});
  assert.equal((await lossy(request('replay'))).ok,false);
  assert.equal((await lossy(request('replay'))).ok,true);
  assert.equal((await db.doc('billingEntities/B').get()).data().nextPoNumber,11);
  await app.delete();
});
