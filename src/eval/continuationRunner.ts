/**
 * Separate continuation run, never a Study 1 manifest. No provider client lives here.
 * ExperimentBudget remains the sole admission/usage authority, unchanged.
 */
import type { Genesis } from '../agent/participantWorld.js';
import { sha256 } from '../agent/accountingStore.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { usageCost, type AccountingPrices } from '../agent/accountingLedger.js';
import type { ExperimentBudget } from '../agent/experimentBudget.js';
import { validateDecision } from '../agent/protocol.js';
import { digest } from '../agent/replay.js';
import { ContinuationHost } from './continuationHost.js';
import { ContinuationConversations } from './continuationConversation.js';
import type { ActorSpec } from './constructs/authorityAttribution.js';
import type { Sender } from './accountedRunner.js';
import type { ContinuationLedger } from './continuationLedger.js';

export interface ContinuationPlan {
  schema: 'node-reasoning-continuation-v1';
  id: string; model: 'claude-haiku-5-5'; seed: number;
  actors: ActorSpec[]; maxTicks: number; maxCalls: number;
  deadlineMs: number; minIntervalMs: number;
  memory: 'own_append_only_transcript';
  allowance: { maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number; windowHours: number };
}
export const continuationPlanHash = (p: ContinuationPlan) => sha256(JSON.stringify(p));
export function validateContinuationPlan(p: ContinuationPlan): void {
  const positive = (n: number, max: number) => Number.isSafeInteger(n) && n > 0 && n <= max;
  if (p.schema !== 'node-reasoning-continuation-v1' || !/^[A-Za-z0-9._:-]{1,100}$/.test(p.id) ||
      p.model !== 'claude-haiku-5-5' || !Number.isSafeInteger(p.seed) || !positive(p.maxTicks, 1000) ||
      !positive(p.maxCalls, 5000) || !positive(p.deadlineMs, 20_000) || !Number.isSafeInteger(p.minIntervalMs) ||
      p.minIntervalMs < 0 || p.minIntervalMs > 600_000 || p.memory !== 'own_append_only_transcript' ||
      !Array.isArray(p.actors) || !p.actors.length || p.actors.length > 7 ||
      new Set(p.actors.map(a => a.actorId)).size !== p.actors.length ||
      !p.actors.every(a => /^[A-Za-z0-9._:-]{1,100}$/.test(a.actorId) && /^[A-Za-z]{1,32}$/.test(a.role) && Number.isSafeInteger(a.ordinal) && a.ordinal >= 0) ||
      !positive(p.allowance.maxRequests, 5000) || p.allowance.maxRequests < p.maxCalls ||
      !positive(p.allowance.limitMicroUsd, 25_000_000) || !positive(p.allowance.perRequestMicroUsd, p.allowance.limitMicroUsd) ||
      !positive(p.allowance.windowHours, 168)) throw Error('continuation_plan_invalid');
}
export interface RunSummary { status: string; calls: number; ticks: number; finalStateHash: string; historyHash: string; bookedMicroUsd: string; heldMicroUsd: string }
export interface StartEvidence { plan: ContinuationPlan; genesis: Genesis; sourceRevision: string; runId: string; mode: 'offline_simulated_provider' | 'live'; prices: AccountingPrices; budgetHistoryHash: string; identities: { actorId: string; person: string }[] }

/** The caller must supply an already authorized, plan-bound, unused allowance. Never creates one. */
export async function runContinuation(plan: ContinuationPlan, genesis: Genesis, budget: ExperimentBudget,
    send: Sender, ledger: ContinuationLedger, options: { sourceRevision: string; mode: StartEvidence['mode']; forbiddenSubstrings?: readonly string[]; signal?: AbortSignal }): Promise<RunSummary> {
  validateContinuationPlan(plan);
  const initial = budget.view(), auth = initial.authorization;
  if (!auth || auth.manifestSha256 !== continuationPlanHash(plan) || auth.model !== plan.model ||
      auth.maxRequests !== plan.allowance.maxRequests || auth.limitMicroUsd !== plan.allowance.limitMicroUsd ||
      auth.perRequestMicroUsd !== plan.allowance.perRequestMicroUsd || initial.requests.length) throw Error('continuation_separate_unused_allowance_required');
  if (genesis.seed !== plan.seed || genesis.sourceRevision !== options.sourceRevision || genesis.config.recognition !== 'v2') throw Error('continuation_genesis_mismatch');
  const host = new ContinuationHost(genesis, plan.actors), histories = new ContinuationConversations();
  ledger.append('start', { plan, genesis, sourceRevision: options.sourceRevision, runId: auth.runId, mode: options.mode, prices: auth.prices, budgetHistoryHash: initial.historyHash, identities: host.identities() } satisfies StartEvidence);
  let calls = 0, status = 'completed', lastDispatch = -Infinity;
  tickLoop: while (host.tick < plan.maxTicks) {
    if (options.signal?.aborted) { status = 'cancelled'; break; }
    const views = host.views(), remainingCalls = plan.maxCalls - calls;
    if (!views.length) { status = 'all_departed'; break; }
    if (remainingCalls <= 0) { status = 'call_limit'; break; }
    // Fixed plan order; the final tick schedules only the remaining calls. Everyone else follows
    // the unchanged kernel without a submitted decision. No invented idle model responses.
    const scheduled = views.slice(0, remainingCalls), scheduledActors = scheduled.map(v => v.actorId);
    const proposals: Record<string, unknown> = {}, requests: Record<string, string> = {};
    for (const { actorId, observation } of scheduled) {
      if (options.signal?.aborted) { status = 'cancelled'; break tickLoop; }
      let wire;
      try { wire = histories.prepare(actorId, observation, plan.model); }
      catch (error) { status = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'request_construction_failed'; break tickLoop; }
      if ([genesis.observerSecret, ...options.forbiddenSubstrings ?? []].some(s => s && wire.body.includes(s))) throw Error('continuation_information_exclusion');
      const view = budget.view(), ceiling = usageCost(wire.maxInputTokens, wire.maxOutputTokens, auth.prices);
      const stop = !view.canReserve ? view.stopReason : ceiling > auth.perRequestMicroUsd ? 'request_ceiling' : BigInt(ceiling) > view.remainingMicroUsd! ? 'cost_limit' : null;
      if (stop) { status = 'budget_stopped:' + stop; break tickLoop; }
      const wait = lastDispatch + plan.minIntervalMs - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (options.signal?.aborted) { status = 'cancelled'; break tickLoop; }
      const requestId = sha256(JSON.stringify([auth.runId, plan.id, actorId, observation.context.selfRef, host.tick]));
      const reservation = { id: requestId, episodeId: plan.id, actorId, inputSha256: wire.sha256,
        participant: { tick: host.tick, selfRef: wire.context.selfRef, role: wire.context.role, roleEpoch: wire.context.roleEpoch },
        model: plan.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens };
      try {
        if (budget.reserve(reservation) !== 'reserved') throw Error('continuation_request_consumed');
      } catch (error) {
        const reason = budget.view().stopReason;
        if (reason) { status = 'budget_stopped:' + reason; break tickLoop; }
        throw error;
      }
      const index = calls++;
      requests[actorId] = requestId;
      ledger.append('request', { requestId, actorId, tick: host.tick, worldHash: host.hash, observation, body: wire.body, sha256: wire.sha256, reservation, ceilingMicroUsd: ceiling, budgetHistoryHash: budget.view().historyHash });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal?.addEventListener('abort', cancel, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const begun = performance.now();
      lastDispatch = begun;
      let bytes: Buffer;
      try {
        bytes = await Promise.race([send({ requestId, episodeId: plan.id, actorId, tick: host.tick, index, provider: 'anthropic', body: wire.body, sha256: wire.sha256 }, controller.signal),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('deadline')); }, plan.deadlineMs); })]);
      } catch {
        ledger.append('failure', { actorId, tick: host.tick, requestId, outcome: 'transport_failed', held: true });
        status = 'inference_failed:transport_failed'; break tickLoop;
      } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
      const latencyMs = performance.now() - begun;
      // Archive the exact bytes BEFORE parsing: even malformed/unknown responses remain evidence.
      ledger.append('response', { requestId, actorId, tick: host.tick, raw: bytes.toString('base64'), sha256: sha256(bytes), latencyMs });
      let recorded;
      try { recorded = parseAnthropicResponse(bytes, requestId); }
      catch { status = 'inference_failed:response_invalid'; break tickLoop; }
      const usage = recorded.receipt.usage;
      if (!usage) { status = 'inference_failed:usage_unknown'; break tickLoop; }
      const receipt = { requestId, receiptId: recorded.receipt.receiptId, sourceSha256: recorded.receipt.sourceSha256, model: recorded.receipt.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      budget.recordUsage(receipt); // before model output may influence the world
      ledger.append('receipt', { requestId, actorId, receipt, status: recorded.receipt.status, stopReason: recorded.stopReason,
        reasoning: recorded.reasoning, proposed: recorded.decision, actionable: recorded.actionable,
        bookedMicroUsd: recorded.receipt.model === plan.model ? usageCost(usage.inputTokens, usage.outputTokens, auth.prices) : null,
        budgetHistoryHash: budget.view().historyHash });
      if (recorded.receipt.model !== plan.model) { status = 'inference_failed:model_mismatch'; break tickLoop; }
      if (latencyMs > plan.deadlineMs) { status = 'inference_failed:deadline_exceeded'; break tickLoop; }
      if (options.signal?.aborted) { status = 'cancelled'; break tickLoop; }
      if (budget.view().overrun) { status = 'budget_stopped:overrun'; break tickLoop; }
      const transformations = JSON.parse(bytes.toString('utf8')).input_transformations;
      if (Array.isArray(transformations) && transformations.length) { status = 'inference_failed:reasoning_transformed'; break tickLoop; }
      if (!recorded.actionable) { status = 'inference_failed:non_actionable'; break tickLoop; }
      const admitted = validateDecision(recorded.decision, observation.context);
      ledger.append('validation', { requestId, actorId, tick: host.tick, proposed: recorded.decision, admitted });
      if (!admitted) { status = 'decision_rejected'; break tickLoop; } // no repair, retry or substitute
      histories.accept(actorId, wire, bytes, requestId);
      proposals[actorId] = recorded.decision;
    }
    ledger.append('tick_intent', { tick: host.tick, beforeHash: host.hash, scheduledActors, requests, proposals });
    try {
      const transition = host.advance(views, proposals, scheduledActors);
      ledger.append('transition', { ...transition, requests, historyHash: digest(histories.export()) });
    } catch { status = 'simulation_failure'; break; }
  }
  const end = budget.view();
  const summary: RunSummary = { status, calls, ticks: host.tick, finalStateHash: host.hash, historyHash: digest(histories.export()),
    bookedMicroUsd: end.booked.toString(), heldMicroUsd: end.held.toString() };
  ledger.append('stop', { summary, histories: histories.export(), tape: host.tape(), budgetHistoryHash: end.historyHash });
  return summary;
}
