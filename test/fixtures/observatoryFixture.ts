/**
 * TEST-ONLY staged continuation runs for the observatory. Every byte comes from the offline
 * simulated provider: no account, credential, private ledger or API is involved.
 */
import { join } from 'node:path';
import { continuationPlan, continuationGenesis, continuationBudget, simulatedContinuationProvider } from './continuationFixture.js';
import { root } from './accountingFixture.js';
import { ContinuationLedger, readContinuationLedger, type ContinuationEvent } from '../../src/eval/continuationLedger.js';
import { runContinuation, type ContinuationPlan } from '../../src/eval/continuationRunner.js';
import { REGISTRATION_SCHEMA, type ExperimentRegistration } from '../../src/observatory/contracts.js';

export const OLD = 'a'.repeat(40);
export const NEW = 'b'.repeat(40);
export const stagedPlan = (calls = 8, ticks = 4): ContinuationPlan => ({ ...continuationPlan(), maxTicks: ticks, maxCalls: calls,
  allowance: { maxRequests: calls, limitMicroUsd: 1000000, perRequestMicroUsd: 30000, windowHours: 24 } });

export interface Stage { path: string; events: ContinuationEvent[]; summary: Awaited<ReturnType<typeof runContinuation>> }

/** Three segments of one world: ticks 0->1, 1->3, 3->4, as the live extension was staged. */
export async function stagedRun(handles: { close(): void }[], faults: Parameters<typeof simulatedContinuationProvider>[0] = {}) {
  const plan = stagedPlan(), budgetDirectory = join(root(), 'budget'), budget = continuationBudget(plan, budgetDirectory);
  handles.push(budget);
  const stages: Stage[] = [];
  for (const stopAtTick of [1, 3, undefined]) {
    const parent = stages.at(-1)?.events;
    const ledger = new ContinuationLedger(join(root(), 'trace'));
    handles.push(ledger);
    const summary = await runContinuation(plan, continuationGenesis(OLD), budget, simulatedContinuationProvider({ redacted: true, ...faults }).send, ledger,
      { sourceRevision: parent ? NEW : OLD, mode: 'offline_simulated_provider', parent: parent ? JSON.parse(JSON.stringify(parent)) : undefined, stopAtTick });
    ledger.close();
    stages.push({ path: ledger.path, events: readContinuationLedger(ledger.path), summary });
  }
  return { plan, budget, budgetDirectory, stages };
}

export function registration(stages: Stage[], over: Partial<ExperimentRegistration> = {}): ExperimentRegistration {
  return { schema: REGISTRATION_SCHEMA, experimentId: 'TEST-ONLY-observatory', label: 'TEST ONLY synthetic', synthetic: true,
    segments: stages.map((s, i) => ({ segmentId: `stage-${i}`, ledger: s.path, sourceRevision: i ? NEW : OLD })), ...over };
}
