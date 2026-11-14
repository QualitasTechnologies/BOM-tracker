import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const BASELINE_SHA256='2f4a9b6f0390ef91c9f1e4cf954e7e88c872839b9901c4e922655c096de294d0';
const normalize=text=>text.replace(/\r\n/g,'\n');
export const SCHEDULE_HELPER=`    // BEGIN schedule writer fence
    function scheduleClientWritesFenced() {
      return exists(/databases/$(database)/documents/pulseRuntimeControl/cutover)
        && get(/databases/$(database)/documents/pulseRuntimeControl/cutover).data.get('scheduleClientWritesFenced', false) == true;
    }
    function projectScheduleFieldsUnchanged() {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny([
        'deadline', 'originalDeadline', 'isBaselined', 'baselinedAt', 'baselinedBy'
      ]);
    }
    // END schedule writer fence

`;
const ANCHOR='    function purchaseOrderPostSendStatus(status) {';
const UPDATE="      allow update: if request.auth != null\n        && request.auth.token.status == 'approved'";
const UPDATE_FENCE=UPDATE+'\n        && (!scheduleClientWritesFenced() || projectScheduleFieldsUnchanged())';
const DELETE="      allow delete: if request.auth != null\n        && request.auth.token.role == 'admin';";
const DELETE_FENCE=DELETE.slice(0,-1)+'\n        && !scheduleClientWritesFenced();';
const GRANT='            || !overheadClientWritesFenced());';
const GRANT_FENCE='            || !overheadClientWritesFenced())\n          && (!(projectCollection in [\'milestones\', \'delayLogs\']) || !scheduleClientWritesFenced());';
const once=(text,fragment)=>text.indexOf(fragment)>=0&&text.indexOf(fragment)===text.lastIndexOf(fragment);
export function stripScheduleFenceAddition(candidateText){
 const candidate=normalize(candidateText);
 if(![SCHEDULE_HELPER,UPDATE_FENCE,DELETE_FENCE,GRANT_FENCE].every(fragment=>once(candidate,fragment)))throw Error('ambiguous_schedule_addition');
 return candidate.replace(SCHEDULE_HELPER,'').replace(UPDATE_FENCE,UPDATE).replace(DELETE_FENCE,DELETE).replace(GRANT_FENCE,GRANT);
}
export function buildScheduleFenceRules(baselineText){
 const baseline=normalize(baselineText);
 if(createHash('sha256').update(baseline).digest('hex')!==BASELINE_SHA256)throw Error('schedule_live_baseline_changed');
 if(![ANCHOR,UPDATE,DELETE,GRANT].every(fragment=>once(baseline,fragment))||baseline.includes('scheduleClientWritesFenced'))throw Error('ambiguous_schedule_baseline');
 const candidate=baseline.replace(ANCHOR,SCHEDULE_HELPER+ANCHOR).replace(UPDATE,UPDATE_FENCE).replace(DELETE,DELETE_FENCE).replace(GRANT,GRANT_FENCE);
 if(stripScheduleFenceAddition(candidate)!==baseline)throw Error('schedule_baseline_preservation_failed');
 return candidate;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),generated=buildScheduleFenceRules(await readFile(path.join(root,'firestore.overhead-fence.rules'),'utf8')),target=path.join(root,'firestore.schedule-fence.rules');
 if(process.argv.includes('--check')){if(normalize(await readFile(target,'utf8'))!==generated)throw Error('schedule_release_artifact_stale');}
 else await writeFile(target,generated);
}
