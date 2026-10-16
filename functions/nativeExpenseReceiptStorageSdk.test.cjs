const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {Storage,CRC32C}=require('@google-cloud/storage');

// Exercise the installed SDK's real HTTP upload path against a loopback double.
// This proves precondition/metadata transport, not GCS's live IAM or atomicity.
test('installed Storage SDK sends a generation-zero conditional multipart upload and exposes a losing 412',async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic SDK receipt'),checksum=new CRC32C();checksum.update(bytes);
 const requests=[];let exists=false;
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push({url:req.url,body:Buffer.concat(chunks).toString()});
  res.setHeader('Content-Type','application/json');
  if(exists){res.statusCode=412;res.end(JSON.stringify({error:{code:412,message:'precondition failed'}}));return;}
  exists=true;res.end(JSON.stringify({bucket:'demo-receipts',name:'projects/P/receipts/finalized/test.bin',generation:'8',size:String(bytes.length),crc32c:checksum.toString()}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const storage=new Storage({projectId:'demo-bom-native-security',apiEndpoint:`http://127.0.0.1:${server.address().port}`,useAuthWithCustomEndpoint:false,retryOptions:{autoRetry:false}});
  const file=storage.bucket('demo-receipts').file('projects/P/receipts/finalized/test.bin');
  const settings=()=>({resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/pdf',metadata:{firebaseStorageDownloadTokens:'synthetic-token'}}});
  await file.save(bytes,settings());await assert.rejects(file.save(bytes,settings()),error=>Number(error.code)===412);
  assert.equal(requests.length,2);
  for(const request of requests){const url=new URL(request.url,'http://loopback');assert.equal(url.searchParams.get('ifGenerationMatch'),'0');assert.equal(url.searchParams.get('uploadType'),'multipart');assert.match(request.body,/synthetic-token/);assert.match(request.body,/%PDF-1.7 synthetic SDK receipt/);}
 }finally{await new Promise(resolve=>server.close(resolve));}
});
