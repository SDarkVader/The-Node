/**
 * Private, append-only, hash-chained experiment evidence. Exclusive create; flush each event.
 * A crash never triggers an automatic paid retry. Audit can inspect the surviving prefix.
 * Hashes detect inconsistency relative to a retained root; they are not external attestation.
 */
import { openSync, closeSync, fsyncSync, writeFileSync, readFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest, replay, evidenceHash, type ReplayTape } from '../agent/replay.js';
import { sha256 } from '../agent/accountingStore.js';
import { usageCost } from '../agent/accountingLedger.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { PRICED_MODELS } from '../agent/modelPricing.js';
import { validateDecision } from '../agent/protocol.js';
import { ContinuationHost } from './continuationHost.js';
import { ContinuationConversations, type History } from './continuationConversation.js';
import { validateContinuationPlan, continuationPlanHash, type StartEvidence, type RunSummary } from './continuationRunner.js';

export const CONTINUATION_LEDGER_FILE = 'continuation.ledger.jsonl';
export interface ContinuationEvent { seq: number; previous: string; kind: string; data: any; hash: string }
interface RecoveredSegment {
  verified: true; complete: boolean; ledgerRoot: string; sourceRevision: string; mode: StartEvidence['mode'];
  calls: number; transitions: number; finalStateHash: string; historyHash: string; summary: RunSummary | null;
  tickEvidence: { tick: number; nextTick: number; beforeHash: string; afterHash: string; effects: unknown; ownChanges: unknown }[];
  metrics: 'not_validated';
  recovery: { tape: ReplayTape; histories: [string, History][]; plan: StartEvidence['plan']; runId: string;
    budgetHistoryHash: string; seenRequests: string[]; receipts: string[]; resumable: boolean };
}
const ROOT = '0'.repeat(64);
const equal = (a: unknown, b: unknown, code: string) => { if (digest(a) !== digest(b)) throw Error(code); };
export class ContinuationLedger {
  #fd: number; #seq = 0; #previous = ROOT; #closed = false; #poisoned = false;
  readonly path: string;
  constructor(directory: string) {
    mkdirSync(directory, { mode: 0o700 }); // exclusive: existing runs cannot be overwritten
    if (lstatSync(directory).isSymbolicLink() || resolve(realpathSync(directory)).toLowerCase() !== resolve(directory).toLowerCase()) throw Error('continuation_unsafe_path');
    this.path = join(directory, CONTINUATION_LEDGER_FILE);
    this.#fd = openSync(this.path, 'wx', 0o600);
  }
  append(kind: string, data: unknown): void {
    if (this.#closed || this.#poisoned) throw Error('continuation_ledger_closed');
    const value = JSON.parse(JSON.stringify(data)), seq = this.#seq, previous = this.#previous;
    const event: ContinuationEvent = { seq, previous, kind, data: value, hash: digest([seq, previous, kind, value]) };
    try { writeFileSync(this.#fd, JSON.stringify(event) + '\n'); fsyncSync(this.#fd); }
    catch (error) { this.#poisoned = true; throw error; }
    this.#seq++; this.#previous = event.hash;
  }
  close() { if (!this.#closed) { closeSync(this.#fd); this.#closed = true; } }
}
export function readContinuationLedger(path: string): ContinuationEvent[] {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw Error('continuation_ledger_bounds');
  const bytes = readFileSync(path, 'utf8');
  if (!bytes.endsWith('\n')) throw Error('continuation_ledger_torn_tail');
  return bytes.trimEnd().split('\n').map(line => JSON.parse(line));
}
export function verifyContinuation(events: readonly ContinuationEvent[], expectedSourceRevision: string) {
  const { recovery: _, ...result } = recoverContinuation(events, expectedSourceRevision);
  return result;
}
/** Internal recovery material is reconstructed from evidence, never imported from a stop snapshot. */
export function recoverContinuation(events: readonly ContinuationEvent[], expectedSourceRevision: string, depth = 0): RecoveredSegment {
  if (depth > 64) throw Error('continuation_parent_depth');
  return verifySegment(events, expectedSourceRevision, depth);
}
function verifySegment(events: readonly ContinuationEvent[], expectedSourceRevision: string, depth: number): RecoveredSegment {
  if (!events.length) throw Error('continuation_empty');
  let previous = ROOT;
  events.forEach((event, i) => {
    if (event.seq !== i || event.previous !== previous || event.hash !== digest([i, previous, event.kind, event.data])) throw Error('continuation_chain');
    previous = event.hash;
  });
  const first = events[0]!;
  if (first.kind !== 'start') throw Error('continuation_start_required');
  const start = first.data as StartEvidence, { plan, genesis } = start;
  validateContinuationPlan(plan);
  equal(start.prices, PRICED_MODELS[plan.model], 'continuation_prices_mismatch');
  if (!['live', 'offline_simulated_provider'].includes(start.mode)) throw Error('continuation_mode');
  if (start.sourceRevision !== expectedSourceRevision || (!start.parent && genesis.sourceRevision !== expectedSourceRevision) ||
      plan.seed !== genesis.seed || genesis.config.recognition !== 'v2') throw Error('continuation_source_mismatch');
  // Parent events make each sealed segment self-contained in a fresh environment. Their own
  // runner revision is distinct from the immutable original world's genesis revision.
  const parent = start.parent ? recoverContinuation(start.parent.events, start.parent.events[0]?.data.sourceRevision, depth + 1) : null;
  if (parent) {
    if (!parent.recovery.resumable || start.parent!.ledgerRoot !== parent.ledgerRoot) throw Error('continuation_parent_not_resumable');
    equal([genesis, plan.actors, plan.model, plan.memory, plan.reasoningProfile ?? null, start.mode],
      [parent.recovery.tape.genesis, parent.recovery.plan.actors, parent.recovery.plan.model, parent.recovery.plan.memory, parent.recovery.plan.reasoningProfile ?? null, parent.mode], 'continuation_parent_contract');
    if (plan.maxTicks <= parent.summary!.ticks) throw Error('continuation_parent_tick_limit');
  }
  const sameBudget = parent?.recovery.runId === start.runId;
  if (sameBudget) {
    if (continuationPlanHash(plan) !== continuationPlanHash(parent!.recovery.plan) || start.budgetHistoryHash !== parent!.recovery.budgetHistoryHash) throw Error('continuation_resume_budget');
  } else if (parent && start.carriedFingerprint !== parent.recovery.budgetHistoryHash) throw Error('continuation_carried_budget');
  const baseline = sameBudget ? { calls: parent!.summary!.calls, booked: parent!.summary!.bookedMicroUsd, held: parent!.summary!.heldMicroUsd } : { calls: 0, booked: '0', held: '0' };
  if (parent) equal(start.baseline, baseline, 'continuation_baseline');
  const host = parent ? ContinuationHost.restore(parent.recovery.tape, plan.actors) : new ContinuationHost(genesis, plan.actors);
  const histories = parent ? ContinuationConversations.restoreVerified(parent.recovery.histories, plan.maxRequestBytes, plan.reasoningProfile) : new ContinuationConversations(plan.maxRequestBytes, plan.reasoningProfile);
  const startTick = host.tick;
  if (start.stopAtTick !== undefined && (!Number.isSafeInteger(start.stopAtTick) || start.stopAtTick <= startTick || start.stopAtTick > plan.maxTicks)) throw Error('continuation_stage_bound');
  equal(start.identities, host.identities(), 'continuation_identity_mapping');
  const pending = new Map<string, { request: any; wire: ReturnType<ContinuationConversations['prepare']>; response?: any; recorded?: ReturnType<typeof parseAnthropicResponse>; receipt?: boolean; validated?: boolean }>();
  const seenRequests = new Set<string>(parent?.recovery.seenRequests ?? []), receipts = new Set<string>(parent?.recovery.receipts ?? []);
  let intent: any = null, stopped = false, calls = baseline.calls, booked = Number(baseline.booked), held = Number(baseline.held), transitions = 0, budgetHistoryHash = start.budgetHistoryHash;
  const tickEvidence: { tick: number; nextTick: number; beforeHash: string; afterHash: string; effects: unknown; ownChanges: unknown }[] = [];
  let summary: RunSummary | null = null;
  for (const event of events.slice(1)) {
    if (stopped) throw Error('continuation_after_stop');
    const d = event.data;
    if (typeof d.budgetHistoryHash === 'string') budgetHistoryHash = d.budgetHistoryHash;
    if (event.kind === 'request') {
      if (intent || [...pending.values()].some(q => !q.validated)) throw Error('continuation_request_order');
      const scheduled = host.views().slice(0, plan.maxCalls - calls + pending.size);
      if (scheduled[pending.size]?.actorId !== d.actorId) throw Error('continuation_schedule_mismatch');
      const view = scheduled.find(v => v.actorId === d.actorId);
      if (!view || seenRequests.has(d.requestId) || pending.has(d.actorId)) throw Error('continuation_request_identity');
      equal(view.observation, d.observation, 'continuation_observation_forged');
      const wire = histories.prepare(d.actorId, view.observation, plan.model);
      if (d.body !== wire.body || d.sha256 !== wire.sha256 || d.tick !== host.tick || d.worldHash !== host.hash) throw Error('continuation_wire_mismatch');
      const requestId = sha256(JSON.stringify([start.runId, plan.id, d.actorId, view.observation.context.selfRef, host.tick]));
      equal(d.reservation, { id: requestId, episodeId: plan.id, actorId: d.actorId, inputSha256: wire.sha256,
        participant: { tick: host.tick, selfRef: wire.context.selfRef, role: wire.context.role, roleEpoch: wire.context.roleEpoch },
        model: plan.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens }, 'continuation_reservation_mismatch');
      const ceiling = usageCost(wire.maxInputTokens, wire.maxOutputTokens, start.prices);
      if (d.requestId !== requestId || d.ceilingMicroUsd !== ceiling || ceiling > plan.allowance.perRequestMicroUsd ||
          booked + held + ceiling > plan.allowance.limitMicroUsd || calls >= plan.maxCalls) throw Error('continuation_budget_mismatch');
      held += ceiling; calls++; seenRequests.add(requestId);
      pending.set(d.actorId, { request: d, wire });
    } else if (event.kind === 'response') {
      const q = pending.get(d.actorId);
      if (!q || q.request.requestId !== d.requestId || q.response || d.tick !== host.tick) throw Error('continuation_response_order');
      const bytes = Buffer.from(d.raw, 'base64');
      if (sha256(bytes) !== d.sha256 || !Number.isFinite(d.latencyMs) || d.latencyMs < 0) throw Error('continuation_response_hash');
      q.response = d;
      try { q.recorded = parseAnthropicResponse(bytes, d.requestId); } catch { /* preserved failed response */ }
    } else if (event.kind === 'receipt') {
      const q = pending.get(d.actorId), r = q?.recorded;
      if (!q || !r?.receipt.usage || q.receipt || q.request.requestId !== d.requestId || receipts.has(r.receipt.receiptId)) throw Error('continuation_receipt_order');
      equal(d.receipt, { requestId: d.requestId, receiptId: r.receipt.receiptId, sourceSha256: r.receipt.sourceSha256, model: r.receipt.model,
        inputTokens: r.receipt.usage.inputTokens, outputTokens: r.receipt.usage.outputTokens }, 'continuation_receipt_mismatch');
      equal(d.reasoning, r.reasoning, 'continuation_reasoning_mismatch');
      equal([d.status, d.stopReason, d.proposed, d.actionable], [r.receipt.status, r.stopReason, r.decision, r.actionable], 'continuation_proposal_mismatch');
      const cost = r.receipt.model === plan.model ? usageCost(r.receipt.usage.inputTokens, r.receipt.usage.outputTokens, start.prices) : null;
      if (cost !== d.bookedMicroUsd) throw Error('continuation_cost_mismatch');
      if (cost !== null) { booked += cost; held -= q.request.ceilingMicroUsd; }
      receipts.add(r.receipt.receiptId); q.receipt = true;
    } else if (event.kind === 'validation') {
      const q = pending.get(d.actorId), r = q?.recorded;
      if (!q?.receipt || !r?.actionable || r.receipt.model !== plan.model || q.response.latencyMs > plan.deadlineMs ||
          (JSON.parse(Buffer.from(q.response.raw, 'base64').toString('utf8')).input_transformations?.length ?? 0) > 0 ||
          q.validated || d.tick !== host.tick || q.request.requestId !== d.requestId) throw Error('continuation_validation_order');
      equal(d.proposed, r.decision, 'continuation_validation_candidate');
      const decision = validateDecision(r.decision, q.wire.context);
      equal(d.admitted, decision, 'continuation_validator_mismatch');
      if (decision) {
        histories.accept(d.actorId, q.wire, Buffer.from(q.response.raw, 'base64'), d.requestId);
        q.validated = true;
      }
    } else if (event.kind === 'tick_intent') {
      const views = host.views().slice(0, plan.maxCalls - calls + pending.size), scheduledActors = views.map(v => v.actorId), proposals = Object.fromEntries([...pending].map(([a, q]) => [a, q.recorded?.decision]));
      const requests = Object.fromEntries([...pending].map(([a, q]) => [a, q.request.requestId]));
      if (intent || pending.size !== views.length || [...pending.values()].some(q => !q.validated)) throw Error('continuation_incomplete_tick');
      equal(d, { tick: host.tick, beforeHash: host.hash, scheduledActors, requests, proposals }, 'continuation_intent_mismatch'); intent = d;
    } else if (event.kind === 'transition') {
      if (!intent) throw Error('continuation_missing_intent');
      const expected = host.advance(host.views(), intent.proposals, intent.scheduledActors);
      equal(d, { ...expected, requests: intent.requests, historyHash: digest(histories.export()) }, 'continuation_transition_mismatch');
      if (expected.nextTick !== expected.tick + 1 || expected.beforeHash === expected.afterHash) throw Error('continuation_frozen_world');
      tickEvidence.push({ tick: expected.tick, nextTick: expected.nextTick, beforeHash: expected.beforeHash, afterHash: expected.afterHash,
        effects: expected.effects, ownChanges: expected.after.map(v => ({ actorId: v.actorId,
          before: expected.before.find(b => b.actorId === v.actorId)!.observation.projection.self, after: v.observation.projection.self })) });
      transitions++; intent = null; pending.clear();
    } else if (event.kind === 'failure') {
      const q = pending.get(d.actorId);
      if (!q || q.request.requestId !== d.requestId || q.response || d.outcome !== 'transport_failed' || d.held !== true) throw Error('continuation_failure_mismatch');
    } else if (event.kind === 'stop') {
      summary = d.summary as RunSummary;
      equal([summary.calls, summary.ticks, summary.finalStateHash, summary.historyHash, summary.bookedMicroUsd, summary.heldMicroUsd],
        [calls, host.tick, host.hash, digest(histories.export()), String(booked), String(held)], 'continuation_summary_mismatch');
      equal(d.histories, histories.export(), 'continuation_history_mismatch');
      equal(d.tape, host.tape(), 'continuation_tape_mismatch');
      if (evidenceHash(replay(d.tape, genesis.sourceRevision)) !== host.hash) throw Error('continuation_replay_mismatch');
      if (summary.status === 'completed' && host.tick !== plan.maxTicks) throw Error('continuation_premature_completion');
      if (summary.status === 'checkpoint' && (host.tick !== start.stopAtTick || host.tick >= plan.maxTicks || pending.size || intent)) throw Error('continuation_bad_checkpoint');
      stopped = true;
    } else throw Error('continuation_event_kind');
  }
  return { verified: true as const, complete: stopped, ledgerRoot: previous, sourceRevision: expectedSourceRevision,
    mode: start.mode, calls, transitions, finalStateHash: host.hash, historyHash: digest(histories.export()), summary,
    tickEvidence, metrics: 'not_validated' as const,
    recovery: { tape: host.tape(), histories: histories.export(), plan, runId: start.runId, budgetHistoryHash,
      seenRequests: [...seenRequests], receipts: [...receipts],
      resumable: stopped && !!summary && ['completed', 'checkpoint', 'call_limit'].includes(summary.status) && !pending.size && !intent && held === 0 && booked <= plan.allowance.limitMicroUsd } };
}
/** Native Inspect dataset rows: observed artifacts only; no fabricated explanations or scores. */
export function continuationInspectSamples(events: readonly ContinuationEvent[], sourceRevision: string) {
  const verified = verifyContinuation(events, sourceRevision);
  if (!verified.complete) throw Error('continuation_export_incomplete');
  const start = events[0]!.data as StartEvidence;
  return events.filter(e => e.kind === 'request').map(e => {
    const request = e.data, { actorId, requestId } = request;
    const transition = events.find(x => x.kind === 'transition' && x.data.requests[actorId] === requestId)?.data;
    const after = transition?.after.find((v: any) => v.actorId === actorId);
    const response = events.find(x => x.kind === 'response' && x.data.requestId === requestId)?.data;
    const receipt = events.find(x => x.kind === 'receipt' && x.data.requestId === requestId)?.data ?? null;
    const validation = events.find(x => x.kind === 'validation' && x.data.requestId === requestId)?.data ?? null;
    return { id: requestId, input: 'Review this verified Node continuation trace. Observed changes do not alone establish motive or causality.',
      target: '', metadata: { episode: start.plan.id, actorId, tick: request.tick, nextTick: transition?.nextTick ?? null,
        mode: start.mode, sourceRevision, ledgerRoot: verified.ledgerRoot, request: JSON.parse(request.body),
        rawResponseBase64: response?.raw ?? null, receipt, validation, executed: transition !== undefined,
        before: request.observation.projection, after: after?.observation.projection ?? null,
        kernelEffects: transition ? transition.effects.filter((x: any) => x.person === start.identities.find(s => s.actorId === actorId)?.person) : null,
        transitionHashes: transition ? { before: transition.beforeHash, after: transition.afterHash } : null,
        explicitExplanation: null, inferredCausality: [], behaviouralMetrics: 'not_validated',
        runStatus: verified.summary?.status } };
  });
}
