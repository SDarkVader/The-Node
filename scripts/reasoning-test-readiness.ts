// Local readiness only. Does not create an allowance, start its clock or contact a provider.
// Args: <NEW private report.json> [--journal actual-journal] [--credential-file approved.env]
import { readFileSync,writeFileSync,lstatSync,realpathSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { usageCost } from '../src/agent/accountingLedger.js';
import { PRICED_MODELS } from '../src/agent/modelPricing.js';
import { ContinuationHost } from '../src/eval/continuationHost.js';
import { ContinuationConversations } from '../src/eval/continuationConversation.js';
import { fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { validateContinuationPlan,continuationPlanHash,type ContinuationPlan } from '../src/eval/continuationRunner.js';
import { PER_TURN_DELIBERATION_V1,DELIBERATION_SYSTEM,DELIBERATION_TURN } from '../src/eval/continuationReasoning.js';
const [output,...args]=process.argv.slice(2);
if(!output||args.length%2)throw Error('explicit_readiness_arguments_required');
const flags=new Map<string,string>();for(let i=0;i<args.length;i+=2){if(!['--journal','--credential-file'].includes(args[i]!)||flags.has(args[i]!))throw Error('readiness_flags');flags.set(args[i]!,args[i+1]!);}
const plan=JSON.parse(readFileSync(new URL('../experiments/two-baker-reasoning-20-ticks.json',import.meta.url),'utf8')) as ContinuationPlan;validateContinuationPlan(plan);
if(plan.maxTicks!==20||plan.maxCalls!==40||plan.actors.length!==2||plan.reasoningProfile!==PER_TURN_DELIBERATION_V1)throw Error('fresh_reasoning_test_configuration');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceDirty=execFileSync('git',['status','--porcelain','--','src','scripts','experiments','package.json','package-lock.json'],{encoding:'utf8'}).trim().length>0;
const genesis={...fixtureGenesis(plan.seed,JSON.parse(JSON.stringify({...DEFAULT_WORLD_CONFIG,recognition:'v2'}))),sourceRevision:revision};
const host=new ContinuationHost(genesis,plan.actors),conversations=new ContinuationConversations(plan.maxRequestBytes,plan.reasoningProfile);
const requests=host.views().map(v=>JSON.parse(conversations.prepare(v.actorId,v.observation,plan.model).body));
const systems=[...new Set(requests.map(q=>sha256(q.system)))];
if(systems.length!==1||requests.some(q=>q.output_config.effort!=='high'||q.max_tokens!==2048||!q.system.includes(DELIBERATION_SYSTEM)||JSON.parse(q.messages[0].content[0].text).reasoningInstruction!==DELIBERATION_TURN))throw Error('reasoning_conditions_not_uniform');
const prices=PRICED_MODELS[plan.model]!,perRequest=usageCost(plan.maxRequestBytes!+4096,2048,prices),maximumBooked=perRequest*40;
if(maximumBooked>plan.allowance.limitMicroUsd||perRequest>plan.allowance.perRequestMicroUsd)throw Error('reasoning_budget_bound');
let funding:{status:string;bookedMicroUsd?:string;heldMicroUsd?:string;historyHash?:string;carried?:unknown}={status:'actual_journal_not_provided'};
if(flags.has('--journal')){
  const path=resolve(flags.get('--journal')!),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('readiness_journal_bounds');
  const envelope=JSON.parse(readFileSync(path,'utf8'));if(envelope.format!=='node-accounting-journal-v1'||sha256(envelope.payload)!==envelope.sha256)throw Error('readiness_journal_checksum');
  const v=ExperimentBudget.inspect(JSON.parse(envelope.payload)),closed=v.authorization&&(Date.now()>=Date.parse(v.authorization.expiresAt)||v.requests.length>=v.authorization.maxRequests);
  funding={status:v.held!==0n?'outstanding_holds':v.overrun?'prior_overrun':closed?'verified_closed_prior_can_be_carried_after_approval':'current_grant_not_closed',bookedMicroUsd:v.booked.toString(),heldMicroUsd:v.held.toString(),historyHash:v.historyHash,carried:v.carried};
}
let credential='not_configured';
if(flags.has('--credential-file')){
  const path=resolve(flags.get('--credential-file')!),stat=lstatSync(path);
  // Known approved file only; no value or error text is returned. Does not test network auth.
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384||realpathSync(dirname(path))!==dirname(path)||
    process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))throw Error('readiness_credential_permissions');
  const lines=readFileSync(path,'utf8').split(/\r?\n/).filter(s=>/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=/.test(s));
  let value=lines.length===1?lines[0]!.slice(lines[0]!.indexOf('=')+1).trim():'';
  if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  credential=value.length<=512&&/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(value)?'private_file_format_valid_network_not_tested':'invalid_format';value='';
}
const report={schema:'node-reasoning-test-readiness-v1',sourceRevision:revision,sourceWorkingTreeClean:!sourceDirty,planSha256:continuationPlanHash(plan),
  startsFrom:'fresh_genesis_no_parent_no_prior_model_context',rounds:20,actors:plan.actors,maximumCalls:40,displayRounds:'1–20 (canonical source ticks 0–19)',
  reasoningProfile:plan.reasoningProfile,effort:'high',thinking:{type:'adaptive',display:'summarized'},systemSha256:systems[0],
  explicitSystemInstruction:DELIBERATION_SYSTEM,explicitInstructionOnEveryTurn:DELIBERATION_TURN,
  fixedThinkingTokenBudget:'unsupported_by_Haiku_5_5',hardTotalOutputTokenCap:2048,emissionOnEveryTurnGuaranteed:false,
  allowanceProposal:{...plan.allowance,maximumBookedFromRequestBoundsMicroUsd:maximumBooked,maximumPerRequestBookedMicroUsd:perRequest,clockStarted:false,created:false},
  credential,funding,readyForOwnerApproval:!sourceDirty&&credential.startsWith('private_file_format_valid')&&funding.status==='verified_closed_prior_can_be_carried_after_approval',
  ownerApproval:'pending_required',dispatchApproved:false,providerCalls:0,kernelTransitions:0};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
