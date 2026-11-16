import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {Firestore,FieldValue}=require('@google-cloud/firestore'),{fixture}=require('./nativeProjectFixture.cjs');
const {createNativeProjectOperations}=require('./nativeProjectOperations.cjs'),{createNativeMaterialOperations}=require('./nativeMaterialOperations.cjs'),{createProjectOperationsHandler}=require('./projectOperations.cjs');
const {createProjectMemberNotifications}=require('./projectMemberNotifications.cjs'),{createAddProjectBackfillStakeholders}=require('./addProjectBackfillStakeholders.cjs');
const {resolveSpecSearchActor}=require('./specSearchActor.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');let env,db,f,uid,native;
before(async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),rules=await readFile(resolve(root,process.env.PROJECT_RULES_PATH||'firestore.project-fence.rules'),'utf8');
 env=await initializeTestEnvironment({projectId:'demo-bom-native-security',firestore:{host:'127.0.0.1',port:18080,rules}});db=new Firestore({projectId:'demo-bom-native-security',host:'127.0.0.1:18080',ssl:false});
});
after(async()=>{await db?.terminate();await env?.cleanup();});
async function seed(flag,actor='alice',scheduleFence=true){
 await env.clearFirestore();uid=actor;f=fixture({uid});f.auth={verifyIdToken:async()=>({uid,email:f.users.get(uid).email}),getUser:async id=>structuredClone(f.users.get(id))};const project=f.docs.get('projects/P');project.members=project.members.map(row=>({...row,notificationsEnabled:true}));project.externalRecipients=[{email:'old@example.test',name:'Old',notificationsEnabled:true,unknown:'keep'}];project.internalBudget=100;project.miscCost=10;
 const batch=db.batch();for(const[path,value]of f.docs)batch.set(db.doc(path),value);batch.set(db.doc('settings/bom'),{categories:[{name:'Parts',isActive:true}]});
 if(flag===undefined)batch.delete(db.doc('pulseRuntimeControl/cutover'));else batch.set(db.doc('pulseRuntimeControl/cutover'),{mode:'coexist',projectClientWritesFenced:flag,projectStatusClientWritesFenced:true,scheduleClientWritesFenced:scheduleFence});await batch.commit();
 native=createNativeProjectOperations({db,auth:f.auth,enabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp(),getDeleteField:()=>FieldValue.delete()});
}
beforeEach(()=>seed(true));
const sdk=(actor=uid)=>env.authenticatedContext(actor,{...f.users.get(actor).customClaims,email:f.users.get(actor).email,email_verified:true}).firestore();
const request=data=>({auth:{uid},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'get',project_id:'P',expected_actor_uid:uid,...data}});
const call=data=>native(request(data));
const cases=[['metadata','alice',{kind:'metadata',patch:{projectName:'Native name'}},'projectName','Native name'],['budget','admin',{kind:'budget',amount:200},'internalBudget',200],['cost','admin',{kind:'cost_field',field:'miscCost',amount:300},'miscCost',300],['member preferences','alice',{kind:'member_notifications',user_id:'alice',enabled:false},'members',null],['recipient preferences','alice',{kind:'recipient_notifications',email:'old@example.test',enabled:false},'externalRecipients',null],['archive','alice',{kind:'archive'},'status','Archived']];
for(const [label,actor,command,field,value]of cases)test('stale SDK cannot reverse audited native '+label,async()=>{
 await seed(true,actor);const ref=doc(sdk(),'projects/P'),stale=(await getDoc(ref)).data(),opening=await call();assert.equal(opening.permissions.edit,true);
 const payload={operation:'command',expected_version:opening.version,operation_id:'native',command},saved=await call(payload);assert.equal(saved.ok,true,JSON.stringify(saved));await assertFails(setDoc(ref,stale));
 const current=(await db.doc('projects/P').get()).data();if(value===null)assert.equal(current[field].find(row=>row.userId===actor||row.email==='old@example.test').notificationsEnabled,false);else assert.equal(current[field],value);
 assert.equal((await db.doc('pulseProjectOperations/P/receipts/native').get()).data().result.ok,true);assert.equal((await db.doc('pulseProjectOperations/P/audit/native').get()).exists,true);
 await db.doc('pulseRuntimeControl/cutover').set({mode:'read_only'});assert.deepEqual(await call(payload),saved);assert.equal((await call({...payload,resolve_only:true})).resolution,'committed');
});

test('only exact true fences root create/update/delete for every original role; reads and subcollections retain policy',async()=>{
 for(const flag of [undefined,false,'true',1,true]){
  await seed(flag,'alice',false);const client=sdk(),admin=sdk('admin'),expect=flag===true?assertFails:assertSucceeds;
  await assertSucceeds(getDoc(doc(client,'projects/P')));await expect(updateDoc(doc(client,'projects/P'),{projectName:'Ordinary change'}));await expect(updateDoc(doc(admin,'projects/P'),{projectName:'Admin change'}));
  await expect(setDoc(doc(client,'projects/NEW'),{projectId:'NEW',memberIds:['alice']}));await expect(deleteDoc(doc(admin,'projects/P')));
  await db.doc('projects/P').set(f.docs.get('projects/P'));await assertSucceeds(updateDoc(doc(client,'projects/P/bom/data'),{unrelated:'BOM remains under its own owner policy'}));
  await assertFails(setDoc(doc(admin,'pulseRuntimeControl/cutover'),{projectClientWritesFenced:false}));
 }
});

test('native new-project/template continuation works while privileged legacy and SDK creation are fenced',async()=>{
 const material=createNativeMaterialOperations({db,auth:f.auth,mutationsEnabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp()});
 const create={operation:'create_project',project_id:'NEW',operation_id:'create',project:{projectName:'Original project',clientName:'Client',description:'',status:'Planning',deadline:'2027-01-01',poValue:0}};
 const created=await material(request(create));assert.equal(created.ok,true,JSON.stringify(created));assert.equal((await db.doc('pulseMaterialCutovers/NEW').get()).data().fence,'legacy_bom_data_writes');
 const opening=await material({auth:{uid},rawRequest:{get:()=> 'Bearer synthetic'},data:{operation:'get',project_id:'NEW'}});assert.equal(opening.ok,true,JSON.stringify(opening));const result=await material(request({operation:'command',project_id:'NEW',expected_version:opening.version,operation_id:'template',command:{kind:'add_items',initialize:true,items:[{category:'Parts',id:'template',name:'Template part',description:'',itemType:'component',quantity:1}]}}));assert.equal(result.ok,true,JSON.stringify(result));
 const legacy=createProjectOperationsHandler({db,auth:f.auth,resolveActor:async()=>f.users.get(uid),mutationsEnabled:true,getServerTimestamp:()=>FieldValue.serverTimestamp()});let denied;
 await legacy({method:'POST',query:{project_id:'LEGACY',resource:'project_create'},body:{operation_id:'legacy',project:create.project}},{set(){},status(){return this;},json(value){denied=value;}});assert.equal(denied.error,'project_read_only');assert.equal((await db.doc('projects/LEGACY').get()).exists,false);
});

test('versioned recipient preferences, backfill append and self preferences remain cooperating transactional peers',async()=>{
 const ref=doc(sdk(),'projects/P'),stale=(await getDoc(ref)).data(),opening=await call(),producer=createAddProjectBackfillStakeholders({db,resolveActor:req=>resolveSpecSearchActor({request:req,auth:f.auth}),getServerTimestamp:()=>FieldValue.serverTimestamp(),getDeleteField:()=>FieldValue.delete()});
 const change={operation:'command',expected_version:opening.version,operation_id:'preference',command:{kind:'recipient_notifications',email:'old@example.test',enabled:false}};
 const [preference,registered]=await Promise.all([call(change),producer(request({projectId:'P',contacts:[{email:'new@example.test',name:'New'}]}))]);assert.equal(registered.queuedContactCount,1);
 if(!preference.ok){assert.equal(preference.error,'project_version_conflict');const fresh=await call();assert.equal((await call({...change,operation_id:'preference-retry',expected_version:fresh.version})).ok,true);}
 const self=createProjectMemberNotifications({db,auth:f.auth,getServerTimestamp:()=>FieldValue.serverTimestamp()}),loaded=await self(request({operation:'get'}));
 assert.equal((await self(request({operation:'set',member_uid:uid,notifications_enabled:false,expected_version:loaded.version,operation_id:'self'}))).ok,true);
 const saved=(await db.doc('projects/P').get()).data();assert.equal(saved.externalRecipients.find(r=>r.email==='old@example.test').notificationsEnabled,false);assert.equal(saved.externalRecipients.find(r=>r.email==='old@example.test').unknown,'keep');assert.equal(saved.externalRecipients.filter(r=>r.email==='new@example.test').length,1);assert.equal(saved.members.find(r=>r.userId===uid).notificationsEnabled,false);
 await assertFails(setDoc(ref,stale));assert.equal((await db.collection('pulseProjectBackfillOperations').get()).size,1);await assertFails(getDoc(doc(sdk('admin'),'pulseProjectBackfillOperations/'+(await db.collection('pulseProjectBackfillOperations').get()).docs[0].id)));
});
