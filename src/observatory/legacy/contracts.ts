/**
 * Observatory contracts (2026-10-23, docs/research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md).
 *
 * Read-only presentation of experiment evidence. Nothing here writes a ledger, an accounting
 * journal, world state or a provider message. Three kinds of record stay apart:
 *   - ObservatoryEvent: execution evidence normalized from the hash-chained continuation ledger;
 *   - EvaluationRecord: a result produced separately by a named framework, a declared metric or a
 *     human reviewer, with its own provenance and evaluated-through cursor;
 *   - AnnotationRecord (annotations.ts): attributed human commentary, never a score.
 */

export const OBSERVATORY_EVENT_SCHEMA = 'node-observatory-event-v1' as const;
export const EVALUATION_SCHEMA = 'node-observatory-evaluation-v1' as const;
export const REGISTRATION_SCHEMA = 'node-observatory-registration-v1' as const;

export interface EvidenceRef {
  segmentId: string; segmentRoot: string | null; seq: number; eventHash: string;
  requestId?: string; actorId?: string;
}

/** Ledger kinds, in the order the runner writes them. `start` and `tick_intent` are recorded by
 *  the runner too; the handover's proposed union omitted them, so they are added here. */
export const EVENT_TYPES = ['start', 'request', 'response', 'receipt', 'validation', 'tick_intent', 'transition', 'failure', 'stop'] as const;
export type EventType = typeof EVENT_TYPES[number];
export type Access = 'public_world' | 'researcher' | 'actor_authorized';
export type Verification = 'hash_checked_prefix' | 'replay_verified' | 'unverified';

export interface ObservatoryEvent {
  schema: typeof OBSERVATORY_EVENT_SCHEMA;
  experimentId: string; sourceRunId: string; segmentId: string;
  sourceRevision: string; genesisSourceRevision: string;
  /** `<segmentId>:<seq>`. Its meaning never changes when the segment is sealed. */
  cursor: string; segmentRoot: string | null; parentLedgerRoot: string | null;
  seq: number; eventHash: string;
  type: EventType;
  phase: 'execution';
  sourceTick: number; nextTick?: number;
  elapsedMs?: number;
  worldHashBefore?: string; worldHashAfter?: string;
  actorId?: string; requestId?: string;
  access: Access;
  verification: Verification;
  /** Allowlisted per type in ledgerTail.ts; never raw response bytes, signatures or secrets. */
  data: unknown;
}

export type EvaluationStatus = 'scored' | 'not_applicable' | 'not_scorable' | 'not_evaluated' | 'pending';
export interface EvaluationRecord {
  schema: typeof EVALUATION_SCHEMA;
  evaluationId: string; experimentId: string; inputLedgerRoot: string | null;
  inputEventHash: string; evaluatedThroughCursor: string;
  phase: 'evaluation';
  producer: { kind: 'framework' | 'human' | 'declared_metric'; name: string; version: string };
  executor?: { kind: 'human' | 'assistant' | 'process'; id: string };
  metricId?: string; metricVersion?: string; definition?: string;
  status: EvaluationStatus;
  value: number | string | null; unit?: string;
  numerator?: number; denominator?: number; exclusions?: Record<string, number>;
  scope: { actorId?: string; startTick: number; endTick: number };
  evidence: EvidenceRef[]; contractHash?: string;
  createdAt: string; evaluatedThroughTick: number;
  /** Why a status other than `scored` was recorded, in the producer's own terms. */
  reason?: string;
}

/** Trusted server configuration. Paths stay on the server and never appear in a response. */
export interface SegmentRegistration {
  segmentId: string;
  /** Private ledger file. Optional for a segment that only exists embedded as the next one's parent. */
  ledger?: string;
  /** Runner revision this segment must have been written by; when absent the start event's own
   *  claim is used and the evidence panel says it was not pinned. */
  sourceRevision?: string;
}
export interface ExperimentRegistration {
  schema: typeof REGISTRATION_SCHEMA;
  experimentId: string;
  label?: string;
  /** True for TEST-ONLY offline runs; the interface labels every view of it as synthetic. */
  synthetic?: boolean;
  /** Oldest first. Each later segment's start event must embed the previous segment as its parent. */
  segments: SegmentRegistration[];
  /** Separately produced EvaluationRecord JSONL files. */
  evaluations?: string[];
  /** Independent fixture/Study samples; never assigned a continuation cursor or tick. */
  sampleEvaluations?: string[];
  /** Append-only annotation JSONL file for this experiment. */
  annotations?: string;
}

const id = (v: unknown, max = 128): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]+$/.test(v) && v.length <= max;
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function validateRegistration(r: ExperimentRegistration): ExperimentRegistration {
  if (r?.schema !== REGISTRATION_SCHEMA || !id(r.experimentId) || !Array.isArray(r.segments) || !r.segments.length ||
      new Set(r.segments.map(s => s.segmentId)).size !== r.segments.length ||
      !r.segments.every(s => id(s.segmentId) && (s.ledger === undefined || typeof s.ledger === 'string') &&
        (s.sourceRevision === undefined || /^[a-f0-9]{40}$/.test(s.sourceRevision))) ||
      typeof r.segments.at(-1)!.ledger !== 'string' ||
      (r.evaluations !== undefined && !(Array.isArray(r.evaluations) && r.evaluations.every(p => typeof p === 'string'))) ||
      (r.sampleEvaluations !== undefined && !(Array.isArray(r.sampleEvaluations) && r.sampleEvaluations.length <= 100 && r.sampleEvaluations.every(p => typeof p === 'string' && p.length > 0))) ||
      (r.annotations !== undefined && typeof r.annotations !== 'string')) throw Error('observatory_registration_invalid');
  return r;
}

const STATUSES: readonly EvaluationStatus[] = ['scored', 'not_applicable', 'not_scorable', 'not_evaluated', 'pending'];
/** A record that does not carry its provenance is refused, never displayed as a result. */
export function validateEvaluationRecord(r: EvaluationRecord): EvaluationRecord {
  const ok = r?.schema === EVALUATION_SCHEMA && id(r.evaluationId, 200) && id(r.experimentId) && r.phase === 'evaluation' &&
    (r.inputLedgerRoot === null || hex(r.inputLedgerRoot)) && typeof r.inputEventHash === 'string' && r.inputEventHash.length > 0 &&
    typeof r.evaluatedThroughCursor === 'string' && r.evaluatedThroughCursor.length > 0 &&
    ['framework', 'human', 'declared_metric'].includes(r.producer?.kind) && typeof r.producer.name === 'string' && r.producer.name.length > 0 &&
    typeof r.producer.version === 'string' && r.producer.version.length > 0 &&
    (r.executor === undefined || ['human', 'assistant', 'process'].includes(r.executor.kind) && typeof r.executor.id === 'string') &&
    STATUSES.includes(r.status) &&
    (r.value === null || typeof r.value === 'string' || typeof r.value === 'number' && Number.isFinite(r.value)) &&
    // A scored value needs a stated metric; any non-scored status carries no value.
    (r.status !== 'scored' || typeof r.metricId === 'string' && typeof r.definition === 'string' && r.value !== null) &&
    (r.status === 'scored' || r.value === null) &&
    (r.producer.kind !== 'declared_metric' || typeof r.definition === 'string') &&
    (r.numerator === undefined || int(r.numerator)) && (r.denominator === undefined || int(r.denominator)) &&
    (r.exclusions === undefined || Object.values(r.exclusions).every(int)) &&
    int(r.scope?.startTick) && int(r.scope.endTick) && r.scope.endTick >= r.scope.startTick &&
    Array.isArray(r.evidence) && typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) &&
    int(r.evaluatedThroughTick);
  if (!ok) throw Error('observatory_evaluation_invalid');
  return r;
}
