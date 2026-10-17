const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {fixture}=require('./nativeProjectDocumentFixture.cjs');
const opening=row=>({expected_project_version:row.nativeOpening.project_version,expected_bom_version:row.nativeOpening.bom_version,expected_document_version:row.nativeOpening.document_version});
const uploaded=async f=>{const reserved=await f.reserve();assert.equal(reserved.ok,true);f.upload(reserved.path);const result=await f.finalize();assert.equal(result.ok,true);return result;};
test('one verified object and metadata record publish atomically and replay with writes off',async()=>{
 const f=fixture(),saved=await uploaded(f);assert.match(decodeURIComponent(new URL(saved.document.url).pathname),/documents\/native\/finalized\//);
 assert.equal(saved.document.id,'document-1');assert.equal(saved.document.uploadedBy,'alice');assert.deepEqual(saved.document.linkedBOMItems,[]);
 assert.equal(f.docs.get('projectDocuments/document-1').pulseNativeDocument.path,decodeURIComponent(new URL(saved.document.url).pathname.split('/o/')[1]));
 f.off();f.expire();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.deepEqual(await f.finalize(),saved);assert.equal(f.publications(),1);
});
test('empty files and Office MIME types retain original size/type without transcoding',async()=>{
 for(const type of ['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/octet-stream']){
  const f=fixture(),bytes=Buffer.alloc(0),reserved=await f.reserve({content_type:type,byte_size:0,sha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(reserved.ok,true);f.upload(reserved.path,bytes,type);assert.equal((await f.finalize()).document.fileSize,0);
 }
});
test('new customer PO actions require the original admin role while other project documents allow approved viewers',async()=>{
 const f=fixture();assert.equal((await f.reserve({document_type:'customer-po'})).error,'project_document_forbidden');f.actor.customClaims.role='admin';assert.equal((await f.reserve({document_type:'customer-po'})).ok,true);
 const g=fixture();delete g.docs.get('projects/P').memberIds;assert.equal((await g.reserve()).ok,true);g.docs.get('projects/P').memberIds=[];assert.equal((await g.finalize()).error,'project_document_forbidden');
});
test('wrong bytes, claimed identity and duplicate metadata IDs cannot be attached or overwritten',async()=>{
 const f=fixture(),reserved=await f.reserve();f.upload(reserved.path,Buffer.alloc(f.bytes.length));assert.equal((await f.finalize()).error,'project_document_integrity_failed');assert.equal(f.docs.has('projectDocuments/document-1'),false);
 const g=fixture();g.docs.set('projectDocuments/document-1',{projectId:'P',unknown:'keep'});assert.equal((await g.reserve()).error,'project_document_identity_used');assert.equal(g.docs.get('projectDocuments/document-1').unknown,'keep');
 assert.equal((await fixture().reserve({expected_actor_uid:'other'})).error,'actor_session_changed');
});
test('cancelled uploads fence late finalization and never delete stored bytes',async()=>{
 const f=fixture(),reserved=await f.reserve();f.upload(reserved.path);f.off();f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
 assert.equal((await f.call({operation:'cancel'})).resolution,'cancelled');assert.equal((await f.finalize()).error,'project_document_upload_cancelled');assert.equal(f.objects.has(reserved.path),true);assert.equal(f.docs.has('projectDocuments/document-1'),false);
});
test('lost final acknowledgement resolves the same document without duplicate metadata or publication',async()=>{
 const f=fixture({loseFinalReply:true}),reserved=await f.reserve();f.upload(reserved.path);assert.equal((await f.finalize()).ok,false);
 const saved=await f.finalize();assert.equal(saved.ok,true);assert.equal(f.publications(),1);assert.equal([...f.docs.keys()].filter(path=>path.startsWith('projectDocuments/')).length,1);
});
test('delete compares displayed document/project/BOM versions and archives all raw metadata atomically',async()=>{
 const f=fixture();await uploaded(f);f.docs.get('projectDocuments/document-1').unknown={date:new Date('2020-01-02'),bytes:Buffer.from([1,2])};
 const [row]=(await f.get()).documents,raw=f.docs.get('projectDocuments/document-1');const result=await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});assert.equal(result.ok,true);assert.equal(f.docs.has('projectDocuments/document-1'),false);
 const archived=f.docs.get('pulseDeletedProjectDocuments/P/documents/document-1');assert.deepEqual(archived.document,raw);assert.equal(archived.actor_uid,'alice');assert.equal(f.objects.size,2);
 f.off();assert.equal((await f.call({operation:'resolve_delete',operation_id:'delete-1',...opening(row)})).resolution,'committed');
});
test('stale deletion cannot erase a changed record and an archive failure leaves active metadata intact',async()=>{
 const f=fixture();await uploaded(f);const [row]=(await f.get()).documents;f.docs.get('projectDocuments/document-1').name='changed';f.versions.set('projectDocuments/document-1',99);
 assert.equal((await f.call({operation:'delete',operation_id:'delete-1',...opening(row)})).error,'project_document_version_conflict');assert.equal(f.docs.get('projectDocuments/document-1').name,'changed');
 const g=fixture();await uploaded(g);const [fresh]=(await g.get()).documents;g.options.failArchive=true;assert.equal((await g.call({operation:'delete',operation_id:'delete-1',...opening(fresh)})).ok,false);assert.equal(g.docs.has('projectDocuments/document-1'),true);
});
test('original ordered-PO and received-invoice restrictions are evaluated against complete current materials',async()=>{
 for(const[type,status,field]of [['vendor-po','ordered','linkedPODocumentId'],['vendor-invoice','received','linkedInvoiceDocumentId']]){
  const f=fixture(),reserved=await f.reserve({document_type:type});f.upload(reserved.path);await f.finalize();const item=f.docs.get('projects/P/bom/data').categories[0].items[0];item.status=status;item[field]='document-1';const [row]=(await f.get()).documents;
  assert.equal((await f.call({operation:'delete',operation_id:'delete-1',...opening(row)})).error,'project_document_delete_blocked');assert.equal(f.docs.has('projectDocuments/document-1'),true);
 }
});
test('resolving an unknown deletion cancels only that nonce and fences its delayed request',async()=>{
 const f=fixture();await uploaded(f);const [row]=(await f.get()).documents;f.off();const request={operation_id:'delete-1',...opening(row)};
 assert.equal((await f.call({operation:'resolve_delete',...request})).resolution,'cancelled');assert.equal((await f.call({operation:'delete',...request})).error,'project_document_request_cancelled');assert.equal(f.docs.has('projectDocuments/document-1'),true);
});
test('document reads project only scalar metadata and reject malformed link identities without exposing SDK internals',async()=>{
 const f=fixture();await uploaded(f);
 const secret={credential:{private_key:'SYNTHETIC-DOCUMENT-SECRET'}};
 f.docs.get('projectDocuments/document-1').sourceUrl=secret;
 const response=await f.get();assert.equal(response.ok,true);assert.equal(JSON.stringify(response).includes('SYNTHETIC-DOCUMENT-SECRET'),false);assert.equal('sourceUrl' in response.documents[0],false);
 f.docs.get('projectDocuments/document-1').linkedBOMItems=[secret];
 const invalid=await f.get();assert.equal(invalid.ok,false);assert.equal(invalid.error,'invalid_project_document_state');assert.equal(JSON.stringify(invalid).includes('SYNTHETIC-DOCUMENT-SECRET'),false);
});
test('pagination progresses through filtered customer PO rows and exposes every permitted document once',async()=>{
 const f=fixture();
 for(let i=0;i<205;i++)f.docs.set('projectDocuments/doc-'+String(i).padStart(3,'0'),{projectId:'P',name:'doc',url:'https://example.test/doc',type:i<105?'customer-po':'spec-sheet',uploadedAt:new Date(),uploadedBy:'alice',linkedBOMItems:[]});
 const seen=[];let cursor,rounds=0;
 do{const page=await f.get(cursor?{cursor}:{});assert.equal(page.ok,true);seen.push(...page.documents.map(row=>row.id));cursor=page.next_cursor;assert.ok(++rounds<=3);}while(cursor);
 assert.equal(rounds,3);assert.equal(seen.length,100);assert.equal(new Set(seen).size,100);assert.equal(seen[0],'doc-105');assert.equal(seen.at(-1),'doc-204');
});
test('revocation or cancellation during publication cannot make document metadata visible',async()=>{
 for(const action of ['revoke','cancel']){
  const f=fixture(),reserved=await f.reserve();f.upload(reserved.path);
  f.options.onPublish=async()=>{if(action==='revoke')f.actor.disabled=true;else assert.equal((await f.call({operation:'cancel'})).resolution,'cancelled');};
  const result=await f.finalize();assert.equal(result.ok,false);assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(f.publications(),1);
 }
});
test('mixed external category links cannot be deleted and no archive is written',async()=>{
 const f=fixture();await uploaded(f);f.actor.email='alice@customer.test';f.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Parts']}];
 f.docs.get('projects/P/bom/data').categories.push({name:'Other',items:[{id:'other',status:'not-ordered'}]});
 f.docs.get('projectDocuments/document-1').linkedBOMItems=['bolt','other'];
 const [row]=(await f.get()).documents;const result=await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 assert.equal(result.error,'project_document_forbidden');assert.equal(f.docs.has('projectDocuments/document-1'),true);assert.equal(f.docs.has('pulseDeletedProjectDocuments/P/documents/document-1'),false);
});
test('malformed material state cannot be interpreted as an empty BOM when authorizing deletion',async()=>{
 for(const bom of [{categories:{}},{categories:[{name:'Parts',items:{}}]},{categories:[{name:'Parts',items:[null]}]}]){
  const f=fixture();await uploaded(f);f.docs.set('projects/P/bom/data',bom);const [row]=(await f.get()).documents;
  const result=await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});assert.equal(result.error,'invalid_project_document_state');assert.equal(f.docs.has('projectDocuments/document-1'),true);
 }
});
test('staged bytes cannot become an active document after a read-only or unknown control transition',async()=>{
 for(const mode of ['read_only','unknown']){
  const f=fixture(),reserved=await f.reserve();f.upload(reserved.path);f.docs.set('pulseRuntimeControl/cutover',{mode});
  assert.equal((await f.finalize()).ok,false);assert.equal((await f.reserve({operation_id:'another',document_id:'another'})).ok,false);assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(f.publications(),0);
 }
});
test('public document metadata holds no download bearer token and scoped API reads hydrate the private proof URL',async()=>{
 const f=fixture(),saved=await uploaded(f),raw=f.docs.get('projectDocuments/document-1');
 assert.equal(new URL(raw.url).searchParams.has('token'),false);assert.equal(JSON.stringify(raw).includes(new URL(saved.document.url).searchParams.get('token')),false);
 const page=await f.get();assert.equal(page.documents[0].url,saved.document.url);
 f.docs.get('projects/P').memberIds=[];assert.equal((await f.get()).error,'project_document_forbidden');
});
test('private URL hydration fails closed on broken proof and rechecks identity after proof reads',async()=>{
 const f=fixture();await uploaded(f);f.docs.get('pulseProjectDocumentUploads/P/receipts/upload-1').finalized.document.url='https://other.test/secret';
 assert.equal((await f.get()).error,'invalid_project_document_state');
 const g=fixture();await uploaded(g);g.options.onRead=path=>{if(path==='pulseProjectDocumentUploads/P/receipts/upload-1')g.actor.disabled=true;};
 assert.equal((await g.get()).error,'actor_forbidden');
});

test('deleted documents can be browsed and restored with exact metadata and the original object generation',async()=>{
 const f=fixture(),saved=await uploaded(f);f.docs.get('projectDocuments/document-1').unknown={created:new Date('2020-01-02'),bytes:Buffer.from([1,2])};
 const raw=f.docs.get('projectDocuments/document-1'),row=(await f.get()).documents[0];
 await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 const listed=await f.call({operation:'list_deleted'});assert.equal(listed.ok,true,JSON.stringify(listed));assert.equal(listed.deleted_documents.length,1);
 const archived=listed.deleted_documents[0];assert.equal(archived.document.id,'document-1');assert.equal(archived.document.unknown,undefined);assert.equal(archived.opening.project_version,`10:${f.versions.get('projects/P')}`);
 const result=await f.call({operation:'restore',archive_id:archived.archive_id,operation_id:'restore-1',expected_project_version:archived.opening.project_version,expected_bom_version:archived.opening.bom_version,expected_archive_version:archived.opening.archive_version});
 assert.deepEqual(result,{ok:true,archive_id:archived.archive_id,document_id:'document-1',operation_id:'restore-1',resolution:'restored'});
 assert.deepEqual(f.docs.get('projectDocuments/document-1'),raw);assert.equal(f.docs.get('projectDocuments/document-1').pulseNativeDocument.generation,saved.generation);assert.equal(f.objects.size,2);
 assert.equal(f.docs.has(`pulseDeletedProjectDocuments/P/documents/${archived.archive_id}`),true);assert.equal((await f.call({operation:'list_deleted'})).deleted_documents.length,0);
 assert.equal((await f.call({operation:'restore',archive_id:archived.archive_id,operation_id:'restore-again',expected_project_version:archived.opening.project_version,expected_bom_version:archived.opening.bom_version,expected_archive_version:archived.opening.archive_version})).error,'project_document_archive_already_restored');
});

test('append-only deletion generations support delete restore delete without losing either archive',async()=>{
 const f=fixture();await uploaded(f);let row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 let listed=await f.call({operation:'list_deleted'}),archive=listed.deleted_documents[0];
 await f.call({operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version});
 row=(await f.get()).documents[0];assert.equal((await f.call({operation:'delete',operation_id:'delete-2',...opening(row)})).ok,true);
 listed=await f.call({operation:'list_deleted'});assert.equal(listed.deleted_documents.length,1);assert.notEqual(listed.deleted_documents[0].archive_id,archive.archive_id);
 assert.equal([...f.docs.keys()].filter(path=>path.startsWith('pulseDeletedProjectDocuments/P/documents/')).length,2);
});

test('archive listing and restore enforce existing project and category access, with customer POs admin-only',async()=>{
 const f=fixture(),saved=await uploaded(f),row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 const [archive]=(await f.call({operation:'list_deleted'})).deleted_documents;
 f.actor.email='user@customer.test';f.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Parts']}];
 const raw=f.docs.get(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`);raw.document.type='customer-po';raw.document_type='customer-po';raw.document.linkedBOMItems=['bolt'];
 assert.equal((await f.call({operation:'list_deleted'})).deleted_documents.length,0);
 const request={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-denied',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 assert.equal((await f.call(request)).error,'project_document_forbidden');
 f.actor.customClaims.role='admin';assert.equal((await f.call({operation:'list_deleted'})).deleted_documents.length,1);assert.equal((await f.call(request)).ok,true);assert.equal(f.docs.get('projectDocuments/document-1').pulseNativeDocument.generation,saved.generation);
});

test('restore rejects stale versions, active identity conflicts, and missing original bytes without changing archives',async()=>{
 const f=fixture();await uploaded(f);let row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 let archive=(await f.call({operation:'list_deleted'})).deleted_documents[0],request={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 f.versions.set('projects/P',55);assert.equal((await f.call(request)).error,'project_document_version_conflict');f.versions.set('projects/P',1);
 f.docs.set('projectDocuments/document-1',{projectId:'P',name:'collision',type:'spec-sheet'});assert.equal((await f.call(request)).error,'project_document_identity_conflict');f.docs.delete('projectDocuments/document-1');
 const marker=f.docs.get(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`).document.pulseNativeDocument;f.objects.delete(marker.path);
 assert.equal((await f.call(request)).error,'project_document_integrity_failed');assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(f.docs.has(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`),true);
});

test('restore stays disabled in read-only and default-off modes and replays by its receipt',async()=>{
 const f=fixture();await uploaded(f);const row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});let archive=(await f.call({operation:'list_deleted'})).deleted_documents[0],request={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});assert.equal((await f.call({operation:'list_deleted'})).permissions.restore,false);assert.equal((await f.call(request)).error,'project_document_writes_disabled');
 f.docs.set('pulseRuntimeControl/cutover',{mode:'coexist'});const restored=await f.call(request);assert.equal(restored.ok,true);f.off();assert.deepEqual(await f.call(request),restored);
 const g=fixture({enabled:false});g.docs.set('pulseDeletedProjectDocuments/P/documents/legacy',{project_id:'P',document_id:'legacy',document_type:'spec-sheet',actor_uid:'alice',document:{projectId:'P',name:'legacy',url:'https://example.test/legacy',type:'spec-sheet',linkedBOMItems:[]},at:new Date('2020-01-01')});
 const legacy=(await g.call({operation:'list_deleted'})).deleted_documents[0];assert.equal((await g.call({operation:'list_deleted'})).permissions.restore,false);assert.equal((await g.call({operation:'restore',archive_id:legacy.archive_id,operation_id:'restore-legacy',expected_project_version:legacy.opening.project_version,expected_bom_version:legacy.opening.bom_version,expected_archive_version:legacy.opening.archive_version})).error,'project_document_writes_disabled');
});

test('external member archive access respects project membership and narrows linked documents by category',async()=>{
 const f=fixture(),saved=await uploaded(f);f.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Parts']}];f.docs.get('projects/P/bom/data').categories.push({name:'Other',items:[{id:'other',status:'not-ordered'}]});
 f.docs.get('projectDocuments/document-1').linkedBOMItems=['other'];const row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0];f.actor.email='user@customer.test';
 const all=(await f.call({operation:'list_deleted'})).deleted_documents;assert.equal(all.length,0);
 const raw=f.docs.get(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`),request={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 assert.equal((await f.call(request)).error,'project_document_forbidden');assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(raw.document.pulseNativeDocument.generation,saved.generation);
 const g=fixture();await uploaded(g);g.docs.get('projectDocuments/document-1').linkedBOMItems=[];const unlinked=(await g.get()).documents[0];await g.call({operation:'delete',operation_id:'delete-1',...opening(unlinked)});g.actor.email='user@customer.test';g.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Parts']}];assert.equal((await g.call({operation:'list_deleted'})).deleted_documents.length,1);
});

test('restore audit failure is atomic and its archive can be retried with the same request',async()=>{
 const f=fixture();await uploaded(f);const row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0],request={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 f.options.failAudit=true;assert.equal((await f.call(request)).ok,false);assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(f.docs.has(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`),true);assert.equal(f.docs.has(`pulseProjectDocumentMutations/P/restorations/${archive.archive_id}`),false);
 f.options.failAudit=false;assert.equal((await f.call(request)).ok,true);assert.equal(f.docs.has('pulseProjectDocumentMutations/P/audit/restore-restore-1'),true);
});

test('item-side document references participate in category-scope access checks',async()=>{
 for(const[type,field]of [['vendor-quote','linkedQuoteDocumentId'],['vendor-po','linkedPODocumentId'],['vendor-invoice','linkedInvoiceDocumentId']]){
  const f=fixture(),reserved=await f.reserve({document_type:type});f.upload(reserved.path);assert.equal((await f.finalize()).ok,true);f.docs.get('projectDocuments/document-1').linkedBOMItems=[];f.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Parts']}];f.docs.get('projects/P/bom/data').categories.push({name:'Other',items:[{id:'other',status:'not-ordered',[field]:'document-1'}]});
  const row=(await f.get()).documents[0];assert.ok(row);await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0];assert.ok(archive);
  f.actor.email='user@customer.test';const scoped=await f.call({operation:'list_deleted'});assert.equal(scoped.deleted_documents.length,0,`${type} should be hidden when only its item-side link is outside scope`);
  assert.equal((await f.call({operation:'restore',archive_id:archive.archive_id,operation_id:'restore-denied',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version})).error,'project_document_forbidden');
 }
});

test('new non-native archives capture and verify the original Firebase Storage generation and bytes',async()=>{
 const f=fixture(),path='projects/P/documents/vendor-quote/legacy.pdf',bytes=Buffer.from('legacy bytes');f.upload(path,bytes,'application/pdf',{metadata:{firebaseStorageDownloadTokens:'legacy-token'}});
 const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(f.bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=legacy-token`;
 f.docs.set('projectDocuments/document-1',{projectId:'P',name:'legacy.pdf',url,type:'vendor-quote',uploadedAt:new Date('2025-01-01'),uploadedBy:'alice',linkedBOMItems:[],fileSize:bytes.length});const raw=f.docs.get('projectDocuments/document-1'),row=(await f.get()).documents[0],deleted=await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});assert.equal(deleted.ok,true,JSON.stringify(deleted));
 const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0],stored=f.docs.get(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`);
 assert.deepEqual(stored.storage_proof,{bucket:f.bucket.name,path,generation:f.objects.get(path).metadata.generation,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const restore={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 assert.equal((await f.call(restore)).ok,true);assert.deepEqual(f.docs.get('projectDocuments/document-1'),raw);
});

test('non-native restore fails when its storage generation or download token changed after deletion',async()=>{
 for(const change of ['generation','token']){
  const f=fixture(),path='projects/P/documents/vendor-quote/legacy.pdf',bytes=Buffer.from('legacy bytes');f.upload(path,bytes,'application/pdf',{metadata:{firebaseStorageDownloadTokens:'legacy-token'}});
  const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(f.bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=legacy-token`;
  f.docs.set('projectDocuments/document-1',{projectId:'P',name:'legacy.pdf',url,type:'vendor-quote',uploadedAt:new Date('2025-01-01'),uploadedBy:'alice',linkedBOMItems:[],fileSize:bytes.length});const row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
  const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0];if(change==='generation')f.upload(path,Buffer.from('replacement'),'application/pdf',{metadata:{firebaseStorageDownloadTokens:'legacy-token'}});else f.objects.get(path).metadata.metadata.firebaseStorageDownloadTokens='rotated-token';
  const restore={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
  assert.equal((await f.call(restore)).error,'project_document_integrity_failed');assert.equal(f.docs.has('projectDocuments/document-1'),false);
 }
});

test('legacy non-native archives without deletion-time storage proof fail closed on restore',async()=>{
 const f=fixture();f.docs.set('pulseDeletedProjectDocuments/P/documents/legacy',{project_id:'P',document_id:'legacy',document_type:'spec-sheet',actor_uid:'alice',document:{projectId:'P',name:'legacy',url:'https://storage.example/file.pdf',type:'spec-sheet',linkedBOMItems:[]},at:new Date('2020-01-01')});
 const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0],restore={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-legacy',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 assert.equal((await f.call(restore)).error,'project_document_integrity_unverified');assert.equal(f.docs.has('projectDocuments/legacy'),false);
});

test('new deletes refuse to archive non-native URLs whose storage identity cannot be verified',async()=>{
 const f=fixture();f.docs.set('projectDocuments/document-1',{projectId:'P',name:'external.pdf',url:'https://files.example/document.pdf',type:'spec-sheet',uploadedAt:new Date('2025-01-01'),uploadedBy:'alice',linkedBOMItems:[]});
 const row=(await f.get()).documents[0],result=await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});
 assert.equal(result.error,'project_document_integrity_unverified');assert.equal(f.docs.has('projectDocuments/document-1'),true);assert.equal(f.docs.has('pulseDeletedProjectDocuments/P/documents/document-1'),false);
});

test('deleted archive pagination skips restored entries and applies current category scope',async()=>{
 const f=fixture();
 for(let i=0;i<205;i++)f.docs.set(`pulseDeletedProjectDocuments/P/documents/archive-${String(i).padStart(3,'0')}`,{project_id:'P',document_id:`doc-${i}`,document_type:'spec-sheet',document:{projectId:'P',name:`doc-${i}`,url:'https://example.test/file.pdf',type:'spec-sheet',linkedBOMItems:[]},at:new Date(2026,0,i+1)});
 f.docs.set('pulseProjectDocumentMutations/P/restorations/archive-000',{event:'project_document_archive_restored'});
 const seen=[];let cursor,rounds=0;do{const page=await f.call({operation:'list_deleted',...(cursor?{cursor}:{})});assert.equal(page.ok,true);seen.push(...page.deleted_documents.map(row=>row.archive_id));cursor=page.next_cursor;assert.ok(++rounds<=3);}while(cursor);
 assert.equal(rounds,3);assert.equal(seen.length,204);assert.equal(seen.includes('archive-000'),false);assert.equal(new Set(seen).size,204);
 const g=fixture();g.actor.email='viewer@customer.test';g.docs.get('projects/P').members=[{userId:'alice',categoryScope:['Other']}];
 g.docs.set('pulseDeletedProjectDocuments/P/documents/scoped',{project_id:'P',document_id:'scoped-document',document_type:'spec-sheet',document:{projectId:'P',name:'scoped',url:'https://example.test/file.pdf',type:'spec-sheet',linkedBOMItems:['bolt']},at:new Date('2026-01-01')});
 assert.equal((await g.call({operation:'list_deleted'})).deleted_documents.length,0);
 const revoked=fixture();revoked.options.onRead=path=>{if(path==='pulseDeletedProjectDocuments/P/documents')revoked.actor.disabled=true;};
 assert.equal((await revoked.call({operation:'list_deleted'})).error,'actor_forbidden');
});

test('restore rechecks project membership after verifying the original storage object',async()=>{
 const f=fixture();await uploaded(f);const row=(await f.get()).documents[0];await f.call({operation:'delete',operation_id:'delete-1',...opening(row)});const archive=(await f.call({operation:'list_deleted'})).deleted_documents[0];
 f.options.onRead=path=>{if(path==='pulseProjectDocumentUploads/P/receipts/upload-1')f.docs.get('projects/P').memberIds=[];};
 const restore={operation:'restore',archive_id:archive.archive_id,operation_id:'restore-1',expected_project_version:archive.opening.project_version,expected_bom_version:archive.opening.bom_version,expected_archive_version:archive.opening.archive_version};
 assert.equal((await f.call(restore)).error,'project_document_forbidden');assert.equal(f.docs.has('projectDocuments/document-1'),false);assert.equal(f.docs.has(`pulseDeletedProjectDocuments/P/documents/${archive.archive_id}`),true);
});
