import { lstatSync, readFileSync } from 'node:fs';
import type { Point } from './source.js';

export interface EvaluationRecord {
  schema: 'node-observatory-evaluation-v1'; evaluationId: string; experimentId: string; phase: 'evaluation';
  inputLedgerRoot: string | null; inputEventHash: string; evaluatedThroughCursor: string; evaluatedThroughTick: number;
  producer: { kind: 'framework' | 'human' | 'declared_metric'; name: string; version: string };
  executor?: { kind: 'human' | 'assistant' | 'process'; id: string };
  metricId: string; metricVersion: string; definition: string;
  status: 'scored' | 'not_applicable' | 'not_scorable' | 'not_evaluated' | 'pending';
  value: number | string | null; unit?: string; numerator?: number; denominator?: number; exclusions?: Record<string, number>;
  scope: { actorId?: string; startTick: number; endTick: number };
  evidence: { segmentId: string; seq: number; eventHash: string }[];
  contractHash?: string; createdAt: string;
}
const text = (v: unknown, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max;
const tick = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
/** Import results produced elsewhere, never interpret a summary as a score. Return an
 * allowlist so extra private export fields cannot escape through this endpoint. */
export function readEvaluations(path: string | string[] | undefined, experimentId: string, points: readonly Point[], cursor: string) {
  if (!path) return [];
  const paths = typeof path === 'string' ? [path] : path;
  if (!Array.isArray(paths) || paths.length > 32) throw Error('observatory_evaluation_bounds');
  const records = paths.flatMap(path => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw Error('observatory_evaluation_bounds');
    const records: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(records)) throw Error('observatory_evaluation_schema');
    return records as EvaluationRecord[];
  });
  if (!Array.isArray(records) || records.length > 10000) throw Error('observatory_evaluation_schema');
  const selected = points.findIndex(p => p.cursor === cursor), ids = new Set<string>();
  const out: EvaluationRecord[] = [];
  for (const r of records) {
    const through = points.findIndex(p => p.cursor === r.evaluatedThroughCursor), p = points[through];
    const endTick = p?.event.kind === 'transition' ? p.event.data.nextTick : p?.event.data.summary?.ticks ?? p?.event.data.tick ?? 0;
    if (r.schema !== 'node-observatory-evaluation-v1' || r.phase !== 'evaluation' || r.experimentId !== experimentId ||
        !text(r.evaluationId) || ids.has(r.evaluationId) || !p || r.inputEventHash !== p.event.hash ||
        r.inputLedgerRoot !== null && (!p.events.some(e => e.kind === 'stop' && e.hash === r.inputLedgerRoot) || p.events.at(-1)?.hash !== r.inputLedgerRoot) ||
        !r.producer || !['framework', 'human', 'declared_metric'].includes(r.producer.kind) || !text(r.producer.name) || !text(r.producer.version) ||
        r.executor !== undefined && (!['human', 'assistant', 'process'].includes(r.executor.kind) || !text(r.executor.id)) ||
        !text(r.metricId) || !text(r.metricVersion) || !text(r.definition, 8000) ||
        !['scored', 'not_applicable', 'not_scorable', 'not_evaluated', 'pending'].includes(r.status) ||
        (r.status === 'scored' ? !(typeof r.value === 'number' && Number.isFinite(r.value) || text(r.value, 8000)) : r.value !== null) ||
        !r.scope || !tick(r.scope.startTick) || !tick(r.scope.endTick) || r.scope.startTick > r.scope.endTick ||
        r.scope.actorId !== undefined && !p.start.plan.actors.some(a => a.actorId === r.scope.actorId) ||
        r.evaluatedThroughTick !== endTick || r.scope.endTick > r.evaluatedThroughTick || !text(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt)) ||
        !Array.isArray(r.evidence) || !r.evidence.length || r.evidence.some(e => !points.slice(0, through + 1).some(q => q.segmentId === e.segmentId && q.event.seq === e.seq && q.event.hash === e.eventHash)) ||
        r.numerator !== undefined && (!tick(r.numerator) || r.denominator === undefined || r.numerator > r.denominator) ||
        r.denominator !== undefined && !tick(r.denominator) ||
        r.unit !== undefined && !text(r.unit) ||
        r.contractHash !== undefined && !/^[a-f0-9]{64}$/.test(r.contractHash) ||
        r.exclusions !== undefined && (!r.exclusions || typeof r.exclusions !== 'object' || Object.values(r.exclusions).some(v => !tick(v)))) throw Error('observatory_evaluation_provenance');
    ids.add(r.evaluationId);
    if (through > selected) continue; // an evaluation cannot appear on an earlier frame
    out.push({ schema: r.schema, evaluationId: r.evaluationId, experimentId, phase: 'evaluation', inputLedgerRoot: r.inputLedgerRoot,
      inputEventHash: r.inputEventHash, evaluatedThroughCursor: r.evaluatedThroughCursor, evaluatedThroughTick: r.evaluatedThroughTick,
      producer: { kind: r.producer.kind, name: r.producer.name, version: r.producer.version },
      ...(r.executor ? { executor: { kind: r.executor.kind, id: r.executor.id } } : {}),
      metricId: r.metricId, metricVersion: r.metricVersion, definition: r.definition, status: r.status, value: r.value,
      ...(r.unit ? { unit: r.unit } : {}), ...(r.numerator !== undefined ? { numerator: r.numerator } : {}),
      ...(r.denominator !== undefined ? { denominator: r.denominator } : {}), ...(r.exclusions ? { exclusions: r.exclusions } : {}),
      scope: { startTick: r.scope.startTick, endTick: r.scope.endTick, ...(r.scope.actorId ? { actorId: r.scope.actorId } : {}) },
      evidence: r.evidence.map(e => ({ segmentId: e.segmentId, seq: e.seq, eventHash: e.eventHash })),
      ...(r.contractHash ? { contractHash: r.contractHash } : {}), createdAt: r.createdAt });
  }
  return out;
}
