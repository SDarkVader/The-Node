// Explicit paid entry point for the distinct first-person condition. No retries or old-journal edits.
// <compiled src runtime> <parent ledger> <prior allowance> <NEW output> <approved env>
// <plan.json> <owner instruction.txt> --preflight-only|--dispatch-owner-authorized
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, fsyncSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPowerShell7 } from './pwsh-preflight.mjs';
import { assertLegacyLiveDispatchClosed } from './legacy-live-gate.mjs';
const args = process.argv.slice(2);
if (args.length !== 8 || !['--preflight-only', '--dispatch-owner-authorized'].includes(args[7])) throw Error('perception_cli_authorization_required');
if (args[7] !== '--preflight-only') assertLegacyLiveDispatchClosed();
const [runtime, parentPath, priorPath, directory, keyPath, planPath, instructionPath] = args.slice(0,7).map(p => resolve(p));
const preflightOnly = args[7] === '--preflight-only';
const checkout = realpathSync(fileURLToPath(new URL('..', import.meta.url))), inside = relative(checkout, realpathSync(resolve(directory, '..')));
if (inside === '' || inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside)) throw Error('perception_private_output_required');
if (existsSync(directory)) throw Error('perception_new_output_required');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { runPerceptionContinuation, verifyPerceptionContinuation, perceptionPlanHash, validatePerceptionPlan, PerceptionConversations } = await load('observatory/perceptionContinuation.js');
const { readContinuationLedger, recoverContinuation, ContinuationLedger } = await load('eval/continuationLedger.js');
const { ContinuationHost } = await load('eval/continuationHost.js');
const { replay, evidenceHash } = await load('agent/replay.js');
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { authorizedPrices } = await load('agent/modelPricing.js');
const { sha256 } = await load('agent/accountingStore.js');
const { hostProcessEnvironment } = await load('agent/isolatedHost.js');
const { startPerceptionBridge, launchPerceptionWorker } = await load('observatory/perceptionBridge.js');
const { auditPerception } = await load('observatory/perceptionAudit.js');
const { perceptionRequest } = await load('observatory/perception.js');
const { buildPerceptionAgentInput, perceptionDecisionContext } = await load('observatory/perceptionContext.js');
const plan = JSON.parse(readFileSync(planPath,'utf8')); validatePerceptionPlan(plan);
const instruction = readFileSync(instructionPath,'utf8').trim();
if (!instruction || instruction.length > 8192) throw Error('owner_instruction_required');
const sourceRevision = readFileSync(join(runtime,'REVISION'),'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw Error('runtime_revision_required');
const binary = process.env.NODE_GODOT_BIN; if (!binary) throw Error('perception_godot_required');
assertPowerShell7(hostProcessEnvironment(process.env));
const parentBytes = readFileSync(parentPath), oldJournal = readFileSync(join(priorPath,'accounting.journal.json'));
const parentEvents = readContinuationLedger(parentPath), parent = recoverContinuation(parentEvents,parentEvents[0].data.sourceRevision);
const prior = ExperimentBudget.open(priorPath); let priorView, prices;
try { priorView = prior.view(); prices = authorizedPrices(plan.model, prior.carriedPrices()); } finally { prior.close(); }
if (!parent.recovery.resumable || priorView.historyHash !== parent.recovery.budgetHistoryHash || priorView.held !== 0n || priorView.overrun || !prices) throw Error('perception_prior_binding');
if (parent.recovery.plan.actors.length * plan.ticks !== plan.maxCalls) throw Error('perception_call_tick_count');
mkdirSync(directory, {mode:0o700});
const write = (name,value) => { const fd=openSync(join(directory,name),'wx',0o600); try { writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'); fsyncSync(fd); } finally { closeSync(fd); } };
const bridges=[], processes=[], workers=[]; let budget, ledger;
const report = { sourceRevision, preflightOnly, paidDispatches:0, freeTokenCountRequests:0, preflight:null, summary:null, verification:null, error:null, originalSourcesUnchanged:null };
try {
  for(let i=0;i<2;i++) {
    const bridge=await startPerceptionBridge({timeoutMs:15000}); bridges.push(bridge);
    const worker=launchPerceptionWorker(binary,bridge,join(runtime,'..','client')); processes.push(worker);
    await bridge.ready(20000); workers.push({workerId:`godot-process-${i+1}`,perceive:req=>bridge.perceive(req)});
  }
  const host=ContinuationHost.restore(parent.recovery.tape,parent.recovery.plan.actors), mirror=replay(parent.recovery.tape,parent.recovery.tape.genesis.sourceRevision);
  if(evidenceHash(mirror)!==host.hash) throw Error('perception_preflight_mirror');
  const histories=new PerceptionConversations(parent.recovery.histories,plan.maxRequestBytes), firstRequests=[];
  for(const view of host.views()) {
    const person=host.identities().find(p=>p.actorId===view.actorId).person;
    const req=perceptionRequest(mirror,{agentId:view.actorId,person},plan.perspective,plan.condition,{episodeId:plan.id,worldHash:host.hash});
    const {record,audit}=await auditPerception(req,...workers);
    const input=buildPerceptionAgentInput(req,record,view.observation), wire=histories.prepare(view.actorId,input,perceptionDecisionContext(view.observation.context),plan.model);
    firstRequests.push({actorId:view.actorId,requestBytes:Buffer.byteLength(wire.body),maxInputTokens:wire.maxInputTokens,audit:audit.status});
  }
  report.preflight={parentVerified:true,startTick:host.tick,targetTick:host.tick+plan.ticks,firstRequests,mode:plan.memory,originalJournalStatus:priorView.stopReason};
  write('preflight.json',report.preflight);
  if(!preflightOnly) {
    budget=ExperimentBudget.carryFromExperiment(join(directory,'allowance'),priorPath);
    const now=Date.now();
    budget.authorize({runId:plan.id+'-'+sha256(directory+now).slice(0,12),authorizedAt:new Date(now).toISOString(),expiresAt:new Date(now+plan.allowance.windowHours*3600000).toISOString(),
      expectedCarriedFingerprint:budget.carriedFingerprint(),instruction,scope:'accounted_experiment_spending_only',manifestSha256:perceptionPlanHash(plan),model:plan.model,
      maxRequests:plan.maxCalls,limitMicroUsd:plan.allowance.limitMicroUsd,perRequestMicroUsd:plan.allowance.perRequestMicroUsd,prices});
    mkdirSync(join(directory,'calls'),{mode:0o700}); mkdirSync(join(directory,'counts'),{mode:0o700});
    const dispatch=async(endpoint,input,signal)=>{
      if(endpoint==='messages' && report.paidDispatches>=plan.maxCalls) throw Error('perception_cli_call_limit');
      const call=join(directory,endpoint==='messages'?'calls':'counts',String(input.index).padStart(5,'0')); mkdirSync(call,{mode:0o700});
      writeFileSync(join(call,'request.json'),input.body,{flag:'wx',mode:0o600});
      writeFileSync(join(call,'attempt.json'),JSON.stringify({requestId:input.requestId,actorId:input.actorId,tick:input.tick,sha256:input.sha256,noRetry:true}),{flag:'wx',mode:0o600});
      if(endpoint==='messages') report.paidDispatches++; else report.freeTokenCountRequests++;
      const workerScript=plan.inputProfile?'./anthropic-perception-request.ps1':'./anthropic-request.ps1';
      await promisify(execFile)('pwsh',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL(workerScript,import.meta.url)),
        '-KeyPath',keyPath,'-ArtifactDirectory',call,'-Endpoint',endpoint,'-ArchiveAllResponses','-MaxRequestBytes',String(plan.maxRequestBytes)],
        {env:hostProcessEnvironment(process.env),windowsHide:true,signal,timeout:15000,maxBuffer:8192});
      if(!existsSync(join(call,'response.json'))) throw Error('provider_response_failed');
      return readFileSync(join(call,'response.json'));
    };
    ledger=new ContinuationLedger(join(directory,'trace'));
    report.summary=await runPerceptionContinuation(plan,parentEvents,budget,(input,signal)=>dispatch('messages',input,signal),ledger,workers,sourceRevision,
      plan.inputProfile?{countTokens:(input,signal)=>dispatch('count_tokens',input,signal)}:{});
    ledger.close();
    report.verification=verifyPerceptionContinuation(readContinuationLedger(ledger.path));
    const actual=budget.view();
    if(actual.historyHash!==report.summary.budgetHistoryHash || String(actual.booked)!==report.summary.bookedMicroUsd || String(actual.held)!==report.summary.heldMicroUsd) throw Error('perception_journal_mismatch');
  }
} catch(error) { report.error=/^[a-z_]{1,100}$/.test(error?.message)?error.message:'run_failed_preserve_evidence_do_not_retry'; }
finally {
  ledger?.close(); budget?.close();
  await Promise.all(bridges.map(b=>b.close())); await Promise.all(processes.map(p=>p.stop()));
  report.originalSourcesUnchanged=sha256(readFileSync(parentPath))===sha256(parentBytes)&&sha256(readFileSync(join(priorPath,'accounting.journal.json')))===sha256(oldJournal);
  write('report.json',report);
}
console.log(JSON.stringify({sourceRevision,preflightOnly,paidDispatches:report.paidDispatches,freeTokenCountRequests:report.freeTokenCountRequests,preflight:report.preflight,summary:report.summary,
  verified:report.verification?.verified??null,error:report.error,originalSourcesUnchanged:report.originalSourcesUnchanged},null,2));
if(report.error || !report.originalSourcesUnchanged || !preflightOnly && report.summary?.status!=='completed') process.exitCode=1;
