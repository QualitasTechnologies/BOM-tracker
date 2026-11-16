const {createHash,randomUUID}=require('node:crypto');
const ingestion=require('./emailIngestion.js');
const discovery=require('./contactDiscovery.js');
const {fetchJsonResponse}=require('./emailNetwork.cjs');
const fault=code=>Object.assign(new Error(code),{code});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const millis=value=>value?.toDate?value.toDate().getTime():new Date(value).getTime();
const backfillKey=job=>digest([job.contacts,job.requestedByUid,millis(job.sinceDate)]);
const syncKey=connection=>digest([connection.status,connection.refreshToken,connection.email,connection.lastHistoryId,connection.connectedAt]);
const transient=error=>[4,8,10,13,14,429,500,502,503,504,'ABORTED','UNAVAILABLE','DEADLINE_EXCEEDED','email_request_timeout'].includes(error.code)||[429,500,502,503,504].includes(error.status);
function oldestWorkFirst(docs,prefix){
  return docs.map((doc,index)=>{
    const row=doc.data(),recorded=row[prefix+'LastStartedMs'];
    const fallback=millis(row.updatedAt??row.lastSyncedAt??row.connectedAt??0);
    return{doc,index,time:Number.isFinite(recorded)?recorded:Number.isFinite(fallback)?fallback:0};
  }).sort((a,b)=>a.time-b.time||a.index-b.index).map(row=>row.doc);
}

// One current owner may checkpoint a record. Input changes invalidate the old
// owner so an operator extending a job or reconnecting Gmail cannot receive a
// stale page cursor/completion from an already-running invocation.
async function withLease(options,{ref,prefix,key,active,deadline},action){
  const {db,now,getDeleteField,logger}=options,owner=randomUUID(),ownerField=prefix+'LeaseOwner',untilField=prefix+'LeaseUntil';
  if(now()+35000>=deadline)return{state:'budget'};
  const initial=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists||!active(snap.data()))return null;
    const row=snap.data();if(row[ownerField]&&row[untilField]>now())return null;
    tx.update(ref,{[ownerField]:owner,[untilField]:deadline+30000,[prefix+'LastStartedMs']:now()});return row;
  });
  if(!initial)return{state:'busy'};
  const expected=key(initial);
  const commit=async(fields,extra)=>db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists||!active(snap.data())||snap.data()[ownerField]!==owner||key(snap.data())!==expected)throw fault('gmail_work_superseded');
    let extraFields;
    if(extra){const target=await tx.get(extra.ref);if(!target.exists)throw fault('gmail_project_not_found');extraFields=typeof extra.fields==='function'?extra.fields(target.data()):extra.fields;}
    tx.update(ref,fields);if(extra)tx.update(extra.ref,extraFields);
  });
  const stage=(name,fields={})=>logger.info('Gmail scheduled work stage',{recordId:ref.id,worker:prefix,stage:name,...fields});
  try{return await action({initial,commit,stage,hasTime:()=>now()+35000<deadline});}
  catch(error){
    if(error.code==='gmail_work_superseded')return{state:'superseded'};
    if(!transient(error))throw error;
    try{await commit({lastWorkerError:'provider_unavailable',updatedAt:options.getServerTimestamp()});}
    catch(checkpointError){if(checkpointError.code==='gmail_work_superseded')return{state:'superseded'};throw checkpointError;}
    logger.warn('Gmail scheduled work retained for retry',{recordId:ref.id,worker:prefix,code:'provider_unavailable'});return{state:'retry'};
  }finally{
    try{await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&snap.data()[ownerField]===owner)tx.update(ref,{[ownerField]:getDeleteField(),[untilField]:getDeleteField()});});}
    catch{logger.warn('Gmail scheduled lease will expire',{recordId:ref.id,worker:prefix});}
  }
}

function dependencies(input){return{...ingestion,...discovery,now:Date.now,fetchImpl:globalThis.fetch,logger:{info(){},warn(){}},...input};}
function createBackfillWorker(input){
  const options=dependencies(input),{db,now,getServerTimestamp:stamp,getDeleteField:remove,logger}=options;
  return async({projectId,jobRef,clientId,clientSecret,geminiApiKey,deadline=now()+90000})=>withLease(options,{ref:jobRef,prefix:'backfill',key:backfillKey,active:job=>['pending','running'].includes(job.status),deadline},async({initial:job,commit,stage,hasTime})=>{
    const completed=new Set(job.completedContacts||[]),contacts=job.contacts||[],batch=contacts.filter(email=>!completed.has(email)).slice(0,25),projectRef=db.collection('projects').doc(projectId);
    const completedProject={ref:projectRef,fields:project=>{
      const previous=project.backfilledContactEmails??[];
      if(!Array.isArray(previous)||previous.some(email=>typeof email!=='string'))throw fault('invalid_backfilled_contacts');
      return{backfilledContactEmails:[...new Set([...previous,...contacts])]};
    }};
    if(!batch.length){await commit({status:'completed',updatedAt:stamp()},completedProject);return{state:'completed'};}
    stage('checking_stakeholders');
    const snapshots=await Promise.all(batch.map(email=>db.collection('stakeholderIndex').doc(email).get()));
    const index=Object.fromEntries(batch.map((email,i)=>[email.toLowerCase().trim(),snapshots[i].exists?snapshots[i].data().projectIds||[]:[]]));
    if(options.findUnresolvedContacts(batch,projectId,index).length){await commit({status:'pending',updatedAt:stamp()});return{state:'waiting_for_stakeholders'};}
    stage('reading_connection');const connection=await db.collection('gmailConnections').doc(job.requestedByUid).get();
    if(!connection.exists||connection.data().status!=='connected'){await commit({status:'failed',error:'Gmail account is no longer connected',updatedAt:stamp()});return{state:'failed'};}
    stage('refreshing_token');const {accessToken}=await options.refreshAccessToken({refreshToken:connection.data().refreshToken,clientId,clientSecret,fetchImpl:options.fetchImpl});
    const since=new Date(millis(job.sinceDate));if(!Number.isFinite(since.getTime()))throw fault('invalid_email_backfill_date');
    const query=options.buildBackfillSearchQuery(batch,since),queryHash=digest([query,job.requestedByUid,connection.data().email]),sameQuery=job.backfillQueryHash===queryHash;
    let pending=Array.isArray(job.backfillPendingIds)&&sameQuery?[...job.backfillPendingIds]:null,next=job.backfillNextPageToken||null;
    let processed=job.processedCount||0,matched=job.matchedCount||0;
    if(pending===null){
      if(!hasTime())return{state:'pending'};stage('listing_messages');
      const page=await options.searchGmailMessageIds({accessToken,query,pageToken:!job.backfillQueryHash||sameQuery?job.pageToken||undefined:undefined,fetchImpl:options.fetchImpl});
      pending=[...page.messageIds];next=page.nextPageToken||null;
      await commit({status:'running',backfillPendingIds:pending,backfillNextPageToken:next,backfillQueryHash:queryHash,updatedAt:stamp()});
    }
    while(pending.length){
      if(!hasTime())return{state:'pending'};stage('processing_message',{messageId:pending[0],remaining:pending.length});
      const result=await options.processGmailMessage({db,accessToken,messageId:pending[0],geminiApiKey,mailboxEmail:connection.data().email});
      const rest=pending.slice(1);await commit({status:'running',backfillPendingIds:rest,processedCount:processed+1,matchedCount:matched+(result?1:0),lastWorkerError:remove(),updatedAt:stamp()});
      pending=rest;processed++;if(result)matched++;
    }
    const fields={backfillPendingIds:remove(),backfillNextPageToken:remove(),lastWorkerError:remove(),updatedAt:stamp()};
    let state='running';
    if(next)await commit({...fields,status:'running',pageToken:next});
    else{
      const finished=[...new Set([...completed,...batch])],allDone=contacts.every(email=>finished.includes(email));state=allDone?'completed':'running';
      await commit({...fields,status:state,completedContacts:finished,pageToken:remove(),backfillQueryHash:remove()},allDone?completedProject:undefined);
    }
    logger.info('Email backfill page checkpointed',{projectId,state,processedCount:processed,matchedCount:matched});return{state};
  });
}

function createSyncWorker(input){
  const options=dependencies(input),{db,now,getServerTimestamp:stamp,getDeleteField:remove,logger}=options;
  return async({connectionRef,clientId,clientSecret,geminiApiKey,deadline=now()+90000})=>withLease(options,{ref:connectionRef,prefix:'sync',key:syncKey,active:row=>row.status==='connected',deadline},async({initial:connection,commit,stage,hasTime})=>{
    stage('refreshing_token');const {accessToken}=await options.refreshAccessToken({refreshToken:connection.refreshToken,clientId,clientSecret,fetchImpl:options.fetchImpl});
    const queueKey=digest([connection.email,connection.connectedAt,connection.lastHistoryId]),sameQueue=connection.syncQueueKey===queueKey;
    let pending=Array.isArray(connection.syncPendingIds)&&sameQueue?[...connection.syncPendingIds]:null,next=sameQueue?connection.syncNextPageToken||null:null,history=sameQueue?connection.syncPendingHistoryId||connection.lastHistoryId:connection.lastHistoryId;
    if(pending===null){
      if(!hasTime())return{state:'pending'};stage('listing_history');
      const page=await options.listNewGmailMessageIds({accessToken,startHistoryId:connection.lastHistoryId,pageToken:sameQueue?connection.syncPageToken||undefined:undefined,maxPages:1,fetchImpl:options.fetchImpl});
      if(page.historyExpired){
        // Preserve the existing expired-history policy; never invent a cursor on
        // a failed profile fetch. The separate historical backfill remains queued.
        const response=await fetchJsonResponse(options.fetchImpl,'https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${accessToken}`}});
        if(!response.ok)throw Object.assign(Error('Gmail profile re-anchor failed'),{status:response.status});
        const profile=await response.json();if(!/^\d+$/.test(String(profile.historyId||'')))throw fault('gmail_history_cursor_invalid');
        await commit({lastHistoryId:String(profile.historyId),lastSyncedAt:stamp(),syncPageToken:remove(),syncPendingIds:remove(),syncNextPageToken:remove(),syncPendingHistoryId:remove(),syncQueueKey:remove()});
        logger.warn('syncGmailAccounts: history expired, re-anchored',{uid:connectionRef.id});return{state:'reanchored'};
      }
      pending=[...page.messageIds];next=page.nextPageToken||null;history=page.newHistoryId||connection.lastHistoryId;
      await commit({syncPendingIds:pending,syncNextPageToken:next,syncPendingHistoryId:history,syncQueueKey:queueKey});
    }
    while(pending.length){
      if(!hasTime())return{state:'pending'};stage('processing_message',{messageId:pending[0],remaining:pending.length});
      await options.processGmailMessage({db,accessToken,messageId:pending[0],geminiApiKey,mailboxEmail:connection.email});
      const rest=pending.slice(1);await commit({syncPendingIds:rest,lastWorkerError:remove()});pending=rest;
    }
    const fields={syncPendingIds:remove(),syncNextPageToken:remove(),syncPendingHistoryId:remove(),lastWorkerError:remove()};
    await commit(next?{...fields,syncPageToken:next}:{...fields,syncPageToken:remove(),syncQueueKey:remove(),lastHistoryId:history,lastSyncedAt:stamp()});
    logger.info('Gmail incremental page checkpointed',{uid:connectionRef.id,state:next?'running':'completed'});return{state:next?'running':'completed'};
  });
}
module.exports={createBackfillWorker,createSyncWorker,isTransientGmailWorkError:transient,oldestWorkFirst};
