const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {Storage,CRC32C}=require('@google-cloud/storage');

// Exercise the installed SDK's real HTTP upload path against a loopback double.
// This proves precondition/metadata transport, not GCS's live IAM or atomicity.
for(const sample of [
 {name:'travel PDF',path:'projects/P/receipts/finalized/test.bin',type:'application/pdf',bytes:Buffer.from('%PDF-1.7 synthetic SDK receipt')},
 {name:'received JPEG',path:'projects/P/received-photos/finalized/test.jpg',type:'image/jpeg',bytes:Buffer.from([255,216,255,1,255,217])},
])test(`installed Storage SDK sends conditional ${sample.name} bytes and exposes a losing 412`,async()=>{
 const bytes=sample.bytes,checksum=new CRC32C();checksum.update(bytes);
 const requests=[];let exists=false;
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push({url:req.url,body:Buffer.concat(chunks)});
  res.setHeader('Content-Type','application/json');
  if(exists){res.statusCode=412;res.end(JSON.stringify({error:{code:412,message:'precondition failed'}}));return;}
  exists=true;res.end(JSON.stringify({bucket:'demo-receipts',name:sample.path,generation:'8',size:String(bytes.length),crc32c:checksum.toString()}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const storage=new Storage({projectId:'demo-bom-native-security',apiEndpoint:`http://127.0.0.1:${server.address().port}`,useAuthWithCustomEndpoint:false,retryOptions:{autoRetry:false}});
  const file=storage.bucket('demo-receipts').file(sample.path);
  const settings=()=>({resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:sample.type,metadata:{firebaseStorageDownloadTokens:'synthetic-token'}}});
  await file.save(bytes,settings());await assert.rejects(file.save(bytes,settings()),error=>Number(error.code)===412);
  assert.equal(requests.length,2);
  for(const request of requests){const url=new URL(request.url,'http://loopback');assert.equal(url.searchParams.get('ifGenerationMatch'),'0');assert.equal(url.searchParams.get('uploadType'),'multipart');assert.match(request.body.toString(),/synthetic-token/);assert.equal(request.body.includes(bytes),true);}
 }finally{await new Promise(resolve=>server.close(resolve));}
});
