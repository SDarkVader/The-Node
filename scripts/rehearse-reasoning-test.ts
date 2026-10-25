// Explicitly OFFLINE: synthetic provider and synthetic accounting, actual 20-tick shared world.
import{readFileSync,mkdirSync,writeFileSync,realpathSync}from'node:fs';
import{resolve,dirname,relative,isAbsolute,sep,join}from'node:path';
import{execFileSync}from'node:child_process';
import{continuationBudget,continuationGenesis,simulatedContinuationProvider}from'../test/fixtures/continuationFixture.js';
import{cleanup}from'../test/fixtures/accountingFixture.js';
import{runContinuation,type ContinuationPlan}from'../src/eval/continuationRunner.js';
import{ContinuationLedger,readContinuationLedger,verifyContinuation}from'../src/eval/continuationLedger.js';
import{auditContinuationReasoning}from'../src/eval/reasoningAudit.js';
const[output]=process.argv.slice(2);if(!output||process.argv.length!==3)throw Error('explicit_offline_output_required');
const directory=resolve(output),checkout=realpathSync('.'),inside=relative(checkout,realpathSync(dirname(directory)));
if(inside===''||inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside))throw Error('private_rehearsal_outside_checkout_required');
mkdirSync(directory,{mode:0o700});
const declared=JSON.parse(readFileSync(new URL('../experiments/two-baker-reasoning-20-ticks.json',import.meta.url),'utf8')) as ContinuationPlan;
const plan={...declared,id:'TEST-ONLY-'+declared.id,minIntervalMs:0,deadlineMs:2000};
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const budget=continuationBudget(plan,join(directory,'TEST-ONLY-allowance')),ledger=new ContinuationLedger(join(directory,'trace'));
const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
try{
  const provider=simulatedContinuationProvider(),summary=await runContinuation(plan,continuationGenesis(sourceRevision),budget,provider.send,ledger,{sourceRevision,mode:'offline_simulated_provider'});
  ledger.close();const events=readContinuationLedger(ledger.path),verification=verifyContinuation(events,sourceRevision),audit=auditContinuationReasoning(events);
  if(summary.status!=='completed'||summary.calls!==40||summary.ticks!==20||!audit.ticks.every(t=>t.uniformReasoningConditions)||!audit.actors.every(a=>a.explicitInstructionOnEveryRequest))throw Error('offline_reasoning_rehearsal_failed');
  write('verification.json',verification);write('reasoning-audit.json',audit);
  const report={mode:'offline_simulated_provider',sourceRevision,rounds:20,calls:40,actors:audit.actors.map(a=>({actorId:a.actorId,requests:a.requests,explicitInstructionOnEveryRequest:a.explicitInstructionOnEveryRequest})),
    identicalReasoningConditionsEveryRound:true,effort:'high',totalOutputCap:2048,syntheticAccounting:true,syntheticBookedMicroUsd:summary.bookedMicroUsd,
    syntheticHeldMicroUsd:summary.heldMicroUsd,replayVerified:verification.verified,finalWorldHash:verification.finalStateHash,providerCalls:0,liveEmissionVerified:false};
  write('report.json',report);console.log(JSON.stringify(report,null,2));
}finally{ledger.close();budget.close();cleanup();}
