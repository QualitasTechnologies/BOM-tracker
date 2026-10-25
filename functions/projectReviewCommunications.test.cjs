const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectReviewHandler } = require('./projectReview.cjs');
const stamp = value => new Date(value);
function fixture(actorOverride={}) {
  const actor = {uid:'alice',email:'alice@qualitastech.com',emailVerified:true,customClaims:{role:'user',status:'approved'},...actorOverride};
  const project = {memberIds:['alice']};
  const records = {emails:{},meetings:{}};
  const queries = [];
  const snapshot = (id,data) => ({id,exists:!!data,data:()=>data});
  const millis = value => value instanceof Date ? BigInt(+value)*1000000n : Number.isInteger(value?.seconds) ? BigInt(value.seconds)*1000000000n+BigInt(value.nanoseconds) : value;
  function collection(type, filters=[], orders=[], after=null, count=Infinity) {
    return {
      doc:id=>({get:async()=>snapshot(id,records[type][id])}),
      where:(field,op,value)=>collection(type,[...filters,[field,op,value]],orders,after,count),
      orderBy:(field,direction)=>collection(type,filters,[...orders,[field,direction]],after,count),
      startAfter:(...values)=>collection(type,filters,orders,values,count),
      limit:value=>collection(type,filters,orders,after,value),
      get:async()=>{
        queries.push({type,filters,orders,after,count});
        let rows=Object.entries(records[type]).filter(([,data])=>orders.every(([f])=>f==='__name__'||data[f]!=null));
        for(const [field,op,value] of filters) rows=rows.filter(([,d])=>op==='>='?millis(d[field])>=millis(value):millis(d[field])<millis(value));
        const values=row=>orders.map(([field])=>field==='__name__'?row[0]:millis(row[1][field]));
        const compare=(a,b)=>{for(let i=0;i<orders.length;i++){if(a[i]!==b[i])return (a[i]<b[i]?-1:1)*(orders[i][1]==='desc'?-1:1);}return 0;};
        rows.sort((a,b)=>compare(values(a),values(b)));
        if(after) rows=rows.filter(row=>compare(values(row),after.map(millis))>0);
        return {docs:rows.slice(0,count).map(([id,data])=>snapshot(id,data))};
      }
    };
  }
  const ref={get:async()=>snapshot('A',project),collection:type=>collection(type)};
  const db={collection:()=>({doc:()=>ref})};
  const auth={getUserByEmail:async()=>actor,getUser:async()=>actor};
  const handler=createProjectReviewHandler({db,auth,getServiceKey:()=> 'key',timestampFromParts:(seconds,nanoseconds)=>({seconds,nanoseconds,toMillis:()=>seconds*1000+nanoseconds/1e6})});
  async function call(query={}, headers={}) {
    let status=200, body;
    const res={set(){},status(code){status=code;return this;},json(value){body=value;return this;}};
    await handler({method:'GET',query:{project_id:'A',resource:'communications',...query},get:name=>({'X-Project-Review-Key':'key','X-Pulse-User-Email':actor.email,'X-Pulse-Authenticated-At':'1800000000000',...headers})[name]},res);
    return {status,body};
  }
  return {actor,project,records,queries,call};
}
const add = (f,type,id,time,extra={}) => { f.records[type][id] = {[type==='emails'?'sentAt':'startedAt']:stamp(time),createdAt:stamp(time),...extra}; };
test('native records are sanitized, qualified, and retain only available provider identities',async()=>{
  const f=fixture();
  add(f,'emails','e','2026-10-10T12:00:00Z',{subject:'Proposal',gmailMessageId:'g',gmailThreadId:'thread',mailboxEmail:'Sales@Example.com',rfcMessageId:'<m@example.com>',from:{email:'a@example.com',name:'A',token:'secret'},body:'private body',rawBody:'raw',price:999});
  add(f,'meetings','m','2026-10-10T13:00:00Z',{title:'Meeting',summary:'Discussed',fathomRecordingId:'123',shareUrl:'https://fathom.video/share/abc',attendees:[{email:'b@example.com',name:'B',refreshToken:'secret'}]});
  const result=await f.call(); assert.equal(result.status,200);
  assert.equal(result.body.ok,true); assert.equal(result.body.items.length,2);
  const email=result.body.items[1]; assert.equal(email.id,'bom:email:A:e'); assert.equal(email.source_system,'bom'); assert.equal(email.occurred_at,'2026-10-10T12:00:00.000Z');
  assert.deepEqual(email.provider_ids,{gmail_message_id:'g',gmail_thread_id:'thread',mailbox_email:'sales@example.com',rfc_message_id:'<m@example.com>'});
  assert.deepEqual(email.canonical_keys,['rfc:m@example.com']); assert.equal(email.summary,null);
  assert.deepEqual(email.participants,[{name:'A',email:'a@example.com'}]);
  assert.deepEqual(result.body.items[0].canonical_keys,['fathom:123']);
  // Intentionally superseded: the list now carries a bounded body preview (the full body is detail-only); unknown and secret fields stay excluded.
  assert.equal(email.body_preview,'private body'); assert.equal(Object.hasOwn(email,'body'),false);
  for(const value of ['rawBody','price','refreshToken','secret']) assert.equal(JSON.stringify(result.body).includes(value),false);
});
test('timestamp and document ties merge correctly across every page without truncating older history',async()=>{
  const f=fixture();
  for(let i=0;i<125;i++) add(f,i%2?'emails':'meetings',String(i).padStart(3,'0'),'2026-10-10T12:00:00Z');
  const expected=Object.keys(f.records.emails).concat(Object.keys(f.records.meetings)).sort().reverse();
  const actual=[]; let cursor;
  do {const r=await f.call({limit:'7',...(cursor?{cursor}:{})});assert.equal(r.status,200);actual.push(...r.body.items.map(x=>x.source_id));cursor=r.body.next_cursor;} while(cursor);
  assert.deepEqual(actual,expected); assert.ok(f.queries.every(q=>q.count<=8));
});
test('India inclusive dates and type are applied to queries before pagination',async()=>{
  const f=fixture();
  for(const [id,time] of [['before','2026-10-09T18:29:59Z'],['start','2026-10-09T18:30:00Z'],['end','2026-10-10T18:29:59Z'],['after','2026-10-10T18:30:00Z']]) add(f,'emails',id,time);
  add(f,'meetings','meeting','2026-10-10T12:00:00Z');
  const r=await f.call({type:'email',from:'2026-10-10',to:'2026-10-10',limit:'1'});
  assert.deepEqual(r.body.items.map(x=>x.source_id),['end']);
  assert.deepEqual((await f.call({type:'email',from:'2026-10-10',to:'2026-10-10',limit:'1',cursor:r.body.next_cursor})).body.items.map(x=>x.source_id),['start']);
  assert.ok(f.queries.every(q=>q.type==='emails'&&q.filters.length===2));
});
test('cursors reject malformed shapes and changes to project or filters',async()=>{
  const f=fixture(); add(f,'emails','a','2026-10-10T12:00:00Z');add(f,'emails','b','2026-10-10T12:00:00Z');
  const cursor=(await f.call({limit:'1'})).body.next_cursor;
  for(const query of [{cursor:'nonsense'},{cursor:Buffer.from('{}').toString('base64url')},{cursor,type:'email'},{cursor,project_id:'B'},{cursor,from:'2026-10-10'},{type:'all'},{type:['email']},{limit:'101'},{limit:'0'},{from:'2026-02-30'},{from:'2026-10-11',to:'2026-10-10'}]) assert.equal((await f.call(query)).status,400,JSON.stringify(query));
});
test('current actor approval and membership are rechecked on continuation pages',async()=>{
  const f=fixture(); add(f,'emails','a','2026-10-10T12:00:00Z');add(f,'emails','b','2026-10-10T12:00:00Z');
  const cursor=(await f.call({limit:'1'})).body.next_cursor;
  f.project.memberIds=[]; assert.equal((await f.call({cursor})).status,403);
  f.project.memberIds=['alice'];f.actor.disabled=true;assert.equal((await f.call({cursor})).status,403);
  f.actor.disabled=false;f.actor.tokensValidAfterTime=new Date(1900000000000).toISOString();assert.equal((await f.call({cursor})).status,403);
});
test('unsafe links and unverified gmail keys stay absent; reading never mutates sources',async()=>{
  const f=fixture();add(f,'emails','a','2026-10-10T12:00:00Z',{gmailMessageId:'g',gmailThreadId:'t',sourceUrl:'javascript:alert(1)'});
  add(f,'meetings','b','2026-10-10T12:00:00Z',{shareUrl:'https://user:password@example.com/x',fathomRecordingId:'123'});
  const before=JSON.stringify(f.records);const r=await f.call();assert.equal(r.status,200);
  assert.equal(JSON.stringify(f.records),before);assert.ok(r.body.items.every(i=>i.source_url===null));
  assert.deepEqual(r.body.items.find(i=>i.source_type==='email').canonical_keys,[]);
  assert.equal((await f.call({resource:'communications',project_id:undefined})).status,400);
});
test('malformed RFC ids never become canonical message identities',async()=>{
  const f=fixture();
  for(const [index,rfc] of ['<>','<wrong@example.com','wrong@example.com>','two words@example.com','<valid@example.com>'].entries()) add(f,'emails',String(index),'2026-10-10T12:00:00Z',{rfcMessageId:rfc});
  const r=await f.call();assert.equal(r.status,200);
  for(const item of r.body.items) assert.deepEqual(item.canonical_keys,item.source_id==='4'?['rfc:valid@example.com']:[]);
});
test('same document ids across streams and submillisecond timestamp ties survive cursors',async()=>{
  const Timestamp=function(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;this.toMillis=()=>seconds*1000+nanoseconds/1e6;};const f=fixture();
  for(const type of ['emails','meetings']) for(const [id,nanos] of [['same',123],['older',122]]) f.records[type][id]={[type==='emails'?'sentAt':'startedAt']:new Timestamp(1791633600,nanos)};
  const actual=[];let cursor;
  do {const r=await f.call({limit:'1',...(cursor?{cursor}:{})});assert.equal(r.status,200);actual.push(r.body.items[0].id);cursor=r.body.next_cursor;} while(cursor);
  assert.deepEqual(actual,['bom:meeting:A:same','bom:email:A:same','bom:meeting:A:older','bom:email:A:older']);
});
test('missing titles and name-only participants follow the Pulse page schema',async()=>{
  const f=fixture();add(f,'meetings','a','2026-10-10T12:00:00Z',{attendees:[{name:'Unknown'},{email:'valid@example.com'}]});
  const item=(await f.call()).body.items[0];assert.equal(item.title,'');assert.deepEqual(item.participants,[{name:null,email:'valid@example.com'}]);
});
test('transport-unsafe provider identifiers are omitted without rejecting the page',async()=>{
  const f=fixture();add(f,'emails','a','2026-10-10T12:00:00Z',{gmailMessageId:'a\rb',gmailThreadId:'a'.repeat(2049),rfcMessageId:'<abc@\nexample.com>'});
  const r=await f.call();assert.equal(r.status,200);assert.deepEqual(r.body.items[0].provider_ids,{});assert.deepEqual(r.body.items[0].canonical_keys,[]);
});
const detail = (f, type, source_id, headers={}) => f.call({resource:'communication',type,source_id},headers);
const richEmail = {subject:'Quote',gmailMessageId:'g',mailboxEmail:'sales@qualitastech.com',from:{email:'A@Example.com',name:'A',token:'secret'},to:[{email:'b@example.com',name:'B'},{name:'no-email'}],cc:[{email:'c@example.com'}],direction:'outbound',body:'x'.repeat(5000),sanitizeFailed:false,rawBody:'raw'};
test('list rows carry sender, recipients, direction, bounded body preview and detail availability but never the full body',async()=>{
  const f=fixture();add(f,'emails','e','2026-10-10T12:00:00Z',richEmail);
  const item=(await f.call()).body.items[0];
  assert.deepEqual(item.from,{name:'A',email:'a@example.com'});assert.deepEqual(item.to,[{name:'B',email:'b@example.com'}]);assert.deepEqual(item.cc,[{name:null,email:'c@example.com'}]);
  assert.equal(item.direction,'outbound');assert.equal(item.body_preview.length,500);assert.equal(item.body_length,5000);assert.equal(item.detail_available,true);assert.equal(item.sanitize_failed,false);
  assert.equal(JSON.stringify(item).includes('x'.repeat(501)),false);assert.equal(Object.hasOwn(item,'body'),false);assert.equal(JSON.stringify(item).includes('secret'),false);assert.equal(JSON.stringify(item).includes('rawBody'),false);
});
test('unknown direction is null rather than guessed, and sanitizeFailed is surfaced',async()=>{
  const f=fixture();add(f,'emails','e','2026-10-10T12:00:00Z',{direction:'sideways',sanitizeFailed:true,body:'hi'});
  const item=(await f.call()).body.items[0];assert.equal(item.direction,null);assert.equal(item.sanitize_failed,true);assert.equal(item.from,null);assert.deepEqual(item.to,[]);
});
test('meeting rows carry ended_at, host and action items; absent fields are not invented',async()=>{
  const f=fixture();add(f,'meetings','m','2026-10-10T12:00:00Z',{title:'M',endedAt:stamp('2026-10-10T13:00:00Z'),hostEmail:'Host@Qualitastech.com',actionItems:['Send plan',' ',7,'Book site']});
  add(f,'meetings','n','2026-10-09T12:00:00Z',{title:'N'});
  const [m,n]=(await f.call()).body.items;
  assert.equal(m.ended_at,'2026-10-10T13:00:00.000Z');assert.equal(m.host_email,'host@qualitastech.com');assert.deepEqual(m.action_items,['Send plan','Book site']);assert.equal(m.action_item_count,2);assert.equal(m.detail_available,true);
  assert.equal(n.ended_at,null);assert.equal(n.host_email,null);assert.deepEqual(n.action_items,[]);
});
test('email detail returns the full plain-text body for one authorized record, in one response',async()=>{
  const f=fixture();const body='y'.repeat(1040000);add(f,'emails','big','2026-10-10T12:00:00Z',{...richEmail,body});
  const r=await detail(f,'email','big');assert.equal(r.status,200);
  assert.equal(r.body.ok,true);assert.equal(r.body.item.id,'bom:email:A:big');assert.equal(r.body.item.body,body);assert.equal(Object.hasOwn(r.body.item,'body_truncated'),false);
  assert.equal(r.body.item.source_id,'big');assert.equal(JSON.stringify(r.body).includes('rawBody'),false);assert.equal(JSON.stringify(r.body).includes('secret'),false);
  assert.equal(f.queries.length,0,'detail reads one document, never a collection scan');
});
test('email detail preserves the exact stored string, including markup and ordinary angle brackets, as inert data',async()=>{
  const f=fixture();
  const bodies=['<p>Hello&nbsp;<b>team</b></p><script>alert(1)</script><style>p{}</style><div>Line&amp;2</div><img src=x onerror=alert(1)>','Mail <john@acme.com> or <https://x.com/a>','List<String> x;\n#include <stdio.h>\na <b and c> d','a < b && c > d','café \u{1F600} 😀 中文 <3'];
  bodies.forEach((body,i)=>add(f,'emails',`h${i}`,'2026-10-10T12:00:00Z',{body,sanitizeFailed:i===0}));
  for(const [i,body] of bodies.entries()) {
    const r=await detail(f,'email',`h${i}`);assert.equal(r.status,200);assert.equal(r.body.item.body,body,`h${i}`);
  }
  assert.equal((await detail(f,'email','h0')).body.item.sanitize_failed,true);
  const preview=(await f.call()).body.items.map(x=>x.body_preview);
  for(const body of bodies) assert.ok(preview.includes(body),'preview keeps ordinary angle-bracket content: '+body);
});
test('the source ceiling is the Firestore document limit in UTF-8 bytes: exact-limit multibyte bodies pass, oversize is an explicit integrity error',async()=>{
  const f=fixture();
  add(f,'emails','emoji','2026-10-10T12:00:00Z',{body:'\u{1F600}'.repeat(262144)});
  const ok=await detail(f,'email','emoji');assert.equal(ok.status,200);assert.equal(ok.body.item.body.length,524288);assert.equal(Buffer.byteLength(ok.body.item.body),1048576);
  add(f,'emails','over','2026-10-10T12:00:00Z',{body:'x'.repeat(1048577)});
  const over=await detail(f,'email','over');assert.equal(over.status,502);assert.deepEqual(over.body,{ok:false,error:'communication_integrity_error'});
  add(f,'emails','overbytes','2026-10-10T12:00:00Z',{body:'€'.repeat(349526)});
  assert.equal((await detail(f,'email','overbytes')).status,502);
});
test('email detail rejects a populated non-string body as an explicit integrity error',async()=>{
  const f=fixture();
  add(f,'emails','object','2026-10-10T12:00:00Z',{body:{text:'retained'}});
  add(f,'emails','number','2026-10-10T12:00:00Z',{body:123});
  for(const id of ['object','number']) {
    const result=await detail(f,'email',id);
    assert.equal(result.status,502);
    assert.deepEqual(result.body,{ok:false,error:'communication_integrity_error'});
  }
});
test('email detail keeps missing and null legacy bodies as empty strings',async()=>{
  const f=fixture();
  add(f,'emails','missing','2026-10-10T12:00:00Z');
  add(f,'emails','null','2026-10-10T12:00:00Z',{body:null});
  for(const id of ['missing','null']) {
    const result=await detail(f,'email',id);
    assert.equal(result.status,200);
    assert.equal(result.body.item.body,'');
  }
});
test('meeting detail returns the full summary and every action item',async()=>{
  const f=fixture();const items=Array.from({length:60},(_,i)=>`Item ${i}`);add(f,'meetings','m','2026-10-10T12:00:00Z',{title:'M',summary:'Long summary',actionItems:items,hostEmail:'h@example.com',endedAt:stamp('2026-10-10T13:00:00Z')});
  const r=await detail(f,'meeting','m');assert.equal(r.status,200);assert.deepEqual(r.body.item.action_items,items);assert.equal(r.body.item.summary,'Long summary');assert.equal(r.body.item.ended_at,'2026-10-10T13:00:00.000Z');
  assert.equal(r.body.item.body,undefined);
});
test('detail validates type and id and reports missing records',async()=>{
  const f=fixture();add(f,'emails','e','2026-10-10T12:00:00Z');
  assert.equal((await detail(f,'email','missing')).status,404);
  for(const [t,i] of [['call','e'],[undefined,'e'],['email',undefined],['email','a/b'],['email',''],['email','x'.repeat(513)],[['email'],'e'],['email',['e']]]) assert.equal((await detail(f,t,i)).status,400,JSON.stringify([t,i]));
  assert.equal((await f.call({resource:'communication',project_id:undefined,type:'email',source_id:'e'})).status,400);
});
test('communications list and detail require the BOM communications capability (not partner) on every request',async()=>{
  for(const override of [{email:'alice@example.com'},{email:'viewer@partner.io',customClaims:{role:'viewer',status:'approved'}}]) {
    const f=fixture(override);add(f,'emails','e','2026-10-10T12:00:00Z',{body:'secret body'});
    const list=await f.call();const one=await detail(f,'email','e');
    assert.equal(list.status,403);assert.equal(one.status,403);assert.equal(JSON.stringify([list.body,one.body]).includes('secret body'),false);assert.equal(f.queries.length,0);
  }
});
test('BOM admin without a qualitastech address keeps communications access; internal viewer role is not restricted',async()=>{
  const f=fixture({email:'boss@example.com',customClaims:{role:'admin',status:'approved'}});add(f,'emails','e','2026-10-10T12:00:00Z',{body:'hi'});
  assert.equal((await f.call()).status,200);
  const v=fixture({customClaims:{role:'viewer',status:'approved'}});add(v,'emails','e','2026-10-10T12:00:00Z',{body:'hi'});
  assert.equal((await detail(v,'email','e')).status,200);
});
test('detail rechecks fresh approval, disable state, revocation and project membership; outsiders get nothing',async()=>{
  const f=fixture();add(f,'emails','e','2026-10-10T12:00:00Z',{body:'private body'});
  assert.equal((await detail(f,'email','e')).status,200);
  f.project.memberIds=['someone-else'];const outsider=await detail(f,'email','e');assert.equal(outsider.status,403);assert.equal(JSON.stringify(outsider.body).includes('private body'),false);
  f.project.memberIds=['alice'];f.actor.disabled=true;assert.equal((await detail(f,'email','e')).status,403);
  f.actor.disabled=false;f.actor.tokensValidAfterTime=new Date(1900000000000).toISOString();assert.equal((await detail(f,'email','e')).status,403);
  f.actor.tokensValidAfterTime=undefined;f.actor.customClaims.status='suspended';assert.equal((await detail(f,'email','e')).status,403);
});
