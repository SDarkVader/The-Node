import { readFileSync, lstatSync } from 'node:fs';
import { ExperimentBudget } from '../agent/experimentBudget.js';
import { sha256 } from '../agent/accountingStore.js';
import { replay } from '../agent/replay.js';
import { recoverContinuation, type ContinuationEvent } from '../eval/continuationLedger.js';
import type { StartEvidence } from '../eval/continuationRunner.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { LedgerTail } from './ledgerTail.js';
import { projectWorld } from './worldProjection.js';

export interface Registration { id: string; ledger: string; sourceRevision: string; journal?: string; evaluations?: string | string[] }
export interface Point { segmentId: string; cursor: string; event: ContinuationEvent; events: readonly ContinuationEvent[]; index: number; start: StartEvidence }
export function points(events: readonly ContinuationEvent[]): Point[] {
  if (!events.length) return [];
  const start = events[0]!.data as StartEvidence;
  const parent = start.parent ? points(start.parent.events) : [];
  const segmentId = events[0]!.hash;
  return [...parent, ...events.map((event, index) => ({ segmentId, cursor: `${segmentId}:${event.seq}:${event.hash}`, event, events, index, start }))];
}

/** Only this trusted backend sees ledger bodies/signatures, genesis secrets and file paths. */
export class ObservatorySource {
  readonly tail: LedgerTail;
  #events: readonly ContinuationEvent[] = [];
  #points: Point[] = [];
  #snapshot = new Map<string, ReturnType<typeof recoverContinuation>>();
  constructor(readonly registration: Registration) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(registration.id) || !/^[a-f0-9]{40}$/.test(registration.sourceRevision)) throw Error('observatory_registration');
    this.tail = new LedgerTail(registration.ledger, registration.sourceRevision);
  }
  refresh() {
    const next = this.tail.read();
    if (next !== this.#events) { this.#events = next; this.#points = points(next); }
    return this.#points.length > 0;
  }
  get latestCursor() { return this.#points.at(-1)?.cursor ?? null; }
  has(cursor: string) { return this.#points.some(p => p.cursor === cursor); }
  list() { return this.#points.map(p => ({ cursor: p.cursor, segmentId: p.segmentId, seq: p.event.seq, eventHash: p.event.hash,
    type: p.event.kind, sourceTick: p.event.data.tick ?? p.event.data.summary?.ticks ?? null })); }
  point(cursor: string | null = null) {
    const p = cursor === null ? this.#points.at(-1) : this.#points.find(p => p.cursor === cursor);
    if (!p) throw Error('observatory_cursor_unknown');
    return p;
  }
  snapshot(cursor: string | null, secret: string, researcher: boolean) {
    const p = this.point(cursor), selected = p.events.slice(0, p.index + 1);
    let verified = this.#snapshot.get(p.cursor);
    if (!verified) {
      verified = recoverContinuation(selected, p.start.sourceRevision);
      // Bounded cache; a new viewer cannot create an unbounded state cache.
      if (this.#snapshot.size >= 8) this.#snapshot.delete(this.#snapshot.keys().next().value!);
      this.#snapshot.set(p.cursor, verified);
    }
    const state = replay(verified.recovery.tape, verified.recovery.tape.genesis.sourceRevision);
    const meta = { schema: 'node-observatory-snapshot-v1', experimentId: this.registration.id, segmentId: p.segmentId,
      sourceRunId: p.start.runId, sourceRevision: p.start.sourceRevision, genesisSourceRevision: p.start.genesis.sourceRevision,
      cursor: p.cursor, eventHash: p.event.hash, sourceTick: state.world.tick, worldHash: verified.finalStateHash,
      segmentRoot: verified.complete ? verified.ledgerRoot : null, mode: p.start.mode,
      status: verified.summary?.status ?? 'recorded_prefix', verification: 'replay_verified',
      following: cursor === null, providerReasoning: p.start.mode === 'live' ? 'provider_returned' : 'synthetic_test_only' };
    const projected = projectWorld(state, secret);
    const result = { ...meta, hello: { ...projected.hello, ...meta, type: 'hello' }, frame: { ...projected.frame, ...meta, type: 'tick' } };
    if (!researcher) return result;
    const through = points(selected), requests = through.filter(x => x.event.kind === 'request');
    const calls = requests.map(q => {
      const d = q.event.data, related = through.filter(x => x.event.data.requestId === d.requestId);
      const response = related.find(x => x.event.kind === 'response')?.event.data;
      const receipt = related.find(x => x.event.kind === 'receipt')?.event.data;
      const validation = related.find(x => x.event.kind === 'validation')?.event.data;
      const transition = through.find(x => x.event.kind === 'transition' && x.event.data.requests[d.actorId] === d.requestId)?.event.data;
      let parsed;
      try { if (response) parsed = parseAnthropicResponse(Buffer.from(response.raw, 'base64'), d.requestId); } catch { /* absent/invalid is explicit */ }
      return { cursor: q.cursor, segmentId: q.segmentId, sourceRunId: q.start.runId,
        requestId: d.requestId, actorId: d.actorId, tick: d.tick, observation: d.observation,
        reasoning: parsed ? { source: parsed.reasoning.source, status: parsed.reasoning.status,
          summaries: parsed.reasoning.summaries, redactedBlocks: parsed.reasoning.redactedBlocks } : { status: response ? 'unparseable' : related.some(x => x.event.kind === 'failure') ? 'transport_failed' : 'pending', summaries: [] },
        latencyMs: response?.latencyMs ?? null, proposal: parsed?.decision ?? null, admitted: validation?.admitted ?? null,
        executed: !!transition, nextTick: transition?.nextTick ?? null,
        // Effects are facts about this actor, not a judgment of the provider's explanation.
        effects: transition?.effects.filter((e: { person: string }) => e.person === q.start.identities.find(a => a.actorId === d.actorId)?.person).map((e: { category: string }) => e.category) ?? [],
        usage: receipt ? { model: receipt.receipt.model, inputTokens: receipt.receipt.inputTokens, outputTokens: receipt.receipt.outputTokens,
          bookedMicroUsd: receipt.bookedMicroUsd, stopReason: receipt.stopReason } : null,
        heldMicroUsd: receipt?.bookedMicroUsd != null ? 0 : d.ceilingMicroUsd };
    });
    return { ...result, phase: 'execution', calls, timeline: this.list().slice(0, this.#points.indexOf(p) + 1),
      telemetry: { callAttemptCount: calls.length, knownUsageCount: calls.filter(c => c.usage?.bookedMicroUsd != null).length,
        validatorAdmissionCount: calls.filter(c => c.admitted !== null).length, executedDecisionCount: calls.filter(c => c.executed).length,
        completedTickCount: through.filter(x => x.event.kind === 'transition').length,
        inputTokens: calls.reduce((n,c) => n + (c.usage?.inputTokens ?? 0), 0), outputTokens: calls.reduce((n,c) => n + (c.usage?.outputTokens ?? 0), 0),
        bookedMicroUsd: calls.reduce((n,c) => n + BigInt(c.usage?.bookedMicroUsd ?? 0), 0n).toString(),
        heldMicroUsd: calls.reduce((n,c) => n + BigInt(c.heldMicroUsd), 0n).toString(), basis: 'verified_ledger_receipts_at_cursor', qualityEvaluation: 'not_evaluated' },
      accounting: this.accounting() };
  }
  accounting() {
    const path = this.registration.journal;
    if (!path) return { status: 'not_registered', historicalBillingReconciled: false };
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw Error('observatory_journal_bounds');
    const envelope = JSON.parse(readFileSync(path, 'utf8'));
    if (envelope.format !== 'node-accounting-journal-v1' || sha256(envelope.payload) !== envelope.sha256) throw Error('observatory_journal_checksum');
    const v = ExperimentBudget.inspect(JSON.parse(envelope.payload));
    const ledgerHistory = [...this.#events].reverse().find(e => typeof e.data.budgetHistoryHash === 'string')?.data.budgetHistoryHash;
    return { status: v.historyHash === ledgerHistory ? 'matches_latest_ledger' : 'journal_ahead_or_mismatch', observedAt: new Date().toISOString(),
      historyHash: v.historyHash, requests: v.requests.length, bookedMicroUsd: v.booked.toString(), heldMicroUsd: v.held.toString(),
      carried: v.carried, canReserve: v.canReserve, stopReason: v.stopReason, historicalBillingReconciled: false,
      authorization: v.authorization ? { runId: v.authorization.runId, expiresAt: v.authorization.expiresAt,
        limitMicroUsd: v.authorization.limitMicroUsd, maxRequests: v.authorization.maxRequests } : null };
  }
}
