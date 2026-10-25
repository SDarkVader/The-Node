/** Explicitly synthetic, offline rehearsal. Real kernel, sealed checkpoint, restart.
 * Never calls a provider or creates a real financial authorization. */
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { continuationPlan, continuationGenesis, continuationBudget, simulatedContinuationProvider } from '../test/fixtures/continuationFixture.js';
import { cleanup } from '../test/fixtures/accountingFixture.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { runContinuation } from '../src/eval/continuationRunner.js';
import { ContinuationLedger, readContinuationLedger, verifyContinuation, continuationInspectSamples } from '../src/eval/continuationLedger.js';
import { ObservatorySource, points } from '../src/observatory/source.js';
const [output, mode] = process.argv.slice(2);
if (!output || process.argv.length > 4 || mode !== undefined && mode !== '--quick') throw Error('usage_demo_NEW_private_directory_optional_quick');
const directory = resolve(output), checkout = realpathSync('.'), inside = relative(checkout, realpathSync(dirname(directory)));
if (inside === '' || inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside)) throw Error('demo_output_must_be_outside_checkout');
mkdirSync(directory, {mode:0o700});
const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const fixturePlan=continuationPlan(mode === '--quick' ? 14 : 140);
const plan={...fixturePlan,maxRequestBytes:95000,
  allowance:{...fixturePlan.allowance,limitMicroUsd:1000000,perRequestMicroUsd:30000}}, allowance=join(directory,'TEST-ONLY-allowance');
let budget=continuationBudget(plan,allowance);
write('plan.json',plan);
const genesis=continuationGenesis(revision);
const first=new ContinuationLedger(join(directory,'stage-one'));
try {
  const one=simulatedContinuationProvider({redacted:true,exerciseMechanics:true});
  await runContinuation(plan,genesis,budget,one.send,first,{sourceRevision:revision,mode:'offline_simulated_provider',stopAtTick:1});
  first.close();budget.close();
  const parent=readContinuationLedger(first.path);
  const preflight=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/continuation-preflight.ts',
    join(directory,'plan.json'),join(allowance,'accounting.journal.json'),first.path],{encoding:'utf8'}));
  if(!preflight.parentVerified||!preflight.canReserve||preflight.dispatches!==0)throw Error('synthetic_preflight_failed');
  write('preflight-before-resume.json',preflight);
  budget=ExperimentBudget.open(allowance);
  const second=new ContinuationLedger(join(directory,'stage-two'));
  try {
    const two=simulatedContinuationProvider({redacted:true,exerciseMechanics:true});
    const summary=await runContinuation(plan,genesis,budget,two.send,second,{sourceRevision:revision,mode:'offline_simulated_provider',parent});
    second.close();budget.close();
    const events=readContinuationLedger(second.path),verification=verifyContinuation(events,revision);
    if(summary.status!=='completed') throw Error('synthetic_rehearsal_incomplete_preserve_evidence');
    write('verification.json',verification);
    const all=[...continuationInspectSamples(parent,revision),...continuationInspectSamples(events,revision)];
    write('inspect-samples.jsonl',all.map(s=>JSON.stringify(s)).join('\n')+'\n');
    write('registration.json',{host:'127.0.0.1',port:8090,runs:[{id:'synthetic-rehearsal',ledger:'stage-two/continuation.ledger.jsonl',sourceRevision:revision,
      journal:'TEST-ONLY-allowance/accounting.journal.json',evaluations:'evaluations.json'}]});
    const source=new ObservatorySource({id:'synthetic-rehearsal',ledger:second.path,sourceRevision:revision});source.refresh();
    write('evaluation-input.json',{snapshot:source.snapshot(null,'evaluation-private',true),evidence:points(events).map(p=>({segmentId:p.segmentId,seq:p.event.seq,eventHash:p.event.hash}))});
    write('evaluations.json',[]);
    console.log(JSON.stringify({mode:'offline_simulated_provider',actors:plan.actors.map(a=>a.actorId),...summary,
      callsAcrossSegments:one.requests.length+two.requests.length,replayed:verification.verified,providerCalls:0,preflightCanResume:preflight.canReserve,
      preservedParentSha256:(await import('../src/agent/accountingStore.js')).sha256(readFileSync(first.path))},null,2));
  } finally {second.close();}
} finally {first.close();budget.close();cleanup();}
