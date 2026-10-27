/** Real production observation/transport/parser/kernel/replay paths with a local synthetic
 * response producer. No credentials, allowance, provider connection or paid tests. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyAction} from '../src/society/boundary.js';
import {validateSocietyWire} from './society-request-worker.js';
import {parseAnthropicResponse} from '../src/agent/anthropicResponse.js';
import {usageCost} from '../src/agent/accountingLedger.js';
import {PRICED_MODELS} from '../src/agent/modelPricing.js';
import {buildSocietyResultsReport,writeSocietyRawResults} from '../src/society/report.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {digest} from '../src/agent/replay.js';
const {values}=parseArgs({options:{output:{type:'string'},ticks:{type:'string',default:'3'},seed:{type:'string',default:'42'}}});
if(!values.output)throw Error('operational_proof_fresh_output_required');
const output=resolve(values.output),ticks=Number(values.ticks),seed=Number(values.seed);
if(existsSync(output)||!Number.isSafeInteger(ticks)||ticks<1||ticks>20||!Number.isSafeInteger(seed))throw Error('operational_proof_arguments');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8',windowsHide:true}).trim())throw Error('operational_proof_requires_committed_source');
const s=new Society({seed,sourceRevision:head,config:societyConfig(),routine:{maxTurnsPerDay:128,information:'inhabitant-v1'},
  postcards:{rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000},
  dailyOracle:JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8'))});
mkdirSync(output,{recursive:true});
const events:any[]=[],all:any[]=[],roles=new Set<string>();let index=0,maxCeiling=0;
while(s.tick<ticks){
  if(s.halted)throw Error(s.stoppedReason!);
  for(const person of s.pendingPeople()){
    const view=s.view(person),wire=buildSocietyRequest(view.visible);
    validateSocietyWire(Buffer.from(wire.body),wire.sha256);
    const received=JSON.parse(JSON.parse(wire.body).messages[0].content[0].text);
    if(digest(received)!==digest(view.visible))throw Error('operational_proof_observation_mismatch');
    const action=autonomousPolicy(received),requestId='synthetic-'+all.length;
    const response=Buffer.from(JSON.stringify({type:'message',id:'msg_'+requestId,role:'assistant',model:wire.model,stop_reason:'end_turn',
      content:[{type:'text',text:JSON.stringify(action)}],usage:{input_tokens:0,output_tokens:0}}));
    const parsed=parseAnthropicResponse(response,requestId);
    if(!parsed.actionable)throw Error('operational_proof_response_rejected');
    const admitted=validateSocietyAction(parsed.decision,view.context),beforeHash=s.hash;
    const binding={requestId,index,actorId:person,person,tick:s.tick,phase:s.phase,turn:s.turn};
    const controlled=s.controlled.includes(person);
    if(controlled){
      events.push({kind:'request',data:{...binding,body:wire.body,sha256:wire.sha256}},
        {kind:'response',data:{...binding,rawBase64:response.toString('base64'),parsed,synthetic:true}},
        {kind:'decision',data:{...binding,status:'validated',action:admitted}});index++;
      maxCeiling=Math.max(maxCeiling,usageCost(wire.maxInputTokens,wire.maxOutputTokens,PRICED_MODELS[wire.model]!));
    }
    s.submit(person,admitted);roles.add(received.self.role);
    all.push({person,controlled,day:received.day,phase:received.phase,turn:binding.turn,requestBody:wire.body,
      responseBody:response.toString('utf8'),admitted,beforeHash,afterHash:s.hash});
  }
}
const tape=s.exportTape(),replay=verifySocietyTape(tape,head);
const eventsText=events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')+'\n';
const report=buildSocietyResultsReport({tape,eventsText});
if(report.integrityIssues.length)throw Error('operational_proof_report_conflict');
writeFileSync(join(output,'society.json'),stringifySocietyEvidence(tape),{flag:'wx'});
writeFileSync(join(output,'events.jsonl'),eventsText,{flag:'wx'});
writeFileSync(join(output,'inhabitant-transports.json'),JSON.stringify({synthetic:true,providerCalls:0,records:all}),{flag:'wx'});
writeSocietyRawResults(report,join(output,'results'));
writeFileSync(join(output,'history-registration.json'),JSON.stringify({runs:[{kind:'society',id:'operational-proof',mode:'synthetic',directory:output}]}),{flag:'wx'});
const summary={sourceRevision:head,synthetic:true,providerCalls:0,...replay,roles:[...roles].sort(),controlledRequests:index,
  maxConservativeRequestMicroUsd:maxCeiling,withinExistingRequestCeiling:maxCeiling<=20000,
  movements:tape.transitions.flatMap(t=>t.effects).filter(e=>e.category==='move').length,
  diaryWrites:tape.transitions.flatMap(t=>t.effects).filter(e=>e.category==='diary').length,
  foodReceipts:tape.transitions.flatMap(t=>(t.economy as any).receipts).length,
  maxAccountingResidual:Math.max(...tape.transitions.map(t=>Math.abs(t.accounting.residual))),integrityIssues:report.integrityIssues.length};
writeFileSync(join(output,'proof.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,...summary},null,2));
if(!summary.withinExistingRequestCeiling)process.exitCode=1;
