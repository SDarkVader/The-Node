// Read-only remote preflight. Never takes an accounting lock or reads a provider key.
// Args: <plan.json> <accounting.journal.json> [latest continuation.ledger.jsonl]
import { readFileSync, lstatSync } from 'node:fs';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { recoverContinuation, readContinuationLedger } from '../src/eval/continuationLedger.js';
import { continuationPlanHash, validateContinuationPlan, type ContinuationPlan } from '../src/eval/continuationRunner.js';
import { digest } from '../src/agent/replay.js';
const [planPath,journalPath,parentPath]=process.argv.slice(2);
if(!planPath||!journalPath||process.argv.length>5)throw Error('explicit_preflight_arguments_required');
const plan=JSON.parse(readFileSync(planPath,'utf8')) as ContinuationPlan;validateContinuationPlan(plan);
const stat=lstatSync(journalPath);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('preflight_journal_bounds');
const envelope=JSON.parse(readFileSync(journalPath,'utf8'));
if(envelope.format!=='node-accounting-journal-v1'||sha256(envelope.payload)!==envelope.sha256)throw Error('preflight_journal_checksum');
const budget=ExperimentBudget.inspect(JSON.parse(envelope.payload)),auth=budget.authorization;
if(!auth||auth.manifestSha256!==continuationPlanHash(plan)||auth.model!==plan.model||auth.maxRequests!==plan.allowance.maxRequests||
  auth.limitMicroUsd!==plan.allowance.limitMicroUsd||auth.perRequestMicroUsd!==plan.allowance.perRequestMicroUsd)throw Error('preflight_plan_allowance_mismatch');
const parentEvents=parentPath?readContinuationLedger(parentPath):undefined;
const parent=parentEvents?recoverContinuation(parentEvents,parentEvents[0]?.data.sourceRevision):null;
if(budget.requests.length&&!parent)throw Error('preflight_latest_parent_required');
if(parent){
  if(!parent.recovery.resumable)throw Error('preflight_parent_not_resumable');
  const old=parent.recovery.plan;
  if(digest([plan.seed,plan.actors,plan.model,plan.memory,plan.reasoningProfile??null])!==digest([old.seed,old.actors,old.model,old.memory,old.reasoningProfile??null]))throw Error('preflight_parent_contract');
  if(parent.recovery.runId===auth.runId){
    if(continuationPlanHash(old)!==continuationPlanHash(plan)||budget.historyHash!==parent.recovery.budgetHistoryHash||
      budget.requests.length!==parent.summary!.calls||budget.booked.toString()!==parent.summary!.bookedMicroUsd||budget.held!==0n)throw Error('preflight_stale_parent_or_journal');
  }else if(budget.requests.length||JSON.parse(envelope.payload).carried.fingerprint!==parent.recovery.budgetHistoryHash)throw Error('preflight_carried_history_mismatch');
  if(parent.summary!.ticks>=plan.maxTicks)throw Error('preflight_tick_limit');
}
console.log(JSON.stringify({planSha256:continuationPlanHash(plan),model:plan.model,mode:parent?.mode??'no_parent',
  parentVerified:parent?.verified??null,parentLedgerRoot:parent?.ledgerRoot??null,resumeTick:parent?.summary?.ticks??null,
  journalHistoryHash:budget.historyHash,requests:budget.requests.length,bookedMicroUsd:budget.booked.toString(),heldMicroUsd:budget.held.toString(),
  carried:budget.carried,canReserve:budget.canReserve,stopReason:budget.stopReason,expiresAt:auth.expiresAt,
  historicalBillingReconciled:false,dispatches:0,authorization:'this_preflight_grants_no_spending_permission'},null,2));
if(!budget.canReserve)process.exitCode=1;
