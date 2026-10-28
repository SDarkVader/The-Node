/** Machine-private settings and latest-history pointer. No provider or credential reads. */
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,lstatSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {parseArgs} from 'node:util';
import {prepareSocietyPlaytest} from './prepare-society-playtest.js';
import {inspectSocietyFunding} from '../src/society/funding.js';
import {parseSocietyEvidence} from '../src/society/codec.js';
export interface LocalTestSettings {
  format:'node-local-test-settings-v1';credentialFile:string;priorJournal:string;outputParent:string;
  godot:string;webTemplate:string;webWorldDirectory:string;postcardRate:string;oracleConfig:string;
  historyRegistration:string;pendingRun:string|null;
}
function write(path:string,value:unknown){const temp=path+'.'+randomBytes(6).toString('hex')+'.next';
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temp,path);}
export function readLocalTestSettings(path:string):LocalTestSettings{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),file=resolve(path),rel=relative(root,file),stat=lstatSync(file);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)||!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('node_test_private_settings');
  const v=JSON.parse(readFileSync(file,'utf8')) as LocalTestSettings;
  if(v.format!=='node-local-test-settings-v1'||!['credentialFile','priorJournal','outputParent','godot','webTemplate','webWorldDirectory','postcardRate','oracleConfig','historyRegistration'].every(k=>typeof (v as any)[k]==='string'&&(v as any)[k].length>0)||
    v.pendingRun!==null&&typeof v.pendingRun!=='string')throw Error('node_test_settings');
  return v;
}
export function finishLocalTest(settingsPath:string){
  const settings=readLocalTestSettings(settingsPath);if(!settings.pendingRun)return {status:'no_pending_run'};
  const base=settings.pendingRun,journal=join(base,'execution','allowance','accounting.journal.json');
  if(!existsSync(journal)){
    if(existsSync(join(base,'execution')))throw Error('node_test_incomplete_execution_preserved');
    settings.pendingRun=null;write(settingsPath,settings);return {status:'unstarted_review_preserved'};
  }
  const view=inspectSocietyFunding(readFileSync(journal));
  // Always retain the newest actual financial history, even when it blocks another run.
  settings.priorJournal=journal;
  const auth=view.authorization,closed=!!auth&&(!!view.closure||view.requests.length===auth.maxRequests||Date.parse(auth.expiresAt)<=Date.now());
  const run=join(base,'execution','run');
  if(existsSync(join(run,'society.json'))){
    const events=readFileSync(join(run,'events.jsonl'),'utf8').split(/\r?\n/).filter(Boolean);
    const start=events.map(line=>parseSocietyEvidence<any>(line)).find(e=>e.kind==='start');
    const id=String(start?.data.runId??'run-'+randomBytes(6).toString('hex')).replace(/[^A-Za-z0-9._-]/g,'-');
    const registry=existsSync(settings.historyRegistration)?JSON.parse(readFileSync(settings.historyRegistration,'utf8')):{runs:[]};
    if(!Array.isArray(registry.runs))throw Error('node_test_history_registry');
    if(!registry.runs.some((r:any)=>r.directory===run))registry.runs.push({kind:'society',id,directory:run,mode:'live'});
    mkdirSync(dirname(settings.historyRegistration),{recursive:true});write(settings.historyRegistration,registry);
  }
  if(closed&&view.held===0n&&!view.overrun)settings.pendingRun=null;
  write(settingsPath,settings);
  return {status:settings.pendingRun?'latest_history_preserved_not_closed':'latest_history_carried',
    bookedMicroUsd:view.booked.toString(),heldMicroUsd:view.held.toString(),requests:view.requests.length};
}
export function prepareLocalTest(settingsPath:string,ticks:number,seed:number):ReturnType<typeof prepareSocietyPlaytest>{
  const settings=readLocalTestSettings(settingsPath);
  if(settings.pendingRun){finishLocalTest(settingsPath);if(readLocalTestSettings(settingsPath).pendingRun)throw Error('node_test_previous_allowance_not_closed');}
  const current=readLocalTestSettings(settingsPath),output=join(current.outputParent,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex'));
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const result=prepareSocietyPlaytest({priorJournal:current.priorJournal,credentialFile:current.credentialFile,
    outputRoot:output,postcardRate:current.postcardRate,ticks,seed,oracleConfig:resolve(root,current.oracleConfig),optionalDiarySubject:true,dailyTurns:128,inhabitantInformation:true,dualNavigation:true,godot:current.godot},{repositoryRoot:root});
  current.pendingRun=output;write(settingsPath,current);return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const {values}=parseArgs({options:{settings:{type:'string'},prepare:{type:'boolean'},finish:{type:'boolean'},
    ticks:{type:'string',default:'3'},seed:{type:'string',default:'42'}}});
  if(!values.settings||[values.prepare,values.finish].filter(Boolean).length!==1)throw Error('node_test_explicit_mode');
  console.log(JSON.stringify(values.prepare?prepareLocalTest(values.settings,Number(values.ticks),Number(values.seed)):finishLocalTest(values.settings)));
}
