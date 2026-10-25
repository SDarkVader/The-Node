import { ExperimentBudget } from '../agent/experimentBudget.js';
import { sha256 } from '../agent/accountingStore.js';
import type { ContinuationEvent } from '../eval/continuationLedger.js';
import { recoverExperiment } from './recovery.js';
import { startPerceptionBridge, launchPerceptionWorker, type PerceptionBridge, type PerceptionWorkerProcess } from './perceptionBridge.js';
import type { PerceptionAuditWorker } from './perceptionAudit.js';

/** Validate actual journal contents without opening the writer or reconstructing missing records. */
export function inspectFreshFunding(bytes: Buffer, events: readonly ContinuationEvent[]) {
  if (bytes.length > 8*1024*1024) throw Error('readiness_journal_bounds');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (envelope.format !== 'node-accounting-journal-v1' || sha256(envelope.payload) !== envelope.sha256) throw Error('readiness_journal_checksum');
  const v = ExperimentBudget.inspect(JSON.parse(envelope.payload)), start = events[0]!.data;
  const verified = recoverExperiment(events, start.sourceRevision);
  const summary = verified.summary;
  const ledgerHistory = summary?.budgetHistoryHash ?? verified.recovery.budgetHistoryHash;
  const matches = verified.complete && ledgerHistory === v.historyHash && summary?.calls === v.requests.length &&
    summary?.bookedMicroUsd === String(v.booked) && summary?.heldMicroUsd === String(v.held) &&
    v.authorization?.manifestSha256 === sha256(JSON.stringify(start.plan));
  const closed = v.authorization && (Date.now() >= Date.parse(v.authorization.expiresAt) || v.requests.length >= v.authorization.maxRequests);
  return { status: !matches ? 'journal_ledger_mismatch' : v.held !== 0n ? 'outstanding_holds' : v.overrun ? 'prior_overrun' :
      closed ? 'verified_closed_prior_can_be_carried_after_approval' : 'current_grant_not_closed',
    historyHash: v.historyHash, ledgerRoot: verified.ledgerRoot, requests: v.requests.length,
    bookedMicroUsd: String(v.booked), heldMicroUsd: String(v.held), carried: v.carried, historicalBillingReconciled: false };
}

/** Independent actual Godot processes; no provider or credential is involved. */
export async function nativePerceptionWorkers(binary: string, clientDirectory: string) {
  const bridges: PerceptionBridge[] = [], processes: PerceptionWorkerProcess[] = [];
  const close = async () => { await Promise.all(bridges.map(b => b.close())); await Promise.all(processes.map(p => p.stop())); };
  try {
    const workers: PerceptionAuditWorker[] = [];
    for (let i=0;i<2;i++) {
      const bridge = await startPerceptionBridge({ timeoutMs: 15000 }); bridges.push(bridge);
      processes.push(launchPerceptionWorker(binary,bridge,clientDirectory)); await bridge.ready(20000);
      workers.push({ workerId: `godot-process-${i+1}`, perceive: request => bridge.perceive(request) });
    }
    return { workers: workers as [PerceptionAuditWorker,PerceptionAuditWorker], close,
      stats: () => bridges.map((b,i) => ({ workerId: workers[i]!.workerId, ...b.stats() })) };
  } catch (error) { await close(); throw error; }
}
