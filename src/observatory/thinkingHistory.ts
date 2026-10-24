/** Researcher-only, longitudinal presentation of recorded provider summaries. No inference. */
import type { DecisionRecord, ReasoningDisplayStatus } from './reasoning.js';
import type { TimelineCall, TimelineTick } from './timeline.js';

export interface ReasoningRecord extends DecisionRecord {
  status: ReasoningDisplayStatus;
  stage: TimelineCall['stage'];
  admissionStatus: 'pending' | 'admitted' | 'rejected';
  summaries: string[];
}
export interface TickThinking {
  tick: number; segmentId: string; committed: boolean; verification: string;
  worldHash: string | null; nextWorldHash: string | null; transitionCursor: string | null;
  decisions: ReasoningRecord[];
}
export interface ThinkingQuery {
  actorId?: string; tickFrom?: number; tickTo?: number; status?: string; summaryKeyword?: string;
}
export interface ThinkingHistory {
  schema: 'node-observatory-thinking-history-v1';
  experimentId: string;
  evidenceKind: 'provider_returned_summaries';
  scope: 'researcher';
  selection: ThinkingQuery;
  ticks: TickThinking[];
  stats: {
    totalDecisions: number; totalTicks: number; decisionsByStatus: Record<string, number>;
    admitted: number; rejected: number; pendingAdmission: number; executed: number;
    avgLatencyMs: number | null;
  };
}

function stats(ticks: TickThinking[]): ThinkingHistory['stats'] {
  const rows = ticks.flatMap(t => t.decisions), times = rows.flatMap(d => d.latencyMs === null ? [] : [d.latencyMs]);
  const counts: Record<string, number> = {};
  for (const d of rows) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return { totalDecisions: rows.length, totalTicks: ticks.length, decisionsByStatus: counts,
    admitted: rows.filter(d => d.admissionStatus === 'admitted').length,
    rejected: rows.filter(d => d.admissionStatus === 'rejected').length,
    pendingAdmission: rows.filter(d => d.admissionStatus === 'pending').length,
    executed: rows.filter(d => d.executed).length,
    avgLatencyMs: times.length ? times.reduce((sum, t) => sum + t, 0) / times.length : null };
}

/** Join verified timeline requests to the existing decision reader; refuse missing/mismatched rows. */
export function buildThinkingHistory(experimentId: string, timeline: readonly TimelineTick[], decisions: ReadonlyMap<string, DecisionRecord>): ThinkingHistory {
  const seen = new Set<string>();
  const ticks = [...timeline].sort((a, b) => a.tick - b.tick).map(t => ({
    tick: t.tick, segmentId: t.segmentId, committed: t.committed, verification: t.verification,
    worldHash: t.worldHashBefore, nextWorldHash: t.worldHashAfter, transitionCursor: t.transitionCursor,
    decisions: t.calls.map(call => {
      const d = decisions.get(call.requestId);
      if (!d || d.requestId !== call.requestId || d.actorId !== call.actorId || d.tick !== t.tick || seen.has(d.requestId)) {
        throw Error('observatory_thinking_join_mismatch');
      }
      seen.add(d.requestId);
      return { ...d, reasoning: { ...d.reasoning, summaries: [...d.reasoning.summaries] },
        status: d.reasoning.status, summaries: [...d.reasoning.summaries], stage: call.stage,
        admissionStatus: (call.stage === 'rejected' ? 'rejected' : d.admitted !== null ? 'admitted' : 'pending') as ReasoningRecord['admissionStatus'] };
    }),
  }));
  return { schema: 'node-observatory-thinking-history-v1', experimentId,
    evidenceKind: 'provider_returned_summaries', scope: 'researcher', selection: {}, ticks, stats: stats(ticks) };
}

export function filterThinkingHistory(history: ThinkingHistory, query: ThinkingQuery): ThinkingHistory {
  for (const n of [query.tickFrom, query.tickTo]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) throw Error('observatory_thinking_tick_range');
  if (query.tickFrom !== undefined && query.tickTo !== undefined && query.tickFrom > query.tickTo) throw Error('observatory_thinking_tick_range');
  const needle = query.summaryKeyword?.toLocaleLowerCase();
  const ticks = history.ticks.filter(t => (query.tickFrom === undefined || t.tick >= query.tickFrom) && (query.tickTo === undefined || t.tick <= query.tickTo))
    .map(t => ({ ...t, decisions: t.decisions.filter(d => (!query.actorId || d.actorId === query.actorId) && (!query.status || d.status === query.status) &&
      (!needle || d.actorId.toLocaleLowerCase().includes(needle) || d.requestId.toLocaleLowerCase().includes(needle) || d.summaries.some(s => s.toLocaleLowerCase().includes(needle)))) }))
    .filter(t => t.decisions.length > 0);
  return { ...history, selection: { ...query }, ticks, stats: stats(ticks) };
}

export function searchThinking(history: ThinkingHistory, query: ThinkingQuery): ReasoningRecord[] {
  return filterThinkingHistory(history, query).ticks.flatMap(t => t.decisions);
}
export function exportThinkingJSON(history: ThinkingHistory, range?: { from: number; to: number }): string {
  return JSON.stringify(range ? filterThinkingHistory(history, { tickFrom: range.from, tickTo: range.to }) : history, null, 2);
}
/** RFC 4180 quoting; formula-like text is inert in spreadsheet applications. JSON stays verbatim. */
function csv(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportThinkingCSV(history: ThinkingHistory, range?: { from: number; to: number }): string {
  const selected = range ? filterThinkingHistory(history, { tickFrom: range.from, tickTo: range.to }) : history;
  const rows: unknown[][] = [['tick', 'segmentId', 'worldHash', 'nextWorldHash', 'requestId', 'cursor', 'actorId', 'reasoningStatus', 'stage', 'admissionStatus', 'proposed', 'admitted', 'executed', 'summaries', 'latencyMs', 'source', 'redactedBlocks', 'signedBlocks', 'stopReason']];
  for (const t of selected.ticks) for (const d of t.decisions) rows.push([t.tick, t.segmentId, t.worldHash, t.nextWorldHash, d.requestId, d.cursor, d.actorId,
    d.status, d.stage, d.admissionStatus, d.proposed, d.admitted, d.executed, d.summaries.join('\n\n'), d.latencyMs, d.reasoning.source,
    d.reasoning.redactedBlocks, d.reasoning.signedBlocks, d.stopReason]);
  return rows.map(row => row.map(csv).join(',')).join('\r\n') + '\r\n';
}
export function formatForExternalModel(history: ThinkingHistory, format: 'json' | 'markdown' | 'text' = 'markdown'): string {
  if (format === 'json') return exportThinkingJSON(history);
  // A long enough fence keeps returned text and complete actions literal when Markdown is viewed.
  const body = JSON.stringify(history, null, 2);
  if (format === 'text') return body;
  const fence = '`'.repeat(Math.max(3, ...Array.from(body.matchAll(/`+/g), m => m[0].length + 1)));
  return '# Recorded thinking history\n\nProvider-returned summaries and execution evidence. No inferred internal thoughts or evaluation scores.\n\n' + fence + 'json\n' + body + '\n' + fence + '\n';
}
export interface ExternalModelRequest {
  type: 'query' | 'analyze' | 'export' | 'stream'; thinkingHistory?: ThinkingHistory; query?: string;
  tickRange?: { from: number; to: number }; actorIds?: string[]; format?: 'json' | 'csv' | 'markdown' | 'text';
}
/** Offline payload preparation only. This function never sends a request or starts an evaluator. */
export function buildExternalModelPayload(history: ThinkingHistory, request: ExternalModelRequest): ExternalModelRequest & { thinkingHistory: ThinkingHistory } {
  let selected = request.tickRange ? filterThinkingHistory(history, { tickFrom: request.tickRange.from, tickTo: request.tickRange.to }) : history;
  if (request.actorIds) {
    const ids = new Set(request.actorIds);
    const ticks = selected.ticks.map(t => ({ ...t, decisions: t.decisions.filter(d => ids.has(d.actorId)) })).filter(t => t.decisions.length);
    selected = { ...selected, ticks, stats: stats(ticks) };
  }
  return { ...request, thinkingHistory: selected };
}
