/**
 * Tick-by-tick join of normalized execution events: observation at tick n -> request -> returned
 * summary -> proposal -> validation -> committed transition n -> n+1. A tick without its
 * transition is shown as pending; it never moves the committed world.
 */
import type { ObservatoryEvent } from './contracts.js';

export interface TimelineCall {
  requestId: string; actorId: string; requestCursor: string;
  stage: 'requested' | 'response_recorded' | 'receipt_recorded' | 'validated' | 'rejected' | 'transport_failed';
  reasoningStatus: string | null; summaries: string[]; redactedBlocks: number;
  proposed: unknown; admitted: unknown; executed: boolean; latencyMs: number | null;
  inputTokens: number | null; outputTokens: number | null;
}
export interface TimelineTick {
  tick: number; segmentId: string; committed: boolean;
  worldHashBefore: string | null; worldHashAfter: string | null;
  transitionCursor: string | null; verification: string;
  calls: TimelineCall[]; effects: { actorId: string; category: string }[];
}

export function timeline(events: readonly ObservatoryEvent[]): TimelineTick[] {
  const ticks = new Map<number, TimelineTick>();
  const calls = new Map<string, TimelineCall>();
  const tickOf = (t: number, e: ObservatoryEvent) => {
    let x = ticks.get(t);
    if (!x) { x = { tick: t, segmentId: e.segmentId, committed: false, worldHashBefore: null, worldHashAfter: null, transitionCursor: null, verification: e.verification, calls: [], effects: [] }; ticks.set(t, x); }
    return x;
  };
  for (const e of events) {
    const d = e.data as Record<string, any>;
    if (e.type === 'request') {
      const call: TimelineCall = { requestId: e.requestId!, actorId: e.actorId!, requestCursor: e.cursor, stage: 'requested', reasoningStatus: 'pending',
        summaries: [], redactedBlocks: 0, proposed: null, admitted: null, executed: false, latencyMs: null, inputTokens: null, outputTokens: null };
      calls.set(call.requestId, call);
      const t = tickOf(d.tick, e); t.calls.push(call); t.worldHashBefore ??= d.worldHash; t.verification = e.verification;
    } else if (e.type === 'response') {
      const c = calls.get(e.requestId!); if (c) { c.stage = 'response_recorded'; c.latencyMs = d.latencyMs; }
    } else if (e.type === 'receipt') {
      const c = calls.get(e.requestId!);
      if (c) { c.stage = 'receipt_recorded'; c.reasoningStatus = d.reasoning.status; c.summaries = d.reasoning.summaries; c.redactedBlocks = d.reasoning.redactedBlocks;
        c.proposed = d.proposed; c.inputTokens = d.inputTokens; c.outputTokens = d.outputTokens; }
    } else if (e.type === 'validation') {
      const c = calls.get(e.requestId!); if (c) { c.admitted = d.admitted; c.stage = d.admitted === null ? 'rejected' : 'validated'; }
    } else if (e.type === 'failure') {
      const c = calls.get(e.requestId!); if (c) { c.stage = 'transport_failed'; c.reasoningStatus = 'absent_transport_failed'; }
    } else if (e.type === 'transition') {
      const t = tickOf(d.tick, e);
      Object.assign(t, { committed: true, worldHashBefore: d.beforeHash, worldHashAfter: d.afterHash, transitionCursor: e.cursor, verification: e.verification, effects: d.effects });
      for (const id of Object.values(d.requests as Record<string, string>)) { const c = calls.get(id); if (c) c.executed = true; }
    }
  }
  return [...ticks.values()].sort((a, b) => a.tick - b.tick);
}
