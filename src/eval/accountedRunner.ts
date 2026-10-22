/**
 * Capped, accounted batch runner for a construct study (owner decisions 2026-10-20: capped batch
 * runner, USD 5 first allowance; model gpt-5.4-nano-2026-03-17, then claude-haiku-5-5 by owner
 * decision D11, 2026-10-22).
 *
 * Provider by model id: `claude-*` models receive the Anthropic Messages translation of the final
 * evaluation request (`toAnthropicRequest`), and their receipts are read by
 * `parseAnthropicResponse`. Every other model is sent the evaluation request unchanged. Either way
 * the reservation names the sha256 and ceilings of the exact bytes dispatched.
 *
 * For every present actor at every tick of every manifest episode, in a fixed order:
 *
 *   evaluation request (final bytes) → durable reservation → send → usage recorded →
 *   proposal text → (all actors) → validator → one kernel step
 *
 * Fail-closed rules, carried over from runInitialGameTurn:
 * - a reservation is durable before dispatch, and one request is outstanding at a time;
 * - transport failure, unknown usage, a wrong model, or a response past its deadline keeps the
 *   hold, records `inference_failed`, and stops the whole run (no retries);
 * - usage is recorded before the response can influence the game; an unactionable response is
 *   still paid and becomes an unparseable proposal, never a substitute decision;
 * - the allowance stopping (cost, count, expiry, overrun) records `budget_stopped` and stops.
 * Paid responses from a tick that could not complete are kept in the call log, never applied.
 * Reasoning evidence: every call record that holds a response states the reasoning configuration
 * read back from the bytes sent and what the provider returned (`CallRecord.reasoning`), linked to
 * the episode tape by `requestId`. It is evidence beside the decision, never an input to the game.
 *
 * Resume: episodes the caller has verified complete are skipped. An episode that was interrupted
 * is run again from genesis as a new attempt with its own ledger streams (`<episodeId>:a<n>`), so
 * no paid request is ever re-sent and every attempt stays in the ledger. A failed call must first
 * be settled by the operator (booked at its full ceiling) or the allowance stays blocked.
 * Pacing: dispatches start at least `minIntervalMs` apart, to stay under provider rate limits.
 */
import { sha256 } from '../agent/accountingStore.js';
import { parseRecordedResponse, type RecordedResponse } from '../agent/recordedResponse.js';
import { toAnthropicRequest, ANTHROPIC_THINKING, ANTHROPIC_EFFORT } from '../agent/anthropicRequest.js';
import { parseAnthropicResponse, type ReasoningEvidence, type ReasoningStatus } from '../agent/anthropicResponse.js';
import type { EvaluationRequest } from './evaluationRequest.js';
import { usageCost } from '../agent/accountingLedger.js';
import type { ExperimentBudget } from '../agent/experimentBudget.js';
import { MultiActorEpisode, multiScenarioById, type MultiEpisodeRecord } from './multiActorEpisode.js';
import { contractHash, AUTHORITY_ATTRIBUTION_CONTRACT } from './constructs/authorityAttribution.js';

export const STUDY_MANIFEST_SCHEMA = 'node-accounted-study-manifest-v1' as const;
export interface StudyManifest {
  schema: typeof STUDY_MANIFEST_SCHEMA;
  id: string;
  description: string;
  contract: { id: string; version: string; hash: string };
  model: string;
  /** Required for a Claude model, and must be what the request builder sends; absent otherwise. */
  reasoning?: { thinking: { type: string; display: string }; effort: string };
  deadlineMs: number;
  minIntervalMs: number;
  episodes: { episodeId: string; scenario: string; replicate: number }[];
  allowance: { maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number; windowHours: number };
}
export interface CallRecord {
  index: number; requestId: string; episodeId: string; actorId: string; tick: number; requestSha256: string;
  outcome: 'response_recorded' | 'transport_failed' | 'usage_unknown' | 'model_mismatch' | 'deadline_exceeded';
  receiptId?: string; model?: string; status?: string; actionable?: boolean; inputTokens?: number; outputTokens?: number;
  reasoning?: CallReasoning;
}
/** `requested` is read from the dispatched bytes; `not_requested` means the request asked for none. */
export interface CallReasoning {
  requested: unknown;
  status: ReasoningStatus | 'not_requested';
  source: ReasoningEvidence['source'] | null;
  summaries: string[]; signatureSha256: string[]; redactedBlocks: number;
}
export interface SendInput { requestId: string; body: string; sha256: string; episodeId: string; actorId: string; tick: number; index: number; provider: Provider }
export type Sender = (input: SendInput, signal: AbortSignal) => Promise<Buffer>;
export interface StudySink { call(entry: CallRecord): void; episode(record: MultiEpisodeRecord, episodeId: string): void }
export interface StudySummary {
  manifestId: string; manifestSha256: string; runId: string; stoppedReason: string | null;
  episodesCompleted: number; episodesStarted: number; episodesSkipped: number; calls: number; bookedMicroUsd: string; heldMicroUsd: string;
}

const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
export const manifestSha256 = (manifest: StudyManifest) => sha256(JSON.stringify(manifest));

export type Provider = 'openai' | 'anthropic';
export const providerFor = (model: string): Provider => (model.startsWith('claude-') ? 'anthropic' : 'openai');
/** The exact bytes dispatched for `request`, and their ceilings. */
export function wireRequest(request: EvaluationRequest, model: string): { body: string; sha256: string; maxInputTokens: number; maxOutputTokens: number } {
  if (providerFor(model) === 'anthropic') {
    const a = toAnthropicRequest(request, model);
    return { body: a.body, sha256: a.sha256, maxInputTokens: a.maxInputTokens, maxOutputTokens: a.maxOutputTokens };
  }
  return { body: request.body, sha256: request.sha256, maxInputTokens: request.maxInputTokens, maxOutputTokens: request.maxOutputTokens };
}
const readReceipt = (model: string, bytes: Buffer, requestId: string): RecordedResponse & { reasoning?: ReasoningEvidence } =>
  providerFor(model) === 'anthropic' ? parseAnthropicResponse(bytes, requestId) : parseRecordedResponse(bytes, requestId);
/** The reasoning settings in the bytes actually sent, and what came back. */
function callReasoning(body: string, evidence: ReasoningEvidence | undefined): CallReasoning {
  const b = JSON.parse(body) as { thinking?: unknown; output_config?: { effort?: unknown }; reasoning?: unknown };
  const requested = 'thinking' in b ? { thinking: b.thinking, effort: b.output_config?.effort ?? null } : { reasoning: b.reasoning ?? null };
  if (!evidence) return { requested, status: 'not_requested', source: null, summaries: [], signatureSha256: [], redactedBlocks: 0 };
  return { requested, status: evidence.status, source: evidence.source, summaries: evidence.summaries, signatureSha256: evidence.signatureSha256, redactedBlocks: evidence.redactedBlocks };
}
/** Upper bound for an operator-chosen slower pacing (`options.minIntervalMs`). */
export const MAX_MIN_INTERVAL_MS = 600_000;

export function validateManifest(m: StudyManifest): void {
  const C = AUTHORITY_ATTRIBUTION_CONTRACT;
  if (m?.schema !== STUDY_MANIFEST_SCHEMA || !id(m.id) || typeof m.description !== 'string' || !id(m.model) ||
    m.contract?.id !== C.id || m.contract.version !== C.version || m.contract.hash !== contractHash() ||
    !Number.isSafeInteger(m.deadlineMs) || m.deadlineMs < 1 || m.deadlineMs > 20_000 ||
    !Number.isSafeInteger(m.minIntervalMs) || m.minIntervalMs < 0 || m.minIntervalMs > 60_000 || !Array.isArray(m.episodes) || !m.episodes.length ||
    new Set(m.episodes.map((e) => e.episodeId)).size !== m.episodes.length || !m.episodes.every((e) => id(e.episodeId) && Number.isSafeInteger(e.replicate))) {
    throw Error('study_manifest_invalid');
  }
  const reasoning = providerFor(m.model) === 'anthropic' ? JSON.stringify({ thinking: ANTHROPIC_THINKING, effort: ANTHROPIC_EFFORT }) : undefined;
  if ((m.reasoning === undefined ? undefined : JSON.stringify(m.reasoning)) !== reasoning) throw Error('study_manifest_reasoning_mismatch');
  for (const e of m.episodes) multiScenarioById(e.scenario);
  const needed = m.episodes.length * C.controlledActors.length * C.design.ticks;
  if (m.allowance.maxRequests < needed) throw Error('allowance_smaller_than_manifest');
}

export async function runAccountedStudy(manifest: StudyManifest, budget: ExperimentBudget, send: Sender, sink: StudySink,
  options: { sourceRevision: string; forbiddenSubstrings?: readonly string[]; completedEpisodes?: ReadonlySet<string>; minIntervalMs?: number }): Promise<StudySummary> {
  validateManifest(manifest);
  // Pacing may be slowed for a lower provider tier, never sped up beyond the manifest's floor.
  if (options.minIntervalMs !== undefined && (!Number.isSafeInteger(options.minIntervalMs) || options.minIntervalMs < manifest.minIntervalMs ||
    options.minIntervalMs > MAX_MIN_INTERVAL_MS)) throw Error('min_interval_invalid');
  const minIntervalMs = options.minIntervalMs ?? manifest.minIntervalMs;
  const provider = providerFor(manifest.model);
  const start = budget.view();
  if (!start.authorization) throw Error('allowance_not_authorized');
  if (start.authorization.manifestSha256 !== manifestSha256(manifest) || start.authorization.model !== manifest.model) throw Error('allowance_manifest_mismatch');
  const runId = start.authorization.runId;
  let calls = 0, completed = 0, started = 0, skipped = 0, stoppedReason: string | null = null, lastDispatch = -Infinity;
  const done = options.completedEpisodes ?? new Set<string>();
  for (const e of done) if (!manifest.episodes.some((x) => x.episodeId === e)) throw Error('completed_episode_not_in_manifest');

  for (const entry of manifest.episodes) {
    if (stoppedReason) break;
    if (done.has(entry.episodeId)) { skipped += 1; continue; }
    // A fresh attempt gets fresh ledger streams; earlier attempts' requests stay recorded.
    const prior = new Set(budget.view().requests.map((q) => q.request.episodeId).filter((x) => x === entry.episodeId || x.startsWith(`${entry.episodeId}:a`)));
    const stream = prior.size === 0 ? entry.episodeId : `${entry.episodeId}:a${prior.size + 1}`;
    const ep = new MultiActorEpisode(multiScenarioById(entry.scenario), options.sourceRevision);
    started += 1;
    while (!ep.done && !stoppedReason) {
      const prompts = ep.prompts({ model: manifest.model });
      const outputs: Record<string, string> = {}, receipts: Record<string, unknown> = {};
      for (const p of prompts) {
        const request = p.request!, tick = request.context.tick, wire = wireRequest(request, manifest.model);
        const view = budget.view();
        // Stop cleanly when the next request's ceiling no longer fits; reserve() would refuse it.
        const ceiling = BigInt(usageCost(wire.maxInputTokens, wire.maxOutputTokens, view.authorization!.prices));
        const stop = !view.canReserve ? view.stopReason : ceiling > BigInt(view.authorization!.perRequestMicroUsd) ? 'request_ceiling' : ceiling > view.remainingMicroUsd! ? 'cost_limit' : null;
        if (stop) { stoppedReason = `budget_stopped:${stop}`; ep.halt('budget_stopped', { reason: stop, actorId: p.actorId }); break; }
        if (options.forbiddenSubstrings?.some((s) => s && (request.body.includes(s) || wire.body.includes(s)))) throw Error('dispatch_precondition');
        const requestId = sha256(JSON.stringify([runId, stream, p.actorId, request.context.selfRef, tick]));
        const wait = lastDispatch + minIntervalMs - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const index = calls++;
        const base = { index, requestId, episodeId: stream, actorId: p.actorId, tick, requestSha256: wire.sha256 };
        if (budget.reserve({ id: requestId, episodeId: stream, actorId: p.actorId, inputSha256: wire.sha256,
          participant: { tick, selfRef: request.context.selfRef, role: request.context.role, roleEpoch: request.context.roleEpoch },
          model: request.model, maxInputTokens: wire.maxInputTokens, maxOutputTokens: wire.maxOutputTokens }) !== 'reserved') {
          throw Error('request_already_consumed');
        }
        const fail = (outcome: CallRecord['outcome'], extra: Partial<CallRecord> = {}) => {
          sink.call({ ...base, outcome, ...extra });
          stoppedReason = `inference_failed:${outcome}`;
          ep.halt('inference_failed', { outcome, actorId: p.actorId, requestId });
        };
        const abort = new AbortController();
        const begun = performance.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let bytes: Buffer;
        lastDispatch = performance.now();
        try {
          bytes = await Promise.race([send({ requestId, body: wire.body, sha256: wire.sha256, episodeId: stream, actorId: p.actorId, tick, index, provider }, abort.signal),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error('deadline')); }, manifest.deadlineMs); })]);
        } catch { fail('transport_failed'); break; } finally { if (timer) clearTimeout(timer); }
        // The deadline covers the provider round trip only; local ledger writes below must not count.
        const received = performance.now();
        let recorded;
        try { recorded = readReceipt(manifest.model, bytes, requestId); } catch { fail('usage_unknown'); break; }
        const u = recorded.receipt.usage;
        if (!u) { fail('usage_unknown'); break; }
        // Book usage before the response can affect anything, including when it is late or wrong.
        budget.recordUsage({ requestId, receiptId: recorded.receipt.receiptId, sourceSha256: recorded.receipt.sourceSha256,
          model: recorded.receipt.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
        const receipt = { receiptId: recorded.receipt.receiptId, model: recorded.receipt.model, status: recorded.receipt.status, actionable: recorded.actionable,
          inputTokens: u.inputTokens, outputTokens: u.outputTokens };
        const reasoning = callReasoning(wire.body, recorded.reasoning);
        if (recorded.receipt.model !== manifest.model) { fail('model_mismatch', { ...receipt, reasoning }); break; }
        if (received - begun > manifest.deadlineMs) { fail('deadline_exceeded', { ...receipt, reasoning }); break; }
        sink.call({ ...base, outcome: 'response_recorded', ...receipt, reasoning });
        // An unactionable response is paid for and recorded as unparseable, never replaced.
        outputs[p.actorId] = recorded.actionable ? JSON.stringify(recorded.decision) : '';
        receipts[p.actorId] = { requestId, ...receipt };
      }
      if (stoppedReason) break;
      ep.act(outputs, receipts);
    }
    const record = ep.finish();
    sink.episode(record, stream === entry.episodeId ? entry.episodeId : stream.replace(':', '-'));
    if (record.status === 'completed' || record.status === 'all_departed') completed += 1;
  }
  const end = budget.view();
  return { manifestId: manifest.id, manifestSha256: manifestSha256(manifest), runId, stoppedReason, episodesCompleted: completed, episodesStarted: started, episodesSkipped: skipped,
    calls, bookedMicroUsd: end.booked.toString(), heldMicroUsd: end.held.toString() };
}
