/** Recover a durable, append-only v4 submission prefix without a provider, policy,
 * accounting operation or invented action. The caller must establish that it is using
 * the committed implementation identified by expectedSourceRevision. */
import { digest } from '../agent/replay.js';
import type { Genesis } from '../agent/participantWorld.js';
import { Society, type SocietyTape } from './runtime.js';
import { societyPlanHash, validateSocietyPlan, type SocietyRunEvent, type SocietyRunPlan } from './accounted.js';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { stringifySocietyEvidence } from './codec.js';

export function recoverSocietySubmissions(events: readonly SocietyRunEvent[], expectedSourceRevision: string): SocietyTape {
  const starts=events.filter(e=>e.kind==='start');
  if(starts.length!==1)throw Error('society_submission_start');
  const startIndex=events.indexOf(starts[0]!);
  const finishes=events.filter(e=>e.kind==='finish');
  const finishIndex=finishes.length?events.indexOf(finishes[0]!):-1;
  if(events.slice(0,startIndex).some(e=>e.kind==='submission')||finishes.length>1||
    (finishIndex>=0&&(finishIndex<startIndex||events.slice(finishIndex+1).some(e=>e.kind==='submission'))))
    throw Error('society_submission_event_order');
  const start=starts[0]!.data as {plan:SocietyRunPlan;planSha256:string;genesis:Genesis;submissionJournal:string};
  if(!start||start.submissionJournal!=='node-society-submissions-v1'||!start.genesis)throw Error('society_submission_journal_missing');
  validateSocietyPlan(start.plan);
  if(!start.plan.routine||start.plan.sourceRevision!==expectedSourceRevision||start.genesis.sourceRevision!==expectedSourceRevision||
    societyPlanHash(start.plan)!==start.planSha256)throw Error('society_submission_source');
  const genesis=start.genesis,plan=start.plan;
  const society=new Society({seed:genesis.seed,sourceRevision:expectedSourceRevision,config:genesis.config,observerSecret:genesis.observerSecret,
    ...(plan.postcards?{postcards:plan.postcards}:{}),...(plan.dailyOracle?{dailyOracle:plan.dailyOracle}:{}),routine:plan.routine});
  if(society.hash!==plan.initialHash||digest(society.controlled)!==digest(plan.controlled)||digest(society.exportTape().genesis)!==digest(genesis))
    throw Error('society_submission_genesis');
  let sequence=0;
  for(const event of events){
    if(event.kind!=='submission')continue;
    const entry=event.data as {sequence:number;person:string;tick:number;phase:string;turn:number;action:unknown;beforeHash:string;afterHash:string;afterTick:number;perception?:import('../observatory/perception.js').PerceptionRecord;navigation?:import('../observatory/navigation.js').NavigationRecord};
    if(!entry||entry.sequence!==sequence++||typeof entry.person!=='string'||entry.tick!==society.tick||entry.phase!==society.phase||
      entry.turn!==society.turn||entry.beforeHash!==society.hash)throw Error('society_submission_order');
    society.bindEvidence(entry.person,entry,entry.action as import('./boundary.js').SocietyAction);
    society.submit(entry.person,entry.action);
    if(entry.afterHash!==society.hash||entry.afterTick!==society.tick)throw Error('society_submission_transition');
  }
  const tape=society.exportTape();
  const finish=finishes[0]?.data as {tape?:unknown}|undefined;
  if(finish?.tape!=null&&digest(finish.tape)!==digest(tape))throw Error('society_submission_finish_conflict');
  return tape;
}

/** Fresh private viewing bundle; copies only named regular files, never follows a call
 * directory symlink, and retains the original run unchanged. A torn last event is left
 * only in the original; the bundle contains its complete, newline-terminated prefix. */
export function validateSocietyRecoveryTarget(inputDirectory:string,outputDirectory:string):void {
  const input=realpathSync(resolve(inputDirectory)),output=resolve(outputDirectory);
  if(existsSync(output))throw Error('society_recovery_bundle_target');
  let ancestor=output;
  while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)throw Error('society_recovery_bundle_target');ancestor=parent;}
  const target=resolve(realpathSync(ancestor),relative(ancestor,output)),rel=relative(input,target);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('society_recovery_bundle_target');
}
export function writeSocietyRecoveryBundle(inputDirectory:string,outputDirectory:string,tape:SocietyTape,pinnedEvents:Buffer):void {
  const input=resolve(inputDirectory),output=resolve(outputDirectory);
  validateSocietyRecoveryTarget(input,output);
  if(existsSync(join(input,'society.json')))throw Error('society_recovery_bundle_target');
  const regular=(path:string,max:number)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('society_recovery_artifact_bounds');};
  const eventsPath=join(input,'events.jsonl');regular(eventsPath,128*1024*1024);
  const current=readFileSync(eventsPath);
  if(!current.equals(pinnedEvents))throw Error('society_recovery_events_changed');
  const events=pinnedEvents,last=events.lastIndexOf(10),durable=events.subarray(0,last<0?0:last+1);
  mkdirSync(output,{mode:0o700});
  writeFileSync(join(output,'society.json'),stringifySocietyEvidence(tape),{flag:'wx',mode:0o600});
  writeFileSync(join(output,'events.jsonl'),durable,{flag:'wx',mode:0o600});
  writeFileSync(join(output,'recovery.json'),JSON.stringify({format:'node-society-submission-recovery-v1',
    originalEventsBytes:events.length,durableEventsBytes:durable.length,sourceRevision:tape.genesis.sourceRevision,
    note:'Tape reconstructed from recorded submissions; the original run remains unchanged.'},null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(output,'history-registration.json'),JSON.stringify({runs:[{kind:'society',
    id:'recovered-'+tape.genesisHash.slice(0,16),directory:output,mode:'live'}]},null,2)+'\n',{flag:'wx',mode:0o600});
  for(const name of ['run-start.json','summary.json','finalization.json','errors.json']){
    const file=join(input,name);if(existsSync(file)){regular(file,128*1024*1024);copyFileSync(file,join(output,name),constants.COPYFILE_EXCL);}
  }
  const calls=join(input,'calls');if(!existsSync(calls))return;
  const stats=lstatSync(calls);if(!stats.isDirectory()||stats.isSymbolicLink())throw Error('society_recovery_calls_bounds');
  const entries=readdirSync(calls,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&/^\d{1,10}$/.test(e.name));
  if(entries.length>5000)throw Error('society_recovery_calls_bounds');
  const outCalls=join(output,'calls');mkdirSync(outCalls,{mode:0o700});
  for(const entry of entries){
    const source=join(calls,entry.name),target=join(outCalls,entry.name);mkdirSync(target,{mode:0o700});
    for(const name of ['request.json','response.json','status.json','transport.json']){
      const file=join(source,name);if(existsSync(file)){regular(file,4*1024*1024);copyFileSync(file,join(target,name),constants.COPYFILE_EXCL);}
    }
  }
}
