import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const BASELINE_SHA256='080137bfc0f7a277f1c046b11a8f312f43212e6c5c243e6114373365b95e0c98';
const normalize=text=>text.replace(/\r\n/g,'\n');
export const OVERHEAD_HELPER=`    // BEGIN overhead writer fence
    function overheadClientWritesFenced() {
      return exists(/databases/$(database)/documents/pulseRuntimeControl/cutover)
        && get(/databases/$(database)/documents/pulseRuntimeControl/cutover).data.get('overheadClientWritesFenced', false) == true;
    }
    // END overhead writer fence

`;
const OLD_GRANT=`        allow read, write: if projectCollection != 'purchaseOrders'
          && projectSubcollectionAccess(projectId);`;
const NEW_GRANT=`        allow read: if projectCollection != 'purchaseOrders'
          && projectSubcollectionAccess(projectId);
        allow write: if projectCollection != 'purchaseOrders'
          && projectSubcollectionAccess(projectId)
          && (projectCollection != 'overheads' || document != /data
            || !overheadClientWritesFenced());`;
const ANCHOR='    function purchaseOrderPostSendStatus(status) {';
const once=(text,fragment)=>text.indexOf(fragment)>=0&&text.indexOf(fragment)===text.lastIndexOf(fragment);
export function stripOverheadFenceAddition(candidateText){
 const candidate=normalize(candidateText);
 if(!once(candidate,OVERHEAD_HELPER)||!once(candidate,NEW_GRANT))throw Error('ambiguous_overhead_addition');
 return candidate.replace(OVERHEAD_HELPER,'').replace(NEW_GRANT,OLD_GRANT);
}
export function buildOverheadFenceRules(baselineText){
 const baseline=normalize(baselineText);
 if(createHash('sha256').update(baseline).digest('hex')!==BASELINE_SHA256)throw Error('overhead_live_baseline_changed');
 if(!once(baseline,ANCHOR)||!once(baseline,OLD_GRANT)||baseline.includes('overheadClientWritesFenced'))throw Error('ambiguous_overhead_baseline');
 const candidate=baseline.replace(ANCHOR,OVERHEAD_HELPER+ANCHOR).replace(OLD_GRANT,NEW_GRANT);
 if(stripOverheadFenceAddition(candidate)!==baseline)throw Error('overhead_baseline_preservation_failed');
 return candidate;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const generated=buildOverheadFenceRules(await readFile(path.join(root,'firestore.read-signals.rules'),'utf8'));
 const target=path.join(root,'firestore.overhead-fence.rules');
 if(process.argv.includes('--check')){if(normalize(await readFile(target,'utf8'))!==generated)throw Error('overhead_release_artifact_stale');}
 else await writeFile(target,generated);
}
