/**
 * A5 — execution telemetry (observatory handover, 2026-10-23).
 *
 * Counts, latency, tokens and money from the normalized ledger events only. These are execution
 * measures: none of them grades reasoning or decision quality, and an unknown stays unknown.
 * Accounting totals are the runner's own recorded snapshots (stop summaries); the observatory
 * never opens the allowance journal and never recomputes or releases a hold.
 */
import type { ObservatoryEvent } from './contracts.js';

/** Quoted list price for claude-haiku-5-5, prompts up to 100K tokens, USD per million
 *  (same figures `anthropicConnectionCheck.HAIKU_5_5_PRICES` reports; tested against the evidence). */
const LIST_USD_PER_M: Record<string, { input: number; output: number }> = { 'claude-haiku-5-5': { input: 0.10, output: 0.50 } };

export interface Telemetry {
  definitionsVersion: 'node-observatory-telemetry-v1';
  call_attempt_count: number;
  known_usage_count: number;
  other_receipt_count: number;
  response_without_receipt_count: number;
  transport_failure_count: number;
  pending_request_count: number;
  validator_admission_count: number;
  validator_rejection_count: number;
  executed_decision_count: number;
  completed_tick_count: number;
  final_tick: number | null;
  segment_count: number;
  response_latency_ms: { count: number; min: number | null; median: number | null; max: number | null };
  input_tokens: number;
  output_tokens: number;
  /** Per allowance grant (sourceRunId): the runner's recorded stop snapshot, or null while live. */
  accounting: { sourceRunId: string; booked_micro_usd: string | null; held_micro_usd: string | null; source: 'stop.summary' | 'not_available_until_stop' }[];
  booked_micro_usd_total: string | null;
  held_micro_usd_total: string | null;
  estimated_list_usd: { value: number | null; label: 'estimate from recorded usage at quoted list prices; not an invoice'; models: string[] };
  replay_integrity: { segmentId: string; verification: string; checkedThroughCursor: string | null; segmentRoot: string | null }[];
  unknown: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function telemetry(events: readonly ObservatoryEvent[]): Telemetry {
  const of = (type: ObservatoryEvent['type']) => events.filter(e => e.type === type);
  const data = (e: ObservatoryEvent) => e.data as Record<string, any>;
  const starts = of('start'), requests = of('request'), responses = of('response'), receipts = of('receipt');
  const validations = of('validation'), transitions = of('transition'), failures = of('failure'), stops = of('stop');
  const modelOf = new Map(starts.map(s => [s.segmentId, data(s).model as string]));

  const requestIds = new Set(requests.map(e => e.requestId!));
  const receiptIds = new Set(receipts.map(e => e.requestId!)), responseIds = new Set(responses.map(e => e.requestId!)), failureIds = new Set(failures.map(e => e.requestId!));
  const sameModel = receipts.filter(e => data(e).model === modelOf.get(e.segmentId));
  const executed = new Set(transitions.flatMap(e => Object.values(data(e).requests as Record<string, string>)));
  const latencies = responses.map(e => Number(data(e).latencyMs)).filter(Number.isFinite);

  const unknown: string[] = [];
  const grants = [...new Set(starts.map(s => s.sourceRunId))];
  const accounting = grants.map(runId => {
    const stop = stops.filter(s => s.sourceRunId === runId).at(-1);
    const openAfter = starts.filter(s => s.sourceRunId === runId).at(-1);
    const sealedLast = stop && openAfter && stop.segmentId === openAfter.segmentId;
    if (!sealedLast) { unknown.push(`accounting:${runId}`); return { sourceRunId: runId, booked_micro_usd: null, held_micro_usd: null, source: 'not_available_until_stop' as const }; }
    const s = data(stop!).summary;
    return { sourceRunId: runId, booked_micro_usd: String(s.bookedMicroUsd), held_micro_usd: String(s.heldMicroUsd), source: 'stop.summary' as const };
  });
  const known = accounting.every(a => a.booked_micro_usd !== null);
  const sum = (k: 'booked_micro_usd' | 'held_micro_usd') => known ? accounting.reduce((n, a) => n + BigInt(a[k]!), 0n).toString() : null;

  const models = [...new Set(sameModel.map(e => String(data(e).model)))];
  const priced = models.every(m => LIST_USD_PER_M[m]);
  if (!priced) unknown.push('estimated_list_usd:unpriced_model');
  const estimate = priced ? sameModel.reduce((n, e) => {
    const p = LIST_USD_PER_M[String(data(e).model)]!;
    return n + (data(e).inputTokens * p.input + data(e).outputTokens * p.output) / 1e6;
  }, 0) : null;

  return {
    definitionsVersion: 'node-observatory-telemetry-v1',
    call_attempt_count: requestIds.size,
    known_usage_count: new Set(sameModel.map(e => e.requestId)).size,
    other_receipt_count: receipts.length - sameModel.length,
    response_without_receipt_count: [...responseIds].filter(id => !receiptIds.has(id)).length,
    transport_failure_count: failureIds.size,
    pending_request_count: [...requestIds].filter(id => !responseIds.has(id) && !failureIds.has(id)).length,
    validator_admission_count: validations.filter(e => data(e).admitted !== null).length,
    validator_rejection_count: validations.filter(e => data(e).admitted === null).length,
    executed_decision_count: [...requestIds].filter(id => executed.has(id)).length,
    completed_tick_count: new Set(transitions.map(e => data(e).tick)).size,
    final_tick: transitions.length ? Number(data(transitions.at(-1)!).nextTick) : (starts.at(-1)?.sourceTick ?? null),
    segment_count: new Set(events.map(e => e.segmentId)).size,
    response_latency_ms: { count: latencies.length, min: latencies.length ? Math.min(...latencies) : null, median: median(latencies), max: latencies.length ? Math.max(...latencies) : null },
    input_tokens: sameModel.reduce((n, e) => n + Number(data(e).inputTokens), 0),
    output_tokens: sameModel.reduce((n, e) => n + Number(data(e).outputTokens), 0),
    accounting, booked_micro_usd_total: sum('booked_micro_usd'), held_micro_usd_total: sum('held_micro_usd'),
    estimated_list_usd: { value: estimate === null ? null : Math.round(estimate * 1e7) / 1e7, label: 'estimate from recorded usage at quoted list prices; not an invoice', models },
    replay_integrity: [...new Set(events.map(e => e.segmentId))].map(segmentId => {
      const mine = events.filter(e => e.segmentId === segmentId);
      return { segmentId, verification: mine.at(-1)!.verification, checkedThroughCursor: mine.at(-1)!.cursor, segmentRoot: mine.at(-1)!.segmentRoot };
    }),
    unknown,
  };
}
