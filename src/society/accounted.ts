/** Accounted society controller. A sender is injected only after separately verified owner
 * approval. This module never creates/carries/resets an allowance or opens a provider client. */
import { sha256 } from '../agent/accountingStore.js';
import { usageCost } from '../agent/accountingLedger.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { PRICED_MODELS } from '../agent/modelPricing.js';
import type { ExperimentBudget } from '../agent/experimentBudget.js';
import type { Sender } from '../eval/accountedRunner.js';
import { digest } from '../agent/replay.js';
import { SocietySecurityError, validateSocietyAction } from './boundary.js';
import { buildSocietyRequest } from './request.js';
import { autonomousPolicy } from './policy.js';
import type { Society } from './runtime.js';

export interface SocietyRunPlan {
  schema: 'node-accounted-society-v1'; id: string; model: 'claude-haiku-5-5';
  ticks: number; maxCalls: number; deadlineMs: number; minIntervalMs: number;
  initialHash: string; sourceRevision: string; controlled: string[];
  allowance: { maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number };
}
export const societyPlanHash = (p: SocietyRunPlan) => sha256(JSON.stringify(p));
export function createSocietyPlan(society: Society, options: { id?: string; ticks?: number; deadlineMs?: number;
  minIntervalMs?: number; limitMicroUsd?: number; perRequestMicroUsd?: number } = {}): SocietyRunPlan {
  const ticks = options.ticks ?? 3;
  const plan: SocietyRunPlan = { schema: 'node-accounted-society-v1', id: options.id ?? 'supervised-three-inhabitant-society',
    model: 'claude-haiku-5-5', ticks, maxCalls: ticks * 6, deadlineMs: options.deadlineMs ?? 20_000,
    minIntervalMs: options.minIntervalMs ?? 1000, initialHash: society.hash,
    sourceRevision: society.inspect().genesis.sourceRevision, controlled: society.controlled,
    allowance: { maxRequests: ticks * 6, limitMicroUsd: options.limitMicroUsd ?? 1_000_000,
      perRequestMicroUsd: options.perRequestMicroUsd ?? 20_000 } };
  validateSocietyPlan(plan); return structuredClone(plan);
}
export function validateSocietyPlan(p: SocietyRunPlan): void {
  if (p?.schema !== 'node-accounted-society-v1' || typeof p.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(p.id) ||
    p.model !== 'claude-haiku-5-5' || !Number.isSafeInteger(p.ticks) || p.ticks < 1 || p.ticks > 3 || p.maxCalls !== 6 * p.ticks ||
    !Number.isSafeInteger(p.deadlineMs) || p.deadlineMs < 1 || p.deadlineMs > 20_000 ||
    !Number.isSafeInteger(p.minIntervalMs) || p.minIntervalMs < 0 || p.minIntervalMs > 60_000 ||
    !/^[a-f0-9]{64}$/.test(p.initialHash) || typeof p.sourceRevision !== 'string' || !p.sourceRevision ||
    !Array.isArray(p.controlled) || p.controlled.length !== 3 || new Set(p.controlled).size !== 3 ||
    !p.controlled.every(v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v)) ||
    p.allowance?.maxRequests !== p.maxCalls || !Number.isSafeInteger(p.allowance.limitMicroUsd) || p.allowance.limitMicroUsd < 1 || p.allowance.limitMicroUsd > 1_000_000 ||
    !Number.isSafeInteger(p.allowance.perRequestMicroUsd) || p.allowance.perRequestMicroUsd < 1 || p.allowance.perRequestMicroUsd > p.allowance.limitMicroUsd)
    throw new SocietySecurityError('society_paid_plan');
}

/** All events are operator-private evidence, never an inhabitant message. A synchronous sink
 * must persist the exact request before dispatch and response before admitted world action. */
export interface SocietyRunEvent { kind: 'start' | 'request' | 'response' | 'decision' | 'finish'; data: unknown }
export interface AccountedSocietyOptions {
  plan: SocietyRunPlan; ownerApproved: boolean; instruction: string; expectedCarriedFingerprint: string;
  sink: (event: SocietyRunEvent) => void; signal?: AbortSignal;
}
export interface AccountedSocietySummary {
  status: 'completed' | 'stopped'; stoppedReason: string | null; calls: number; ticks: number;
  startTick: number; finalTick: number; planSha256: string; runId: string;
  bookedMicroUsd: string; heldMicroUsd: string; budgetHistoryHash: string; finalHash: string;
}
const running = new WeakSet<Society>();
const message = (error: unknown, fallback: string) => error instanceof Error && /^[A-Za-z0-9_:.-]{1,128}$/.test(error.message) ? error.message : fallback;

export async function runAccountedSociety(society: Society, budget: ExperimentBudget, send: Sender,
  options: AccountedSocietyOptions): Promise<AccountedSocietySummary> {
  // Snapshot the reviewed plan before any sender/evidence callback can mutate caller data.
  const plan = structuredClone(options.plan); validateSocietyPlan(plan);
  const emit = (event: SocietyRunEvent) => options.sink(structuredClone(event));
  if (options.ownerApproved !== true || typeof options.instruction !== 'string' || !options.instruction.trim() ||
    options.instruction.length > 8192 || typeof options.sink !== 'function') throw new SocietySecurityError('society_owner_approval_required');
  const start = budget.view(), auth = start.authorization;
  if (society.halted || society.tick !== 0 || society.phase !== 'commit' || society.exportTape().decisions.length || running.has(society) ||
    society.hash !== plan.initialHash || society.inspect().genesis.sourceRevision !== plan.sourceRevision || digest(society.controlled) !== digest(plan.controlled))
    throw new SocietySecurityError('society_paid_initial_state');
  if (!auth || !start.canReserve || start.requests.length || !/^[a-f0-9]{64}$/.test(options.expectedCarriedFingerprint) ||
    budget.carriedFingerprint() !== options.expectedCarriedFingerprint || auth.expectedCarriedFingerprint !== options.expectedCarriedFingerprint ||
    auth.instruction !== options.instruction || auth.manifestSha256 !== societyPlanHash(plan) || auth.model !== plan.model ||
    auth.maxRequests !== plan.maxCalls || auth.limitMicroUsd !== plan.allowance.limitMicroUsd || auth.perRequestMicroUsd !== plan.allowance.perRequestMicroUsd ||
    digest(auth.prices) !== digest(PRICED_MODELS[plan.model])) throw new SocietySecurityError('society_paid_allowance');
  running.add(society);
  let calls = 0, stoppedReason: string | null = null, lastDispatch = -Infinity;
  const halt = (reason: string) => { stoppedReason = reason; society.halt(); };
  try {
    emit({ kind: 'start', data: { plan, planSha256: societyPlanHash(plan), runId: auth.runId,
      budgetHistoryHash: start.historyHash, carriedFingerprint: options.expectedCarriedFingerprint } });
    while (society.tick < plan.ticks && !stoppedReason) {
      if (options.signal?.aborted) { halt('society_cancelled'); break; }
      const people = society.pendingPeople();
      if (!people.length) { halt('society_no_pending_people'); break; }
      for (const person of people) {
        if (options.signal?.aborted) { halt('society_cancelled'); break; }
        const view = society.view(person);
        if (!plan.controlled.includes(person)) {
          society.submit(person, autonomousPolicy(view.visible));
          continue;
        }
        if (calls >= plan.maxCalls) { halt('society_call_limit'); break; }
        const wire = buildSocietyRequest(view.visible, plan.model), current = budget.view();
        const ceiling = BigInt(usageCost(wire.maxInputTokens, wire.maxOutputTokens, auth.prices));
        if (!current.canReserve || ceiling > BigInt(auth.perRequestMicroUsd) || ceiling > current.remainingMicroUsd!) {
          halt('society_budget_stopped'); break;
        }
        const phase: 'commit' | 'act' = society.phase, tick: number = society.tick;
        const episodeId = `${plan.id}:${phase}`;
        const requestId = sha256(JSON.stringify([auth.runId, episodeId, person, tick, wire.sha256]));
        const sent = { requestId, body: wire.body, sha256: wire.sha256, episodeId, actorId: person, tick, index: calls, provider: 'anthropic' as const };
        // Save exact bytes before a reservation/dispatch. Sink failure here spends nothing.
        emit({ kind: 'request', data: { ...sent, phase, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens } });
        const wait = lastDispatch + plan.minIntervalMs - performance.now();
        if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
        if (options.signal?.aborted) { halt('society_cancelled'); break; }
        if (budget.reserve({ id: requestId, episodeId, actorId: person, inputSha256: wire.sha256,
          participant: { tick, selfRef: view.context.selfRef, role: view.context.role, roleEpoch: view.context.roleEpoch },
          model: plan.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens }) !== 'reserved') throw new SocietySecurityError('society_request_consumed');
        calls++; lastDispatch = performance.now();
        const abort = new AbortController(), cancelled = () => abort.abort();
        options.signal?.addEventListener('abort', cancelled, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined, bytes: Buffer;
        const begun = performance.now();
        try {
          bytes = await Promise.race([send(sent, abort.signal), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { abort.abort(); reject(new Error('society_provider_deadline')); }, plan.deadlineMs);
          }), new Promise<never>((_, reject) => {
            abort.signal.addEventListener('abort', () => reject(new Error('society_provider_aborted')), { once: true });
          })]);
        } catch (error) { halt(message(error, 'society_transport_failed')); break; }
        finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', cancelled); }
        const elapsedMs = performance.now() - begun;
        let parsed: ReturnType<typeof parseAnthropicResponse>;
        try { parsed = parseAnthropicResponse(bytes, requestId); }
        catch {
          emit({ kind: 'response', data: { requestId, rawBase64: Buffer.isBuffer(bytes) ? bytes.toString('base64') : null, status: 'usage_unknown' } });
          halt('society_usage_unknown'); break;
        }
        const usage = parsed.receipt.usage;
        // Always book recognizable usage before response validation, evidence writes or action.
        if (usage) budget.recordUsage({ requestId, receiptId: parsed.receipt.receiptId, sourceSha256: parsed.receipt.sourceSha256,
          model: parsed.receipt.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        emit({ kind: 'response', data: { requestId, rawBase64: bytes.toString('base64'), parsed, elapsedMs } });
        if (!usage) { halt('society_usage_unknown'); break; }
        if (parsed.receipt.model !== plan.model) { halt('society_response_model'); break; }
        if (elapsedMs > plan.deadlineMs) { halt('society_provider_deadline'); break; }
        if (budget.view().overrun) { halt('society_usage_overrun'); break; }
        if (!parsed.actionable || parsed.receipt.status !== 'completed') { halt('society_response_not_actionable'); break; }
        // No tool block, malformed final text or out-of-menu action reaches the kernel.
        const action = validateSocietyAction(parsed.decision, view.context);
        if (society.tick !== tick || society.phase !== phase || !society.pendingPeople().includes(person)) throw new SocietySecurityError('society_stale_response');
        emit({ kind: 'decision', data: { requestId, person, tick, phase, action } });
        society.submit(person, action);
      }
    }
  } catch (error) { halt(message(error, 'society_execution_failed')); }
  finally { running.delete(society); }
  const end = budget.view();
  const summary: AccountedSocietySummary = { status: stoppedReason ? 'stopped' : 'completed', stoppedReason,
    calls, ticks: society.tick, startTick: 0, finalTick: society.tick, planSha256: societyPlanHash(plan), runId: auth.runId,
    bookedMicroUsd: end.booked.toString(), heldMicroUsd: end.held.toString(), budgetHistoryHash: end.historyHash, finalHash: society.hash };
  try { emit({ kind: 'finish', data: { summary, tape: society.exportTape() } }); }
  catch (error) { society.halt(); summary.status = 'stopped'; summary.stoppedReason = message(error, 'society_evidence_finish_failed'); }
  return summary;
}
