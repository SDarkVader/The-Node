/** Explicit prepare -> review/fund separately -> approve -> one bounded accounted run.
 * No command here creates an allowance, reuses a historical world, or resets accounting. */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Society, verifySocietyTape } from '../src/society/runtime.js';
import { createSocietyPlan, societyPlanHash, runAccountedSociety, validateSocietyPlan, type SocietyRunPlan } from '../src/society/accounted.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { hostProcessEnvironment } from '../src/agent/isolatedHost.js';
import { digest } from '../src/agent/replay.js';
import { sha256 } from '../src/agent/accountingStore.js';
import type { Genesis } from '../src/agent/participantWorld.js';
import { parseSocietyEvidence, stringifySocietyEvidence } from '../src/society/codec.js';
import { readSocietyResults, writeSocietyRawResults } from '../src/society/report.js';
import { inspectSocietyFunding } from '../src/society/funding.js';
import type {SocietyPostcardConfig} from '../src/society/postcards.js';

const {values}=parseArgs({options:{prepare:{type:'boolean'},preflight:{type:'boolean'},'owner-approved':{type:'boolean'},
  bundle:{type:'string'},ticks:{type:'string',default:'3'},seed:{type:'string',default:'42'},budget:{type:'string'},
  credential:{type:'string'},approval:{type:'string'},output:{type:'string'},'carried-fingerprint':{type:'string'},
  'postcard-rate':{type:'string'},'postcard-start-ms':{type:'string'}}});
if([values.prepare,values.preflight,values['owner-approved']].filter(Boolean).length!==1||!values.bundle)throw Error('society_explicit_mode_and_bundle_required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
// Pin actual committed source before preparing a reviewable paid plan. Untracked unrelated
// files (including the owner's PDF) are preserved and do not change a compiled source commit.
execFileSync('git',['diff','--quiet','HEAD'],{cwd:root,windowsHide:true});
const untrackedExecutable=execFileSync('git',['ls-files','--others','--exclude-standard','--','src','scripts','client','experiments','package.json','package-lock.json'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
if(untrackedExecutable)throw Error('society_untracked_executable_source');
const privatePath=(path:string)=>{
  const target=resolve(path);
  let ancestor=target;while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)throw Error('society_private_path');ancestor=parent;}
  const resolvedTarget=resolve(realpathSync(ancestor),relative(ancestor,target)),rel=relative(realpathSync(root),resolvedTarget);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('society_private_output_outside_repository_required');
  return target;
};
const bundlePath=privatePath(values.bundle);
interface Bundle {plan:SocietyRunPlan;genesis:Genesis;planSha256:string;postcardConfig?:SocietyPostcardConfig}
if(values.prepare){
  if(existsSync(bundlePath))throw Error('society_bundle_exists');
  const seed=Number(values.seed),ticks=Number(values.ticks);
  if(!Number.isSafeInteger(seed))throw Error('society_seed');
  if(values['postcard-start-ms']!==undefined&&!values['postcard-rate'])throw Error('society_postcard_rate_required');
  if(values['postcard-rate']&&!/^[1-9][0-9]*\/[1-9][0-9]*$/.test(values['postcard-rate']))throw Error('society_postcard_rate');
  const [numerator,denominator]=(values['postcard-rate']??'0/1').split('/').map(Number);
  const postcards:SocietyPostcardConfig|undefined=values['postcard-rate']?{rate:{numerator:numerator!,denominator:denominator!},
    startAtMs:Number(values['postcard-start-ms']??0),dayDurationMs:86_400_000}:undefined;
  const society=new Society({seed,sourceRevision:revision,observerSecret:randomBytes(32).toString('hex'),...(postcards?{postcards}:{})});
  const plan=createSocietyPlan(society,{ticks}),bundle:Bundle={plan,genesis:society.exportTape().genesis,planSha256:societyPlanHash(plan),
    ...(postcards?{postcardConfig:structuredClone(postcards)}:{})};
  const packets=society.pendingPeople().map(person=>{const request=buildSocietyRequest(society.view(person).visible);return {person,requestBytes:Buffer.byteLength(request.body),maxInputTokens:request.maxInputTokens,maxOutputTokens:request.maxOutputTokens};});
  mkdirSync(dirname(bundlePath),{recursive:true});writeFileSync(bundlePath,stringifySocietyEvidence(bundle),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({bundle:bundlePath,planSha256:bundle.planSha256,plan,initialPackets:packets,
    dispatchApproved:false,allowanceCreated:false,providerCalls:0,next:'Review the plan. A later owner approval and a separately authorised allowance carrying the latest actual journal are required.'},null,2));
}else{
  const bundle=parseSocietyEvidence<Bundle>(readFileSync(bundlePath,'utf8'));validateSocietyPlan(bundle.plan);
  if(bundle.genesis.sourceRevision!==revision||bundle.plan.sourceRevision!==revision||societyPlanHash(bundle.plan)!==bundle.planSha256)throw Error('society_bundle_source_or_hash');
  if(digest(bundle.postcardConfig??null)!==digest(bundle.plan.postcards??null))throw Error('society_bundle_postcard_config');
  const society=new Society({seed:bundle.genesis.seed,sourceRevision:revision,config:bundle.genesis.config,observerSecret:bundle.genesis.observerSecret,
    ...(bundle.postcardConfig?{postcards:bundle.postcardConfig}:{})});
  if(society.hash!==bundle.plan.initialHash||digest(society.exportTape().genesis)!==digest(bundle.genesis))throw Error('society_bundle_genesis');
  const packets=society.pendingPeople().map(person=>{const q=buildSocietyRequest(society.view(person).visible);return {person,sha256:q.sha256,bytes:Buffer.byteLength(q.body),maxInputTokens:q.maxInputTokens};});
  if(values.preflight){
    let funding='not_provided';
    if(values.budget){const view=inspectSocietyFunding(readFileSync(join(privatePath(values.budget),'accounting.journal.json')));
      funding=view.authorization?.manifestSha256===bundle.planSha256&&view.requests.length===0&&view.canReserve?'manifest_matches_not_approved':'not_ready';}
    console.log(JSON.stringify({sourceRevision:revision,planSha256:bundle.planSha256,packets,funding,dispatchApproved:false,providerCalls:0,allowanceCreated:false},null,2));
  }else{
    if(!values.budget||!values.credential||!values.approval||!values.output||!values['carried-fingerprint'])throw Error('society_explicit_paid_inputs_required');
    const approvalPath=privatePath(values.approval),credential=privatePath(values.credential),output=privatePath(values.output),budgetPath=privatePath(values.budget);
    const approval=JSON.parse(readFileSync(approvalPath,'utf8')) as {approved:boolean;planSha256:string;instruction:string};
    if(approval.approved!==true||approval.planSha256!==bundle.planSha256||!approval.instruction?.trim())throw Error('society_owner_approval_required');
    if(existsSync(output))throw Error('society_new_paid_output_required');
    const originalBundle=sha256(readFileSync(bundlePath));
    mkdirSync(output,{mode:0o700});const events=openSync(join(output,'events.jsonl'),'wx',0o600);
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    let budget:ExperimentBudget|undefined,summary:Awaited<ReturnType<typeof runAccountedSociety>>|null=null;
    let replay:unknown=null,error:string|null=null;
    const persist=(name:string,value:unknown,codec=false)=>{
      const fd=openSync(join(output,name),'wx',0o600);
      try{writeFileSync(fd,codec?stringifySocietyEvidence(value):JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
    };
    try{
      persist('run-start.json',{sourceRevision:revision,planSha256:bundle.planSha256,requestedTicks:bundle.plan.ticks,
        startedAt:new Date().toISOString(),controlled:bundle.plan.controlled});
      budget=ExperimentBudget.open(budgetPath);
      summary=await runAccountedSociety(society,budget,async (input,signal)=>{
        const call=join(output,'calls',String(input.index).padStart(5,'0'));mkdirSync(call,{recursive:true,mode:0o700});
        const fd=openSync(join(call,'request.json'),'wx',0o600);try{writeFileSync(fd,input.body);fsyncSync(fd);}finally{closeSync(fd);}
        const env=hostProcessEnvironment(process.env);
        for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','NODE_EXTRA_CA_CERTS','NODE_USE_SYSTEM_CA','SSL_CERT_FILE'])if(process.env[key])env[key]=process.env[key];
        let transportError:string|null=null;
        try{await promisify(execFile)(process.execPath,['--use-env-proxy','--import','tsx',join(root,'scripts','society-request-worker.ts'),credential,call,input.sha256],
          {cwd:root,env,signal,timeout:21_000,maxBuffer:4096,windowsHide:true});}
        catch{transportError='society_worker_exit_or_abort';}
        const fdOutcome=openSync(join(call,'transport.json'),'wx',0o600);
        try{writeFileSync(fdOutcome,JSON.stringify({requestId:input.requestId,index:input.index,
          responsePresent:existsSync(join(call,'response.json')),transportError,aborted:signal.aborted})+'\n');fsyncSync(fdOutcome);}finally{closeSync(fdOutcome);}
        if(!existsSync(join(call,'response.json')))throw Error('society_transport_failed_preserve_hold');
        return readFileSync(join(call,'response.json'));
      },{plan:bundle.plan,ownerApproved:true,instruction:approval.instruction,expectedCarriedFingerprint:values['carried-fingerprint'],signal:controller.signal,
        sink:event=>{
          writeFileSync(events,JSON.stringify(JSON.parse(stringifySocietyEvidence(event)))+'\n');fsyncSync(events);
          if(event.kind==='decision'){
            const d=event.data as {person:string;tick:number;phase:string};
            console.log(JSON.stringify({event:'decision_validated',person:d.person,day:d.tick+1,phase:d.phase}));
          }
        }});
    }catch(cause){
      society.halt();error=cause instanceof Error&&/^[A-Za-z0-9_:.-]{1,128}$/.test(cause.message)?cause.message:'society_cli_execution_failed';
    }finally{
      // Evidence finalization also runs after approval/accounting/transport/controller errors.
      // Each write is attempted independently: one failed artifact must not suppress others.
      const errors:string[]=[];
      const attempt=(label:string,operation:()=>void)=>{try{operation();}catch{errors.push(label);society.halt();}};
      const tape=society.exportTape();
      attempt('society_tape_write_failed',()=>persist('society.json',tape,true));
      attempt('society_replay_failed',()=>{replay=verifySocietyTape(tape,revision,{allowPartial:true});});
      let accounting:unknown=null;
      attempt('society_accounting_snapshot_failed',()=>{if(budget){const v=budget.view();accounting={bookedMicroUsd:v.booked.toString(),heldMicroUsd:v.held.toString(),historyHash:v.historyHash,requests:v.requests.length};}});
      attempt('society_summary_write_failed',()=>persist('summary.json',{summary,replay,error,errors,
        sourceRevision:revision,requestedTicks:bundle.plan.ticks,finalTick:society.tick,halted:society.halted,accounting,
        originalBundleUnchanged:sha256(readFileSync(bundlePath))===originalBundle,finishedAt:new Date().toISOString()}));
      process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
      attempt('society_budget_close_failed',()=>budget?.close());
      attempt('society_events_close_failed',()=>{fsyncSync(events);closeSync(events);});
      attempt('society_results_export_failed',()=>{writeSocietyRawResults(readSocietyResults(output),join(output,'results'));});
      // Finalization failures discovered after the primary summary are separate facts.
      attempt('society_finalization_write_failed',()=>persist('finalization.json',{errors,halted:society.halted,
        finishedAt:new Date().toISOString()}));
      console.log(JSON.stringify({summary,replay,error,errors,output},null,2));
      if(summary?.status!=='completed'||error||errors.length)process.exitCode=1;
    }
  }
}
