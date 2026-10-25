// <runtime> <latest ledger, money reference only> <latest journal> <NEW private output>
// <approved credential> <owner instruction> --preflight-only|--owner-approved-fresh-20-ticks
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,join,dirname,basename,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const args=process.argv.slice(2),mode=args[6];
if(args.length!==7||!['--preflight-only','--owner-approved-fresh-20-ticks'].includes(mode))throw Error('fresh_first_person_explicit_mode_required');
const [runtime,latestLedger,journalPath,directory,keyPath,instructionPath]=args.slice(0,6).map(p=>resolve(p));
const ownerApproved=mode==='--owner-approved-fresh-20-ticks';
const checkout=realpathSync(fileURLToPath(new URL('..',import.meta.url))),inside=relative(checkout,realpathSync(dirname(directory)));
if(inside===''||inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside)||existsSync(directory))throw Error('new_private_output_outside_checkout_required');
if(basename(journalPath)!=='accounting.journal.json')throw Error('actual_journal_filename_required');
const load=file=>import(pathToFileURL(join(runtime,file)).href);
const {runFreshPerception,verifyFreshPerception,freshPerceptionGenesis,setupFreshPerception,validateFreshPerceptionPlan,freshPerceptionPlanHash}=await load('observatory/freshPerception.js');
const {nativePerceptionWorkers,inspectFreshFunding}=await load('observatory/freshReadiness.js');
const {readContinuationLedger,ContinuationLedger}=await load('eval/continuationLedger.js');
const {ExperimentBudget}=await load('agent/experimentBudget.js');
const {PRICED_MODELS}=await load('agent/modelPricing.js');
const {sha256}=await load('agent/accountingStore.js');
if(sha256(readFileSync(fileURLToPath(import.meta.url)))!==sha256(readFileSync(join(runtime,'scripts','run-fresh-first-person-test.mjs'))))throw Error('fresh_cli_runtime_revision_mismatch');
const {hostProcessEnvironment}=await load('agent/isolatedHost.js');
const {perceptionRequest}=await load('observatory/perception.js');
const {auditPerception}=await load('observatory/perceptionAudit.js');
const {buildPerceptionAgentInput,perceptionDecisionContext}=await load('observatory/perceptionContext.js');
const {DELIBERATION_TURN}=await load('eval/continuationReasoning.js');
const plan=JSON.parse(readFileSync(join(runtime,'experiments','two-baker-first-person-reasoning-20-ticks.json'),'utf8'));validateFreshPerceptionPlan(plan);
if(plan.ticks!==20||plan.maxCalls!==40||plan.actors.length!==2)throw Error('fresh_twenty_tick_plan_required');
const revision=readFileSync(join(runtime,'REVISION'),'utf8').trim();if(!/^[a-f0-9]{40}$/.test(revision))throw Error('committed_runtime_revision_required');
const originalLedger=readFileSync(latestLedger),originalJournal=readFileSync(journalPath);
const funding=inspectFreshFunding(originalJournal,readContinuationLedger(latestLedger));
if(funding.status!=='verified_closed_prior_can_be_carried_after_approval')throw Error('actual_funding_not_ready');
const instruction=ownerApproved?readFileSync(instructionPath,'utf8').trim():'';
if(ownerApproved&&(!instruction||instruction.length>8192))throw Error('owner_instruction_required');
const binary=process.env.NODE_GODOT_BIN;if(!binary)throw Error('actual_godot_required');
const genesis=freshPerceptionGenesis(plan,revision,randomBytes(32).toString('hex'));
mkdirSync(directory,{mode:0o700});const native=await nativePerceptionWorkers(binary,join(runtime,'client'));
const write=(name,value)=>{const fd=openSync(join(directory,name),'wx',0o600);try{writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
const report={sourceRevision:revision,observationCondition:'first_person',freshGenesis:true,priorModelTurns:0,ownerApproved,allowanceActivated:false,
  paidDispatches:0,freeTokenCountRequests:0,preflight:null,summary:null,verification:null,error:null,originalSourcesUnchanged:null};
let budget,ledger;
try{
  const setup=setupFreshPerception(plan,genesis),requests=[];
  for(const view of setup.host.views()){
    const person=setup.host.identities().find(p=>p.actorId===view.actorId).person;
    const req=perceptionRequest(setup.mirror,{agentId:view.actorId,person},'first_person',plan.condition,{episodeId:plan.id,worldHash:setup.host.hash});
    const {record,audit}=await auditPerception(req,...native.workers),input=buildPerceptionAgentInput(req,record,view.observation);
    const wire=setup.histories.prepare(view.actorId,input,perceptionDecisionContext(view.observation.context),plan.model),q=JSON.parse(wire.body);
    if(q.messages.length!==1||q.output_config.effort!=='high'||q.max_tokens!==2048||JSON.parse(q.messages[0].content[0].text).reasoningInstruction!==DELIBERATION_TURN)throw Error('compiled_fresh_reasoning_conditions');
    requests.push({actorId:view.actorId,systemSha256:sha256(q.system),requestBytes:Buffer.byteLength(wire.body),workerAgreement:audit.status});
  }
  if(new Set(requests.map(q=>q.systemSha256)).size!==1)throw Error('compiled_reasoning_asymmetry');
  report.preflight={startTick:0,targetTick:20,requests,funding,allowanceCreated:false,clockStarted:false};write('preflight.json',report.preflight);
  if(ownerApproved){
    budget=ExperimentBudget.carryFromExperiment(join(directory,'allowance'),dirname(journalPath));const now=Date.now();
    budget.authorize({runId:plan.id+'-'+sha256(directory+now).slice(0,12),authorizedAt:new Date(now).toISOString(),expiresAt:new Date(now+plan.allowance.windowHours*3600000).toISOString(),
      expectedCarriedFingerprint:funding.historyHash,instruction,scope:'accounted_experiment_spending_only',manifestSha256:freshPerceptionPlanHash(plan),model:plan.model,
      maxRequests:40,limitMicroUsd:plan.allowance.limitMicroUsd,perRequestMicroUsd:plan.allowance.perRequestMicroUsd,prices:PRICED_MODELS[plan.model]});
    report.allowanceActivated=true;
    mkdirSync(join(directory,'calls'),{mode:0o700});mkdirSync(join(directory,'counts'),{mode:0o700});
    const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
    const dispatch=async(endpoint,input,signal)=>{
      if(endpoint==='messages'&&report.paidDispatches>=40||endpoint==='count_tokens'&&report.freeTokenCountRequests>=40)throw Error('fresh_call_limit');
      const call=join(directory,endpoint==='messages'?'calls':'counts',String(input.index).padStart(5,'0'));mkdirSync(call,{mode:0o700});
      writeFileSync(join(call,'request.json'),input.body,{flag:'wx',mode:0o600});
      writeFileSync(join(call,'attempt.json'),JSON.stringify({requestId:input.requestId,actorId:input.actorId,tick:input.tick,sha256:input.sha256,noRetry:true}),{flag:'wx',mode:0o600});
      if(endpoint==='messages')report.paidDispatches++;else report.freeTokenCountRequests++;
      const env=hostProcessEnvironment(process.env);
      for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','NODE_USE_SYSTEM_CA','SSL_CERT_FILE'])if(process.env[name])env[name]=process.env[name];
      await promisify(execFile)(process.execPath,[join(runtime,'scripts','anthropic-perception-request.mjs'),keyPath,call,String(plan.maxRequestBytes),endpoint],{env,windowsHide:true,signal,timeout:25000,maxBuffer:8192});
      if(!existsSync(join(call,'response.json')))throw Error('provider_response_failed');return readFileSync(join(call,'response.json'));
    };
    ledger=new ContinuationLedger(join(directory,'trace'));
    try{report.summary=await runFreshPerception(plan,genesis,budget,(input,signal)=>dispatch('messages',input,signal),ledger,native.workers,revision,
      {expectedCarriedFingerprint:funding.historyHash,signal:controller.signal,countTokens:(input,signal)=>dispatch('count_tokens',input,signal)});}
    finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
    ledger.close();report.verification=verifyFreshPerception(readContinuationLedger(ledger.path));
    const v=budget.view();if(v.historyHash!==report.summary.budgetHistoryHash||String(v.booked)!==report.summary.bookedMicroUsd||String(v.held)!==report.summary.heldMicroUsd)throw Error('fresh_journal_binding');
    write('registration.json',{runs:[{id:plan.id,ledger:ledger.path,sourceRevision:revision,journal:join(directory,'allowance','accounting.journal.json')}]});
  }
}catch(error){report.error=/^[a-z_]{1,100}$/.test(error?.message)?error.message:'run_failed_preserve_evidence_do_not_retry';}
finally{
  ledger?.close();budget?.close();await native.close();
  report.originalSourcesUnchanged=sha256(readFileSync(latestLedger))===sha256(originalLedger)&&sha256(readFileSync(journalPath))===sha256(originalJournal);write('report.json',report);
}
console.log(JSON.stringify(report,null,2));
if(report.error||!report.originalSourcesUnchanged||ownerApproved&&report.summary?.status!=='completed')process.exitCode=1;
