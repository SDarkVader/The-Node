// Local checks only: no allowance creation/clock, token-count request, provider call or world advance.
// <NEW report.json> [--journal actual-journal --ledger actual-latest-ledger] [--credential-file approved.env]
import { readFileSync,writeFileSync,lstatSync,realpathSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../src/agent/accountingStore.js';
import { usageCost } from '../src/agent/accountingLedger.js';
import { PRICED_MODELS } from '../src/agent/modelPricing.js';
import { readContinuationLedger } from '../src/eval/continuationLedger.js';
import { freshPerceptionGenesis,setupFreshPerception,validateFreshPerceptionPlan,freshPerceptionPlanHash,type FreshPerceptionPlan } from '../src/observatory/freshPerception.js';
import { nativePerceptionWorkers,inspectFreshFunding } from '../src/observatory/freshReadiness.js';
import { perceptionRequest } from '../src/observatory/perception.js';
import { auditPerception } from '../src/observatory/perceptionAudit.js';
import { buildPerceptionAgentInput,perceptionDecisionContext } from '../src/observatory/perceptionContext.js';
import { DELIBERATION_TURN } from '../src/eval/continuationReasoning.js';
const [out,...args]=process.argv.slice(2);if(!out||args.length%2)throw Error('explicit_readiness_arguments_required');
const flags=new Map<string,string>();for(let i=0;i<args.length;i+=2){if(!['--journal','--ledger','--credential-file'].includes(args[i]!)||flags.has(args[i]!))throw Error('readiness_flags');flags.set(args[i]!,args[i+1]!);}
const plan=JSON.parse(readFileSync(new URL('../experiments/two-baker-first-person-reasoning-20-ticks.json',import.meta.url),'utf8')) as FreshPerceptionPlan;validateFreshPerceptionPlan(plan);
if(plan.ticks!==20||plan.maxCalls!==40||plan.actors.length!==2)throw Error('fresh_twenty_tick_plan_required');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceClean=!execFileSync('git',['status','--porcelain','--','src','scripts','client','experiments','package.json','package-lock.json'],{encoding:'utf8'}).trim();
let funding:ReturnType<typeof inspectFreshFunding>|{status:string}={status:'actual_journal_not_provided'};
if(flags.has('--journal')!==flags.has('--ledger'))throw Error('actual_journal_and_latest_ledger_required_together');
if(flags.has('--journal')){
  const path=resolve(flags.get('--journal')!),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('readiness_journal_bounds');
  funding=inspectFreshFunding(readFileSync(path),readContinuationLedger(resolve(flags.get('--ledger')!)));
}
let credential='not_configured';
if(flags.has('--credential-file')){
  const path=resolve(flags.get('--credential-file')!),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384||realpathSync(dirname(path))!==dirname(path)||
    process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))throw Error('readiness_credential_permissions');
  const lines=readFileSync(path,'utf8').split(/\r?\n/).filter(s=>/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=/.test(s));
  let value=lines.length===1?lines[0]!.slice(lines[0]!.indexOf('=')+1).trim():'';
  if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  credential=value.length<=512&&/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(value)?'private_file_format_valid_network_not_tested':'invalid_format';value='';
}
const binary=process.env.NODE_GODOT_BIN;if(!binary)throw Error('actual_godot_required');
const native=await nativePerceptionWorkers(binary,resolve('client'));const requests=[];
try{
  const setup=setupFreshPerception(plan,freshPerceptionGenesis(plan,revision,randomBytes(32).toString('hex')));
  for(const view of setup.host.views()){
    const person=setup.host.identities().find(p=>p.actorId===view.actorId)!.person;
    const req=perceptionRequest(setup.mirror,{agentId:view.actorId,person},'first_person',plan.condition,{episodeId:plan.id,worldHash:setup.host.hash});
    const {record,audit}=await auditPerception(req,...native.workers),input=buildPerceptionAgentInput(req,record,view.observation);
    const wire=setup.histories.prepare(view.actorId,input,perceptionDecisionContext(view.observation.context),plan.model),q=JSON.parse(wire.body),turn=JSON.parse(q.messages[0].content[0].text);
    if(q.messages.length!==1||q.output_config.effort!=='high'||q.max_tokens!==2048||turn.reasoningInstruction!==DELIBERATION_TURN||turn.conditionTransition||turn.observation)throw Error('fresh_first_person_reasoning_conditions');
    requests.push({actorId:view.actorId,priorModelTurns:0,systemSha256:sha256(q.system),requestBytes:Buffer.byteLength(wire.body),maxInputTokens:wire.maxInputTokens,workerAgreement:audit.status,engine:record.engine});
  }
}finally{await native.close();}
if(new Set(requests.map(r=>r.systemSha256)).size!==1)throw Error('reasoning_system_asymmetry');
const perRequest=usageCost(100000,2048,PRICED_MODELS[plan.model]!),ceiling=perRequest*40;
if(ceiling>plan.allowance.limitMicroUsd||perRequest>plan.allowance.perRequestMicroUsd)throw Error('reasoning_budget_bound');
const report={schema:'node-first-person-test-readiness-v1',sourceRevision:revision,sourceWorkingTreeClean:sourceClean,planSha256:freshPerceptionPlanHash(plan),
  startsFrom:'fresh_genesis_no_parent_no_prior_model_context',perspective:'first_person',perceptionFoundationPr:40,perceptionRuntimePr:41,
  rounds:20,maximumPaidCalls:40,maximumFreeCounts:40,deadlineMs:plan.deadlineMs,displayRounds:'1–20 (canonical source ticks 0–19)',condition:plan.condition,
  reasoningProfile:plan.reasoningProfile,effort:'high',thinking:{type:'adaptive',display:'summarized'},hardTotalOutputTokenCap:2048,
  fixedThinkingTokenBudget:'unsupported_by_Haiku_5_5',emissionOnEveryTurnGuaranteed:false,requests,
  allowanceProposal:{...plan.allowance,maximumBookedFromRequestBoundsMicroUsd:ceiling,maximumPerRequestBookedMicroUsd:perRequest,created:false,clockStarted:false},
  credential,funding,readyForOwnerApproval:sourceClean&&credential.startsWith('private_file_format_valid')&&funding.status==='verified_closed_prior_can_be_carried_after_approval',
  ownerApproval:'pending_required',dispatchApproved:false,providerCalls:0,kernelTransitions:0};
writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
