import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
import {createNativeMilestoneClient,createNativeMilestoneSession} from '../nativeMilestoneOperations';
const require=createRequire(import.meta.url);
const {fixture}=require('../../../functions/nativeMilestoneFixture.cjs');
const {fixture:projectFixture}=require('../../../functions/nativeProjectFixture.cjs');
import {createNativeProjectClient,createNativeProjectWorkspace} from '../nativeProjectOperations';
it('the original schedule session locks the real baseline once and resolves a lost body reply across reload',async()=>{
  sessionStorage.clear();const settings:{loseCommitReply:boolean;enabled?:boolean}={loseCommitReply:true},f=fixture(settings);
  const client=createNativeMilestoneClient({currentUid:async()=>'alice',callable:async payload=>({data:await f.call(payload)})});
  const session=createNativeMilestoneSession('P','alice',()=>true,client),opening=await session.load();
  expect(opening.project.projectId).toBe('P');expect(opening.project.projectName).toBe('Project');
  await expect(session.issue({kind:'baseline_lock'})).rejects.toBeInstanceOf(Error);
  const pending=session.pending;expect(pending?.command.kind).toBe('baseline_lock');
  settings.enabled=false;f.docs.set('pulseRuntimeControl/cutover',{mode:'read_only'});
  const reopened=createNativeMilestoneSession('P','alice',()=>true,client);await reopened.load();
  expect(reopened.pending).toEqual(pending);expect((await reopened.resolve()).resolution).toBe('committed');
  expect(f.docs.get('projects/P').isBaselined).toBe(true);expect([...f.docs.keys()].filter(path=>path.includes('/receipts/'))).toHaveLength(1);
});
it('the original project editor restores a deadline request and resolves real committed history after flag off',async()=>{
  sessionStorage.clear();let on=true,lost=true;
  const f=projectFixture({uid:'alice',enabled:()=>on});f.change({isBaselined:true,originalDeadline:'2026-10-20'});
  const client=createNativeProjectClient({currentUid:async()=>'alice',callable:async payload=>{
    const data=await f.call(payload);if(payload.operation==='command'&&lost){lost=false;throw Error('lost response');}return{data};
  }});
  const workspace=createNativeProjectWorkspace('P',client,'alice');await workspace.load();const action=workspace.capture('metadata');
  const command={kind:'metadata' as const,patch:{deadline:'2026-11-04'},delay:{reason:'Customer approved the schedule change',attribution:'external-client' as const}};
  await expect(action.submit(command)).rejects.toBeInstanceOf(Error);on=false;
  const reloaded=createNativeProjectWorkspace('P',client,'alice');expect((await reloaded.load()).permissions.edit).toBe(false);
  const restored=reloaded.capture('metadata');expect(restored.pendingCommand).toEqual(command);expect((await restored.resolve()).resolution).toBe('committed');
  expect([...f.docs.keys()].filter(path=>path.includes('/delayLogs/'))).toHaveLength(1);expect(f.docs.get('projects/P').originalDeadline).toBe('2026-10-20');sessionStorage.clear();
});
