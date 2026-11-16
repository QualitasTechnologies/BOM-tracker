import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const BASELINE_SHA256='a02b48d3cd3a8e43880d40011e10e9f3856fc3db65c60bda0fa8c052ce18d909';
const normalize=text=>text.replace(/\r\n/g,'\n');
export const PROJECT_HELPER=`    // BEGIN project writer fence
    function projectClientWritesFenced() {
      return exists(/databases/$(database)/documents/pulseRuntimeControl/cutover)
        && get(/databases/$(database)/documents/pulseRuntimeControl/cutover).data.get('projectClientWritesFenced', false) == true;
    }
    // END project writer fence

`;
const ANCHOR='    function purchaseOrderPostSendStatus(status) {';
const ROOT='    match /projects/{projectId} {';
const END='\n      // Collection-prefixed grant.';
const GUARD='        && !projectClientWritesFenced()\n';
const once=(text,fragment)=>text.indexOf(fragment)>=0&&text.indexOf(fragment)===text.lastIndexOf(fragment);
function changeRoot(text,strip){
 const start=text.indexOf(ROOT),end=text.indexOf(END,start);if(!once(text,ROOT)||end<start)throw Error('ambiguous_project_root');
 let block=text.slice(start,end);
 for(const kind of ['create','update','delete']){
  const grant=`      allow ${kind}: if request.auth != null\n`,from=strip?grant+GUARD:grant,to=strip?grant:grant+GUARD;
  if(!once(block,from))throw Error('ambiguous_project_grant');block=block.replace(from,to);
 }
 return text.slice(0,start)+block+text.slice(end);
}
export function stripProjectFenceAddition(text){
 const value=normalize(text);if(!once(value,PROJECT_HELPER)||value.split(GUARD).length!==4)throw Error('ambiguous_project_addition');
 return changeRoot(value,true).replace(PROJECT_HELPER,'');
}
export function buildProjectFenceRules(text){
 const baseline=normalize(text);if(createHash('sha256').update(baseline).digest('hex')!==BASELINE_SHA256)throw Error('project_live_baseline_changed');
 if(!once(baseline,ANCHOR)||baseline.includes('projectClientWritesFenced'))throw Error('ambiguous_project_baseline');
 const candidate=changeRoot(baseline,false).replace(ANCHOR,PROJECT_HELPER+ANCHOR);
 if(stripProjectFenceAddition(candidate)!==baseline)throw Error('project_baseline_preservation_failed');return candidate;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),generated=buildProjectFenceRules(await readFile(path.join(root,'firestore.material-fence.rules'),'utf8')),target=path.join(root,'firestore.project-fence.rules');
 if(process.argv.includes('--check')){if(normalize(await readFile(target,'utf8'))!==generated)throw Error('project_release_artifact_stale');}
 else await writeFile(target,generated);
}
