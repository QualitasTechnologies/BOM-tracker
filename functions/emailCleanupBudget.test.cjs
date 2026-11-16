const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {stripQuotedHistory,getGmailMessage,listNewGmailMessageIds}=require('./emailIngestion.js');
test('deep quoted text followed by fresh content cannot monopolize the event loop',()=>{
 const source=`const {stripQuotedHistory}=require(${JSON.stringify(require.resolve('./emailIngestion.js'))});const text='New text\\n'+'>'.repeat(64)+'quoted text\\nFresh unquoted footer';if(stripQuotedHistory(text)!==text)process.exit(2);`;
 const result=spawnSync(process.execPath,['-e',source],{timeout:1500,encoding:'utf8'});
 assert.equal(result.error,undefined,'body cleanup must complete within the isolated process deadline');assert.equal(result.status,0,result.stderr);
});
test('trailing quote scan retains new text and handles a very deep legitimate quoted tail',()=>{
 assert.equal(stripQuotedHistory('New text\n'+'>'.repeat(10000)+' old quote\n> next old line\n'),'New text');
 assert.equal(stripQuotedHistory('New text\n> quoted line\nFresh new text'),'New text\n> quoted line\nFresh new text');
});
test('an unavailable Gmail message is recoverable by future backfill rather than a whole-history failure',async()=>{
 assert.equal(await getGmailMessage({accessToken:'synthetic',messageId:'deleted',fetchImpl:async()=>({ok:false,status:404})}),null);
 await assert.rejects(()=>getGmailMessage({accessToken:'synthetic',messageId:'auth',fetchImpl:async()=>({ok:false,status:403})}),/403/);
});
test('incremental history can stop after one page and resume from the exact original history cursor',async()=>{
 const calls=[];const fetchImpl=async url=>{const parsed=new URL(url);calls.push(parsed);return{ok:true,status:200,json:async()=>({historyId:'30',nextPageToken:'next-page',history:[{messagesAdded:[{message:{id:'one'}}]}]})};};
 const page=await listNewGmailMessageIds({accessToken:'synthetic',startHistoryId:'10',fetchImpl,maxPages:1});assert.equal(calls.length,1);assert.equal(page.nextPageToken,'next-page');
 await listNewGmailMessageIds({accessToken:'synthetic',startHistoryId:'10',pageToken:page.nextPageToken,fetchImpl,maxPages:1});assert.equal(calls[1].searchParams.get('startHistoryId'),'10');assert.equal(calls[1].searchParams.get('pageToken'),'next-page');
});
