/** Accounted condition transition from a verified continuation tape. Existing runners stay unchanged. */
import { sha256 } from '../agent/accountingStore.js';
import { usageCost } from '../agent/accountingLedger.js';
import { toAnthropicRequest, type AnthropicRequest } from '../agent/anthropicRequest.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import type { ExperimentBudget } from '../agent/experimentBudget.js';
import { stepParticipantState } from '../agent/participantWorld.js';
import { validateDecision } from '../agent/protocol.js';
import { digest, evidenceHash, replay, type ReplayTape } from '../agent/replay.js';
import type { Sender } from '../eval/accountedRunner.js';
import { observationPatch, applyObservationPatch, type History, type Message } from '../eval/continuationConversation.js';
import { ContinuationHost } from '../eval/continuationHost.js';
import { recoverContinuation, type ContinuationEvent, type ContinuationLedger } from '../eval/continuationLedger.js';
import { auditPerception, type PerceptionAuditWorker, type PerceptionAuditRecord } from './perceptionAudit.js';
import { assertPerceptionRecord, perceptionRequest, validateCondition, type PerceptionCondition, type PerceptionRecord } from './perception.js';
import { buildPerceptionAgentInput, perceptionDecisionContext, perceptionPolicyPacket, type PerceptionAgentInput } from './perceptionContext.js';

export interface PerceptionContinuationPlan {
  schema: 'node-accounted-perception-continuation-v1'; id: string; model: 'claude-haiku-5-5';
  ticks: number; maxCalls: number; condition: PerceptionCondition; perspective: 'first_person';
  memory: 'retain_exact_own_legacy_then_perception'; maxRequestBytes: number;
  deadlineMs: number; minIntervalMs: number;
  allowance: { maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number; windowHours: number };
}
export const perceptionPlanHash = (plan: PerceptionContinuationPlan) => sha256(JSON.stringify(plan));
export function validatePerceptionPlan(p: PerceptionContinuationPlan) {
  if (p?.schema !== 'node-accounted-perception-continuation-v1' || !/^[A-Za-z0-9._:-]{1,100}$/.test(p.id) || p.model !== 'claude-haiku-5-5' ||
    p.perspective !== 'first_person' || p.memory !== 'retain_exact_own_legacy_then_perception' ||
    ![p.ticks, p.maxCalls, p.maxRequestBytes, p.deadlineMs, p.minIntervalMs, ...Object.values(p.allowance ?? {})].every(Number.isSafeInteger) ||
    p.ticks < 1 || p.ticks > 100 || p.maxCalls < 1 || p.maxCalls > 700 || p.maxRequestBytes < 32768 || p.maxRequestBytes > 95000 ||
    p.deadlineMs < 1 || p.deadlineMs > 20000 || p.minIntervalMs < 0 || p.minIntervalMs > 600000 ||
    p.allowance.maxRequests !== p.maxCalls || p.allowance.limitMicroUsd < 1 || p.allowance.limitMicroUsd > 25000000 ||
    p.allowance.perRequestMicroUsd < 1 || p.allowance.perRequestMicroUsd > p.allowance.limitMicroUsd || p.allowance.windowHours < 1 || p.allowance.windowHours > 168) throw Error('perception_live_plan');
  validateCondition(p.condition);
}

interface PerceptionHistory { system: string; messages: Message[]; selfRef: string; lastTick: number; previousPacket: unknown | null }
export class PerceptionConversations {
  #histories: Map<string, PerceptionHistory>;
  constructor(legacy: readonly [string, History][], readonly maxBytes: number) {
    this.#histories = new Map(legacy.map(([id, h]) => [id, { system: h.system, messages: structuredClone(h.messages), selfRef: h.selfRef, lastTick: h.lastTick, previousPacket: null }]));
  }
  prepare(actorId: string, input: PerceptionAgentInput, context: AnthropicRequest['context'], model: string): AnthropicRequest {
    const h = this.#histories.get(actorId);
    if (!h || h.selfRef !== context.selfRef || context.tick <= h.lastTick || input.agentId !== actorId || input.tick !== context.tick) throw Error('perception_history_binding');
    const packet = perceptionPolicyPacket(input);
    const turn = h.previousPacket === null ? {
      conditionTransition: { tick: input.tick, from: 'authorized_global_observer', to: 'first_person_perception', memory: 'retain_exact_own_legacy_then_perception',
        instructions: 'Your exact earlier conversation remains your historical memory. It used broader authorized observations. From this turn only perceptionPacket (or its lossless updates) describes the CURRENT environment and permissions. Do not treat old locations, references, recognition or diary entries as current. No other actor history is supplied. Keep the prior system instructions about historical memory; use this current decision schema and role mechanics.' },
      roleRule: input.rules.role.duty, perceptionPacket: packet,
      perceptionEncoding: 'Later perceptionPatch objects update the previous perceptionPacket losslessly, in order. path is an array of keys/indexes; value replaces that path; remove:true deletes it; splice:{index,deleteCount,items} edits that array. Empty path replaces the whole packet. Unchanged fields remain. These are current environmental packets; older packets remain historical memory.',
    } : { roleRule: input.rules.role.duty, perceptionPatch: observationPatch(h.previousPacket, packet) };
    if (h.previousPacket !== null && digest(applyObservationPatch(h.previousPacket, (turn as { perceptionPatch: ReturnType<typeof observationPatch> }).perceptionPatch)) !== digest(packet)) throw Error('perception_history_encoding');
    const base = toAnthropicRequest({ context, body: JSON.stringify({ instructions: h.system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(turn) }] }],
      text: { format: { type: 'json_schema', strict: true, schema: input.decisionSchema } } }) }, model);
    const messages = [...structuredClone(h.messages), { role: 'user' as const, content: [{ type: 'text', text: JSON.stringify(turn) }] }];
    const body = JSON.stringify({ ...JSON.parse(base.body), messages });
    const size = Buffer.byteLength(body);
    if (size > this.maxBytes || size + 4096 > 100000) throw Error('perception_history_request_bound');
    const { max_tokens: _, output_config: __, ...count } = JSON.parse(body);
    return Object.freeze({ ...base, body, sha256: sha256(body), countBody: JSON.stringify(count), maxInputTokens: size + 4096 });
  }
  accept(actorId: string, wire: AnthropicRequest, input: PerceptionAgentInput, bytes: Buffer, requestId: string) {
    const h = this.#histories.get(actorId)!, sent = JSON.parse(wire.body), returned = JSON.parse(bytes.toString());
    if (!parseAnthropicResponse(bytes, requestId).actionable || sha256(wire.body) !== wire.sha256 || sent.system !== h.system ||
      digest(sent.messages.slice(0, -1)) !== digest(h.messages)) throw Error('perception_history_prefix');
    this.#histories.set(actorId, { ...h, lastTick: input.tick, previousPacket: structuredClone(perceptionPolicyPacket(input)),
      messages: [...sent.messages, { role: 'assistant', content: returned.content }] });
  }
  export() { return structuredClone([...this.#histories.entries()]); }
}

function setup(parentEvents: ContinuationEvent[], plan: PerceptionContinuationPlan) {
  validatePerceptionPlan(plan);
  const parent = recoverContinuation(parentEvents, parentEvents[0]?.data.sourceRevision);
  if (!parent.recovery.resumable || parent.recovery.plan.model !== plan.model || plan.maxCalls !== plan.ticks * parent.recovery.plan.actors.length) throw Error('perception_live_parent');
  const host = ContinuationHost.restore(parent.recovery.tape, parent.recovery.plan.actors);
  return { parent, host, mirror: replay(parent.recovery.tape, parent.recovery.tape.genesis.sourceRevision),
    histories: new PerceptionConversations(parent.recovery.histories, plan.maxRequestBytes) };
}
function auditBinding(request: ReturnType<typeof perceptionRequest>, record: PerceptionRecord, audit: PerceptionAuditRecord) {
  assertPerceptionRecord(request, record);
  if (audit.schema !== 'node-perception-independent-audit-v1' || audit.status !== 'agreement' || audit.agentId !== request.agentId ||
    audit.tick !== request.tick || audit.worldHash !== request.worldHash || audit.requestId !== request.requestId || audit.perspective !== request.perspective ||
    audit.requestSha256 !== record.requestSha256 || audit.workers.length !== 2 || new Set(audit.workers.map(w => w.workerId)).size !== 2 ||
    audit.workers.some(w => w.observationSha256 !== digest(record.observation)) || audit.workers[0]!.responseSha256 !== record.responseSha256) throw Error('perception_live_audit');
}

export async function runPerceptionContinuation(plan: PerceptionContinuationPlan, parentEvents: ContinuationEvent[], budget: ExperimentBudget,
  send: Sender, ledger: ContinuationLedger, workers: [PerceptionAuditWorker, PerceptionAuditWorker], sourceRevision: string,
  options: { signal?: AbortSignal; mode?: 'live' | 'offline_simulated_provider' } = {}) {
  const initialSetup = setup(parentEvents, plan), { parent, host, histories } = initialSetup; let mirror = initialSetup.mirror;
  const initial = budget.view(), auth = initial.authorization;
  if (!auth || auth.manifestSha256 !== perceptionPlanHash(plan) || auth.model !== plan.model || auth.maxRequests !== plan.maxCalls ||
    auth.limitMicroUsd !== plan.allowance.limitMicroUsd || auth.perRequestMicroUsd !== plan.allowance.perRequestMicroUsd || initial.requests.length ||
    budget.carriedFingerprint() !== parent.recovery.budgetHistoryHash || !initial.canReserve) throw Error('perception_live_allowance');
  const startTick = host.tick, endTick = startTick + plan.ticks;
  ledger.append('perception_start', { schema: plan.schema, plan, parent: { events: parentEvents, root: parent.ledgerRoot }, sourceRevision,
    mode: options.mode ?? 'live', runId: auth.runId, prices: auth.prices, carriedFingerprint: budget.carriedFingerprint(), budgetHistoryHash: initial.historyHash,
    identities: host.identities(), startTick });
  let calls = 0, status = 'completed', lastDispatch = -Infinity;
  run: while (host.tick < endTick) {
    const views = host.views();
    if (!views.length) { status = 'all_departed'; break; }
    const proposals: Record<string, unknown> = {}, requests: Record<string, string> = {};
    for (const view of views) {
      if (options.signal?.aborted) { status = 'cancelled'; break run; }
      if (calls >= plan.maxCalls) { status = 'call_limit'; break run; }
      const person = host.identities().find(p => p.actorId === view.actorId)!.person;
      const request = perceptionRequest(mirror, { agentId: view.actorId, person }, plan.perspective, plan.condition, { episodeId: plan.id, worldHash: host.hash });
      let record: PerceptionRecord, audit: PerceptionAuditRecord, input: PerceptionAgentInput, wire: AnthropicRequest;
      try {
        ({ record, audit } = await auditPerception(request, ...workers)); auditBinding(request, record, audit);
        input = buildPerceptionAgentInput(request, record, view.observation);
        wire = histories.prepare(view.actorId, input, perceptionDecisionContext(view.observation.context), plan.model);
      } catch (error) { status = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'perception_preflight_failed'; break run; }
      if (wire.body.includes(mirror.genesis.observerSecret)) throw Error('perception_live_secret');
      const ceiling = usageCost(wire.maxInputTokens, wire.maxOutputTokens, auth.prices), state = budget.view();
      if (!state.canReserve || ceiling > auth.perRequestMicroUsd || BigInt(ceiling) > state.remainingMicroUsd!) { status = 'budget_stopped'; break run; }
      const wait = lastDispatch + plan.minIntervalMs - performance.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (options.signal?.aborted) { status = 'cancelled'; break run; }
      const requestId = sha256(JSON.stringify([auth.runId, plan.id, view.actorId, host.tick, request.requestId]));
      const reservation = { id: requestId, episodeId: plan.id, actorId: view.actorId, inputSha256: wire.sha256,
        participant: { tick: host.tick, selfRef: wire.context.selfRef, role: wire.context.role, roleEpoch: wire.context.roleEpoch },
        model: plan.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens };
      if (budget.reserve(reservation) !== 'reserved') throw Error('perception_live_consumed');
      ledger.append('perception_request', { requestId, actorId: view.actorId, tick: host.tick, worldHash: host.hash, perceptionRequest: request, record, audit,
        body: wire.body, sha256: wire.sha256, reservation, ceiling, budgetHistoryHash: budget.view().historyHash });
      requests[view.actorId] = requestId;
      const controller = new AbortController(), cancel = () => controller.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
      const begun = performance.now(); lastDispatch = begun; let timer: ReturnType<typeof setTimeout> | undefined; let bytes: Buffer;
      const index = calls++;
      try { bytes = await Promise.race([send({ requestId, body: wire.body, sha256: wire.sha256, episodeId: plan.id, actorId: view.actorId, tick: host.tick, index, provider: 'anthropic' }, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('deadline')); }, plan.deadlineMs); })]); }
      catch { ledger.append('perception_failure', { requestId, actorId: view.actorId, held: true }); status = 'transport_failed'; break run; }
      finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
      const latencyMs = performance.now() - begun;
      ledger.append('perception_response', { requestId, actorId: view.actorId, raw: bytes.toString('base64'), sha256: sha256(bytes), latencyMs });
      let parsed;
      try { parsed = parseAnthropicResponse(bytes, requestId); } catch { status = 'response_invalid'; break run; }
      if (!parsed.receipt.usage) { status = 'usage_unknown'; break run; }
      budget.recordUsage({ requestId, receiptId: parsed.receipt.receiptId, model: parsed.receipt.model, sourceSha256: parsed.receipt.sourceSha256, ...parsed.receipt.usage });
      ledger.append('perception_receipt', { requestId, actorId: view.actorId, parsed, budgetHistoryHash: budget.view().historyHash });
      if (parsed.receipt.model !== plan.model || budget.view().overrun || latencyMs > plan.deadlineMs || options.signal?.aborted ||
        JSON.parse(bytes.toString()).input_transformations?.length || !parsed.actionable) { status = 'response_not_applicable'; break run; }
      const admitted = validateDecision(parsed.decision, wire.context);
      ledger.append('perception_validation', { requestId, actorId: view.actorId, admitted });
      if (!admitted) { status = 'decision_rejected'; break run; }
      histories.accept(view.actorId, wire, input, bytes, requestId); proposals[view.actorId] = parsed.decision;
    }
    ledger.append('perception_intent', { tick: host.tick, beforeHash: host.hash, requests, proposals });
    const transition = host.advance(views, proposals);
    mirror = stepParticipantState(mirror, transition.tapeTick.actions, transition.tapeTick.online).state;
    if (evidenceHash(mirror) !== transition.afterHash) throw Error('perception_live_mirror');
    ledger.append('perception_transition', { ...transition, requests, historyHash: digest(histories.export()) });
  }
  const v = budget.view();
  const summary = { status, calls, startTick, finalTick: host.tick, completedTicks: host.tick - startTick, finalWorldHash: host.hash,
    historyHash: digest(histories.export()), budgetHistoryHash: v.historyHash, bookedMicroUsd: String(v.booked), heldMicroUsd: String(v.held) };
  ledger.append('perception_stop', { summary, tape: host.tape(), histories: histories.export() });
  return summary;
}

/** Rebuild request bytes, signed memory prefixes, admission, costs and world from original evidence. */
export function verifyPerceptionContinuation(events: ContinuationEvent[]) {
  let previous = '0'.repeat(64);
  events.forEach((e, i) => { if (e.seq !== i || e.previous !== previous || e.hash !== digest([i, previous, e.kind, e.data])) throw Error('perception_live_chain'); previous = e.hash; });
  const start = events[0]?.data;
  if (events[0]?.kind !== 'perception_start' || !/^[a-f0-9]{40}$/.test(start.sourceRevision)) throw Error('perception_live_start');
  const plan = start.plan as PerceptionContinuationPlan, initialSetup = setup(start.parent.events, plan), { parent, host, histories } = initialSetup; let mirror = initialSetup.mirror;
  if (!['live', 'offline_simulated_provider'].includes(start.mode)) throw Error('perception_live_mode');
  const eq = (a: unknown, b: unknown) => { if (digest(a) !== digest(b)) throw Error('perception_live_evidence_mismatch'); };
  eq(start.parent.root, parent.ledgerRoot); eq(start.carriedFingerprint, parent.recovery.budgetHistoryHash); eq(start.identities, host.identities()); eq(start.startTick, host.tick);
  eq(start.prices, parentEventsPrices(start.parent.events, plan.model));
  const pending = new Map<string, { d: any; wire: AnthropicRequest; input: PerceptionAgentInput; raw?: Buffer; latency?: number; parsed?: ReturnType<typeof parseAnthropicResponse>; received?: boolean; valid?: boolean }>();
  let calls = 0, booked = 0, held = 0, stopped = false, intent: any = null, summary: any = null;
  const seen = new Set<string>(), receipts = new Set<string>();
  for (const e of events.slice(1)) {
    if (stopped) throw Error('perception_live_after_stop'); const d = e.data;
    if (e.kind === 'perception_request') {
      const view = host.views()[pending.size];
      if (!view || view.actorId !== d.actorId || intent || [...pending.values()].some(p => !p.valid) || seen.has(d.requestId) || calls >= plan.maxCalls || host.tick >= start.startTick + plan.ticks) throw Error('perception_live_order');
      const person = host.identities().find(p => p.actorId === view.actorId)!.person;
      const req = perceptionRequest(mirror, { agentId: d.actorId, person }, plan.perspective, plan.condition, { episodeId: plan.id, worldHash: host.hash });
      eq(d.perceptionRequest, req); auditBinding(req, d.record, d.audit);
      const input = buildPerceptionAgentInput(req, d.record, view.observation), wire = histories.prepare(d.actorId, input, perceptionDecisionContext(view.observation.context), plan.model);
      eq([d.tick, d.worldHash, d.body, d.sha256], [host.tick, host.hash, wire.body, wire.sha256]);
      const requestId = sha256(JSON.stringify([start.runId, plan.id, d.actorId, host.tick, req.requestId])); eq(requestId, d.requestId);
      eq(d.reservation, { id: requestId, episodeId: plan.id, actorId: d.actorId, inputSha256: wire.sha256,
        participant: { tick: host.tick, selfRef: wire.context.selfRef, role: wire.context.role, roleEpoch: wire.context.roleEpoch }, model: plan.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens });
      eq(d.ceiling, usageCost(wire.maxInputTokens, wire.maxOutputTokens, start.prices));
      if (d.ceiling > plan.allowance.perRequestMicroUsd || booked + held + d.ceiling > plan.allowance.limitMicroUsd) throw Error('perception_live_cost');
      held += d.ceiling; calls++; seen.add(requestId); pending.set(d.actorId, { d, wire, input });
    } else if (e.kind === 'perception_response') {
      const p = pending.get(d.actorId); if (!p || p.raw || p.d.requestId !== d.requestId || !Number.isFinite(d.latencyMs) || d.latencyMs < 0) throw Error('perception_live_response_order');
      p.raw = Buffer.from(d.raw, 'base64'); eq(sha256(p.raw), d.sha256); p.latency = d.latencyMs;
      try { p.parsed = parseAnthropicResponse(p.raw, d.requestId); } catch { /* failed raw response remains evidence */ }
    } else if (e.kind === 'perception_receipt') {
      const p = pending.get(d.actorId); if (!p?.parsed?.receipt.usage || p.received || p.d.requestId !== d.requestId || receipts.has(p.parsed.receipt.receiptId)) throw Error('perception_live_receipt_order');
      eq(d.parsed, p.parsed); receipts.add(p.parsed.receipt.receiptId); p.received = true;
      if (p.parsed.receipt.model === plan.model) { booked += usageCost(p.parsed.receipt.usage.inputTokens, p.parsed.receipt.usage.outputTokens, start.prices); held -= p.d.ceiling; }
    } else if (e.kind === 'perception_validation') {
      const p = pending.get(d.actorId); if (!p?.received || !p.parsed?.actionable || p.valid || p.d.requestId !== d.requestId || p.parsed.receipt.model !== plan.model || p.latency! > plan.deadlineMs || JSON.parse(p.raw!.toString()).input_transformations?.length) throw Error('perception_live_validation');
      const u = p.parsed.receipt.usage!;
      if (u.inputTokens > p.wire.maxInputTokens || u.outputTokens > p.wire.maxOutputTokens || usageCost(u.inputTokens, u.outputTokens, start.prices) > p.d.ceiling || booked > plan.allowance.limitMicroUsd) throw Error('perception_live_overrun');
      const admitted = validateDecision(p.parsed.decision, p.wire.context); eq(d.admitted, admitted);
      if (admitted) { histories.accept(d.actorId, p.wire, p.input, p.raw!, d.requestId); p.valid = true; }
    } else if (e.kind === 'perception_intent') {
      if (intent || pending.size !== host.views().length || [...pending.values()].some(p => !p.valid)) throw Error('perception_live_incomplete_tick');
      eq(d, { tick: host.tick, beforeHash: host.hash, requests: Object.fromEntries([...pending].map(([id,p]) => [id,p.d.requestId])), proposals: Object.fromEntries([...pending].map(([id,p]) => [id,p.parsed!.decision])) }); intent = d;
    } else if (e.kind === 'perception_transition') {
      if (!intent) throw Error('perception_live_missing_intent');
      const transition = host.advance(host.views(), intent.proposals); eq(d, { ...transition, requests: intent.requests, historyHash: digest(histories.export()) });
      mirror = stepParticipantState(mirror, transition.tapeTick.actions, transition.tapeTick.online).state; eq(evidenceHash(mirror), host.hash); pending.clear(); intent = null;
    } else if (e.kind === 'perception_failure') {
      const p = pending.get(d.actorId); if (!p || p.raw || d.requestId !== p.d.requestId || d.held !== true) throw Error('perception_live_failure');
    } else if (e.kind === 'perception_stop') {
      summary = d.summary;
      eq([summary.calls, summary.startTick, summary.finalTick, summary.completedTicks, summary.finalWorldHash, summary.historyHash, summary.bookedMicroUsd, summary.heldMicroUsd],
        [calls, start.startTick, host.tick, host.tick - start.startTick, host.hash, digest(histories.export()), String(booked), String(held)]);
      eq(d.histories, histories.export()); eq(d.tape, host.tape()); eq(evidenceHash(replay(d.tape as ReplayTape, parent.recovery.tape.genesis.sourceRevision)), host.hash);
      if (summary.status === 'completed' && (pending.size || intent || summary.completedTicks !== plan.ticks || calls !== plan.maxCalls)) throw Error('perception_live_premature_stop'); stopped = true;
    } else throw Error('perception_live_event_kind');
  }
  if (!stopped) throw Error('perception_live_unsealed');
  return { verified: true as const, ledgerRoot: previous, sourceRevision: start.sourceRevision as string, summary, metrics: 'not_evaluated' as const };
}
function parentEventsPrices(events: ContinuationEvent[], model: string) {
  const prices = events[0]!.data.prices;
  if (prices.model !== model) throw Error('perception_live_prices'); return prices;
}
