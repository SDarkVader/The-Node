// OFFLINE ONLY. Real Godot perception/kernel; synthetic provider, counts and accounting.
import { mkdirSync,writeFileSync,realpathSync } from 'node:fs';
import { resolve,dirname,relative,isAbsolute,sep,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { freshPerceptionFixture } from '../test/fixtures/freshPerceptionFixture.js';
import { cleanup } from '../test/fixtures/accountingFixture.js';
import { runFreshPerception,verifyFreshPerception } from '../src/observatory/freshPerception.js';
import { nativePerceptionWorkers } from '../src/observatory/freshReadiness.js';
import { readContinuationLedger } from '../src/eval/continuationLedger.js';
import { ObservatorySource } from '../src/observatory/source.js';
import { evaluateContinuationDiary } from '../src/observatory/diaryEvaluation.js';
const [out] = process.argv.slice(2); if(!out||process.argv.length!==3)throw Error('explicit_offline_output_required');
const directory=resolve(out),inside=relative(realpathSync('.'),realpathSync(dirname(directory)));
if(inside===''||inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside))throw Error('private_rehearsal_outside_checkout_required');
const binary=process.env.NODE_GODOT_BIN;if(!binary)throw Error('actual_godot_required');
mkdirSync(directory,{mode:0o700});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceWorkingTreeClean=!execFileSync('git',['status','--porcelain','--','src','scripts','client','experiments','package.json','package-lock.json'],{encoding:'utf8'}).trim();
const f=await freshPerceptionFixture(20,directory,revision),native=await nativePerceptionWorkers(binary,resolve('client'));
const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
try{
  const summary=await runFreshPerception(f.plan,f.genesis,f.budget,f.sender(),f.ledger,native.workers,revision,f.options);f.ledger.close();
  const events=readContinuationLedger(f.ledger.path),verification=verifyFreshPerception(events);
  const source=new ObservatorySource({id:'TEST-ONLY-fresh-first-person',ledger:f.ledger.path,sourceRevision:revision,journal:join(directory,'TEST-ONLY-fresh-allowance','accounting.journal.json')});
  source.refresh();const snapshot=source.snapshot(null,'TEST-ONLY-observatory-secret',true);
  const evaluations=evaluateContinuationDiary(events,'TEST-ONLY-fresh-first-person');
  if(summary.status!=='completed'||summary.calls!==40||summary.finalTick!==20||!('telemetry'in snapshot)||snapshot.telemetry.executedDecisionCount!==40||
    snapshot.worldHash!==summary.finalWorldHash||evaluations.records.some(r=>r.status!=='not_applicable'))throw Error('fresh_native_rehearsal_failed');
  const controls=f.sent.map(q=>JSON.parse(q.body)),systems=[...new Set(controls.map(q=>q.system))];
  if(systems.length!==1||controls.some(q=>q.output_config.effort!=='high'||q.max_tokens!==2048||JSON.parse(q.messages.at(-1).content[0].text).reasoningInstruction===undefined))throw Error('fresh_native_reasoning_parity');
  write('verification.json',verification);write('diary-evaluations.json',evaluations.records);
  write('inspect-input.json',{snapshot,evidence:source.list().map(p=>({segmentId:p.segmentId,seq:p.seq,eventHash:p.eventHash}))});
  write('registration.json',{runs:[{id:'TEST-ONLY-fresh-first-person',ledger:join(directory,'trace','continuation.ledger.jsonl'),sourceRevision:revision,
    journal:join(directory,'TEST-ONLY-fresh-allowance','accounting.journal.json'),evaluations:join(directory,'diary-evaluations.json')}]});
  const report={mode:'offline_simulated_provider',sourceRevision:revision,sourceWorkingTreeClean,perspective:'first_person',freshGenesis:true,priorModelTurns:0,
    rounds:20,calls:40,independentGodotWorkers:native.stats(),effort:'high',totalOutputCap:2048,uniformReasoningConditions:true,
    explicitInstructionEveryTurn:true,syntheticProvider:true,syntheticTokenCounts:true,syntheticAccounting:true,
    syntheticBookedMicroUsd:summary.bookedMicroUsd,syntheticHeldMicroUsd:summary.heldMicroUsd,replayVerified:verification.verified,
    observatoryTick:snapshot.sourceTick,observatoryWorldHash:snapshot.worldHash,finalWorldHash:summary.finalWorldHash,
    diaryEvaluation:'not_applicable_no_diary_subjects_in_first_person_condition',providerCalls:0,liveEmissionVerified:false};
  write('report.json',report);console.log(JSON.stringify(report,null,2));
}finally{f.ledger.close();f.budget.close();await native.close();cleanup();}
