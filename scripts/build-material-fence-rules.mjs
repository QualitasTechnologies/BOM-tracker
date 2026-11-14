import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const BASELINE_SHA256='906c0e9794058b531b14564b2e6f0dce48193bc021261ec61af0acaf8419931b';
const normalize=text=>text.replace(/\r\n/g,'\n');
export const MATERIAL_HELPER=`    // BEGIN material writer fence
    function legacyMaterialDataWriteFenceEnabled(projectId) {
      let cutoverPath = /databases/$(database)/documents/pulseMaterialCutovers/$(projectId);
      return exists(cutoverPath)
        && ('fence' in get(cutoverPath).data)
        && ('version' in get(cutoverPath).data)
        && get(cutoverPath).data.fence == 'legacy_bom_data_writes'
        && get(cutoverPath).data.version == 1;
    }
    // END material writer fence

`;
const ANCHOR='    function purchaseOrderPostSendStatus(status) {';
const GRANT="          && (!(projectCollection in ['milestones', 'delayLogs']) || !scheduleClientWritesFenced());";
const FENCED=GRANT.slice(0,-1)+"\n          && (projectCollection != 'bom' || document != /data || !legacyMaterialDataWriteFenceEnabled(projectId));";
const once=(text,fragment)=>text.indexOf(fragment)>=0&&text.indexOf(fragment)===text.lastIndexOf(fragment);
export function stripMaterialFenceAddition(text){
 const candidate=normalize(text);
 if(![MATERIAL_HELPER,FENCED].every(fragment=>once(candidate,fragment)))throw Error('ambiguous_material_addition');
 return candidate.replace(MATERIAL_HELPER,'').replace(FENCED,GRANT);
}
export function buildMaterialFenceRules(text){
 const baseline=normalize(text);
 if(createHash('sha256').update(baseline).digest('hex')!==BASELINE_SHA256)throw Error('material_live_baseline_changed');
 if(![ANCHOR,GRANT].every(fragment=>once(baseline,fragment))||baseline.includes('legacyMaterialDataWriteFenceEnabled'))throw Error('ambiguous_material_baseline');
 const candidate=baseline.replace(ANCHOR,MATERIAL_HELPER+ANCHOR).replace(GRANT,FENCED);
 if(stripMaterialFenceAddition(candidate)!==baseline)throw Error('material_baseline_preservation_failed');
 return candidate;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),generated=buildMaterialFenceRules(await readFile(path.join(root,'firestore.schedule-fence.rules'),'utf8')),target=path.join(root,'firestore.material-fence.rules');
 if(process.argv.includes('--check')){if(normalize(await readFile(target,'utf8'))!==generated)throw Error('material_release_artifact_stale');}
 else await writeFile(target,generated);
}
