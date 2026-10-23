import { afterEach, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { continuationPlan, continuationGenesis, continuationBudget, simulatedContinuationProvider } from './fixtures/continuationFixture.js';
import { root, cleanup } from './fixtures/accountingFixture.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { runContinuation, continuationPlanHash, type ContinuationPlan } from '../src/eval/continuationRunner.js';
import { ContinuationLedger, readContinuationLedger, recoverContinuation, verifyContinuation, type ContinuationEvent } from '../src/eval/continuationLedger.js';
import { conversationObservations, unpackContinuationObservation } from '../src/eval/continuationConversation.js';
import { digest } from '../src/agent/replay.js';

const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40), handles: { close(): void }[] = [];
const track = <T extends { close(): void }>(h: T) => { handles.push(h); return h; };
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
async function stage(plan: ContinuationPlan, budget: ExperimentBudget, parent?: ContinuationEvent[], stopAtTick?: number,
    faults: Parameters<typeof simulatedContinuationProvider>[0] = {}) {
  const ledger = track(new ContinuationLedger(join(root(), 'trace'))), provider = simulatedContinuationProvider(faults);
  const summary = await runContinuation(plan, continuationGenesis(OLD), budget, provider.send, ledger,
    { sourceRevision: parent ? NEW : OLD, mode: 'offline_simulated_provider', parent, stopAtTick });
  ledger.close();
  return { summary, provider, events: readContinuationLedger(ledger.path), path: ledger.path };
}
const twoActors = (calls: number, ticks: number) => ({ ...continuationPlan(), maxTicks: ticks, maxCalls: calls,
  allowance: { maxRequests: calls, limitMicroUsd: 1000000, perRequestMicroUsd: 30000, windowHours: 24 } });

it('continues exact world and signed histories across process restarts without resetting one grant', async () => {
  const plan = twoActors(8, 4), directory = join(root(), 'budget');
  const budget = track(continuationBudget(plan, directory));
  const a = await stage(plan, budget, undefined, 1);
  expect(a.summary).toMatchObject({ status: 'checkpoint', ticks: 1, calls: 2 });
  budget.close();
  const reopened = track(ExperimentBudget.open(directory));
  const b = await stage(plan, reopened, JSON.parse(JSON.stringify(a.events)), 3);
  expect(b.summary).toMatchObject({ status: 'checkpoint', ticks: 3, calls: 6 });
  expect(b.events.find(e => e.kind === 'transition')!.data.beforeHash).toBe(a.summary.finalStateHash);
  const first = JSON.parse(a.provider.requests[0]!.body), next = JSON.parse(b.provider.requests[0]!.body);
  expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
  const response = JSON.parse(Buffer.from(a.events.find(e => e.kind === 'response')!.data.raw, 'base64').toString());
  expect(next.messages[1].content).toEqual(response.content);
  expect(conversationObservations(next.messages).map(unpackContinuationObservation).map(o => o.tick)).toEqual([0, 1]);
  const c = await stage(plan, reopened, b.events);
  expect(c.summary).toMatchObject({ status: 'completed', ticks: 4, calls: 8, heldMicroUsd: '0' });
  expect(reopened.view().requests).toHaveLength(8);
  expect(BigInt(c.summary.bookedMicroUsd)).toBe(8n * 340n);
  expect(recoverContinuation(c.events, NEW).recovery.tape.genesis.sourceRevision).toBe(OLD);
  const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'test/cli/verify-continuation.ts', c.path, NEW, join(root(), 'samples.jsonl')],
    { cwd: resolve('.'), windowsHide: true, encoding: 'utf8' }));
  expect(result).toMatchObject({ verified: true, complete: true, calls: 8, finalStateHash: c.summary.finalStateHash });
});

it('carries a count-exhausted, known-usage pilot into a new authorization before its expiry unchanged', async () => {
  const priorDir = join(root(), 'prior'), pilot = continuationPlan(), prior = track(continuationBudget(pilot, priorDir));
  const a = await stage(pilot, prior);
  const auth = prior.view().authorization!, oldHash = prior.view().historyHash;
  prior.close();
  const bytes = readFileSync(join(priorDir, 'accounting.journal.json'));
  const next = track(ExperimentBudget.carryFromExperiment(join(root(), 'next'), priorDir));
  const plan = { ...twoActors(8, 6), id: 'TEST-ONLY-extension', maxRequestBytes: 95000 };
  next.authorize({ ...auth, runId: 'TEST-ONLY-extension', authorizedAt: new Date().toISOString(),
    expectedCarriedFingerprint: next.carriedFingerprint(), manifestSha256: continuationPlanHash(plan),
    maxRequests: plan.allowance.maxRequests, limitMicroUsd: plan.allowance.limitMicroUsd, perRequestMicroUsd: plan.allowance.perRequestMicroUsd });
  expect(next.carriedFingerprint()).toBe(oldHash);
  expect(next.view().carried).toMatchObject({ requests: 4, bookedMicroUsd: a.summary.bookedMicroUsd, heldMicroUsd: '0' });
  const b = await stage(plan, next, a.events, 4, { receiptPrefix: 'extension_' });
  expect(b.summary).toMatchObject({ status: 'checkpoint', ticks: 4, calls: 4 });
  const c = await stage(plan, next, b.events, undefined, { receiptPrefix: 'extension_' });
  expect(c.summary).toMatchObject({ status: 'completed', ticks: 6, calls: 8, bookedMicroUsd: '2720', heldMicroUsd: '0' });
  expect(verifyContinuation(c.events, NEW).verified).toBe(true);
  expect(sha256(readFileSync(join(priorDir, 'accounting.journal.json')))).toBe(sha256(bytes));
});

it('refuses an unexhausted prior grant, a held outcome and a count-exhausted overrun', async () => {
  for (const fault of ['open', 'hold', 'overrun'] as const) {
    const priorDir = join(root(), 'prior'), plan = twoActors(fault === 'open' ? 4 : 1, 2);
    const prior = track(continuationBudget(plan, priorDir));
    await stage(plan, prior, undefined, fault === 'open' ? 1 : undefined,
      fault === 'hold' ? { failAt: 0 } : fault === 'overrun' ? { overrunAt: 0 } : {});
    const auth = prior.view().authorization!; prior.close();
    if (fault === 'hold') {
      expect(() => ExperimentBudget.carryFromExperiment(join(root(), 'next'), priorDir)).toThrow('outstanding_hold');
    } else {
      const next = track(ExperimentBudget.carryFromExperiment(join(root(), 'next'), priorDir));
      expect(() => next.authorize({ ...auth, runId: 'TEST-ONLY-next', authorizedAt: new Date().toISOString(),
        expectedCarriedFingerprint: next.carriedFingerprint() })).toThrow('experiment_budget_authorization');
    }
  }
});

it('refuses an edited parent, a failed partial tick and a journal advanced beyond its checkpoint', async () => {
  const plan = twoActors(8, 4), budget = track(continuationBudget(plan));
  const a = await stage(plan, budget, undefined, 1), b = await stage(plan, budget, a.events, 2);
  await expect(stage(plan, budget, a.events, 3)).rejects.toThrow('resume_budget');
  const failed = await stage(plan, budget, b.events, undefined, { failAt: 4 });
  await expect(stage(plan, budget, failed.events)).rejects.toThrow('parent_not_resumable');
  const changed = structuredClone(b.events);
  const parent = changed[0]!.data.parent.events as ContinuationEvent[];
  parent.find(e => e.kind === 'transition')!.data.afterHash = '0'.repeat(64);
  let previous = '0'.repeat(64);
  for (const e of changed) { e.previous = previous; e.hash = digest([e.seq, previous, e.kind, e.data]); previous = e.hash; }
  expect(() => verifyContinuation(changed, NEW)).toThrow('chain');
});

it('allows the explicit larger history profile while keeping the default byte bound and token ceilings', async () => {
  const plan = { ...twoActors(4, 2), maxRequestBytes: 95000 }, budget = track(continuationBudget(plan));
  const result = await stage(plan, budget, undefined, undefined, { largeSignature: true });
  expect(result.summary).toMatchObject({ status: 'completed', calls: 4, ticks: 2 });
  expect(result.provider.requests.some(q => Buffer.byteLength(q.body) > 32768)).toBe(true);
  expect(result.events.filter(e => e.kind === 'request').every(e => e.data.reservation.maxInputTokens <= 100000)).toBe(true);
  expect(verifyContinuation(result.events, OLD).verified).toBe(true);
  const spare = track(continuationBudget(plan)), request = result.events.find(e => e.kind === 'request')!.data.reservation;
  expect(() => spare.reserve({ ...request, maxInputTokens: 100001 })).toThrow('experiment_budget_admission');
});
