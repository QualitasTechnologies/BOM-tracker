// Lazy Admin dependency keeps existing list/detail handlers and isolated fixtures independent.
const defaultTimestampFromParts = (seconds, nanos) => new (require('firebase-admin/firestore').Timestamp)(seconds, nanos);
const fault = code => Object.assign(new Error(code), {code,status:400});
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const email = value => { const candidate=text(value)?.toLowerCase(); return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null; };
const fields = {email:'sentAt',meeting:'startedAt'};
function date(value) {
  if(value == null) return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fault('invalid_communications_filter');
  const parsed=new Date(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==value) throw fault('invalid_communications_filter');
  return value;
}
function position(value,id) {
  if(value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) return {seconds:value.seconds,nanos:value.nanoseconds,id};
  const millis=value instanceof Date ? +value : typeof value?.toMillis==='function'?value.toMillis():NaN;
  if(!Number.isFinite(millis)) throw new Error('invalid_stored_timestamp');
  const seconds=Math.floor(millis/1000);return {seconds,nanos:(millis-seconds*1000)*1e6,id};
}
function iso(value) {
  if(!value) return null;
  const millis=value instanceof Date?+value:typeof value?.toMillis==='function'?value.toMillis():Date.parse(value);
  return Number.isFinite(millis)?new Date(millis).toISOString():null;
}
function participant(value) {return value && typeof value==='object'?{name:text(value.name),email:email(value.email)}:null;}
function sourceUrl(value) {
  try { const url=new URL(value);return url.protocol==='https:'&&url.hostname==='fathom.video'&&!url.username&&!url.password&&!url.search&&!url.hash?url.href:null; } catch {return null;}
}
function sanitize(projectId,type,snapshot) {
  const data=snapshot.data(), provider_ids={},canonical_keys=[];
  const set=(key,value)=>{if(value && value.length<=2048 && !/[\r\n]/.test(value))provider_ids[key]=value;};
  if(type==='email') {
    set('gmail_message_id',text(data.gmailMessageId));set('gmail_thread_id',text(data.gmailThreadId));set('mailbox_email',email(data.mailboxEmail));
    set('rfc_message_id',text(data.rfcMessageId));
    const match=provider_ids.rfc_message_id?.match(/^(?:<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/);
    const rfc=match && (match[1] || match[2]);
    if(rfc && /^[^\s<>@]+@[^\s<>@]+$/.test(rfc)) {canonical_keys.push(`rfc:${rfc}`);}
  } else { const id=text(data.fathomRecordingId);set('fathom_recording_id',id);if(provider_ids.fathom_recording_id)canonical_keys.push(`fathom:${id}`); }
  const people=type==='email'?[data.from,...(Array.isArray(data.to)?data.to:[]),...(Array.isArray(data.cc)?data.cc:[])]:[...(Array.isArray(data.attendees)?data.attendees:[]),...(email(data.hostEmail)?[{email:data.hostEmail}]:[])];
  const participants=people.map(participant).filter(p=>p&&p.email);
  return {id:`bom:${type}:${projectId}:${snapshot.id}`,source_system:'bom',source_type:type,source_id:snapshot.id,occurred_at:iso(data[fields[type]]),recorded_at:iso(data.createdAt),title:text(type==='email'?data.subject:data.title)||'',summary:text(data.summary),participants,source_url:type==='meeting'?sourceUrl(data.shareUrl):null,provider_ids,canonical_keys};
}
function parseQuery(projectId,query) {
  const type=query.type??null;
  if(type!==null&&(typeof type!=='string'||!Object.hasOwn(fields,type))) throw fault('invalid_communications_filter');
  const from=date(query.from),to=date(query.to);
  if(from&&to&&from>to) throw fault('invalid_communications_filter');
  const rawLimit=query.limit??'50';
  if(typeof rawLimit!=='string'||!/^\d+$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>100) throw fault('invalid_communications_limit');
  const binding={version:1,project_id:projectId,type,from,to},types=type?[type]:['email','meeting'];
  let positions=Object.fromEntries(types.map(t=>[t,null]));
  if(query.cursor!=null) {
    try {
      if(typeof query.cursor!=='string'||query.cursor.length>8192||! /^[A-Za-z0-9_-]+$/.test(query.cursor)) throw Error();
      const cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(JSON.stringify(cursor.binding)!==JSON.stringify(binding)||!cursor.positions||Object.keys(cursor.positions).sort().join()!==types.slice().sort().join()||Object.keys(cursor).sort().join()!=='binding,positions') throw Error();
      for(const p of Object.values(cursor.positions)) if(p!==null&&(!p||Object.keys(p).sort().join()!=='id,nanos,seconds'||!Number.isSafeInteger(p.seconds)||p.seconds < -62135596800||p.seconds>253402300799||!Number.isInteger(p.nanos)||p.nanos<0||p.nanos>=1e9||typeof p.id!=='string'||!p.id||p.id.length>1500||p.id.includes('/'))) throw Error();
      positions=cursor.positions;
    } catch {throw fault('invalid_communications_cursor');}
  }
  return {binding,positions,types,limit:Number(rawLimit)};
}
async function readProjectCommunications(ref,projectId,query,timestampFromParts=defaultTimestampFromParts) {
  const {binding,positions,types,limit}=parseQuery(projectId,query);
  const streams=await Promise.all(types.map(async type=>{
    const field=fields[type];let request=ref.collection(type==='email'?'emails':'meetings');
    if(binding.from) request=request.where(field,'>=',new Date(`${binding.from}T00:00:00+05:30`));
    if(binding.to) request=request.where(field,'<',new Date(+new Date(`${binding.to}T00:00:00+05:30`)+86400000));
    request=request.orderBy(field,'desc').orderBy('__name__','desc');
    const p=positions[type];if(p) request=request.startAfter(timestampFromParts(p.seconds,p.nanos),p.id);
    return (await request.limit(limit+1).get()).docs.map(snapshot=>({type,snapshot,position:position(snapshot.data()[field],snapshot.id)}));
  }));
  const rows=streams.flat().sort((a,b)=>b.position.seconds-a.position.seconds||b.position.nanos-a.position.nanos||(a.position.id<b.position.id?1:a.position.id>b.position.id?-1:0)||(a.type<b.type?1:a.type>b.type?-1:0));
  const page=rows.slice(0,limit);
  for(const row of page) positions[row.type]=row.position;
  return {ok:true,items:page.map(row=>sanitize(projectId,row.type,row.snapshot)),next_cursor:rows.length>limit?Buffer.from(JSON.stringify({binding,positions})).toString('base64url'):null,coverage:{source_system:'bom',project_id:projectId,types,from:binding.from,to:binding.to}};
}
module.exports={readProjectCommunications};
